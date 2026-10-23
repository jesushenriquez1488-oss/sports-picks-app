// ============================================================
// CASHEDGE FANTASY NFL — CARGA SEMANAL DE NFLVERSE
// ============================================================
//
// Es el UNICO lugar de Fantasy NFL que descarga NFLverse.
// Baja y GUARDA en Supabase (la formula lee solo de ahi):
//
//   football_schedule              calendario (rival, local, techo,
//                                  clima, hora, QB titular real)
//   football_player_week_stats     produccion de cada jugador
//   football_player_week_expected  TD y yardas "que debieron ser"
//   football_team_week_stats       ofensiva y defensa por equipo (DST)
//
// Cada parte es independiente: si una fuente falla, las demas
// se guardan igual y el error sale en el reporte.
//
// USO
//   /api/fantasy-nfl-weekly?secret=...                         -> temporada actual
//   /api/fantasy-nfl-weekly?secret=...&seasons=2025,2026       -> carga inicial
//   /api/fantasy-nfl-weekly?secret=...&seasons=2022,2023,2024  -> historial (clima)
//
// Cron: martes en la manana (despues del Monday Night).
// Volver a correrlo no duplica nada (reemplaza cada fila).
//
// NO toca nfl_*, football_player_game_stats, picks ni
// ningun otro cron.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download/";
const PLAYER_URL = season => `${RELEASES}stats_player/stats_player_week_${season}.csv`;
const TEAM_URL = season => `${RELEASES}stats_team/stats_team_week_${season}.csv`;
const EXPECTED_URL = season =>
  `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`;
const SCHEDULE_URLS = [
  `${RELEASES}schedules/games.csv`,
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
];

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);
const FIRST_SEASON = 2016;
const MAX_SEASONS_PER_CALL = 3;

// ---------- Columnas que DEBEN existir en cada archivo ----------

const SCHEDULE_REQUIRED = [
  "game_id", "season", "game_type", "week", "gameday",
  "away_team", "home_team", "away_score", "home_score"
];
const SCHEDULE_OPTIONAL = [
  "weekday", "gametime", "overtime", "location", "away_rest", "home_rest",
  "div_game", "roof", "surface", "temp", "wind", "stadium_id", "stadium",
  "away_qb_id", "home_qb_id", "away_qb_name", "home_qb_name", "espn"
];

// Las mismas que exigia stats-bridge.js.
const PLAYER_REQUIRED = [
  "player_id", "player_name", "player_display_name", "position", "team",
  "season", "week", "season_type", "game_id",
  "attempts", "carries", "targets",
  "passing_yards", "passing_tds", "passing_interceptions",
  "rushing_yards", "rushing_tds",
  "receptions", "receiving_yards", "receiving_tds",
  "fumbles_lost_total",
  "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions",
  "special_teams_tds", "fumble_recovery_tds"
];
const PLAYER_OPTIONAL = [
  "completions", "opponent_team",
  "passing_air_yards", "receiving_air_yards", "receiving_yards_after_catch",
  "target_share", "air_yards_share", "wopr"
];

const EXPECTED_REQUIRED = [
  "season", "posteam", "week", "game_id", "player_id",
  "pass_attempt", "rec_attempt", "rush_attempt",
  "pass_touchdown_exp", "rec_touchdown_exp", "rush_touchdown_exp"
];
const EXPECTED_OPTIONAL = [
  "full_name", "position", "pass_air_yards", "rec_air_yards",
  "pass_completions_exp", "receptions_exp",
  "pass_yards_gained_exp", "rec_yards_gained_exp", "rush_yards_gained_exp",
  "pass_interception_exp",
  "pass_two_point_conv_exp", "rec_two_point_conv_exp", "rush_two_point_conv_exp"
];

const TEAM_REQUIRED = [
  "season", "week", "team", "season_type", "game_id", "opponent_team",
  "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
  "sacks_suffered", "carries", "rushing_yards", "rushing_tds",
  "targets", "receptions", "fumbles_lost_total",
  "def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "def_safeties",
  "def_punt_blocks", "def_fg_blocks", "def_pat_blocks", "special_teams_tds"
];
const TEAM_OPTIONAL = ["passing_air_yards"];

// NFL: la temporada 2026 va de septiembre 2026 a febrero 2027.
function currentNFLSeason() {
  const now = new Date();
  return now.getMonth() + 1 >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}


// ============================================================
// LECTURA DEL CSV (de stats-bridge.js, con columnas opcionales)
// ============================================================

function parseCSV(text, required, optional = []) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("CSV vacio");
  }

  const results = [];
  let headers = null;
  let indexes = [];
  let fields = [];
  let field = "";
  let quoted = false;

  const finishRow = () => {
    fields.push(field);
    field = "";

    if (!headers) {
      headers = fields.map(v => v.replace(/^﻿/, "").trim());
      const missing = required.filter(name => !headers.includes(name));
      if (missing.length) {
        throw new Error("CSV columnas faltantes: " + missing.join(", "));
      }
      const wanted = new Set([...required, ...optional]);
      indexes = headers.map((name, i) => (wanted.has(name) ? [name, i] : null)).filter(Boolean);
    } else if (fields.some(v => v !== "")) {
      const obj = {};
      for (const [name, i] of indexes) obj[name] = fields[i] ?? "";
      results.push(obj);
    }
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (fields.length || field.length) finishRow();
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV con comillas incompletas");
  if (fields.length || field.length) finishRow();

  return { headers, rows: results };
}

const isEmpty = raw => raw === "" || raw === null || raw === undefined || raw === "NA";

function required(row, key) {
  const raw = row[key];
  if (isEmpty(raw)) throw new Error(`${key} sin valor`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} invalido`);
  return value;
}

function optional(row, key) {
  const raw = row[key];
  if (isEmpty(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function text(row, key) {
  const raw = row[key];
  if (isEmpty(raw)) return null;
  const value = String(raw).trim();
  return value || null;
}

function bool(row, key) {
  const raw = text(row, key);
  if (raw === null) return null;
  if (/^(1|true|TRUE|T)$/.test(raw)) return true;
  if (/^(0|false|FALSE|F)$/.test(raw)) return false;
  return null;
}

const round = (value, digits = 4) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;


// ============================================================
// DESCARGA Y GUARDADO
// ============================================================

async function getText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CashEdge-Fantasy/1.0" },
        signal: AbortSignal.timeout(60000)
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status} ${url}`);
      if (response.status === 404) throw lastError;
    } catch (error) {
      lastError = error;
      if (/HTTP 404/.test(error.message)) throw error;
    }
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  throw lastError;
}

async function upsertAll(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}

function newReport(headers, optionalColumns, rowsRead) {
  return {
    filasLeidas: rowsRead,
    guardadas: 0,
    semanas: [],
    descartadas: {},
    duplicadas: 0,
    columnasOpcionalesFaltantes: optionalColumns.filter(c => !headers.includes(c))
  };
}

const addSkip = (report, reason) =>
  (report.descartadas[reason] = (report.descartadas[reason] || 0) + 1);

// Quita duplicados por llave, cuenta descartes, guarda y cierra el reporte.
async function saveRows(table, onConflict, keyOf, list, report) {
  const out = new Map();
  for (const row of list) {
    const key = keyOf(row);
    if (out.has(key)) {
      report.duplicadas++;
      continue;
    }
    out.set(key, row);
  }
  const rows = [...out.values()];
  await upsertAll(table, rows, onConflict);
  report.guardadas = rows.length;
  report.semanas = [...new Set(rows.map(r => r.week))].sort((a, b) => a - b);
  return rows;
}


// ============================================================
// 1) CALENDARIO
// ============================================================

async function downloadSchedule() {
  let lastError = null;
  for (const url of SCHEDULE_URLS) {
    try {
      return parseCSV(await getText(url), SCHEDULE_REQUIRED, SCHEDULE_OPTIONAL);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeSchedule(row) {
  const date = String(row.gameday || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("gameday invalido");
  const away = text(row, "away_team");
  const home = text(row, "home_team");
  if (!away || !home || !text(row, "game_id")) throw new Error("partido sin equipos");

  return {
    game_id: row.game_id,
    season: required(row, "season"),
    game_type: text(row, "game_type") || "REG",
    week: required(row, "week"),
    game_date: date,
    weekday: text(row, "weekday"),
    game_time_et: text(row, "gametime"),
    away_team: away,
    home_team: home,
    away_score: optional(row, "away_score"),
    home_score: optional(row, "home_score"),
    overtime: bool(row, "overtime"),
    location: text(row, "location"),
    away_rest: optional(row, "away_rest"),
    home_rest: optional(row, "home_rest"),
    div_game: bool(row, "div_game"),
    roof: text(row, "roof"),
    surface: text(row, "surface"),
    temp: optional(row, "temp"),
    wind: optional(row, "wind"),
    stadium_id: text(row, "stadium_id"),
    stadium: text(row, "stadium"),
    away_qb_id: text(row, "away_qb_id"),
    home_qb_id: text(row, "home_qb_id"),
    away_qb_name: text(row, "away_qb_name"),
    home_qb_name: text(row, "home_qb_name"),
    espn_game_id: text(row, "espn"),
    synced_at: new Date().toISOString()
  };
}

async function saveSchedule(parsed, season) {
  const report = newReport(parsed.headers, SCHEDULE_OPTIONAL, 0);
  const list = [];
  for (const row of parsed.rows) {
    if (String(row.season) !== String(season)) continue;
    report.filasLeidas++;
    try {
      list.push(normalizeSchedule(row));
    } catch (error) {
      addSkip(report, "dato_invalido");
    }
  }
  const rows = await saveRows("football_schedule", "game_id", r => r.game_id, list, report);
  report.temporadaRegular = rows.filter(r => r.game_type === "REG").length;
  report.jugados = rows.filter(r => r.home_score !== null && r.away_score !== null).length;
  return report;
}


// ============================================================
// 2) PRODUCCION DE JUGADORES
// ============================================================

function normalize(row, schedule) {
  const gsis = text(row, "player_id") || "";
  const position = String(row.position || "").trim().toUpperCase();
  const team = String(row.team || "").trim();
  const game = schedule.get(row.game_id);
  const date = String(game?.gameday || "").slice(0, 10);

  if (!gsis || !row.player_name || !team || !POSITIONS.has(position)) return { skip: "posicion_o_identidad" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { skip: "sin_calendario" };

  const isHome = game.home_team === team ? true : game.away_team === team ? false : null;
  const opponent = String(row.opponent_team || "").trim() ||
    (isHome === true ? game.away_team : isHome === false ? game.home_team : null);

  return {
    row: {
      gsis_player_id: gsis,
      game_id: row.game_id,
      season: required(row, "season"),
      week: required(row, "week"),
      game_date: date,
      player_name: String(row.player_display_name || "").trim() || row.player_name,
      position,
      team,
      opponent: opponent || null,
      is_home: isHome,

      completions: optional(row, "completions"),
      passing_attempts: required(row, "attempts"),
      passing_yards: required(row, "passing_yards"),
      passing_tds: required(row, "passing_tds"),
      interceptions: required(row, "passing_interceptions"),
      passing_air_yards: optional(row, "passing_air_yards"),

      rushing_attempts: required(row, "carries"),
      rushing_yards: required(row, "rushing_yards"),
      rushing_tds: required(row, "rushing_tds"),

      targets: required(row, "targets"),
      receptions: required(row, "receptions"),
      receiving_yards: required(row, "receiving_yards"),
      receiving_tds: required(row, "receiving_tds"),
      receiving_air_yards: optional(row, "receiving_air_yards"),
      yards_after_catch: optional(row, "receiving_yards_after_catch"),

      target_share: optional(row, "target_share"),
      air_yards_share: optional(row, "air_yards_share"),
      wopr: optional(row, "wopr"),

      // Total consolidado: no sumar por categoria.
      fumbles_lost: required(row, "fumbles_lost_total"),
      two_point_conversions:
        required(row, "passing_2pt_conversions") +
        required(row, "rushing_2pt_conversions") +
        required(row, "receiving_2pt_conversions"),
      return_tds: required(row, "special_teams_tds"),
      fumble_recovery_tds: required(row, "fumble_recovery_tds"),

      source: "nflverse-stats-player-week",
      synced_at: new Date().toISOString()
    }
  };
}

async function loadPlayers(season, schedule) {
  const { headers, rows } = parseCSV(await getText(PLAYER_URL(season)), PLAYER_REQUIRED, PLAYER_OPTIONAL);
  const report = newReport(headers, PLAYER_OPTIONAL, rows.length);
  const list = [];

  for (const row of rows) {
    // Solo temporada regular (los playoffs cambian las rotaciones).
    if (String(row.season_type).toUpperCase() !== "REG") {
      addSkip(report, "no_temporada_regular");
      continue;
    }
    let result;
    try {
      result = normalize(row, schedule);
    } catch (error) {
      addSkip(report, "dato_invalido");
      continue;
    }
    if (result.skip) {
      addSkip(report, result.skip);
      continue;
    }
    list.push(result.row);
  }

  const saved = await saveRows(
    "football_player_week_stats", "gsis_player_id,game_id",
    r => `${r.gsis_player_id}|${r.game_id}`, list, report
  );
  report.jugadores = new Set(saved.map(r => r.gsis_player_id)).size;
  return report;
}


// ============================================================
// 3) TD Y YARDAS ESPERADAS (ffopportunity)
// ============================================================

// Posiciones que se descartan. "NA" (vacia) se CONSERVA: la
// formula toma la posicion de football_player_week_stats.
const NON_OFFENSE = new Set(["OL", "T", "G", "C", "OT", "OG", "DB", "CB", "S", "LB", "DL", "DE", "DT", "K", "P", "LS"]);

function normalizeExpected(row, schedule) {
  // player_id "NA" = pases sin receptor identificado (no son de nadie).
  const gsis = text(row, "player_id");
  const team = text(row, "posteam");
  const position = text(row, "position")?.toUpperCase() || null;
  const game = schedule.get(row.game_id);

  if (!gsis || !team) return { skip: "sin_identidad" };
  if (position && (NON_OFFENSE.has(position) || !POSITIONS.has(position))) return { skip: "no_ofensivo" };
  if (!game) return { skip: "sin_calendario" };
  if (String(game.game_type || "REG") !== "REG") return { skip: "no_temporada_regular" };

  const twoPoint = ["pass_two_point_conv_exp", "rec_two_point_conv_exp", "rush_two_point_conv_exp"]
    .map(k => optional(row, k));

  return {
    row: {
      gsis_player_id: gsis,
      game_id: row.game_id,
      season: required(row, "season"),
      week: required(row, "week"),
      team,
      position,
      player_name: text(row, "full_name"),

      pass_attempts: required(row, "pass_attempt"),
      targets: required(row, "rec_attempt"),
      rush_attempts: required(row, "rush_attempt"),
      pass_air_yards: round(optional(row, "pass_air_yards"), 2),
      rec_air_yards: round(optional(row, "rec_air_yards"), 2),

      pass_completions_exp: round(optional(row, "pass_completions_exp")),
      receptions_exp: round(optional(row, "receptions_exp")),
      pass_yards_exp: round(optional(row, "pass_yards_gained_exp")),
      rec_yards_exp: round(optional(row, "rec_yards_gained_exp")),
      rush_yards_exp: round(optional(row, "rush_yards_gained_exp")),
      pass_td_exp: round(required(row, "pass_touchdown_exp")),
      rec_td_exp: round(required(row, "rec_touchdown_exp")),
      rush_td_exp: round(required(row, "rush_touchdown_exp")),
      pass_int_exp: round(optional(row, "pass_interception_exp")),
      two_point_exp: twoPoint.every(v => v === null) ? null : round(twoPoint.reduce((s, v) => s + (v || 0), 0)),

      source: "ffopportunity-ep-weekly",
      synced_at: new Date().toISOString()
    }
  };
}

async function loadExpected(season, schedule) {
  const { headers, rows } = parseCSV(await getText(EXPECTED_URL(season)), EXPECTED_REQUIRED, EXPECTED_OPTIONAL);
  const report = newReport(headers, EXPECTED_OPTIONAL, rows.length);
  const list = [];

  for (const row of rows) {
    let result;
    try {
      result = normalizeExpected(row, schedule);
    } catch (error) {
      addSkip(report, "dato_invalido");
      continue;
    }
    if (result.skip) {
      addSkip(report, result.skip);
      continue;
    }
    list.push(result.row);
  }

  const saved = await saveRows(
    "football_player_week_expected", "gsis_player_id,game_id",
    r => `${r.gsis_player_id}|${r.game_id}`, list, report
  );
  report.jugadores = new Set(saved.map(r => r.gsis_player_id)).size;
  report.sinPosicion = saved.filter(r => !r.position).length;
  return report;
}


// ============================================================
// 4) EQUIPO POR PARTIDO (ofensiva + defensa para la DST)
// ============================================================

function normalizeTeam(row, schedule) {
  const team = String(row.team || "").trim();
  const game = schedule.get(row.game_id);
  if (!team) return { skip: "sin_equipo" };
  if (!game) return { skip: "sin_calendario" };

  const isHome = game.home_team === team ? true : game.away_team === team ? false : null;
  const homeScore = optional(game, "home_score");
  const awayScore = optional(game, "away_score");

  return {
    row: {
      team,
      game_id: row.game_id,
      season: required(row, "season"),
      week: required(row, "week"),
      game_date: String(game.gameday || "").slice(0, 10) || null,
      opponent: text(row, "opponent_team") ||
        (isHome === true ? game.away_team : isHome === false ? game.home_team : null),
      is_home: isHome,
      points_for: isHome === null ? null : isHome ? homeScore : awayScore,
      points_against: isHome === null ? null : isHome ? awayScore : homeScore,

      completions: required(row, "completions"),
      pass_attempts: required(row, "attempts"),
      passing_yards: required(row, "passing_yards"),
      passing_tds: required(row, "passing_tds"),
      interceptions_thrown: required(row, "passing_interceptions"),
      sacks_suffered: required(row, "sacks_suffered"),
      passing_air_yards: optional(row, "passing_air_yards"),
      carries: required(row, "carries"),
      rushing_yards: required(row, "rushing_yards"),
      rushing_tds: required(row, "rushing_tds"),
      targets: required(row, "targets"),
      receptions: required(row, "receptions"),
      fumbles_lost: required(row, "fumbles_lost_total"),

      def_sacks: required(row, "def_sacks"),
      def_interceptions: required(row, "def_interceptions"),
      def_fumble_recoveries: required(row, "fumble_recovery_opp"),
      def_tds: required(row, "def_tds"),
      def_safeties: required(row, "def_safeties"),
      blocked_punts: required(row, "def_punt_blocks"),
      blocked_fgs: required(row, "def_fg_blocks"),
      blocked_pats: required(row, "def_pat_blocks"),
      return_tds: required(row, "special_teams_tds"),

      source: "nflverse-stats-team-week",
      synced_at: new Date().toISOString()
    }
  };
}

async function loadTeams(season, schedule) {
  const { headers, rows } = parseCSV(await getText(TEAM_URL(season)), TEAM_REQUIRED, TEAM_OPTIONAL);
  const report = newReport(headers, TEAM_OPTIONAL, rows.length);
  const list = [];

  for (const row of rows) {
    if (String(row.season_type).toUpperCase() !== "REG") {
      addSkip(report, "no_temporada_regular");
      continue;
    }
    let result;
    try {
      result = normalizeTeam(row, schedule);
    } catch (error) {
      addSkip(report, "dato_invalido");
      continue;
    }
    if (result.skip) {
      addSkip(report, result.skip);
      continue;
    }
    list.push(result.row);
  }

  const saved = await saveRows(
    "football_team_week_stats", "team,game_id",
    r => `${r.team}|${r.game_id}`, list, report
  );
  report.equipos = new Set(saved.map(r => r.team)).size;
  report.sinMarcador = saved.filter(r => r.points_for === null || r.points_against === null).length;
  return report;
}


// ============================================================
// UNA TEMPORADA (cada parte por separado)
// ============================================================

async function part(fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: error.message };
  }
}

async function loadSeason(season, parsedSchedule, schedule) {
  return {
    season,
    calendario: await part(() => saveSchedule(parsedSchedule, season)),
    jugadores: await part(() => loadPlayers(season, schedule)),
    esperados: await part(() => loadExpected(season, schedule)),
    equipos: await part(() => loadTeams(season, schedule))
  };
}


// ============================================================
// HANDLER
// ============================================================

function isInternalRequest(req) {
  const secret = process.env.CRON_SECRET || process.env.GENERATE_DAILY_SECRET || "";
  if (!secret) return false;
  const auth = String(req.headers.authorization || "");
  return (
    (auth.startsWith("Bearer ") && auth.slice(7) === secret) ||
    String(req.headers["x-internal-secret"] || "") === secret ||
    String(req.query.secret || "") === secret
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isInternalRequest(req)) return res.status(401).json({ error: "Unauthorized" });

  const current = currentNFLSeason();
  const seasons = [...new Set(
    String(req.query.seasons || current)
      .split(",")
      .map(s => Number(s.trim()))
      .filter(s => Number.isInteger(s) && s >= FIRST_SEASON && s <= current)
  )].sort();

  if (!seasons.length || seasons.length > MAX_SEASONS_PER_CALL) {
    return res.status(400).json({
      error: `seasons invalidas (maximo ${MAX_SEASONS_PER_CALL}, desde ${FIRST_SEASON}, ej. 2025,2026)`
    });
  }

  const t0 = Date.now();
  try {
    const parsedSchedule = await downloadSchedule();
    const schedule = new Map(parsedSchedule.rows.map(g => [g.game_id, g]));

    const results = [];
    for (const season of seasons) {
      results.push(await loadSeason(season, parsedSchedule, schedule));
    }

    const errors = results.flatMap(r =>
      ["calendario", "jugadores", "esperados", "equipos"]
        .filter(k => r[k].error)
        .map(k => `${r.season} ${k}: ${r[k].error}`)
    );
    if (errors.length) console.error("FANTASY NFL WEEKLY:", errors);

    return res.status(200).json({
      ok: errors.length === 0,
      errores: errors,
      seasons: results,
      seconds: (Date.now() - t0) / 1000
    });
  } catch (error) {
    console.error("FANTASY NFL WEEKLY:", error);
    return res.status(500).json({ ok: false, error: error.message, seconds: (Date.now() - t0) / 1000 });
  }
};

module.exports.parseCSV = parseCSV;
module.exports.normalize = normalize;
module.exports.normalizeExpected = normalizeExpected;
module.exports.normalizeTeam = normalizeTeam;
module.exports.normalizeSchedule = normalizeSchedule;

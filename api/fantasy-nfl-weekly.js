// ============================================================
// CASHEDGE FANTASY NFL — CARGA SEMANAL DE NFLVERSE
// ============================================================
//
// Es el UNICO lugar de Fantasy NFL que descarga NFLverse.
// Baja la produccion de cada jugador (pases, acarreos,
// recepciones, fumbles, 2 puntos...) y la GUARDA en
// Supabase -> football_player_week_stats.
// La formula despues lee solo de Supabase.
//
// Usa la misma lectura y validacion de
// fantasy-engine/nfl/stats-bridge.js.
//
// USO
//   /api/fantasy-nfl-weekly?secret=...                    -> temporada actual
//   /api/fantasy-nfl-weekly?secret=...&seasons=2025,2026  -> carga inicial
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

const BASE =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/";
const SCHEDULE_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

// Columnas que DEBEN existir (las mismas que exigia stats-bridge.js).
const REQUIRED = [
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

// Columnas utiles que se guardan si vienen (si no, quedan vacias).
const OPTIONAL = [
  "completions", "opponent_team",
  "passing_air_yards", "receiving_air_yards", "receiving_yards_after_catch",
  "target_share", "air_yards_share", "wopr"
];

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
    throw new Error("NFLverse CSV vacio");
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
        throw new Error("NFLverse CSV columnas faltantes: " + missing.join(", "));
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

  if (quoted) throw new Error("NFLverse CSV con comillas incompletas");
  if (fields.length || field.length) finishRow();

  return { headers, rows: results };
}

function required(row, key) {
  const raw = row[key];
  if (raw === "" || raw === null || raw === undefined) {
    throw new Error(`NFLverse ${key} sin valor`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`NFLverse ${key} invalido`);
  return value;
}

function optional(row, key) {
  const raw = row[key];
  if (raw === "" || raw === null || raw === undefined || raw === "NA") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}


// ============================================================
// DESCARGA
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

async function loadSchedule() {
  const { rows } = parseCSV(await getText(SCHEDULE_URL), ["game_id", "gameday", "home_team", "away_team"]);
  return new Map(rows.map(g => [g.game_id, g]));
}


// ============================================================
// UNA TEMPORADA
// ============================================================

function normalize(row, schedule) {
  const gsis = String(row.player_id || "").trim();
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

async function loadSeason(season, schedule) {
  const { headers, rows } = parseCSV(
    await getText(`${BASE}stats_player_week_${season}.csv`),
    REQUIRED,
    OPTIONAL
  );

  const report = {
    season,
    filasLeidas: rows.length,
    guardadas: 0,
    jugadores: 0,
    semanas: [],
    temporadaRegular: 0,
    descartadas: {},
    duplicadas: 0,
    columnasOpcionalesFaltantes: OPTIONAL.filter(c => !headers.includes(c))
  };

  const out = new Map();
  const skip = reason => (report.descartadas[reason] = (report.descartadas[reason] || 0) + 1);

  for (const row of rows) {
    // Solo temporada regular (los playoffs cambian las rotaciones).
    if (String(row.season_type).toUpperCase() !== "REG") {
      skip("no_temporada_regular");
      continue;
    }
    report.temporadaRegular++;

    let result;
    try {
      result = normalize(row, schedule);
    } catch (error) {
      skip("dato_invalido");
      continue;
    }
    if (result.skip) {
      skip(result.skip);
      continue;
    }

    const key = `${result.row.gsis_player_id}|${result.row.game_id}`;
    if (out.has(key)) {
      report.duplicadas++;
      continue;
    }
    out.set(key, result.row);
  }

  const list = [...out.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("football_player_week_stats")
      .upsert(list.slice(i, i + 500), { onConflict: "gsis_player_id,game_id" });
    if (error) throw new Error(`Supabase football_player_week_stats: ${error.message}`);
  }

  report.guardadas = list.length;
  report.jugadores = new Set(list.map(r => r.gsis_player_id)).size;
  report.semanas = [...new Set(list.map(r => r.week))].sort((a, b) => a - b);
  return report;
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
  const seasons = String(req.query.seasons || current)
    .split(",")
    .map(s => Number(s.trim()))
    .filter(s => Number.isInteger(s) && s >= 2015 && s <= current);

  if (!seasons.length || seasons.length > 3) {
    return res.status(400).json({ error: "seasons invalidas (maximo 3, ej. 2025,2026)" });
  }

  const t0 = Date.now();
  try {
    const schedule = await loadSchedule();
    const results = [];
    for (const season of [...new Set(seasons)].sort()) {
      results.push(await loadSeason(season, schedule));
    }
    return res.status(200).json({
      ok: true,
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

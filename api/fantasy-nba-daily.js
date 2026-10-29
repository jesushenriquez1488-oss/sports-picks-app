// ============================================================
// CASHEDGE FANTASY NBA — TAREA DIARIA
// ============================================================
//
// Es el UNICO lugar de Fantasy NBA que llama APIs externas.
// Guarda todo en Supabase. La formula despues lee solo
// Supabase.
//
// PASOS (?step=)
//
//   starters  Titulares de cada partido terminado
//             (BALLDONTLIE /v1/lineups) -> nba_game_starters
//             Solo descarga partidos que todavia no tiene.
//             &limit=250 para cargar la temporada pasada.
//
//   box       Tiros intentados, tiros libres, rebotes ofensivos
//             y defensivos, faltas (BALLDONTLIE /v1/stats)
//             -> nba_player_game_box_ext
//             &dates=20 para cargar la temporada pasada.
//
//   quarters  Marcador por cuarto (BALLDONTLIE /v1/games)
//             -> nba_game_quarters
//
//   injuries  Lesiones actuales (BALLDONTLIE)
//             -> nba_player_injuries_current
//
//   depth     Depth chart + roster de los 30 equipos (ESPN)
//             -> nba_depth_chart
//             + enlaza solos los jugadores nuevos en
//               fantasy_nba_player_crosswalk.
//
//   slate     Slate principal DraftKings y FanDuel del dia
//             (BALLDONTLIE) -> fantasy_nba_slates
//                           -> fantasy_nba_slate_players
//
//   evaluate  Compara las proyecciones de AYER contra lo real
//             -> fantasy_nba_projections (actual_*), fantasy_nba_evaluations
//
//   project   LA FORMULA (api/fantasy-nba-project.js): lee solo
//             Supabase -> fantasy_nba_projections, fantasy_nba_team_minutes
//
//   props     Lineas de props del dia (The Odds API, ODDS_API_KEY)
//             -> fantasy_nba_prop_lines. Puntos, rebotes, asistencias,
//             triples, robos y tapones. ~6 creditos por partido.
//             &snapshot=manana|previa para nombrar la foto.
//             La foto "manana" se baja en la corrida diaria (all, 3:30 am).
//             &auto=1 (cron cada 15 min): baja "previa" entre 100 y 0
//             min antes del primer partido; y, solo de respaldo, la
//             "manana" a las 10 am si la de las 3:30 fallo. Despues de
//             cada foto corre el refresh. Si no toca, no llama a la API.
//
//   cierre    CORRIDA DE CIERRE, justo antes de cada slate (lo que mas
//             mejoro en la prueba del 25-oct: de 30 a 70 alineaciones
//             cobrando). Lesiones al dia + foto "cierre" de props
//             (solo partidos que no han empezado) + depth chart +
//             formula. Las alineaciones de la manana NO se borran:
//             quedan en el archivo para comparar.
//             &auto=1 (cron cada 10 min): solo corre si un slate
//             empieza entre 45 y 15 minutos y todavia no se corrio
//             su cierre. Si no toca, no llama a ninguna API.
//
//   all       starters + box + quarters + evaluate + injuries + depth
//             + slate + props (manana) + project
//   refresh   injuries + depth + slate + project (antes de los partidos)
//
// SEGURIDAD
//   Igual que /api/nba-data: CRON_SECRET por
//   Authorization Bearer, X-Internal-Secret o ?secret=
//
// NO toca nba_games, nba_player_game_stats, picks,
// Premium Picks, Player Props (player_props_cache) ni ningun
// otro cron.
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const fantasyProject = require("./fantasy-nba-project.js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BDL = "https://api.balldontlie.io";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

const TIMEOUT_MS = 15000;
const ESPN_CONCURRENCY = 5;
const LINEUP_GAMES_PER_REQUEST = 10;
const DAILY_STARTER_LIMIT = 60;
const MAX_STARTER_LIMIT = 250;
const MAX_EMPTY_ATTEMPTS = 3;

const DEPTH_POSITIONS = ["pg", "sg", "sf", "pf", "c"];


// ============================================================
// TEMPORADA (misma regla que nba-data.js)
// ============================================================
// NBA 2026-27 = season 2026 en BALLDONTLIE.

function getCurrentNBASeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

const CURRENT_SEASON = getCurrentNBASeason();
const PREVIOUS_SEASON = CURRENT_SEASON - 1;


// ============================================================
// UTILIDADES
// ============================================================

const str = value => String(value ?? "").trim();

function chicagoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Quita acentos, puntos, guiones y sufijos (Jr, III...).
function normalizeName(value) {
  return str(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(t => t && !["jr", "sr", "ii", "iii", "iv", "v"].includes(t))
    .join(" ");
}

// ESPN y las casas usan abreviaturas distintas.
const TEAM_ALIASES = {
  GS: "GSW", GSW: "GSW",
  NY: "NYK", NYK: "NYK",
  SA: "SAS", SAS: "SAS",
  NO: "NOP", NOP: "NOP", NOR: "NOP",
  UTAH: "UTA", UTA: "UTA",
  WSH: "WAS", WAS: "WAS",
  PHX: "PHX", PHO: "PHX",
  BKN: "BKN", BRK: "BKN",
  CHA: "CHA", CHO: "CHA"
};

function teamCode(abbreviation) {
  const a = str(abbreviation).toUpperCase();
  return TEAM_ALIASES[a] || a;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}


// ============================================================
// HTTP (con reintentos para 429 / 5xx)
// ============================================================

async function fetchJSON(url, headers = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", ...headers },
        signal: controller.signal
      });

      const text = await response.text();

      if (response.ok) return JSON.parse(text);

      lastError = new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 200)}`);

      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;

    } catch (error) {
      lastError = error.name === "AbortError" ? new Error(`Timeout ${url}`) : error;
      if (/HTTP (4\d\d)/.test(lastError.message) && !/HTTP 429/.test(lastError.message)) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }

  throw lastError;
}

function bdlFetch(path, params = []) {
  const url = new URL(BDL + path);
  for (const [key, value] of params) url.searchParams.append(key, String(value));
  return fetchJSON(url.toString(), { Authorization: process.env.BALLDONTLIE_API_KEY });
}

// Todas las paginas (cursor).
async function bdlPages(path, params = []) {
  const rows = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 60; page++) {
    const response = await bdlFetch(path, [
      ...params,
      ["per_page", 100],
      ...(cursor ? [["cursor", cursor]] : [])
    ]);

    if (!Array.isArray(response?.data)) {
      throw new Error(`BALLDONTLIE ${path}: respuesta sin data`);
    }

    rows.push(...response.data);

    const next = response?.meta?.next_cursor;
    if (!next) return rows;

    if (seen.has(String(next))) throw new Error(`BALLDONTLIE ${path}: cursor repetido`);
    seen.add(String(next));
    cursor = next;
  }

  throw new Error(`BALLDONTLIE ${path}: demasiadas paginas`);
}


// ============================================================
// SUPABASE
// ============================================================

// Lee todas las filas (de 1000 en 1000).
async function selectAll(table, columns, build = q => q) {
  const rows = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(
      supabaseAdmin.from(table).select(columns)
    ).range(from, from + PAGE - 1);

    if (error) throw new Error(`Supabase ${table}: ${error.message}`);

    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function upsertAll(table, rows, onConflict, size = 500) {
  let saved = 0;
  for (const part of chunks(rows, size)) {
    const { error } = await supabaseAdmin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    saved += part.length;
  }
  return saved;
}


// ============================================================
// PASO: TITULARES
// ============================================================

async function stepStarters(limit) {
  // Partidos terminados de esta temporada y la pasada.
  // (nba_games solo guarda partidos terminados.)
  const games = await selectAll(
    "nba_games",
    "game_id,season,game_date",
    q => q
      .in("season", [CURRENT_SEASON, PREVIOUS_SEASON])
      // postseason puede venir vacio (null) en partidos viejos.
      .or("postseason.is.null,postseason.eq.false")
      .order("game_date", { ascending: false })
      .order("game_id", { ascending: true })
  );

  const syncRows = await selectAll(
    "nba_game_lineup_sync",
    "game_id,status,attempts"
  );

  const sync = new Map(syncRows.map(r => [Number(r.game_id), r]));

  // Pendiente = nunca descargado, o vino vacio y
  // todavia no se agotaron los reintentos.
  const pending = games.filter(game => {
    const s = sync.get(Number(game.game_id));
    return !s || (s.status === "empty" && Number(s.attempts) < MAX_EMPTY_ATTEMPTS);
  });

  // Primero los mas recientes: el dia a dia siempre queda al dia.
  const batch = pending.slice(0, limit);

  // Diagnostico: cuantos partidos ve por temporada.
  const gamesFound = {
    [CURRENT_SEASON]: games.filter(g => Number(g.season) === CURRENT_SEASON).length,
    [PREVIOUS_SEASON]: games.filter(g => Number(g.season) === PREVIOUS_SEASON).length
  };

  if (!batch.length) {
    return {
      gamesFound,
      alreadySynced: syncRows.length,
      pending: 0,
      processed: 0,
      ok: 0,
      incomplete: 0,
      empty: 0,
      remaining: 0
    };
  }

  const gameInfo = new Map(batch.map(g => [Number(g.game_id), g]));
  const byGame = new Map(batch.map(g => [Number(g.game_id), []]));

  for (const group of chunks(batch, LINEUP_GAMES_PER_REQUEST)) {
    const rows = await bdlPages(
      "/v1/lineups",
      group.map(g => ["game_ids[]", g.game_id])
    );

    for (const r of rows) {
      const gameId = Number(r.game_id ?? r.game?.id);
      const playerId = Number(r.player?.id ?? r.player_id);
      if (!byGame.has(gameId) || !Number.isFinite(playerId)) continue;
      byGame.get(gameId).push(r);
    }
  }

  const starterRows = [];
  const statusRows = [];
  const now = new Date().toISOString();
  const counts = { ok: 0, incomplete: 0, empty: 0 };

  for (const [gameId, rows] of byGame) {
    const game = gameInfo.get(gameId);
    const unique = new Map();

    for (const r of rows) {
      const playerId = Number(r.player?.id ?? r.player_id);
      unique.set(playerId, {
        game_id: gameId,
        player_id: playerId,
        // Equipo del partido. No se usa player.team_id porque
        // ese es el equipo ACTUAL (falla con traspasos).
        team_id: numberOrNull(r.team?.id ?? r.team_id),
        season: Number(game.season),
        game_date: game.game_date,
        starter: r.starter === true,
        lineup_position: str(r.position) || null,
        synced_at: now
      });
    }

    const list = [...unique.values()];
    const starters = list.filter(r => r.starter).length;

    const status =
      list.length === 0 ? "empty" :
      starters === 10 ? "ok" :
      "incomplete";

    counts[status]++;
    starterRows.push(...list);

    statusRows.push({
      game_id: gameId,
      status,
      rows_count: list.length,
      starters_count: starters,
      attempts: Number(sync.get(gameId)?.attempts || 0) + 1,
      synced_at: now
    });
  }

  // Primero los titulares; si falla, el control no se marca
  // y la proxima corrida lo reintenta.
  if (starterRows.length) {
    await upsertAll("nba_game_starters", starterRows, "game_id,player_id");
  }

  await upsertAll("nba_game_lineup_sync", statusRows, "game_id");

  const stillPending = statusRows.filter(
    r => r.status === "empty" && r.attempts < MAX_EMPTY_ATTEMPTS
  ).length;

  return {
    gamesFound,
    alreadySynced: syncRows.length,
    pending: pending.length,
    processed: batch.length,
    ...counts,
    remaining: pending.length - batch.length + stillPending
  };
}


// ============================================================
// PASO: ESTADISTICAS EXTRA (tiros, tiros libres, rebotes of/def)
// ============================================================
//
// BALLDONTLIE /v1/stats por fecha NBA (hora Este), igual que
// nba-data.js. Solo partidos que todavia no tienen estos datos.

function nbaCalendarDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function parseMinutes(value) {
  const raw = str(value);
  if (raw.includes(":")) {
    const [m, s] = raw.split(":").map(Number);
    return Number.isFinite(m) && Number.isFinite(s) ? m + s / 60 : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function stepBox(maxDates) {
  const games = await selectAll(
    "nba_games",
    "game_id,season,game_date",
    q => q
      .in("season", [CURRENT_SEASON, PREVIOUS_SEASON])
      .or("postseason.is.null,postseason.eq.false")
      .order("game_date", { ascending: false })
      .order("game_id", { ascending: true })
  );

  const syncRows = await selectAll("nba_box_ext_sync", "game_id,status,attempts");
  const sync = new Map(syncRows.map(r => [Number(r.game_id), r]));

  const pending = games.filter(game => {
    const s = sync.get(Number(game.game_id));
    return !s || (s.status === "empty" && Number(s.attempts) < MAX_EMPTY_ATTEMPTS);
  });

  // Agrupar por fecha NBA; primero las mas recientes.
  const byDate = new Map();
  for (const game of pending) {
    const day = nbaCalendarDate(game.game_date);
    if (!day) continue;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push(game);
  }

  const dates = [...byDate.keys()].sort().reverse().slice(0, maxDates);
  const now = new Date().toISOString();
  const boxRows = [];
  const statusRows = [];
  let ok = 0;
  let empty = 0;

  for (const day of dates) {
    const stats = await bdlPages("/v1/stats", [["dates[]", day], ["period", 0]]);

    for (const game of byDate.get(day)) {
      const gameId = Number(game.game_id);
      const rows = new Map();

      for (const s of stats) {
        if (Number(s.game?.id) !== gameId) continue;
        const playerId = Number(s.player?.id);
        if (!Number.isFinite(playerId) || parseMinutes(s.min) <= 0) continue;

        rows.set(playerId, {
          game_id: gameId,
          player_id: playerId,
          team_id: numberOrNull(s.team?.id),
          season: Number(game.season),
          game_date: game.game_date,
          fgm: numberOrNull(s.fgm),
          fga: numberOrNull(s.fga),
          fg3m: numberOrNull(s.fg3m),
          fg3a: numberOrNull(s.fg3a),
          ftm: numberOrNull(s.ftm),
          fta: numberOrNull(s.fta),
          oreb: numberOrNull(s.oreb),
          dreb: numberOrNull(s.dreb),
          pf: numberOrNull(s.pf),
          synced_at: now
        });
      }

      const status = rows.size ? "ok" : "empty";
      if (status === "ok") ok++;
      else empty++;

      boxRows.push(...rows.values());
      statusRows.push({
        game_id: gameId,
        status,
        rows_count: rows.size,
        attempts: Number(sync.get(gameId)?.attempts || 0) + 1,
        synced_at: now
      });
    }
  }

  if (boxRows.length) {
    await upsertAll("nba_player_game_box_ext", boxRows, "game_id,player_id");
  }
  if (statusRows.length) {
    await upsertAll("nba_box_ext_sync", statusRows, "game_id");
  }

  const processedGames = statusRows.filter(
    r => r.status === "ok" || r.attempts >= MAX_EMPTY_ATTEMPTS
  ).length;

  return {
    pendingGames: pending.length,
    datesProcessed: dates.length,
    gamesOk: ok,
    gamesEmpty: empty,
    playerRows: boxRows.length,
    remainingGames: pending.length - processedGames
  };
}


// ============================================================
// PASO: MARCADOR POR CUARTO
// ============================================================
//
// BALLDONTLIE /v1/games trae los puntos de cada cuarto.
// Solo se bajan los partidos que todavia no estan guardados.

async function stepQuarters() {
  const games = await selectAll(
    "nba_games",
    "game_id,season,game_date",
    q => q.in("season", [CURRENT_SEASON, PREVIOUS_SEASON]).order("game_id", { ascending: true })
  );
  const saved = new Set(
    (await selectAll("nba_game_quarters", "game_id")).map(r => Number(r.game_id))
  );
  const missing = games.filter(g => !saved.has(Number(g.game_id)));

  if (!missing.length) return { missing: 0, saved: 0 };

  // Muchos pendientes (primera carga): temporadas completas.
  // Pocos (dia a dia): solo esas fechas.
  let raw;
  if (missing.length > 60) {
    const seasons = [...new Set(missing.map(g => Number(g.season)))];
    raw = await bdlPages("/v1/games", seasons.map(season => ["seasons[]", season]));
  } else {
    const dates = [...new Set(missing.map(g => nbaCalendarDate(g.game_date)).filter(Boolean))];
    raw = [];
    for (const part of chunks(dates, 10)) {
      raw.push(...await bdlPages("/v1/games", part.map(d => ["dates[]", d])));
    }
  }

  const wanted = new Map(missing.map(g => [Number(g.game_id), g]));
  const now = new Date().toISOString();
  const rows = [];

  for (const g of raw) {
    const id = Number(g.id);
    if (!wanted.has(id)) continue;
    const q = k => numberOrNull(g[k]);
    // Sin cuartos (partido viejo o dato faltante): no se guarda.
    if (q("home_q3") === null || q("visitor_q3") === null) continue;
    rows.push({
      game_id: id,
      season: Number(wanted.get(id).season),
      home_q1: q("home_q1"), home_q2: q("home_q2"), home_q3: q("home_q3"), home_q4: q("home_q4"),
      visitor_q1: q("visitor_q1"), visitor_q2: q("visitor_q2"), visitor_q3: q("visitor_q3"), visitor_q4: q("visitor_q4"),
      overtimes: ["home_ot1", "home_ot2", "home_ot3"].filter(k => q(k) !== null && q(k) > 0).length,
      synced_at: now
    });
  }

  if (rows.length) await upsertAll("nba_game_quarters", rows, "game_id");

  return { missing: missing.length, saved: rows.length, stillMissing: missing.length - rows.length };
}


// ============================================================
// PASO: LESIONES
// ============================================================

async function stepInjuries() {
  const runAt = new Date().toISOString();
  const raw = await bdlPages("/v1/player_injuries");

  const rows = new Map();

  for (const r of raw) {
    const playerId = numberOrNull(r.player?.id);
    if (playerId === null) continue;

    rows.set(playerId, {
      player_id: playerId,
      team_id: numberOrNull(r.player?.team_id),
      player_name: `${str(r.player?.first_name)} ${str(r.player?.last_name)}`.trim(),
      status: str(r.status) || null,
      return_date: str(r.return_date) || null,
      description: str(r.description).slice(0, 500) || null,
      checked_at: runAt
    });
  }

  const list = [...rows.values()];

  if (list.length) {
    await upsertAll("nba_player_injuries_current", list, "player_id");
  }

  // Los que ya no aparecen se recuperaron: se borran.
  const { error } = await supabaseAdmin
    .from("nba_player_injuries_current")
    .delete()
    .lt("checked_at", runAt);

  if (error) throw new Error(`Supabase nba_player_injuries_current: ${error.message}`);

  return { injuries: list.length };
}


// ============================================================
// PASO: DEPTH CHART + ROSTER + ENLACES
// ============================================================

async function espnTeams() {
  const data = await fetchJSON(`${ESPN}/teams?limit=100`);
  const list = data?.sports?.[0]?.leagues?.[0]?.teams || [];

  const teams = list
    .map(entry => entry?.team)
    .filter(t => t?.id && t?.abbreviation)
    .map(t => ({ id: str(t.id), code: teamCode(t.abbreviation) }));

  if (teams.length < 30) throw new Error(`ESPN devolvio ${teams.length} equipos`);
  return teams;
}

async function espnTeamData(teamId) {
  const [depth, roster] = await Promise.all([
    fetchJSON(`${ESPN}/teams/${teamId}/depthcharts`),
    fetchJSON(`${ESPN}/teams/${teamId}/roster`)
  ]);

  // Depth chart: posicion -> lista ordenada.
  const charts = depth?.depthchart ?? depth?.depthcharts ?? [];
  const chartList = Array.isArray(charts) ? charts : [charts];
  const ranks = new Map();
  const injuries = new Map();
  const names = new Map();

  for (const chart of chartList) {
    const positions = chart?.positions;
    if (!positions || typeof positions !== "object") continue;

    for (const pos of DEPTH_POSITIONS) {
      const athletes = positions[pos]?.athletes;
      if (!Array.isArray(athletes)) continue;

      athletes.forEach((a, index) => {
        const id = str(a?.id);
        if (!id) return;

        if (!ranks.has(id)) ranks.set(id, {});
        const r = ranks.get(id);
        if (r[pos] === undefined) r[pos] = index + 1;

        if (a?.displayName) names.set(id, str(a.displayName));
        const status = str(a?.injuries?.[0]?.status);
        if (status) injuries.set(id, status);
      });
    }
  }

  // Roster (algunos deportes agrupan por posicion).
  let athletes = roster?.athletes || [];
  if (athletes.length && Array.isArray(athletes[0]?.items)) {
    athletes = athletes.flatMap(group => group.items || []);
  }

  const players = new Map();

  for (const a of athletes) {
    const id = str(a?.id);
    if (!id) continue;
    players.set(id, {
      id,
      name: str(a.displayName || a.fullName),
      position: str(a.position?.abbreviation) || null,
      injury: str(a.injuries?.[0]?.status) || injuries.get(id) || null
    });
  }

  // Jugadores en el depth chart que no salieron en el roster.
  for (const [id, name] of names) {
    if (!players.has(id)) {
      players.set(id, { id, name, position: null, injury: injuries.get(id) || null });
    }
  }

  if (!ranks.size) throw new Error("depth chart vacio");
  if (!players.size) throw new Error("roster vacio");

  return { ranks, players };
}

async function stepDepth() {
  const runAt = new Date().toISOString();
  const day = chicagoDay();

  const [teams, bdlTeams, bdlActive, crosswalk] = await Promise.all([
    espnTeams(),
    bdlFetch("/v1/teams").then(r => r.data || []),
    bdlPages("/v1/players/active"),
    selectAll("fantasy_nba_player_crosswalk", "espn_player_id,nba_player_id")
  ]);

  // Solo los 30 equipos actuales. BALLDONTLIE tambien trae equipos
  // historicos (IDs 31+) y alguno comparte abreviatura: eso le ponia
  // a Washington un ID equivocado.
  const currentTeams = bdlTeams.filter(t => Number(t.id) >= 1 && Number(t.id) <= 30);
  const bdlTeamByCode = new Map(currentTeams.map(t => [teamCode(t.abbreviation), Number(t.id)]));

  // Jugadores activos BALLDONTLIE por equipo y nombre.
  const bdlByTeamName = new Map();
  const bdlByTeamLast = new Map();
  const bdlByName = new Map();   // toda la liga (equipo desactualizado en BALLDONTLIE)

  for (const p of bdlActive) {
    const teamId = Number(p.team?.id ?? p.team_id);
    const name = normalizeName(`${p.first_name} ${p.last_name}`);
    if (!Number.isFinite(teamId) || !name) continue;

    const entry = { id: Number(p.id), name: `${str(p.first_name)} ${str(p.last_name)}` };

    if (!bdlByName.has(name)) bdlByName.set(name, []);
    bdlByName.get(name).push(entry);

    const full = `${teamId}:${name}`;
    if (!bdlByTeamName.has(full)) bdlByTeamName.set(full, []);
    bdlByTeamName.get(full).push(entry);

    const parts = name.split(" ");
    const short = `${teamId}:${parts[0]?.[0]}:${parts.slice(1).join(" ")}`;
    if (!bdlByTeamLast.has(short)) bdlByTeamLast.set(short, []);
    bdlByTeamLast.get(short).push(entry);
  }

  const linkByEspn = new Map(crosswalk.map(r => [str(r.espn_player_id), Number(r.nba_player_id)]));
  const linkedBdl = new Set(crosswalk.map(r => Number(r.nba_player_id)));

  // ESPN: 30 equipos, 5 a la vez.
  const failedTeams = [];
  const okTeams = [];
  const rows = [];
  const newLinks = [];
  const unlinked = [];

  await pool(teams, ESPN_CONCURRENCY, async team => {
    let data;
    try {
      data = await espnTeamData(team.id);
    } catch (error) {
      failedTeams.push(`${team.code}: ${error.message}`);
      return;
    }

    okTeams.push(team.id);
    const bdlTeamId = bdlTeamByCode.get(team.code) ?? null;

    for (const player of data.players.values()) {
      const r = data.ranks.get(player.id) || {};
      const ranks = DEPTH_POSITIONS.map(p => r[p]).filter(v => v !== undefined);

      // Enlace ESPN -> BALLDONTLIE.
      let nbaId = linkByEspn.get(player.id) ?? null;

      if (nbaId === null) {
        const name = normalizeName(player.name);
        const parts = name.split(" ");

        // 1) Mismo equipo + mismo nombre.
        let found = bdlTeamId === null ? [] : bdlByTeamName.get(`${bdlTeamId}:${name}`) || [];

        // 2) Mismo equipo + apellido e inicial.
        if (found.length !== 1 && bdlTeamId !== null) {
          found = bdlByTeamLast.get(`${bdlTeamId}:${parts[0]?.[0]}:${parts.slice(1).join(" ")}`) || [];
        }

        // 3) Traspasos: BALLDONTLIE aun lo tiene en el equipo
        //    viejo. Solo si ese nombre es UNICO en toda la liga.
        if (found.length !== 1) {
          found = bdlByName.get(name) || [];
        }

        // Solo si hay UNO y no esta enlazado a otro jugador.
        if (found.length === 1 && !linkedBdl.has(found[0].id)) {
          nbaId = found[0].id;
          linkedBdl.add(nbaId);
          linkByEspn.set(player.id, nbaId);
          newLinks.push({
            espn_player_id: player.id,
            nba_player_id: nbaId,
            espn_player_name: player.name,
            nba_player_name: found[0].name,
            verified: false,
            verification_source: "auto_daily_team_name"
          });
        }
      }

      if (nbaId === null) unlinked.push(`${player.name} (${team.code})`);

      rows.push({
        snapshot_date: day,
        espn_player_id: player.id,
        espn_team_id: team.id,
        team_id: bdlTeamId,
        team_abbr: team.code,
        player_name: player.name,
        nba_player_id: nbaId,
        roster_position: player.position,
        pg_rank: r.pg ?? null,
        sg_rank: r.sg ?? null,
        sf_rank: r.sf ?? null,
        pf_rank: r.pf ?? null,
        c_rank: r.c ?? null,
        best_rank: ranks.length ? Math.min(...ranks) : null,
        injury_status: player.injury,
        checked_at: runAt
      });
    }
  });

  if (!okTeams.length) {
    throw new Error(`ESPN no respondio para ningun equipo: ${failedTeams.join(" | ")}`);
  }

  // Enlaces nuevos (INSERT: nunca reemplaza los existentes).
  let linksSaved = 0;
  for (const part of chunks(newLinks, 50)) {
    const { error } = await supabaseAdmin.from("fantasy_nba_player_crosswalk").insert(part);
    if (error) throw new Error(`Supabase crosswalk: ${error.message}`);
    linksSaved += part.length;
  }

  // Depth chart del dia (un jugador puede salir dos veces si
  // ESPN lo lista en dos equipos: se queda el primero).
  const unique = new Map();
  for (const row of rows) if (!unique.has(row.espn_player_id)) unique.set(row.espn_player_id, row);

  await upsertAll("nba_depth_chart", [...unique.values()], "snapshot_date,espn_player_id");

  // Quitar del dia a quien ya no esta en el roster
  // (solo en equipos que respondieron bien).
  const { error } = await supabaseAdmin
    .from("nba_depth_chart")
    .delete()
    .eq("snapshot_date", day)
    .in("espn_team_id", okTeams)
    .lt("checked_at", runAt);

  if (error) throw new Error(`Supabase nba_depth_chart: ${error.message}`);

  return {
    snapshotDate: day,
    teams: okTeams.length,
    failedTeams,
    players: unique.size,
    newLinks: linksSaved,
    // Sin enlace: normalmente jugadores two-way o que
    // todavia no aparecen en BALLDONTLIE. Se reintenta solo
    // cada dia.
    unlinkedCount: unlinked.length,
    unlinked: unlinked.slice(0, 40)
  };
}


// ============================================================
// PASO: SLATE DFS
// ============================================================

async function saveSlate(platform, day, bdlTeamCode, runAt) {
  const list = await bdlPages("/nba/v1/dfs/slates", [
    ["providers[]", platform],
    ["formats[]", "salary_cap"],
    ["start_date", day],
    ["end_date", day]
  ]);

  // Slate principal: DraftKings "Classic", FanDuel "Full Roster",
  // el que tenga mas partidos.
  const main = list
    .filter(s =>
      s.provider === platform &&
      s.format === "salary_cap" &&
      s.active !== false &&
      /^(classic|full roster)$/i.test(str(s.style)) &&
      chicagoDay(new Date(s.starts_at)) === day &&
      Number(s.salary_cap) > 0
    )
    .sort((a, b) => Number(b.event_count) - Number(a.event_count))[0];

  // 29-oct: si no encuentra el slate principal, muestra lo que
  // devolvio BALLDONTLIE para saber por que lo descarto.
  if (!main) {
    return {
      platform,
      slate: null,
      recibidos: list.length,
      candidatos: list.slice(0, 20).map(s => ({
        id: s.id,
        provider: s.provider,
        format: s.format,
        style: s.style,
        name: s.name ?? null,
        starts_at: s.starts_at,
        diaChicago: s.starts_at ? chicagoDay(new Date(s.starts_at)) : null,
        event_count: s.event_count,
        salary_cap: s.salary_cap,
        active: s.active
      }))
    };
  }

  const detail = (await bdlFetch(`/nba/v1/dfs/slates/${main.id}`)).data;
  const draftables = await bdlPages("/nba/v1/dfs/draftables", [["slate_ids[]", main.id]]);

  const players = new Map();
  const conflicts = new Set();

  for (const d of draftables) {
    if (d.entity_type !== "player" || d.active === false || d.is_disabled === true) continue;

    const playerId = numberOrNull(d.player_id);
    const salary = numberOrNull(d.salary);
    if (playerId === null || salary === null) continue;

    const teamId = numberOrNull(d.team_id);
    const eventId = numberOrNull(d.slate_event_id);

    if (!players.has(playerId)) {
      players.set(playerId, {
        slate_id: Number(main.id),
        player_id: playerId,
        platform,
        slate_date: day,
        player_name: str(d.display_name),
        team_id: teamId,
        team_abbr: bdlTeamCode.get(teamId) || teamCode(d.team_abbreviation) || null,
        event_id: eventId,
        salary,
        positions: [],
        status: str(d.status) || null,
        checked_at: runAt
      });
    }

    const p = players.get(playerId);

    // Mismo jugador con salario/partido/equipo distinto = dato dudoso.
    if (p.salary !== salary || p.event_id !== eventId || p.team_id !== teamId) {
      conflicts.add(playerId);
    }

    for (const pos of str(d.position).toUpperCase().split(/[\/,]/)) {
      const clean = pos.trim();
      if (["PG", "SG", "SF", "PF", "C"].includes(clean) && !p.positions.includes(clean)) {
        p.positions.push(clean);
      }
    }
  }

  for (const id of conflicts) players.delete(id);

  const list2 = [...players.values()].filter(p => p.positions.length);
  list2.forEach(p => p.positions.sort());

  const rosterSlots = {};
  for (const slot of detail?.roster_slots || []) {
    if (slot.active === false) continue;
    const name = str(slot.name).toUpperCase();
    rosterSlots[name] = (rosterSlots[name] || 0) + (Number(slot.required_count) || 1);
  }

  await upsertAll("fantasy_nba_slates", [{
    slate_id: Number(main.id),
    platform,
    slate_date: day,
    style: str(detail?.style || main.style) || null,
    salary_cap: numberOrNull(detail?.salary_cap ?? main.salary_cap),
    starts_at: detail?.starts_at || main.starts_at || null,
    event_count: numberOrNull(main.event_count),
    roster_slots: rosterSlots,
    events: (detail?.events || []).map(e => ({
      id: e.id,
      name: e.name ?? null,
      starts_at: e.starts_at ?? null,
      game_id: e.game_id ?? null
    })),
    checked_at: runAt
  }], "slate_id");

  if (list2.length) {
    await upsertAll("fantasy_nba_slate_players", list2, "slate_id,player_id");
  }

  // Jugadores que la casa retiro del slate.
  const { error } = await supabaseAdmin
    .from("fantasy_nba_slate_players")
    .delete()
    .eq("slate_id", Number(main.id))
    .lt("checked_at", runAt);

  if (error) throw new Error(`Supabase fantasy_nba_slate_players: ${error.message}`);

  return {
    platform,
    slate: Number(main.id),
    games: numberOrNull(main.event_count),
    players: list2.length,
    conflicts: conflicts.size
  };
}

async function stepSlate(day) {
  const runAt = new Date().toISOString();
  const teams = (await bdlFetch("/v1/teams")).data || [];
  const bdlTeamCode = new Map(teams.map(t => [Number(t.id), teamCode(t.abbreviation)]));

  const results = [];
  for (const platform of ["draftkings", "fanduel"]) {
    results.push(await saveSlate(platform, day, bdlTeamCode, runAt));
  }
  return { date: day, slates: results };
}


// ============================================================
// PASO: LINEAS DE PROPS (The Odds API)
// ============================================================
// Lo que el mercado espera de cada jugador: puntos, rebotes,
// asistencias, triples, robos y tapones. Se guarda TAL CUAL
// (sin analizar) en fantasy_nba_prop_lines, en dos fotos:
//   manana = 10:00 am de Chicago (las primeras lineas del dia)
//   previa = entre 100 y 0 minutos antes del primer partido
// La formula solo lee esa tabla; nunca llama a la API.
// No toca player_props_cache ni nada de CashEdge Player Props.

const ODDS_API = "https://api.the-odds-api.com/v4/sports/basketball_nba";
const PROP_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_steals",
  "player_blocks"
];
const PROP_CONCURRENCY = 3;
const MORNING_HOUR_CHICAGO = 10;
const PREVIA_MINUTES_BEFORE = 100;

function chicagoHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", hour12: false
  }).format(date)) % 24;
}

// Como fetchJSON, pero devuelve tambien los creditos que quedan.
async function oddsFetch(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      const text = await response.text();
      const credits = {
        remaining: numberOrNull(response.headers.get("x-requests-remaining")),
        used: numberOrNull(response.headers.get("x-requests-used")),
        last: numberOrNull(response.headers.get("x-requests-last"))
      };
      if (response.ok) return { data: JSON.parse(text), credits };
      lastError = new Error(`The Odds API HTTP ${response.status}: ${text.slice(0, 200)}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error("The Odds API: timeout") : error;
      if (/HTTP (4\d\d)/.test(lastError.message) && !/HTTP 429/.test(lastError.message)) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw lastError;
}

async function propSnapshotExists(day, snapshot) {
  const { data, error } = await supabaseAdmin
    .from("fantasy_nba_prop_snapshots")
    .select("prop_date")
    .eq("prop_date", day)
    .eq("snapshot", snapshot)
    .limit(1);
  if (error) throw new Error(`Supabase fantasy_nba_prop_snapshots: ${error.message}`);
  return Boolean(data?.length);
}

// Primer partido del dia segun el slate guardado (sin llamar APIs).
async function firstTip(day) {
  const slates = await selectAll("fantasy_nba_slates", "starts_at,events", q => q.eq("slate_date", day));
  const times = [];
  for (const s of slates) {
    if (s.starts_at) times.push(Date.parse(s.starts_at));
    for (const e of s.events || []) if (e.starts_at) times.push(Date.parse(e.starts_at));
  }
  const valid = times.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

async function stepProps(day, snapshot, { onlyUpcoming = false } = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY no configurada");

  const fetchedAt = new Date().toISOString();

  // 1) Partidos (este endpoint no gasta creditos).
  // En el cierre solo los que no han empezado (un partido en juego
  // trae lineas en vivo, que no sirven para proyectar).
  const ev = await oddsFetch(`${ODDS_API}/events?apiKey=${apiKey}`);
  const events = (Array.isArray(ev.data) ? ev.data : [])
    .filter(e => e.commence_time && chicagoDay(new Date(e.commence_time)) === day)
    .filter(e => !onlyUpcoming || Date.parse(e.commence_time) > Date.now());

  if (!events.length) {
    return { date: day, snapshot, events: 0, lines: 0, message: "No hay partidos NBA ese dia en The Odds API", credits: ev.credits };
  }

  // 2) Jugadores del slate de hoy para enlazar por nombre.
  const slatePlayers = await selectAll(
    "fantasy_nba_slate_players",
    "player_id,player_name",
    q => q.eq("slate_date", day)
  );
  const idByName = new Map();
  for (const p of slatePlayers) {
    const key = normalizeName(p.player_name);
    if (key && !idByName.has(key)) idByName.set(key, Number(p.player_id));
  }

  // 3) Lineas de cada partido.
  let credits = ev.credits;
  const failedEvents = [];
  const perEvent = await pool(events, PROP_CONCURRENCY, async event => {
    try {
      const url = `${ODDS_API}/events/${event.id}/odds?apiKey=${apiKey}` +
        `&regions=us&markets=${PROP_MARKETS.join(",")}&oddsFormat=american`;
      const r = await oddsFetch(url);
      if (r.credits.remaining !== null) credits = r.credits;
      return { event, data: r.data };
    } catch (error) {
      failedEvents.push(`${event.away_team} @ ${event.home_team}: ${error.message}`);
      return null;
    }
  });

  const rows = new Map();
  const unmatched = new Set();

  for (const item of perEvent) {
    if (!item) continue;
    const { event, data } = item;

    for (const book of data?.bookmakers || []) {
      for (const market of book.markets || []) {
        if (!PROP_MARKETS.includes(market.key)) continue;

        for (const outcome of market.outcomes || []) {
          const side = str(outcome.name).toUpperCase();
          const player = str(outcome.description);
          const line = numberOrNull(outcome.point);
          if (!player || line === null || (side !== "OVER" && side !== "UNDER")) continue;

          const playerKey = normalizeName(player);
          const key = [event.id, book.key, market.key, playerKey].join("|");

          if (!rows.has(key)) {
            const nbaId = idByName.get(playerKey) ?? null;
            if (nbaId === null) unmatched.add(player);
            rows.set(key, {
              prop_date: day,
              snapshot,
              event_id: str(event.id),
              commence_time: event.commence_time,
              home_team: str(event.home_team),
              away_team: str(event.away_team),
              bookmaker: str(book.key),
              market: market.key,
              player_name: player,
              player_key: playerKey,
              nba_player_id: nbaId,
              line,
              over_price: null,
              under_price: null,
              book_updated_at: market.last_update || book.last_update || null,
              fetched_at: fetchedAt
            });
          }

          const row = rows.get(key);
          // Una sola linea por casa/mercado/jugador (la primera que llega).
          if (row.line !== line) continue;
          if (side === "OVER") row.over_price = numberOrNull(outcome.price);
          else row.under_price = numberOrNull(outcome.price);
        }
      }
    }
  }

  const list = [...rows.values()];
  if (list.length) {
    await upsertAll(
      "fantasy_nba_prop_lines",
      list,
      "prop_date,snapshot,event_id,bookmaker,market,player_key"
    );
  }

  // Foto de las lesiones en ESTE momento: asi la formula sabe que
  // bajas ya estaban cuando se publicaron las lineas y cuales
  // salieron despues (esas las lineas no las traen).
  const injuries = await selectAll("nba_player_injuries_current", "player_id,status");
  await upsertAll("fantasy_nba_prop_snapshots", [{
    prop_date: day,
    snapshot,
    fetched_at: fetchedAt,
    events: events.length,
    lines: list.length,
    players: new Set(list.map(r => r.player_key)).size,
    credits_remaining: credits?.remaining ?? null,
    injuries: Object.fromEntries(injuries.map(i => [String(i.player_id), str(i.status)]))
  }], "prop_date,snapshot");

  const byMarket = {};
  for (const r of list) byMarket[r.market] = (byMarket[r.market] || 0) + 1;

  return {
    date: day,
    snapshot,
    events: events.length,
    eventsFailed: failedEvents,
    lines: list.length,
    players: new Set(list.map(r => r.player_key)).size,
    byMarket,
    unmatchedPlayers: [...unmatched].slice(0, 40),
    unmatchedCount: unmatched.size,
    credits
  };
}

// Automatico (cron cada 15 min): decide si toca foto y cual.
// Si no toca nada, solo lee Supabase (no gasta creditos).
async function stepPropsAuto(day, runRefresh, runInjuries) {
  const now = Date.now();
  const tip = await firstTip(day);

  let snapshot = null;
  if (tip && now >= tip - PREVIA_MINUTES_BEFORE * 60000 && now < tip) {
    if (!(await propSnapshotExists(day, "previa"))) snapshot = "previa";
  }
  if (!snapshot && chicagoHour() >= MORNING_HOUR_CHICAGO && (!tip || now < tip)) {
    if (!(await propSnapshotExists(day, "manana"))) snapshot = "manana";
  }

  if (!snapshot) {
    return {
      date: day,
      skipped: true,
      firstTip: tip ? new Date(tip).toISOString() : null,
      message: "No toca descarga ahora"
    };
  }

  // Lesiones al dia ANTES de la foto (para comparar con las lineas).
  const injuriesBefore = await runInjuries().catch(error => ({ ok: false, error: error.message }));
  const props = await stepProps(day, snapshot);
  props.injuriesBefore = injuriesBefore;
  // Con la foto nueva: lesiones, depth chart, slate y formula.
  const refresh = await runRefresh();
  return { date: day, snapshot, props, refresh };
}


// ============================================================
// PASO: CORRIDA DE CIERRE (antes de cada slate)
// ============================================================
// Por que: en la prueba del 25-oct, con la misma formula y el mismo
// combinador, saber al cierre quien no juega (Kawhi, Edgecombe,
// Thompson) y repartir sus minutos subio las alineaciones que cobran
// de 30 a 70 de 150. Lo que hace:
//   1) lesiones al dia (BALLDONTLIE)
//   2) foto "cierre" de props (solo partidos que no han empezado):
//      las casas ya movieron las lineas con la noticia
//   3) depth chart al dia (ESPN)
//   4) la formula completa: minutos, roles y las alineaciones se
//      rehacen desde cero (oficial + variantes + 150 de prueba).
// Las corridas anteriores quedan en el archivo (no se borran).

const CIERRE_START_MINUTES = 45;   // empieza a mirar 45 min antes
const CIERRE_END_MINUTES = 15;     // y no corre a menos de 15 min

async function slateStarts(day) {
  const slates = await selectAll("fantasy_nba_slates", "slate_id,platform,starts_at", q => q.eq("slate_date", day));
  return slates
    .map(s => ({ slateId: Number(s.slate_id), platform: s.platform, start: Date.parse(s.starts_at) }))
    .filter(s => Number.isFinite(s.start));
}

// ¿Ya se hizo el cierre de este horario? La foto "cierre" de props
// guarda la hora en que se bajo.
async function cierreDoneSince(day, sinceMs) {
  const { data, error } = await supabaseAdmin
    .from("fantasy_nba_prop_snapshots")
    .select("fetched_at")
    .eq("prop_date", day)
    .eq("snapshot", "cierre")
    .limit(1);
  if (error) throw new Error(`Supabase fantasy_nba_prop_snapshots: ${error.message}`);
  const at = data?.[0]?.fetched_at ? Date.parse(data[0].fetched_at) : null;
  return at !== null && at >= sinceMs;
}

async function stepCierre(day, { auto, runInjuries, runDepth, runProject }) {
  const now = Date.now();
  const slates = await slateStarts(day);
  const due = slates.filter(s =>
    now >= s.start - CIERRE_START_MINUTES * 60000 &&
    now <= s.start - CIERRE_END_MINUTES * 60000
  );
  const horarios = slates.map(s => `${s.platform} ${new Date(s.start).toISOString()}`);

  if (auto) {
    if (!due.length) return { date: day, skipped: true, message: "No toca corrida de cierre ahora", slates: horarios };
    const first = Math.min(...due.map(s => s.start));
    if (await cierreDoneSince(day, first - (CIERRE_START_MINUTES + 5) * 60000)) {
      return { date: day, skipped: true, message: "El cierre de este horario ya se corrio", slates: horarios };
    }
  }

  const out = { date: day, slatesEnCierre: due.map(s => `${s.platform} ${new Date(s.start).toISOString()}`) };
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      out[name] = { ok: true, ...(await fn()), seconds: (Date.now() - t0) / 1000 };
    } catch (error) {
      console.error(`FANTASY NBA CIERRE ${name}:`, error);
      out[name] = { ok: false, error: error.message, seconds: (Date.now() - t0) / 1000 };
    }
  };
  await step("injuries", runInjuries);
  await step("props", () => stepProps(day, "cierre", { onlyUpcoming: true }));
  await step("depth", runDepth);
  await step("project", runProject);
  return out;
}


// ============================================================
// HANDLER
// ============================================================

function isInternalRequest(req) {
  const validSecret =
    process.env.CRON_SECRET ||
    process.env.GENERATE_DAILY_SECRET ||
    "";

  if (!validSecret) return false;

  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = String(req.headers["x-internal-secret"] || "");
  const query = String(req.query.secret || "");

  return bearer === validSecret || header === validSecret || query === validSecret;
}

const PLANS = {
  // 3:30 am: la foto "manana" de props va despues del slate (para
  // enlazar jugadores) y antes de la formula. Las casas ya publican
  // las lineas del dia desde la noche anterior.
  all: ["starters", "box", "quarters", "evaluate", "injuries", "depth", "slate", "props", "project"],
  refresh: ["injuries", "depth", "slate", "project"],
  starters: ["starters"],
  box: ["box"],
  quarters: ["quarters"],
  evaluate: ["evaluate"],
  project: ["project"],
  injuries: ["injuries"],
  depth: ["depth"],
  slate: ["slate"],
  props: ["props"],
  cierre: ["cierre"]
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isInternalRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.BALLDONTLIE_API_KEY) {
    return res.status(500).json({ error: "BALLDONTLIE_API_KEY no configurada" });
  }

  const step = String(req.query.step || "all");
  const plan = PLANS[step];

  if (!plan) {
    return res.status(400).json({
      error: "step invalido",
      valid: Object.keys(PLANS)
    });
  }

  const auto = String(req.query.auto || "") === "1";

  const requestedLimit = Number(req.query.limit || DAILY_STARTER_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_STARTER_LIMIT, Math.max(1, Math.floor(requestedLimit)))
    : DAILY_STARTER_LIMIT;

  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
    ? String(req.query.date)
    : chicagoDay();

  // Fechas por llamada para el paso box (diario 3; carga inicial hasta 20).
  const requestedDates = Number(req.query.dates || 3);
  const maxDates = Number.isFinite(requestedDates)
    ? Math.min(20, Math.max(1, Math.floor(requestedDates)))
    : 3;

  const steps = {
    starters: () => stepStarters(limit),
    box: () => stepBox(maxDates),
    quarters: () => stepQuarters(),
    injuries: () => stepInjuries(),
    depth: () => stepDepth(),
    slate: () => stepSlate(day),

    // Lineas de props. &auto=1 (cron): decide solo si toca foto.
    // Manual: &snapshot=manana|previa (por defecto "manual").
    props: async () => {
      if (auto) return stepPropsAuto(day, runRefresh, () => stepInjuries());
      // Manual: lesiones al dia ANTES de la foto, para que la foto
      // guarde las bajas reales del momento (en "all" ya se corrio
      // el paso injuries justo antes).
      if (step !== "all") await stepInjuries();
      return stepProps(
        day,
        ["manana", "previa"].includes(String(req.query.snapshot))
          ? String(req.query.snapshot)
          : step === "all" ? "manana" : "manual"
      );
    },

    // La formula (lee solo Supabase).
    project: async () => {
      const r = await fantasyProject.runProjection(day);
      return {
        date: r.date,
        message: r.message || null,
        platforms: (r.platforms || []).map(p => ({
          platform: p.platform,
          eligible: p.eligible,
          excluded: p.excluded,
          lineups: p.lineups?.length || 0,
          bestLineup: p.lineups?.[0]?.proyectado ?? null
        })),
        prueba: r.prueba || null,
        variantes: (r.variantesDePrueba || []).map(v => ({
          version: v.version,
          error: v.error || null,
          prueba: v.prueba || null,
          segundos: v.segundos ?? null
        })),
        formulaSeconds: r.seconds
      };
    },

    // Corrida de cierre: &auto=1 (cron) decide si toca; sin auto
    // corre ya (para probarla a mano).
    cierre: () => stepCierre(day, {
      auto,
      runInjuries: () => stepInjuries(),
      runDepth: () => stepDepth(),
      runProject: () => steps.project()
    }),

    // Compara las proyecciones de ayer contra lo real.
    evaluate: async () => {
      const r = await fantasyProject.runEvaluation(fantasyProject.shiftDay(chicagoDay(), -1));
      return {
        date: r.date,
        message: r.message || null,
        titularesAcertados: r.titularesAcertados || null,
        errorMinutosTitulares: r.errorMinutosTitulares ?? null,
        errorMinutosBanca: r.errorMinutosBanca ?? null,
        platforms: Object.fromEntries(
          Object.entries(r.platforms || {}).map(([k, v]) => [k, {
            errorPromedio: v.errorPromedio,
            sesgo: v.sesgo,
            dentroDe10: v.dentroDe10
          }])
        )
      };
    }
  };

  // Refresh despues de una foto de props (cada paso por separado).
  async function runRefresh() {
    const out = {};
    for (const name of PLANS.refresh) {
      const t0 = Date.now();
      try {
        out[name] = { ok: true, ...(await steps[name]()), seconds: (Date.now() - t0) / 1000 };
      } catch (error) {
        console.error(`FANTASY NBA DAILY refresh ${name}:`, error);
        out[name] = { ok: false, error: error.message, seconds: (Date.now() - t0) / 1000 };
      }
    }
    return out;
  }

  const startedAt = Date.now();
  const results = {};
  let failed = false;

  // Cada paso por separado: si uno falla, los demas siguen.
  for (const name of plan) {
    const t0 = Date.now();
    try {
      results[name] = { ok: true, ...(await steps[name]()), seconds: (Date.now() - t0) / 1000 };
    } catch (error) {
      failed = true;
      console.error(`FANTASY NBA DAILY ${name}:`, error);
      results[name] = { ok: false, error: error.message, seconds: (Date.now() - t0) / 1000 };
    }
  }

  return res.status(failed ? 500 : 200).json({
    ok: !failed,
    step,
    season: CURRENT_SEASON,
    previousSeason: PREVIOUS_SEASON,
    seconds: (Date.now() - startedAt) / 1000,
    results
  });
};

// ============================================================
// CASHEDGE FANTASY NFL — FORMULA + ALINEACIONES + EVALUACION
// ============================================================
//
// Lee SOLO de Supabase (lo que guardan fantasy-nfl-weekly y
// fantasy-nfl-daily) y escribe:
//   fantasy_nfl_runs, fantasy_nfl_projections,
//   fantasy_nfl_lineups, fantasy_nfl_evaluations
//
// USO
//   ?secret=...                     -> ver la ultima corrida y sus alineaciones
//   ?secret=...&view=1              -> lo mismo en pagina (tablas con salario)
//   ?secret=...&run=1               -> calcular ahora
//   ?secret=...&auto=1              -> (cron) decide solo si toca correr:
//                                      1) una vez al dia (8:30 am Chicago)
//                                      2) despues de los inactivos de cada
//                                         horario de partidos (60-85 min antes)
//   ?secret=...&mode=evaluate       -> (cron martes) proyeccion vs real
//   ?secret=...&mode=evaluate&view=1 -> ver la ultima evaluacion
//
// REGLA DE ORO: solo entran a una alineacion jugadores que van a
// jugar. Un "Questionable" solo entra cuando ya salieron los
// inactivos de su partido y la lista de lesiones esta actualizada.
//
// SHADOW: no publica nada, no toca picks, props ni otros crons.
//
// 2-NOV (aprobado): MERCADO 70% + 4 PARTIDOS + 2 PRINCIPALES (DK).
//   - Lee (solo lectura) las lineas de CashEdge en player_props_cache:
//     yardas, recepciones, prob. de touchdown y puntos que Las Vegas
//     espera de cada equipo.
//   - Proyeccion DK = 70% mercado + 30% formula (sin linea: formula).
//     DST: segun los puntos que se espera que anote su rival.
//   - 20 alineaciones en los 4 partidos con total mas alto de Las
//     Vegas: QB del equipo que mas anota + 2 receptores + 2 principales
//     mas del mismo partido.
//   - 200 alineaciones de prueba (misma forma) en
//     fantasy_nfl_test_lineups; la evaluacion las mide.
//   - FanDuel sigue como antes (20 alineaciones).
// ============================================================

"use strict";

const { createClient } = require("@supabase/supabase-js");
const model = require("./_lib/fantasy-nfl-model.js");
const { buildLineups, buildStackLineups, buildGameStackLineups, RULES } = require("./_lib/fantasy-nfl-lineups.js");
const daily = require("./fantasy-nfl-daily.js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  windowDays: 7,                 // partidos de hoy y los 6 dias siguientes
  dailyRunAfterUtcHour: 13.5,    // 8:30 am Chicago (despues de fantasy-nfl-daily)
  inactivesMinutesBefore: 90,    // la NFL publica los inactivos 90 min antes
  triggerFrom: 75,               // la corrida post-inactivos: entre 75 (le da
                                 // tiempo a nfl-injury-cron de actualizar)...
  triggerTo: 10,                 // ...y 10 minutos antes del partido
  lineupCount: 20,               // 2-nov: 10 -> 20
  testLineupCount: 200,          // 2-nov: de prueba (fantasy_nfl_test_lineups)
  testMaxSeconds: 200,           // si la corrida va pasada de esto, no arma pruebas
  // 2-nov (aprobado, prueba 25-oct y 1-nov): mercado + partidos de Las Vegas.
  market: {
    platforms: ["draftkings"],   // FanDuel sigue como antes
    weight: 0.7,                 // 70% mercado + 30% formula
    games: 4,                    // los 4 partidos con total mas alto
    extras: 2                    // principales extra del mismo partido
  },
  lineupMinDifferent: 2,
  lineupMaxExposure: 0.4,        // ningun jugador en mas del 40% de las alineaciones
                                 // (con stack: el QB lo limita la cuota de su bloque)
  lineupStack: true,             // QB + receptores en cada alineacion y nunca una
                                 // DST contra los propios jugadores (false = como antes)
  sims: 10000,

  // Quien puede entrar a una alineacion (rol real):
  maxDepthRank: { QB: 1, RB: 2, WR: 3, TE: 2 },
  minSnapPct: { QB: 0.8, RB: 0.30, WR: 0.50, TE: 0.45 },
  minPoints: 3,
  // Tu regla: salario de $3,500 o menos NO entra (DK; la DST no
  // cuenta). En FanDuel el minimo es $4,000: el limite equivalente
  // se fija despues de medirlo en la evaluacion (null = sin limite).
  maxExcludedSalary: { draftkings: 3500, fanduel: null }
};

const POS = new Set(["QB", "RB", "WR", "TE"]);

// Mensajes de diagnostico solo si NFL_DEBUG=1 (en Vercel no salen).
const debug = process.env.NFL_DEBUG ? (...a) => console.error("[nfl]", ...a) : () => {};

const OUT_RE = /\b(out|inactive|injured reserve|ir|pup|nfi|suspended|doubtful|reserve|o|d|sus)\b/i;
const Q_RE = /\b(questionable|q|gtd|game[- ]time|day[- ]to[- ]day)\b/i;


// ============================================================
// UTILIDADES
// ============================================================

const str = v => String(v ?? "").trim();
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

function currentNFLSeason(date = new Date()) {
  return date.getMonth() + 1 >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

function chicagoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "2026-10-25" + "13:00" (hora del este) -> Date (UTC)
function easternToDate(day, time) {
  const [h, m] = str(time || "13:00").split(":").map(Number);
  const guess = new Date(Date.UTC(...day.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), h, m || 0));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(guess).map(p => [p.type, p.value]));
  const asEt = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() + (guess.getTime() - asEt));
}

const TEAM_ALIASES = { LAR: "LA", STL: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", LVR: "LV", SD: "LAC" };
const teamCode = raw => {
  const v = str(raw).toUpperCase();
  return TEAM_ALIASES[v] || v;
};

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

async function selectAll(table, columns, build = q => q) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(supabaseAdmin.from(table).select(columns)).range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function insertAll(table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabaseAdmin.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}

async function upsertAll(table, rows, onConflict, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabaseAdmin.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}

// Semilla fija por dia: la misma corrida da el mismo resultado.
const seedOf = text => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);


// ============================================================
// LECTURA DE DATOS
// ============================================================

async function loadHistory(season) {
  const seasons = [season - 1, season];
  const [teamGames, playerGames, expected, snaps, players] = await Promise.all([
    selectAll("football_team_week_stats", "*", q => q.in("season", seasons)),
    selectAll(
      "football_player_week_stats",
      "gsis_player_id,game_id,season,week,game_date,player_name,position,team,opponent,completions,passing_attempts,passing_yards,passing_tds,interceptions,rushing_attempts,rushing_yards,rushing_tds,targets,receptions,receiving_yards,receiving_tds,receiving_air_yards,fumbles_lost,two_point_conversions",
      q => q.in("season", seasons)
    ),
    selectAll("football_player_week_expected", "gsis_player_id,game_id,rec_td_exp,rush_td_exp,pass_td_exp", q => q.in("season", seasons)),
    selectAll(
      "football_player_game_stats",
      "gsis_player_id,player_id,game_date,season,offense_snaps,offense_pct,position",
      q => q.eq("sport", "nfl").in("season", seasons)
    ),
    selectAll("football_players", "gsis_player_id,player_name,position,team,roster_status,espn_athlete_id")
  ]);

  return {
    teamGames,
    playerGames,
    expected,
    snaps: snaps
      .map(s => ({
        gsis_player_id: str(s.gsis_player_id || s.player_id),
        game_date: str(s.game_date).slice(0, 10),
        season: s.season,
        offense_snaps: s.offense_snaps,
        offense_pct: s.offense_pct
      }))
      .filter(s => s.gsis_player_id),
    players
  };
}

async function loadToday(today) {
  const until = addDays(today, CONFIG.windowDays - 1);

  const [schedule, depthDates, injuries, slates, weather] = await Promise.all([
    selectAll("football_schedule", "*", q => q.gte("game_date", today).lte("game_date", until)),
    selectAll("football_depth_chart", "snapshot_date", q => q.lte("snapshot_date", today).order("snapshot_date", { ascending: false }).limit(1)),
    selectAll("nfl_injury_state", "espn_athlete_id,player_name,normalized_status,raw_status,active,last_seen_at,updated_at", q => q.eq("active", true)),
    selectAll("fantasy_nfl_slates", "*", q => q.gte("slate_date", today).lte("slate_date", until)),
    selectAll("football_game_weather", "*", q => q.gte("game_date", today).lte("game_date", until))
  ]);

  const snapshot = depthDates[0]?.snapshot_date || null;
  const depth = snapshot
    ? await selectAll("football_depth_chart", "*", q => q.eq("snapshot_date", snapshot))
    : [];

  const slateIds = slates.map(s => s.slate_id);
  const slatePlayers = slateIds.length
    ? await selectAll("fantasy_nfl_slate_players", "*", q => q.in("slate_id", slateIds))
    : [];

  // 4-nov: slates de DraftKings con la lista COMPLETA de DraftKings.
  const dk = await useDraftKingsLists(slates, slatePlayers);

  return { schedule, depth, depthSnapshot: snapshot, injuries, slates, slatePlayers: dk.players, dkLists: dk.info, weather };
}

// 4-nov: Para cada slate de DraftKings (de BallDontLie), si hay un
// slate Classic de DraftKings del mismo dia con EXACTAMENTE los
// mismos equipos (fantasy_app_dk_players, lo llena
// fantasy-app?action=sync-dk), la lista de jugadores sale de
// DraftKings: completa, con su status y sus IDs oficiales.
// - Jugador que BallDontLie tambien tenia: se queda con su misma
//   llave (entity_key) para que la evaluacion siga igual.
// - Jugador nuevo: llave "dk:<id de DraftKings>".
// Si no hay lista de DraftKings o no cuadra, todo sigue igual.
// FanDuel no cambia.
async function useDraftKingsLists(slates, slatePlayers) {
  const dkSlates = slates.filter(s => s.platform === "draftkings");
  if (!dkSlates.length) return { players: slatePlayers, info: [] };
  let groups = [];
  try {
    const days = [...new Set(dkSlates.map(s => s.slate_date))];
    groups = await selectAll("fantasy_app_dk_slates", "*",
      q => q.eq("sport", "nfl").eq("game_type", "classic").in("slate_date", days));
  } catch (e) {
    return { players: slatePlayers, info: [{ usada: "balldontlie", motivo: `tabla DraftKings no disponible: ${e.message}` }] };
  }
  const info = [];
  let players = slatePlayers;
  for (const slate of dkSlates) {
    const bdl = players.filter(p => Number(p.slate_id) === Number(slate.slate_id));
    const teams = new Set(bdl.map(p => teamCode(p.team)));
    const fresh = groups.filter(g => g.slate_date === slate.slate_date && Date.now() - Date.parse(g.checked_at) <= 3 * 3600000);
    let match = null;
    for (const g of fresh) {
      const rows = await selectAll("fantasy_app_dk_players", "*", q => q.eq("draft_group_id", Number(g.draft_group_id)));
      const dkTeams = new Set(rows.map(r => teamCode(r.team)));
      if (dkTeams.size === teams.size && [...teams].every(t => dkTeams.has(t))) { match = { g, rows }; break; }
    }
    if (!match) {
      info.push({ slate: slate.slate_id, usada: "balldontlie", motivo: fresh.length ? "ningun slate de DraftKings con los mismos partidos" : "sin lista de DraftKings reciente (sync-dk)" });
      continue;
    }
    const byKey = new Map();
    for (const p of bdl) {
      const key = p.entity_type === "team" ? `DST:${teamCode(p.team)}` : p.gsis_player_id;
      if (key && !byKey.has(key)) byKey.set(key, p);
    }
    const eventOfTeam = new Map(bdl.map(p => [teamCode(p.team), p.event_id]));
    const seen = new Set();
    const out = [];
    let sinCruce = 0;
    const nuevos = [];
    for (const r of match.rows) {
      const key = r.player_key;
      if (!key) { sinCruce++; continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      const old = byKey.get(key);
      const isDst = key.startsWith("DST:");
      if (!old) nuevos.push(`${r.player_name} ${teamCode(r.team)} $${r.salary}`);
      out.push({
        ...(old || {}),
        slate_id: slate.slate_id,
        entity_key: old ? old.entity_key : `dk:${r.dk_id}`,
        platform: "draftkings",
        slate_date: slate.slate_date,
        entity_type: isDst ? "team" : "player",
        gsis_player_id: isDst ? null : key,
        player_name: r.player_name,
        position: isDst ? "DST" : (r.positions || [])[0] || old?.position || null,
        team: teamCode(r.team),
        event_id: old?.event_id ?? eventOfTeam.get(teamCode(r.team)) ?? null,
        salary: Number(r.salary),
        status: r.status || null,
        dk_id: Number(r.dk_id),
        checked_at: r.checked_at
      });
    }
    if (out.length < bdl.length * 0.9) {
      info.push({ slate: slate.slate_id, usada: "balldontlie", motivo: `DraftKings trae pocos (${out.length} vs ${bdl.length})` });
      continue;
    }
    players = players.filter(p => Number(p.slate_id) !== Number(slate.slate_id)).concat(out);
    info.push({ slate: slate.slate_id, usada: "draftkings", draft_group_id: Number(match.g.draft_group_id), jugadores: out.length, balldontlie_tenia: bdl.length, nuevos, sin_cruce: sinCruce });
  }
  return { players, info };
}


// ============================================================
// 2-NOV: MERCADO (lineas de CashEdge, solo lectura)
// ============================================================
// player_props_cache (sport nfl): playerLines = linea de cada jugador
// (player_pass_yds, player_rush_yds, player_reception_yds,
// player_receptions...) y anytimeTDProps = probabilidad de touchdown
// + puntos que Las Vegas espera de su equipo (impliedTeamPoints).

const normName = v => str(v).toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
  .replace(/[^a-z]/g, "");

async function loadMarket(today) {
  const until = addDays(today, CONFIG.windowDays);
  const rows = await selectAll(
    "player_props_cache",
    "game,game_date,playerLines:analysis_json->playerLines,td:analysis_json->anytimeTDProps",
    q => q.eq("sport", "nfl").gte("game_date", addDays(today, -1)).lte("game_date", until)
  );
  const lines = new Map();     // nombre -> { mercado: linea }
  const tdProb = new Map();    // nombre -> prob. de touchdown (0-1)
  const implied = new Map();   // nombre -> puntos esperados de su equipo
  for (const r of rows) {
    for (const l of Array.isArray(r.playerLines) ? r.playerLines : []) {
      const k = normName(l.player);
      const line = num(l.line);
      if (!k || line === null || !l.market) continue;
      const o = lines.get(k) || {};
      // Primero la de DraftKings; si no hay, la de otra casa.
      if (o[l.market] === undefined || str(l.bookmaker).toLowerCase() === "draftkings") o[l.market] = line;
      lines.set(k, o);
    }
    for (const t of Array.isArray(r.td) ? r.td : []) {
      const k = normName(t.player);
      if (!k) continue;
      const p = num(t.impliedProbability);
      if (p !== null && !tdProb.has(k)) tdProb.set(k, p / 100);
      const ip = num(t.model?.impliedTeamPoints);
      if (ip !== null) implied.set(k, ip);
    }
  }
  return { lines, tdProb, implied, games: rows.length };
}

// Puntos que Las Vegas espera de cada equipo: la mediana de lo que
// trae cada jugador del equipo. Si a un equipo le falta (paso con
// CIN-TEN el 1-nov), se estima con la linea de yardas de pase de su QB
// (ajuste lineal con los equipos que si lo tienen). Sin nada: null.
function teamImpliedPoints(market, players) {
  const byTeam = new Map();
  for (const p of players) {
    const v = market.implied.get(normName(p.name));
    if (v !== undefined) pushTo(byTeam, p.team, v);
  }
  const out = new Map();
  for (const [t, list] of byTeam) {
    const a = list.slice().sort((x, y) => x - y);
    out.set(t, a[Math.floor(a.length / 2)]);
  }
  const passYds = p => market.lines.get(normName(p.name))?.player_pass_yds;
  const qbs = players.filter(p => p.position === "QB" && passYds(p) !== undefined);
  const pts = qbs.filter(q => out.has(q.team)).map(q => [passYds(q), out.get(q.team)]);
  const estimated = [];
  if (pts.length >= 5) {
    const mx = pts.reduce((s, x) => s + x[0], 0) / pts.length;
    const my = pts.reduce((s, x) => s + x[1], 0) / pts.length;
    const sxx = pts.reduce((s, x) => s + (x[0] - mx) ** 2, 0);
    const b = sxx ? pts.reduce((s, x) => s + (x[0] - mx) * (x[1] - my), 0) / sxx : 0;
    for (const q of qbs) {
      if (out.has(q.team)) continue;
      out.set(q.team, Math.round((my + b * (passYds(q) - mx)) * 4) / 4);
      estimated.push(q.team);
    }
  }
  return { byTeam: out, estimated };
}

// Puntos DraftKings segun el mercado (null = sin linea suficiente).
// Lineas = mediana; TD esperados = -ln(1 - prob. de touchdown).
// QB: pases de TD = puntos del equipo x 0.105 TD por punto x 62% por aire.
function marketPointsDK(p, market, implied) {
  if (p.isDst) {
    const opp = implied.get(p.opponent);
    return opp === undefined ? null : Math.max(1, 6.5 + 0.45 * (22 - opp));
  }
  const k = normName(p.name);
  const o = market.lines.get(k);
  if (!o) return null;
  const prob = market.tdProb.get(k);
  const tds = prob === undefined ? null : -Math.log(1 - Math.min(prob, 0.95));
  if (p.position === "QB") {
    if (o.player_pass_yds === undefined) return null;
    const passTd = (implied.get(p.team) ?? 22) * 0.105 * 0.62;
    return 0.04 * o.player_pass_yds + 4 * passTd - 0.8 + 0.1 * (o.player_rush_yds || 0) +
      6 * (tds ?? 0.12) + (o.player_pass_yds >= 300 ? 1 : 0);
  }
  const recYds = o.player_reception_yds;
  const rushYds = o.player_rush_yds;
  if (recYds === undefined && rushYds === undefined) return null;
  if (p.position === "RB" && rushYds === undefined) return null;
  if (tds === null) return null;
  const rec = o.player_receptions ?? (recYds !== undefined ? recYds / 11 : 0);
  return rec + 0.1 * (recYds || 0) + 0.1 * (rushYds || 0) + 6 * tds;
}


// ============================================================
// DISPONIBILIDAD (quien va a jugar)
// ============================================================

function injuryIndex(injuries) {
  const byEspn = new Map();
  let freshest = 0;
  for (const r of injuries) {
    const t = Date.parse(r.last_seen_at || r.updated_at || "");
    if (Number.isFinite(t) && t > freshest) freshest = t;
    const id = str(r.espn_athlete_id);
    if (!id) continue;
    const prev = byEspn.get(id);
    if (!prev || (Date.parse(prev.last_seen_at || prev.updated_at || "") || 0) < t) byEspn.set(id, r);
  }
  return { byEspn, freshest };
}

function classify(statusText) {
  const s = str(statusText);
  if (!s) return null;
  if (OUT_RE.test(s)) return "OUT";
  if (Q_RE.test(s)) return "Q";
  return null;
}

// Devuelve una funcion gsis -> { ok, reason, questionable }
function availabilityFor({ now, kickoffOf, playersByGsis, injuryIdx, depthByGsis, slateStatus }) {
  return (gsis, team) => {
    const p = playersByGsis.get(gsis);
    if (!p) return { ok: false, reason: "SIN_REGISTRO_NFLVERSE" };
    if (str(p.roster_status) && str(p.roster_status).toUpperCase() !== "ACT") {
      return { ok: false, reason: `ROSTER_${str(p.roster_status).toUpperCase()}` };
    }

    // Cada fuente con su estado y CUANDO se leyo ese estado.
    const inj = p.espn_athlete_id ? injuryIdx.byEspn.get(str(p.espn_athlete_id)) : null;
    const depth = depthByGsis.get(gsis);
    const slate = slateStatus.get(gsis);
    const sources = [
      inj ? { status: classify(inj.normalized_status || inj.raw_status), at: Date.parse(inj.last_seen_at || inj.updated_at || "") } : null,
      depth ? { status: classify(depth.espn_injury), at: Date.parse(depth.checked_at || "") } : null,
      slate ? { status: classify(slate.status), at: Date.parse(slate.checked_at || "") } : null
    ].filter(x => x && x.status);

    if (sources.some(x => x.status === "OUT")) return { ok: false, reason: "LESION_OUT" };

    if (sources.some(x => x.status === "Q")) {
      // Un "Questionable" solo entra si:
      // 1) ya salieron los inactivos de SU partido (90 min antes), y
      // 2) CADA fuente que lo marca en duda volvio a leer a ESE jugador
      //    despues de los inactivos y sigue sin ponerlo "Out".
      // (Si lo dejaron inactivo, las fuentes lo cambian a "Out".)
      const kickoff = kickoffOf(team);
      const release = kickoff ? kickoff.getTime() - CONFIG.inactivesMinutesBefore * 60000 : Infinity;
      if (now.getTime() < release) return { ok: false, reason: "DUDA_ANTES_DE_INACTIVOS", questionable: true };
      const stale = sources.filter(x => x.status === "Q" && !(x.at >= release));
      if (stale.length) return { ok: false, reason: "DUDA_SIN_ACTUALIZAR_DESPUES_DE_INACTIVOS", questionable: true };
      return { ok: true, questionable: true };
    }
    return { ok: true };
  };
}


// ============================================================
// CORRIDA DE LA FORMULA
// ============================================================

async function runProjection({ trigger = "manual", triggerKickoff = null, refresh = false } = {}) {
  const t0 = Date.now();
  const now = new Date();
  const today = chicagoDay(now);
  const season = currentNFLSeason(now);

  const refreshReport = {};
  if (refresh) {
    // Despues de los inactivos: depth chart y estados de salarios al dia.
    for (const [name, fn] of [["depth", daily.stepDepth], ["slates", daily.stepSlates]]) {
      try {
        const r = await fn();
        refreshReport[name] = name === "depth" ? { equipos: r.equipos } : { slates: r.slates?.length };
      } catch (error) {
        refreshReport[name] = { error: error.message };
      }
    }
  }

  const [hist, todayData, market] = await Promise.all([
    loadHistory(season),
    loadToday(today),
    // 2-nov: si el mercado falla, se sigue con la formula sola.
    loadMarket(today).catch(error => ({ lines: new Map(), tdProb: new Map(), implied: new Map(), games: 0, error: error.message }))
  ]);
  const t1 = Date.now();
  debug("datos", (t1 - t0) / 1000, "s");

  // Partidos por jugar (los que ya empezaron no se proyectan).
  const games = todayData.schedule
    .filter(g => g.home_score === null && str(g.game_type || "REG") !== "")
    .map(g => ({ ...g, kickoff: easternToDate(g.game_date, g.game_time_et) }))
    .filter(g => g.kickoff.getTime() > now.getTime());

  if (!games.length) return { ok: true, skipped: "sin partidos por jugar en los proximos 7 dias" };

  const ctx = model.buildContext({ season, asOfDate: today, ...hist });
  debug("contexto listo");

  const playersByGsis = new Map(hist.players.map(p => [p.gsis_player_id, p]));
  const names = new Map(hist.players.map(p => [p.gsis_player_id, p.player_name]));
  const injuryIdx = injuryIndex(todayData.injuries);
  const depthByGsis = new Map(todayData.depth.filter(d => d.gsis_player_id).map(d => [d.gsis_player_id, d]));
  // Estado de cada jugador en los salarios (el mas reciente).
  const slateStatus = new Map();
  for (const sp of todayData.slatePlayers) {
    if (!sp.gsis_player_id || !sp.status) continue;
    const prev = slateStatus.get(sp.gsis_player_id);
    if (!prev || String(sp.checked_at) > String(prev.checked_at)) slateStatus.set(sp.gsis_player_id, { status: sp.status, checked_at: sp.checked_at });
  }
  const gameOfTeam = new Map();
  for (const g of games) {
    if (!gameOfTeam.has(g.home_team)) gameOfTeam.set(g.home_team, g);
    if (!gameOfTeam.has(g.away_team)) gameOfTeam.set(g.away_team, g);
  }
  const availability = availabilityFor({
    now,
    kickoffOf: team => gameOfTeam.get(team)?.kickoff || null,
    playersByGsis,
    injuryIdx,
    depthByGsis,
    slateStatus
  });

  const depthByTeam = new Map();
  for (const d of todayData.depth) {
    if (!d.gsis_player_id) continue;
    pushTo(depthByTeam, d.team, { gsis: d.gsis_player_id, name: d.player_name || names.get(d.gsis_player_id), position: d.position, depthRank: d.position_rank });
  }
  const weatherByGame = new Map(todayData.weather.map(w => [w.game_id, { wind_mph: num(w.wind_mph) }]));

  // ---- Proyeccion de cada partido (solo el proximo partido de cada equipo) ----
  const projected = [];
  const reasons = new Map();
  for (const game of games) {
    if (gameOfTeam.get(game.home_team) !== game || gameOfTeam.get(game.away_team) !== game) continue;

    const cands = new Map();
    for (const t of [game.home_team, game.away_team]) {
      const list = model.buildCandidates(ctx, t, depthByTeam.get(t) || [], gsis => availability(gsis, t), names);
      for (const c of list) if (!c.available) reasons.set(c.gsis, c.reason);
      cands.set(t, list);
    }

    const proj = model.projectGame(ctx, game, cands, weatherByGame.get(game.game_id));
    if (!proj) continue;
    model.simulateGame(ctx, proj, { sims: CONFIG.sims, seed: seedOf(`${game.game_id}|${today}`) });
    debug("partido", game.game_id, proj.players.length, "jugadores");
    projected.push({ game, proj, cands });
  }
  const t2 = Date.now();

  // ---- Filas de proyeccion ----
  const rows = [];
  const projByGsis = new Map();
  for (const { game, proj } of projected) {
    for (const p of proj.players) projByGsis.set(p.gsis, { ...p, kickoff: game.kickoff });
    for (const d of proj.dst) projByGsis.set(`DST:${d.team}`, { ...d, kickoff: game.kickoff, isDst: true });
  }
  // 2-nov: puntos que Las Vegas espera de cada equipo y de cada partido.
  const projList = [...projByGsis.values()].filter(p => !p.isDst);
  const { byTeam: implied, estimated: impliedEstimated } = teamImpliedPoints(market, projList);
  const gameTotals = new Map();
  for (const { game } of projected) {
    const h = implied.get(game.home_team), a = implied.get(game.away_team);
    if (h !== undefined && a !== undefined) gameTotals.set(game.game_id, h + a);
  }
  const marketPts = new Map();
  for (const [key, p] of projByGsis) {
    const v = marketPointsDK(p, market, implied);
    if (v !== null) marketPts.set(key, v);
  }

  // Los que no juegan tambien se guardan (con el motivo). Un jugador
  // cambiado de equipo puede salir en los dos: se guarda una vez.
  const savedOut = new Set();
  for (const { game, cands } of projected) {
    for (const [t, list] of cands) {
      for (const c of list) {
        if (c.available || projByGsis.has(c.gsis) || savedOut.has(c.gsis)) continue;
        savedOut.add(c.gsis);
        rows.push({
          entity_key: c.gsis, game_id: game.game_id, kickoff: game.kickoff.toISOString(), team: t,
          opponent: t === game.home_team ? game.away_team : game.home_team,
          player_name: c.name, position: c.position, depth_rank: c.depthRank, available: false,
          status_reason: c.reason, in_pool: false
        });
      }
    }
  }

  // ---- Pool de cada slate: quien puede entrar a una alineacion ----
  const poolReason = (sp, p) => {
    if (sp.entity_type === "team") return p ? null : "SIN_PARTIDO";
    if (!sp.gsis_player_id) return "SIN_ENLACE_NFLVERSE";
    if (!p) return reasons.get(sp.gsis_player_id) || "NO_ESTA_EN_DEPTH_CHART";
    const pos = p.position;
    if (!POS.has(pos)) return "POSICION";
    if (p.depthRank === null || p.depthRank === undefined) return "NO_ESTA_EN_DEPTH_CHART";
    if (p.depthRank > CONFIG.maxDepthRank[pos]) return pos === "QB" ? "QB_SUPLENTE" : "FUERA_DEL_ROL";
    if (p.snapPct < CONFIG.minSnapPct[pos]) return "POCOS_SNAPS";
    if (!p.games && !p.promoted && !(p.inherits > 0) && p.depthRank !== 1) return "SIN_HISTORIAL_CON_EQUIPO";
    const limit = CONFIG.maxExcludedSalary[sp.platform];
    if (limit !== null && limit !== undefined && num(sp.salary) <= limit) return "SALARIO_3500_O_MENOS";
    const pts = p.sim?.[sp.platform]?.mean ?? 0;
    if (pts < CONFIG.minPoints) return "PROYECCION_BAJA";
    return null;
  };

  const lineupsOut = [];
  const testLineupsOut = [];
  const slateReports = [];
  const inPool = new Set();
  // 4-nov: puntos con mercado (70/30) de cada jugador en DraftKings,
  // para guardarlos en su proyeccion (la ficha muestra lo mismo que
  // usan las alineaciones).
  const marketBlend = new Map();

  for (const slate of todayData.slates) {
    const starts = Date.parse(slate.starts_at || "");
    if (!(starts > now.getTime())) continue;     // ya cerro

    const sps = todayData.slatePlayers.filter(s => Number(s.slate_id) === Number(slate.slate_id));
    // El proximo partido del equipo tiene que ser uno de este slate.
    const lastStart = Date.parse(slate.last_event_starts_at || slate.starts_at);
    const pool = [];
    const excluded = {};
    const useMarket = CONFIG.market.platforms.includes(slate.platform) && marketPts.size > 0;
    let withMarket = 0;
    // 1-nov: el mismo jugador puede venir 2 veces en el slate (dos IDs
    // distintos de la fuente, mismo jugador real). Solo entra una vez;
    // si no, el optimizador lo podia poner en TE y en FLEX a la vez.
    const seenKeys = new Set();
    for (const sp of sps) {
      const key = sp.entity_type === "team" ? `DST:${teamCode(sp.team)}` : sp.gsis_player_id;
      if (key && seenKeys.has(key)) {
        excluded.REPETIDO_EN_EL_SLATE = (excluded.REPETIDO_EN_EL_SLATE || 0) + 1;
        continue;
      }
      if (key) seenKeys.add(key);
      const p = key ? projByGsis.get(key) : null;
      const reason = poolReason(sp, p);
      if (reason) {
        excluded[reason] = (excluded[reason] || 0) + 1;
        continue;
      }
      const g = gameOfTeam.get(teamCode(sp.team));
      if (!g || g.kickoff.getTime() < starts - 60000 || g.kickoff.getTime() > lastStart + 60000) {
        excluded.PARTIDO_FUERA_DEL_SLATE = (excluded.PARTIDO_FUERA_DEL_SLATE || 0) + 1;
        continue;
      }
      // 2-nov: DK = 70% mercado + 30% formula (sin linea: formula).
      const formulaPts = p.sim?.[slate.platform]?.mean ?? 0;
      const mPts = useMarket ? marketPts.get(key) : undefined;
      if (mPts !== undefined) withMarket++;
      pool.push({
        id: sp.entity_key,
        key,
        name: sp.player_name,
        salary: num(sp.salary),
        points: round(mPts !== undefined ? CONFIG.market.weight * mPts + (1 - CONFIG.market.weight) * formulaPts : formulaPts, 2),
        positions: [sp.entity_type === "team" ? "DST" : p.position],
        team: teamCode(sp.team),
        opp: teamCode(sp.team) === g.home_team ? g.away_team : g.home_team,
        gameId: g.game_id
      });
      inPool.add(key);
      if (slate.platform === "draftkings" && mPts !== undefined) marketBlend.set(key, pool[pool.length - 1].points);
    }

    debug("optimizador", slate.slate_id, slate.platform, "pool", pool.length);
    const lineupOpts = { count: CONFIG.lineupCount, minDifferent: CONFIG.lineupMinDifferent, maxExposure: CONFIG.lineupMaxExposure };
    // 2-nov: DK con mercado -> 4 partidos de Las Vegas + 2 principales.
    const gameOpts = { games: CONFIG.market.games, extras: CONFIG.market.extras, gameTotals, teamImplied: implied };
    const result = useMarket && gameTotals.size
      ? buildGameStackLineups(slate.platform, pool, { ...lineupOpts, ...gameOpts })
      : CONFIG.lineupStack
        ? buildStackLineups(slate.platform, pool, lineupOpts)
        : buildLineups(slate.platform, pool, lineupOpts);
    // 2-nov: 200 de prueba con la misma forma (solo DK con mercado).
    let testInfo = null;
    if (useMarket && gameTotals.size) {
      if ((Date.now() - t0) / 1000 > CONFIG.testMaxSeconds) {
        testInfo = "no se armaron: la corrida se acerco al limite de tiempo";
      } else {
        const test = buildGameStackLineups(slate.platform, pool, { ...lineupOpts, ...gameOpts, count: CONFIG.testLineupCount });
        testInfo = test.lineups.length;
        for (const l of test.lineups) {
          testLineupsOut.push({
            slate_id: slate.slate_id, platform: slate.platform, lineup_number: l.number, salary: l.salary, points: l.points,
            players: l.players.map(p => ({ slot: p.slot, id: p.id, key: p.key, name: p.name, team: p.team, salary: p.salary, points: p.points }))
          });
        }
      }
    }
    debug("alineaciones", result.lineups.length);
    slateReports.push({
      slate: slate.slate_id, plataforma: slate.platform, fecha: slate.slate_date, principal: slate.is_main,
      listaDraftKings: (todayData.dkLists || []).find(x => Number(x.slate) === Number(slate.slate_id)) || null,
      partidos: slate.event_count, pool: pool.length, excluidos: excluded,
      estado: result.status, optimo: result.optimal,
      stacks: result.stacks ? result.stacks.filter(s => s.lineups > 0) : undefined,
      mercado: useMarket ? {
        conLinea: `${withMarket} de ${pool.length}`,
        partidos: result.partidos || [],
        estimados: impliedEstimated,
        prueba: testInfo
      } : undefined,
      mejor: result.lineups[0] ? { puntos: result.lineups[0].points, salario: result.lineups[0].salary } : null
    });
    for (const l of result.lineups) {
      lineupsOut.push({
        slate_id: slate.slate_id, platform: slate.platform, lineup_number: l.number, salary: l.salary, points: l.points,
        optimal: l.optimal,
        players: l.players.map(p => ({ slot: p.slot, id: p.id, key: p.key, name: p.name, team: p.team, salary: p.salary, points: p.points }))
      });
    }
  }

  for (const [key, p] of projByGsis) {
    const dk = p.sim?.draftkings, fd = p.sim?.fanduel;
    if (p.isDst) {
      rows.push({
        entity_key: key, game_id: p.game_id, kickoff: p.kickoff.toISOString(), team: p.team, opponent: p.opponent,
        player_name: `${p.team} DST`, position: "DST", depth_rank: null, available: true, status_reason: null,
        in_pool: inPool.has(key), stats: { ...Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, round(v, 3)])), ...(marketBlend.has(key) ? { mercado70_dk: marketBlend.get(key) } : {}) },
        dk_points: dk?.mean, dk_p10: dk?.p10, dk_p90: dk?.p90, fd_points: fd?.mean, fd_p10: fd?.p10, fd_p90: fd?.p90
      });
      continue;
    }
    rows.push({
      entity_key: key, game_id: p.game_id, kickoff: p.kickoff.toISOString(), team: p.team, opponent: p.opponent,
      player_name: p.name, position: p.position, depth_rank: p.depthRank, available: true,
      status_reason: null, in_pool: inPool.has(key),
      snap_pct: round(p.snapPct, 3), target_share: round(p.tshare, 3), carry_share: round(p.cshare, 3),
      inherits: p.inherits, def_factor: p.defFactor, archetype: p.archetype,
      stats: { ...Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, round(v, 2)])), ...(marketBlend.has(key) ? { mercado70_dk: marketBlend.get(key) } : {}) },
      dk_points: dk?.mean, dk_p10: dk?.p10, dk_p90: dk?.p90, fd_points: fd?.mean, fd_p10: fd?.p10, fd_p90: fd?.p90
    });
  }

  // ---- Guardar ----
  const summary = {
    partidos: projected.length,
    jugadoresProyectados: rows.filter(r => r.available && r.position !== "DST").length,
    noJuegan: rows.filter(r => !r.available).length,
    depthChart: todayData.depthSnapshot,
    lesionesActualizadas: injuryIdx.freshest ? new Date(injuryIdx.freshest).toISOString() : null,
    slates: slateReports,
    mercado: market.error ? { error: market.error } : {
      partidosConLineas: market.games,
      totalesVegas: [...gameTotals.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => `${g} ${round(v, 2)}`)
    },
    refresh: refresh ? refreshReport : undefined,
    seconds: { datos: (t1 - t0) / 1000, formula: (t2 - t1) / 1000, total: (Date.now() - t0) / 1000 }
  };

  const { data: runRow, error } = await supabaseAdmin
    .from("fantasy_nfl_runs")
    .insert({
      run_date: today, trigger, trigger_kickoff: triggerKickoff ? triggerKickoff.toISOString() : null,
      season, games: projected.length, summary
    })
    .select("run_id")
    .single();
  if (error) throw new Error(`Supabase fantasy_nfl_runs: ${error.message}`);
  const runId = runRow.run_id;

  await insertAll("fantasy_nfl_projections", rows.map(r => ({ run_id: runId, ...r })));
  await insertAll("fantasy_nfl_lineups", lineupsOut.map(l => ({ run_id: runId, ...l })));
  // 2-nov: las de prueba aparte (si la tabla falla, no tumba la corrida).
  if (testLineupsOut.length) {
    try {
      await insertAll("fantasy_nfl_test_lineups", testLineupsOut.map(l => ({ run_id: runId, ...l })));
    } catch (error) {
      summary.pruebaError = error.message;
    }
  }

  return { ok: true, run_id: runId, trigger, ...summary };
}


// ============================================================
// ¿TOCA CORRER? (cron cada 10 minutos)
// ============================================================

async function autoRun() {
  const now = new Date();
  const today = chicagoDay(now);

  const [runs, schedule] = await Promise.all([
    selectAll("fantasy_nfl_runs", "run_id,trigger,trigger_kickoff,run_at", q => q.eq("run_date", today)),
    selectAll("football_schedule", "game_id,game_date,game_time_et,home_score", q => q.gte("game_date", addDays(today, -1)).lte("game_date", addDays(today, 1)))
  ]);

  // 1) Despues de los inactivos de cada horario de partidos.
  const kickoffs = [...new Set(schedule
    .filter(g => g.home_score === null)
    .map(g => easternToDate(g.game_date, g.game_time_et).getTime()))];

  for (const k of kickoffs.sort()) {
    const minutes = (k - now.getTime()) / 60000;
    if (minutes <= CONFIG.triggerFrom && minutes >= CONFIG.triggerTo) {
      const done = runs.some(r => r.trigger === "inactivos" && Date.parse(r.trigger_kickoff) === k);
      if (!done) {
        return runProjection({ trigger: "inactivos", triggerKickoff: new Date(k), refresh: true });
      }
    }
  }

  // 2) Una vez al dia en la manana.
  const hourUtc = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (hourUtc >= CONFIG.dailyRunAfterUtcHour && !runs.some(r => r.trigger === "diaria")) {
    return runProjection({ trigger: "diaria" });
  }

  return { ok: true, skipped: "no toca correr ahora" };
}


// ============================================================
// EVALUACION (martes, despues de la carga semanal)
// ============================================================

function actualOffense(r, platform) {
  return model.offensePoints({
    passYds: num(r.passing_yards) || 0, passTd: num(r.passing_tds) || 0, int: num(r.interceptions) || 0,
    rushYds: num(r.rushing_yards) || 0, rushTd: num(r.rushing_tds) || 0,
    rec: num(r.receptions) || 0, recYds: num(r.receiving_yards) || 0, recTd: num(r.receiving_tds) || 0,
    fumbles: num(r.fumbles_lost) || 0, twoPt: num(r.two_point_conversions) || 0
  }, platform) + 6 * ((num(r.return_tds) || 0) + (num(r.fumble_recovery_tds) || 0));
}

// Puntos permitidos para la DST: los del rival, sin contar los TD
// que anoto la defensa del rival (esos no son culpa de la DST).
function actualDst(t, opp) {
  return model.dstPoints({
    sacks: num(t.def_sacks) || 0, int: num(t.def_interceptions) || 0, fr: num(t.def_fumble_recoveries) || 0,
    defTd: num(t.def_tds) || 0, retTd: num(t.return_tds) || 0, safety: num(t.def_safeties) || 0,
    blocks: (num(t.blocked_punts) || 0) + (num(t.blocked_fgs) || 0) + (num(t.blocked_pats) || 0),
    pa: Math.max(0, (num(t.points_against) || 0) - 7 * (num(opp?.def_tds) || 0))
  });
}

async function runEvaluation() {
  const today = chicagoDay();
  const from = addDays(today, -10);

  const slates = await selectAll("fantasy_nfl_slates", "*", q => q.gte("slate_date", from).lt("slate_date", today));
  const done = new Set((await selectAll("fantasy_nfl_evaluations", "slate_id", q => q.gte("slate_date", from))).map(r => Number(r.slate_id)));
  const pending = slates.filter(s => !done.has(Number(s.slate_id)));
  if (!pending.length) return { ok: true, evaluados: 0, nota: "nada pendiente" };

  const [weekStats, teamStats, snaps, slatePlayers] = await Promise.all([
    selectAll("football_player_week_stats", "*", q => q.gte("game_date", from).lte("game_date", today)),
    selectAll("football_team_week_stats", "*", q => q.gte("game_date", from).lte("game_date", today)),
    selectAll("football_player_game_stats", "gsis_player_id,player_id,game_date,offense_pct", q => q.eq("sport", "nfl").gte("game_date", from).lte("game_date", today)),
    selectAll("fantasy_nfl_slate_players", "*", q => q.in("slate_id", pending.map(s => s.slate_id)))
  ]);

  const statsByGsis = new Map();
  for (const r of weekStats) pushTo(statsByGsis, r.gsis_player_id, r);
  const teamByKey = new Map(teamStats.map(t => [`${t.team}|${t.game_id}`, t]));
  const snapByKey = new Map(snaps.map(s => [`${str(s.gsis_player_id || s.player_id)}|${String(s.game_date).slice(0, 10)}`, num(s.offense_pct)]));

  const results = [];
  for (const slate of pending) {
    const events = Array.isArray(slate.events) ? slate.events : [];
    const lastStart = Math.max(...events.map(e => Date.parse(e.starts_at || "") || 0), Date.parse(slate.starts_at));
    const sps = slatePlayers.filter(s => Number(s.slate_id) === Number(slate.slate_id));
    const teams = new Set(sps.map(s => teamCode(s.team)));

    // Partido de cada equipo en este slate (el primero desde el cierre).
    const since = Date.parse(slate.starts_at) - 86400000;
    const teamGame = team => teamStats
      .filter(g => g.team === team && Date.parse(`${String(g.game_date).slice(0, 10)}T12:00:00Z`) >= since)
      .sort((a, b) => String(a.game_date).localeCompare(String(b.game_date)))[0] || null;

    // ¿Ya esta TODO cargado? De cada equipo: su fila de equipo Y las
    // filas de sus jugadores de ese mismo partido. Si falta algo no se
    // evalua (un jugador sin fila contaria como 0 puntos).
    const missing = [...teams].filter(t => {
      const tg = teamGame(t);
      return !tg || !weekStats.some(r => r.game_id === tg.game_id && r.team === t);
    });
    if (missing.length || Date.now() < lastStart + 5 * 3600000) {
      results.push({ slate: slate.slate_id, estado: "ESPERANDO_RESULTADOS", faltan: missing });
      continue;
    }

    // La corrida exacta que hizo las alineaciones de ESTE slate: la
    // ultima antes del cierre que tenga alineaciones para el.
    const lineupRuns = [...new Set((await selectAll("fantasy_nfl_lineups", "run_id", q => q.eq("slate_id", slate.slate_id))).map(r => Number(r.run_id)))];
    const runRows = lineupRuns.length
      ? await selectAll("fantasy_nfl_runs", "run_id,run_at", q => q.in("run_id", lineupRuns).lt("run_at", slate.starts_at))
      : [];
    const runId = runRows.sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)))[0]?.run_id;
    if (!runId) {
      results.push({ slate: slate.slate_id, estado: "SIN_CORRIDA_CON_ALINEACIONES" });
      continue;
    }

    const [proj, lineups] = await Promise.all([
      selectAll("fantasy_nfl_projections", "*", q => q.eq("run_id", runId)),
      selectAll("fantasy_nfl_lineups", "*", q => q.eq("run_id", runId).eq("slate_id", slate.slate_id))
    ]);
    const projByKey = new Map(proj.map(p => [p.entity_key, p]));
    const platform = slate.platform;
    const pkey = platform === "draftkings" ? "dk" : "fd";

    // Puntos reales de cada jugador / DST del slate.
    const actual = new Map();
    for (const sp of sps) {
      const team = teamCode(sp.team);
      const tg = teamGame(team);
      if (sp.entity_type === "team") {
        const t = tg;
        if (!t) continue;
        const opp = teamByKey.get(`${t.opponent}|${t.game_id}`);
        actual.set(sp.entity_key, { points: actualDst(t, opp), key: `DST:${team}` });
        continue;
      }
      const list = statsByGsis.get(sp.gsis_player_id) || [];
      const r = tg ? list.find(x => x.game_id === tg.game_id) : null;
      // Sin fila = no hizo nada (0) solo si su equipo jugo.
      actual.set(sp.entity_key, {
        points: r ? actualOffense(r, platform) : tg ? 0 : null,
        key: sp.gsis_player_id,
        snap: r ? snapByKey.get(`${sp.gsis_player_id}|${String(r.game_date).slice(0, 10)}`) : null
      });
    }

    // Error de la proyeccion (pool) por posicion.
    const byPos = {};
    let cover = 0, coverN = 0;
    const snapErr = [];
    for (const sp of sps) {
      const a = actual.get(sp.entity_key);
      const p = a ? projByKey.get(a.key) : null;
      if (!a || a.points === null || !p || !p.in_pool) continue;
      const pos = p.position;
      const b = byPos[pos] || (byPos[pos] = { n: 0, abs: 0, bias: 0 });
      const pr = num(p[`${pkey}_points`]) || 0;
      b.n++;
      b.abs += Math.abs(pr - a.points);
      b.bias += pr - a.points;
      const lo = num(p[`${pkey}_p10`]), hi = num(p[`${pkey}_p90`]);
      if (lo !== null && hi !== null) {
        coverN++;
        if (a.points >= lo && a.points <= hi) cover++;
      }
      if (a.snap !== null && a.snap !== undefined && p.snap_pct !== null) {
        const s = a.snap > 1.5 ? a.snap / 100 : a.snap;
        snapErr.push(Math.abs(num(p.snap_pct) - s));
      }
    }
    for (const b of Object.values(byPos)) {
      b.mae = round(b.abs / b.n);
      b.sesgo = round(b.bias / b.n);
      delete b.abs;
      delete b.bias;
    }

    // 4-nov: jugadores de las alineaciones que vinieron de la lista de
    // DraftKings y no estan en la de BallDontLie ("dk:..."): sus puntos
    // reales se buscan por su llave (gsis o DST:EQUIPO).
    for (const l of lineups) {
      for (const p of l.players || []) {
        if (actual.has(p.id) || !p.key) continue;
        const team = teamCode(p.team);
        const tg = teamGame(team);
        if (!tg) continue;
        if (String(p.key).startsWith("DST:")) {
          const opp = teamByKey.get(`${tg.opponent}|${tg.game_id}`);
          actual.set(p.id, { points: actualDst(tg, opp), key: p.key });
        } else {
          const r = (statsByGsis.get(p.key) || []).find(x => x.game_id === tg.game_id);
          actual.set(p.id, { points: r ? actualOffense(r, platform) : 0, key: p.key });
        }
      }
    }

    // Alineaciones: puntos reales de las nuestras vs la perfecta.
    const ours = lineups.sort((a, b) => a.lineup_number - b.lineup_number).map(l => ({
      numero: l.lineup_number,
      proyectado: num(l.points),
      real: round(l.players.reduce((s, p) => s + (actual.get(p.id)?.points ?? 0), 0))
    }));

    const fullPool = sps
      .filter(sp => actual.get(sp.entity_key)?.points !== null && actual.get(sp.entity_key))
      .map(sp => ({
        id: sp.entity_key, name: sp.player_name, salary: num(sp.salary),
        points: actual.get(sp.entity_key).points,
        positions: [sp.entity_type === "team" ? "DST" : sp.position],
        team: teamCode(sp.team), gameId: str(sp.event_id)
      }))
      .filter(p => p.points > 0 && RULES[platform]);
    const perfect = buildLineups(platform, fullPool, { count: 1 }).lineups[0] || null;

    // Jugadores baratos: ¿sirven o no? (para fijar el limite de salario)
    const cheapLimit = platform === "draftkings" ? 3500 : 4500;
    const cheap = sps.filter(sp => sp.entity_type !== "team" && num(sp.salary) <= cheapLimit && actual.get(sp.entity_key)?.points !== null);
    const cheapPts = cheap.map(sp => actual.get(sp.entity_key).points);
    const cheapInPerfect = perfect ? perfect.players.filter(p => p.positions[0] !== "DST" && p.salary <= cheapLimit).map(p => `${p.name} $${p.salary} ${round(p.points, 1)} pts`) : [];

    // 2-nov: las 200 de prueba de la misma corrida.
    let prueba = null;
    try {
      const tests = await selectAll("fantasy_nfl_test_lineups", "lineup_number,players", q => q.eq("run_id", runId).eq("slate_id", slate.slate_id));
      if (tests.length) {
        const pts = tests.map(l => round(l.players.reduce((s, p) => s + (actual.get(p.id)?.points ?? 0), 0)));
        prueba = {
          alineaciones: pts.length,
          mejor: Math.max(...pts),
          promedio: round(pts.reduce((s, v) => s + v, 0) / pts.length),
          con150oMas: pts.filter(v => v >= 150).length,
          con175oMas: pts.filter(v => v >= 175).length,
          con200oMas: pts.filter(v => v >= 200).length,
          con225oMas: pts.filter(v => v >= 225).length
        };
      }
    } catch (error) {
      prueba = { error: error.message };
    }

    const evaluation = {
      slate_id: slate.slate_id,
      platform,
      slate_date: slate.slate_date,
      run_id: runId,
      metrics: {
        porPosicion: byPos,
        snapsErrorPromedio: snapErr.length ? round(snapErr.reduce((s, v) => s + v, 0) / snapErr.length * 100, 1) : null,
        realDentroDeP10P90: coverN ? round(cover / coverN * 100, 0) : null,
        prueba200: prueba
      },
      lineups: {
        nuestras: ours,
        mejorNuestra: ours.length ? Math.max(...ours.map(l => l.real)) : null,
        promedioNuestras: ours.length ? round(ours.reduce((s, l) => s + l.real, 0) / ours.length) : null
      },
      perfect: perfect ? {
        puntos: perfect.points, salario: perfect.salary,
        jugadores: perfect.players.map(p => `${p.slot} ${p.name} $${p.salary} ${round(p.points, 1)}`)
      } : null,
      cheap: {
        limite: cheapLimit,
        jugadores: cheap.length,
        promedioPuntos: cheapPts.length ? round(cheapPts.reduce((s, v) => s + v, 0) / cheapPts.length) : null,
        con10oMas: cheapPts.filter(v => v >= 10).length,
        enLaPerfecta: cheapInPerfect
      }
    };
    await upsertAll("fantasy_nfl_evaluations", [evaluation], "slate_id");
    results.push({ slate: slate.slate_id, plataforma: platform, principal: slate.is_main, ...evaluation.lineups, perfecta: evaluation.perfect?.puntos, metrics: evaluation.metrics, baratos: evaluation.cheap });
  }

  return { ok: true, evaluados: results.filter(r => !r.estado).length, results };
}


// ============================================================
// VER
// ============================================================

async function viewLatest() {
  const { data: run, error } = await supabaseAdmin
    .from("fantasy_nfl_runs").select("*").order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_nfl_runs: ${error.message}`);
  if (!run) return { ok: true, nota: "todavia no hay corridas: usa &run=1" };

  const lineups = await selectAll("fantasy_nfl_lineups", "*", q => q.eq("run_id", run.run_id));
  const main = (run.summary?.slates || []).filter(s => s.principal).map(s => s.slate);
  const show = lineups
    .filter(l => main.includes(Number(l.slate_id)))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.lineup_number - b.lineup_number)
    .map(l => ({
      plataforma: l.platform, slate: l.slate_id, numero: l.lineup_number, puntos: num(l.points), salario: l.salary,
      jugadores: l.players.map(p => `${p.slot} ${p.name} (${p.team}) $${p.salary} ${p.points}`)
    }));
  return { ok: true, run, alineacionesSlatePrincipal: show };
}

// 30-oct: VISTA HTML de la ultima corrida (?secret=...&view=1), como en
// NBA: cada slate con sus pilas, excluidos y alineaciones con salario.
// Solo muestra; no calcula ni guarda nada.
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const chicagoTime = iso => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-US", { timeZone: "America/Chicago", weekday: "short", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" });
};

async function viewLatestHtml() {
  const { data: run, error } = await supabaseAdmin
    .from("fantasy_nfl_runs").select("*").order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_nfl_runs: ${error.message}`);
  if (!run) return "<p>Todavia no hay corridas: usa &amp;run=1</p>";

  const lineups = await selectAll("fantasy_nfl_lineups", "*", q => q.eq("run_id", run.run_id));
  const s = run.summary || {};
  const slates = [...(s.slates || [])].sort((a, b) =>
    Number(b.principal) - Number(a.principal) || String(a.plataforma).localeCompare(String(b.plataforma)) || (b.partidos || 0) - (a.partidos || 0));

  let body = `<h1>Fantasy NFL — corrida ${esc(run.run_id)}</h1>`;
  body += `<div class="box">Hecha: <b>${esc(chicagoTime(run.run_at))}</b> (Chicago) · ${esc(run.trigger)}${run.trigger_kickoff ? ` · partido ${esc(chicagoTime(run.trigger_kickoff))}` : ""}<br>` +
    `Partidos: ${esc(s.partidos ?? run.games)} · jugadores proyectados: ${esc(s.jugadoresProyectados ?? "")} · no juegan: ${esc(s.noJuegan ?? "")}<br>` +
    `Depth chart: ${esc(s.depthChart ?? "")} · lesiones actualizadas: ${esc(s.lesionesActualizadas ? chicagoTime(s.lesionesActualizadas) : "")}</div>`;

  for (const sl of slates) {
    const own = lineups
      .filter(l => Number(l.slate_id) === Number(sl.slate))
      .sort((a, b) => a.lineup_number - b.lineup_number);
    const title = `${esc(sl.plataforma)} — slate ${esc(sl.slate)} (${esc(sl.partidos)} partidos, ${esc(sl.fecha)})${sl.principal ? " · PRINCIPAL" : ""}`;
    let html = `<div class="box">Estado: <b>${esc(sl.estado)}</b> · pool ${esc(sl.pool)} · mejor ${esc(sl.mejor?.puntos ?? "-")} ($${esc(sl.mejor?.salario ?? "-")})<br>` +
      `<b>Pilas:</b> ${(sl.stacks || []).map(k => `${esc(k.qb)} (${esc(k.team)}) + ${esc((k.receivers || []).join(", "))} → ${esc(k.lineups)} alin.`).join(" | ") || "sin pilas"}<br>` +
      `<b>Excluidos:</b> ${esc(Object.entries(sl.excluidos || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "))}</div>`;
    if (own.length) {
      html += `<table><tr><th>#</th><th>pila</th><th>salario</th><th>jugadores</th><th>proyectado</th></tr>`;
      for (const l of own) {
        const players = l.players || [];
        const qb = players.find(p => String(p.slot).toUpperCase() === "QB");
        const mates = qb ? players.filter(p => p !== qb && p.team === qb.team && !/DST|D$/i.test(String(p.slot))) : [];
        const pila = qb ? `${qb.name}${mates.length ? " + " + mates.map(p => p.name).join(" + ") : ""}` : "-";
        const list = players.map(p => `<b>${esc(p.slot)}</b>: ${esc(p.name)} (${esc(p.team)}, $${esc(p.salary)}, ${esc(round(num(p.points) ?? 0, 1))})`).join(" | ");
        html += `<tr><td>${esc(l.lineup_number)}</td><td>${esc(pila)}</td><td>$${esc(l.salary)}</td><td>${list}</td><td>${esc(num(l.points))}</td></tr>`;
      }
      html += `</table>`;
    } else {
      html += `<p>Sin alineaciones para este slate.</p>`;
    }
    body += sl.principal
      ? `<h2>${title}</h2>${html}`
      : `<details><summary>${title}</summary>${html}</details>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Fantasy NFL</title><style>body{font-family:Arial,sans-serif;background:#020814;color:#e6f1ff;margin:16px}` +
    `h1{color:#00ffe7;font-size:20px}h2{color:#00ffe7;font-size:16px;margin-top:24px}summary{cursor:pointer;color:#a07cff;margin:10px 0;font-weight:bold}` +
    `.box{background:#0b1730;border:1px solid #1d2f55;border-radius:8px;padding:10px;margin:8px 0;font-size:13px;line-height:1.5}` +
    `table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}th,td{border:1px solid #1d2f55;padding:5px;text-align:left;vertical-align:top}` +
    `th{background:#0f2244;color:#00ffe7}tr:nth-child(even){background:#071126}</style></head><body>${body}</body></html>`;
}

async function viewEvaluation() {
  const rows = await selectAll("fantasy_nfl_evaluations", "*", q => q.order("evaluated_at", { ascending: false }).limit(20));
  return { ok: true, evaluaciones: rows };
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

  const t0 = Date.now();
  try {
    let result;
    if (req.query.mode === "evaluate") {
      result = req.query.view ? await viewEvaluation() : await runEvaluation();
    } else if (req.query.auto) {
      result = await autoRun();
    } else if (req.query.run) {
      result = await runProjection({ trigger: "manual", refresh: Boolean(req.query.refresh) });
    } else if (req.query.view) {
      // 30-oct: vista HTML de la ultima corrida.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(await viewLatestHtml());
    } else {
      result = await viewLatest();
    }
    return res.status(200).json({ ...result, seconds: (Date.now() - t0) / 1000 });
  } catch (error) {
    console.error("FANTASY NFL PROJECT:", error);
    return res.status(500).json({ ok: false, error: error.message, seconds: (Date.now() - t0) / 1000 });
  }
};

module.exports.runProjection = runProjection;
module.exports.runEvaluation = runEvaluation;
module.exports.easternToDate = easternToDate;
module.exports.availabilityFor = availabilityFor;
module.exports.classify = classify;

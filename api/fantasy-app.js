// ============================================================
// CASHEDGE FANTASY APP — API PARA EL FRONTEND (PASO 1)
// ============================================================
//
// Un solo endpoint para todo el Fantasy de la app:
//   https://cashedgeapp.com/api/fantasy-app?action=...
//
// PASO 1 (este archivo):
//   action=slates   &sport=nba|nfl &site=draftkings|fanduel
//       -> slates de hoy de ese deporte y site
//   action=players  &sport=nba|nfl &slate_id=123
//       -> todos los jugadores del slate con su ficha
//          (ultimos 10 partidos, promedio de temporada, etiquetas)
//   action=build-cards &secret=... [&sport=nba|nfl] [&date=YYYY-MM-DD]
//       -> (cron / manual) prepara las fichas de todos los slates del dia
//   action=csv-official &secret=... &sport=nba|nfl
//       -> CSV de tus alineaciones oficiales de hoy (Main DraftKings)
//          listo para subir a DraftKings
//   action=sync-dk &secret=... [&sport=nba|nfl]
//       -> (cron cada 15 min) lee de DraftKings todos los slates Classic
//          y Captain de hoy con sus IDs oficiales para el CSV
//
// SEGURIDAD
//   slates y players: solo Premium. El frontend manda el token de
//   Supabase en el header  Authorization: Bearer <access_token>.
//   Se verifica con auth.getUser(token) y luego users.is_premium.
//   El dueño (FANTASY_OWNER_EMAIL) siempre entra.
//   build-cards: solo con ?secret= (CRON_SECRET).
//
// REGLAS INTERNAS
//   Aqui NO se aplican las reglas de nuestras alineaciones
//   ($3,500, estrella, palizas, etc.). Se muestran TODOS los
//   jugadores del slate. Solo se marca su status (OUT, Q...).
//
// FICHAS
//   Se guardan ya calculadas en fantasy_app_player_cards. Si la
//   corrida de proyecciones es mas nueva que las fichas, se
//   recalculan solas la primera vez que alguien abre el slate.
//
// ETIQUETAS (puntos fantasy del site, temporada actual)
//   hot      ultimos 3 >= 20% arriba de su promedio de temporada
//   up       ultimos 5 >= 5% arriba de la temporada (si no es hot)
//   down     ultimos 5 >= 5% abajo de la temporada
//   steady   poca variacion  (NBA: desv/prom <= 0.25 | NFL: <= 0.35)
//   warn     mucha variacion (NBA: desv/prom >= 0.45 | NFL: >= 0.60)
//   bench    jugo menos del 60% de los partidos de su equipo
//   new      rol nuevo: minutos (NBA) o snaps (NFL) de los ultimos 3
//            muy por encima de su temporada
//            (NBA: +25% y +5 min | NFL: +15 puntos de snap%)
//   Se necesitan al menos 3 partidos jugados para etiquetar.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OWNER_EMAIL = String(process.env.FANTASY_OWNER_EMAIL || "").trim().toLowerCase();
// Activar para todos los Premium: variable FANTASY_PUBLIC = 1 en Vercel.
const FANTASY_PUBLIC = String(process.env.FANTASY_PUBLIC || "").trim() === "1";
const CARDS = "fantasy_app_player_cards";
const LAST_GAMES = 10;

// BallDontLie team ids -> siglas
const NBA_TEAMS = {
  1: "ATL", 2: "BOS", 3: "BKN", 4: "CHA", 5: "CHI", 6: "CLE", 7: "DAL", 8: "DEN", 9: "DET", 10: "GSW",
  11: "HOU", 12: "IND", 13: "LAC", 14: "LAL", 15: "MEM", 16: "MIA", 17: "MIL", 18: "MIN", 19: "NOP", 20: "NYK",
  21: "OKC", 22: "ORL", 23: "PHI", 24: "PHX", 25: "POR", 26: "SAC", 27: "SAS", 28: "TOR", 29: "UTA", 30: "WAS"
};
const NFL_ALIASES = { LAR: "LA", STL: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", LVR: "LV", SD: "LAC" };

const TAGS = {
  nba: { steadyCv: 0.25, warnCv: 0.45 },
  nfl: { steadyCv: 0.35, warnCv: 0.60 }
};


// ============================================================
// UTILIDADES
// ============================================================

const str = v => (v === null || v === undefined ? "" : String(v));
const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
// BallDontLie a veces guarda el texto "None" o "Active": eso es sin novedad
const cleanStatus = v => { const t = str(v).trim(); return !t || /^(none|null|active|available)$/i.test(t) ? null : t; };
const nflTeam = raw => { const v = str(raw).toUpperCase(); return NFL_ALIASES[v] || v; };
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = a => { const m = avg(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null; };

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dayIn(tz, v = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v));
}
const chicagoDay = v => dayIn("America/Chicago", v);
const addDaysStr = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nbaDay = v => dayIn("America/New_York", v);

// Temporada NBA (BallDontLie usa el año en que empieza: 2026-27 = 2026)
function nbaSeason(day) {
  const [y, m] = day.split("-").map(Number);
  return m >= 10 ? y : y - 1;
}
// Temporada NFL (empieza en septiembre)
function nflSeason(day) {
  const [y, m] = day.split("-").map(Number);
  return m >= 8 ? y : y - 1;
}

async function selectAll(table, columns, build = q => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(supabaseAdmin.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

// selectAll con un filtro .in() largo, partido en pedazos
async function selectIn(table, columns, col, values, build = q => q) {
  const out = [];
  for (const part of chunks([...new Set(values)], 150)) {
    out.push(...await selectAll(table, columns, q => build(q.in(col, part))));
  }
  return out;
}

async function upsertAll(table, rows, onConflict) {
  for (const part of chunks(rows, 500)) {
    const { error } = await supabaseAdmin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}

// La app (iOS / Android) llama desde otro origen: se permite con el
// token del usuario en Authorization.
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function send(res, status, body) {
  cors(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
}


// ============================================================
// SEGURIDAD: SOLO PREMIUM
// ============================================================

async function requirePremium(req) {
  const header = str(req.headers.authorization || req.headers.Authorization);
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "LOGIN_REQUIRED" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const authUser = data?.user;
  if (error || !authUser) return { ok: false, status: 401, error: "LOGIN_REQUIRED" };

  const email = str(authUser.email).toLowerCase();
  const isOwner = !!OWNER_EMAIL && email === OWNER_EMAIL;

  const { data: row, error: uErr } = await supabaseAdmin
    .from("users").select("id,is_premium").eq("id", authUser.id).maybeSingle();
  if (uErr) throw new Error(`Supabase users: ${uErr.message}`);

  if (!isOwner && row?.is_premium !== true) return { ok: false, status: 403, error: "PREMIUM_ONLY" };
  // MODO ESCONDIDO: mientras FANTASY_PUBLIC no sea "1", solo entra el dueno.
  if (!isOwner && !FANTASY_PUBLIC) return { ok: false, status: 403, error: "NOT_AVAILABLE_YET" };
  return { ok: true, userId: authUser.id, email, isOwner };
}

function checkSecret(req) {
  const secret = process.env.CRON_SECRET || process.env.GENERATE_DAILY_SECRET || "";
  const given = str(req.query.secret) || str(req.headers.authorization).replace(/^Bearer\s+/i, "");
  return !!secret && given === secret;
}


// ============================================================
// PUNTUACION (igual que las formulas oficiales)
// ============================================================

function nbaScore(s, platform) {
  if (platform === "fanduel") return s.pts + 1.2 * s.reb + 1.5 * s.ast + 3 * s.stl + 3 * s.blk - s.tov;
  const tens = [s.pts, s.reb, s.ast, s.stl, s.blk].filter(v => v >= 10).length;
  return s.pts + 0.5 * s.fg3m + 1.25 * s.reb + 1.5 * s.ast + 2 * s.stl + 2 * s.blk -
    0.5 * s.tov + (tens >= 2 ? 1.5 : 0) + (tens >= 3 ? 3 : 0);
}

let nflModel = null;
function model() {
  if (!nflModel) nflModel = require("./_lib/fantasy-nfl-model.js");
  return nflModel;
}

function nflOffenseScore(r, platform) {
  return model().offensePoints({
    passYds: num(r.passing_yards) || 0, passTd: num(r.passing_tds) || 0, int: num(r.interceptions) || 0,
    rushYds: num(r.rushing_yards) || 0, rushTd: num(r.rushing_tds) || 0,
    rec: num(r.receptions) || 0, recYds: num(r.receiving_yards) || 0, recTd: num(r.receiving_tds) || 0,
    fumbles: num(r.fumbles_lost) || 0, twoPt: num(r.two_point_conversions) || 0
  }, platform) + 6 * ((num(r.return_tds) || 0) + (num(r.fumble_recovery_tds) || 0));
}

function nflDstScore(t, opp) {
  return model().dstPoints({
    sacks: num(t.def_sacks) || 0, int: num(t.def_interceptions) || 0, fr: num(t.def_fumble_recoveries) || 0,
    defTd: num(t.def_tds) || 0, retTd: num(t.return_tds) || 0, safety: num(t.def_safeties) || 0,
    blocks: (num(t.blocked_punts) || 0) + (num(t.blocked_fgs) || 0) + (num(t.blocked_pats) || 0),
    pa: Math.max(0, (num(t.points_against) || 0) - 7 * (num(opp?.def_tds) || 0))
  });
}


// ============================================================
// ETIQUETAS
// ============================================================

// games: de mas nuevo a mas viejo, solo temporada actual, solo los que jugo
// usage: minutos (NBA) o snap% (NFL) de esos mismos partidos
function computeTags(sport, fpts, usage, seasonGames, teamGames) {
  const tags = [];
  if (fpts.length < 3) return tags;
  const season = avg(fpts), l3 = avg(fpts.slice(0, 3)), l5 = avg(fpts.slice(0, 5));
  const cfg = TAGS[sport];

  if (season > 0) {
    if (l3 >= season * 1.2) tags.push("hot");
    else if (l5 >= season * 1.05) tags.push("up");
    else if (l5 <= season * 0.95) tags.push("down");
  }

  const u = usage.filter(x => x !== null);
  if (u.length >= 4) {
    const uSeason = avg(u), u3 = avg(u.slice(0, 3));
    const isNew = sport === "nba"
      ? u3 >= uSeason * 1.25 && u3 - uSeason >= 5
      : u3 - uSeason >= 15;
    if (isNew) tags.push("new");
  }

  if (teamGames > 0 && seasonGames / teamGames < 0.6) tags.push("bench");

  const dev = sd(fpts);
  if (season > 0 && dev !== null) {
    const cv = dev / season;
    if (cv <= cfg.steadyCv) tags.push("steady");
    else if (cv >= cfg.warnCv) tags.push("warn");
  }
  return tags;
}


// ============================================================
// SLATES
// ============================================================

async function listSlates(sport, platform, day, lastDay = day) {
  const table = sport === "nfl" ? "fantasy_nfl_slates" : "fantasy_nba_slates";
  const rows = await selectAll(table, "*", q => q.gte("slate_date", day).lte("slate_date", lastDay).eq("platform", platform).order("starts_at", { ascending: true }));
  const now = Date.now();
  return rows.map(s => ({
    slate_id: Number(s.slate_id),
    platform: s.platform,
    slate_date: s.slate_date,
    style: s.style,
    game_type: /showdown|captain|single/i.test(str(s.style)) ? "captain" : "classic",
    salary_cap: num(s.salary_cap),
    starts_at: s.starts_at,
    games: num(s.event_count),
    is_main: s.is_main ?? null,
    roster_slots: s.roster_slots || null,
    started: Date.parse(s.starts_at) <= now
  }));
}

async function getSlate(sport, slateId) {
  const table = sport === "nfl" ? "fantasy_nfl_slates" : "fantasy_nba_slates";
  const { data, error } = await supabaseAdmin.from(table).select("*").eq("slate_id", slateId).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return data;
}


// ============================================================
// FICHAS NBA
// ============================================================

async function nbaSourceVersion(slateId) {
  const { data, error } = await supabaseAdmin
    .from("fantasy_nba_projections").select("created_at")
    .eq("slate_id", slateId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_nba_projections: ${error.message}`);
  return data ? `nba:${data.created_at}` : "nba:none";
}

async function buildNbaCards(slate, version, opts = {}) {
  const slateId = Number(slate.slate_id);
  const platform = slate.platform;
  const day = slate.slate_date;
  const cur = nbaSeason(day), prev = cur - 1;

  // 5-nov: opts.players / opts.projections = slate de DraftKings directo
  const [players, projections] = opts.players ? [opts.players, opts.projections || []] : await Promise.all([
    selectAll("fantasy_nba_slate_players", "*", q => q.eq("slate_id", slateId)),
    selectAll("fantasy_nba_projections", "player_id,opp_team_id,minutes,proj_mean,proj_p90", q => q.eq("slate_id", slateId))
  ]);
  if (!players.length) return [];
  const projById = new Map(projections.map(p => [Number(p.player_id), p]));
  const ids = players.map(p => Number(p.player_id)).filter(Boolean);
  const photos = await dkPhotos("nba", ids.map(String));

  const [logs, games] = await Promise.all([
    selectIn("nba_player_game_roles",
      "game_id,season,game_date,team_id,player_id,minutes,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made,fg3a,starter",
      "player_id", ids, q => q.in("season", [cur, prev])),
    selectAll("nba_games", "game_id,season,game_date,home_team_id,visitor_team_id,home_score,visitor_score,stats_complete",
      q => q.in("season", [cur, prev]).or("postseason.is.null,postseason.eq.false"))
  ]);

  const gameById = new Map(games.map(g => [Number(g.game_id), g]));
  // Partidos jugados (terminados) por equipo en la temporada actual, antes de hoy
  const teamGames = new Map();
  for (const g of games) {
    if (Number(g.season) !== cur || g.home_score === null || nbaDay(g.game_date) >= day) continue;
    for (const t of [Number(g.home_team_id), Number(g.visitor_team_id)]) teamGames.set(t, (teamGames.get(t) || 0) + 1);
  }

  const logsById = new Map();
  for (const r of logs) {
    const g = gameById.get(Number(r.game_id));
    if (!g || nbaDay(g.game_date) >= day) continue;
    const id = Number(r.player_id);
    if (!logsById.has(id)) logsById.set(id, []);
    logsById.get(id).push({ r, g });
  }

  const now = new Date().toISOString();
  const seen = new Set();
  const cards = [];
  for (const sp of players) {
    const id = Number(sp.player_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pj = projById.get(id);
    const teamId = Number(sp.team_id);

    const all = (logsById.get(id) || [])
      .filter(x => (num(x.r.minutes) || 0) > 0)
      .sort((a, b) => String(b.g.game_date).localeCompare(String(a.g.game_date)));

    const rowsOut = all.map(({ r, g }) => {
      const s = {
        pts: num(r.points) || 0, reb: num(r.rebounds) || 0, ast: num(r.assists) || 0,
        stl: num(r.steals) || 0, blk: num(r.blocks) || 0, tov: num(r.turnovers) || 0,
        fg3m: num(r.three_pointers_made) || 0, fg3a: num(r.fg3a) || 0
      };
      const home = Number(g.home_team_id) === Number(r.team_id);
      const oppId = home ? Number(g.visitor_team_id) : Number(g.home_team_id);
      return {
        season: Number(r.season),
        date: nbaDay(g.game_date),
        opp: `${home ? "vs" : "@"} ${NBA_TEAMS[oppId] || oppId}`,
        min: round(num(r.minutes), 0),
        fpts: round(nbaScore(s, platform), 1),
        pts: s.pts, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk, tov: s.tov,
        fg3m: s.fg3m, fg3a: s.fg3a,
        starter: r.starter === true
      };
    });

    const curRows = rowsOut.filter(x => x.season === cur);
    const fpts = curRows.map(x => x.fpts);
    const mins = curRows.map(x => x.min);
    const sAvg = k => round(avg(curRows.map(x => x[k])), 1);
    const tGames = teamGames.get(teamId) || 0;

    const proj = num(pj?.proj_mean);
    const salary = num(sp.salary);
    cards.push({
      sport: "nba", platform, slate_id: slateId, slate_date: day,
      player_key: String(id),
      player_name: sp.player_name,
      team: sp.team_abbr || NBA_TEAMS[teamId] || null,
      opp: pj?.opp_team_id ? (NBA_TEAMS[Number(pj.opp_team_id)] || null) : (sp.opp_abbr || null),
      positions: Array.isArray(sp.positions) ? sp.positions : [],
      salary,
      status: cleanStatus(sp.status),
      proj: round(proj, 2),
      proj_minutes: round(num(pj?.minutes), 1),
      pts_per_1k: proj !== null && salary ? round(proj / (salary / 1000), 2) : null,
      last3: round(avg(fpts.slice(0, 3)), 1),
      last5: round(avg(fpts.slice(0, 5)), 1),
      season_avg: round(avg(fpts), 1),
      season_games: curRows.length,
      team_games: tGames,
      tags: computeTags("nba", fpts, mins, curRows.length, tGames),
      season: curRows.length ? {
        min: sAvg("min"), fpts: sAvg("fpts"), pts: sAvg("pts"), reb: sAvg("reb"), ast: sAvg("ast"),
        stl: sAvg("stl"), blk: sAvg("blk"), tov: sAvg("tov"), fg3m: sAvg("fg3m"), fg3a: sAvg("fg3a")
      } : null,
      // ultimos 10: temporada actual primero; si faltan, se completan con la anterior
      games: rowsOut.slice(0, LAST_GAMES),
      photo_url: photos.get(String(id)) || null,
      source_version: version,
      updated_at: now
    });
  }
  return cards;
}


// ============================================================
// FICHAS NFL
// ============================================================

async function nflLatestRun(day) {
  const { data, error } = await supabaseAdmin
    .from("fantasy_nfl_runs").select("run_id,run_at,run_date,summary")
    .lte("run_date", day).order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_nfl_runs: ${error.message}`);
  return data;
}

async function nflSourceVersion(day) {
  const run = await nflLatestRun(day);
  return run ? `nfl:${run.run_id}` : "nfl:none";
}

async function buildNflCards(slate, version, opts = {}) {
  const slateId = Number(slate.slate_id);
  const platform = slate.platform;
  const day = slate.slate_date;
  const cur = nflSeason(day), prev = cur - 1;
  const pkey = platform === "fanduel" ? "fd" : "dk";
  const runId = opts.players ? (opts.runId ?? null)
    : version.startsWith("nfl:") && version !== "nfl:none" ? Number(version.slice(4)) : null;

  // 5-nov: opts.players = slate de DraftKings directo
  const players = opts.players || await selectAll("fantasy_nfl_slate_players", "*", q => q.eq("slate_id", slateId));
  if (!players.length) return [];

  const keyOf = sp => (sp.entity_type === "team" ? `DST:${nflTeam(sp.team)}` : str(sp.gsis_player_id) || `SLATE:${sp.entity_key}`);
  const gsisList = players.filter(sp => sp.entity_type !== "team" && sp.gsis_player_id).map(sp => String(sp.gsis_player_id));
  const teams = [...new Set(players.map(sp => nflTeam(sp.team)))];

  const [projections, weekStats, snaps, teamStats, roster] = await Promise.all([
    runId ? selectAll("fantasy_nfl_projections", "entity_key,opponent,position,snap_pct,stats,dk_points,dk_p90,fd_points,fd_p90", q => q.eq("run_id", runId)) : [],
    gsisList.length ? selectIn("football_player_week_stats", "*", "gsis_player_id", gsisList, q => q.in("season", [cur, prev])) : [],
    gsisList.length ? selectIn("football_player_game_stats", "gsis_player_id,game_date,offense_pct", "gsis_player_id", gsisList, q => q.eq("sport", "nfl").in("season", [cur, prev])) : [],
    selectAll("football_team_week_stats", "*", q => q.in("season", [cur, prev])),
    gsisList.length ? selectIn("football_players", "gsis_player_id,espn_athlete_id", "gsis_player_id", gsisList) : []
  ]);

  const projByKey = new Map(projections.map(p => [str(p.entity_key), p]));
  const photos = await dkPhotos("nfl", players.map(keyOf));
  const espnByGsis = new Map(roster.map(r => [str(r.gsis_player_id), str(r.espn_athlete_id)]));
  const snapByKey = new Map(snaps.map(s => [`${s.gsis_player_id}|${String(s.game_date).slice(0, 10)}`, num(s.offense_pct)]));
  const statsByGsis = new Map();
  for (const r of weekStats) {
    if (String(r.game_date).slice(0, 10) >= day) continue;
    const k = str(r.gsis_player_id);
    if (!statsByGsis.has(k)) statsByGsis.set(k, []);
    statsByGsis.get(k).push(r);
  }
  const teamRows = teamStats.filter(t => String(t.game_date).slice(0, 10) < day);
  const teamByKey = new Map(teamRows.map(t => [`${nflTeam(t.team)}|${t.game_id}`, t]));
  const teamGames = new Map();
  for (const t of teamRows) {
    if (Number(t.season) !== cur) continue;
    const k = nflTeam(t.team);
    teamGames.set(k, (teamGames.get(k) || 0) + 1);
  }

  // snap% guardado como 0-1 o 0-100: se muestra siempre 0-100
  const pct = v => (v === null ? null : v <= 1.0001 ? round(v * 100, 0) : round(v, 0));

  const now = new Date().toISOString();
  const seen = new Set();
  const cards = [];
  for (const sp of players) {
    const key = keyOf(sp);
    if (seen.has(key)) continue;
    seen.add(key);
    const team = nflTeam(sp.team);
    const isDst = sp.entity_type === "team";
    const pj = projByKey.get(key);
    let rowsOut = [];

    if (isDst) {
      rowsOut = teamRows
        .filter(t => nflTeam(t.team) === team)
        .sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)))
        .map(t => {
          const opp = teamByKey.get(`${nflTeam(t.opponent)}|${t.game_id}`);
          return {
            season: Number(t.season), week: num(t.week), date: String(t.game_date).slice(0, 10),
            opp: nflTeam(t.opponent) || null,
            fpts: round(nflDstScore(t, opp), 1),
            pts_allowed: num(t.points_against), sacks: num(t.def_sacks) || 0,
            int: num(t.def_interceptions) || 0, fum_rec: num(t.def_fumble_recoveries) || 0,
            def_td: (num(t.def_tds) || 0) + (num(t.return_tds) || 0)
          };
        });
    } else {
      rowsOut = (statsByGsis.get(str(sp.gsis_player_id)) || [])
        .sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)))
        .map(r => ({
          season: Number(r.season), week: num(r.week), date: String(r.game_date).slice(0, 10),
          opp: nflTeam(r.opponent) || null,
          snap: pct(snapByKey.get(`${sp.gsis_player_id}|${String(r.game_date).slice(0, 10)}`) ?? null),
          fpts: round(nflOffenseScore(r, platform), 1),
          pass_yds: num(r.passing_yards) || 0, pass_td: num(r.passing_tds) || 0, int: num(r.interceptions) || 0,
          rush_att: num(r.rushing_attempts) || 0, rush_yds: num(r.rushing_yards) || 0, rush_td: num(r.rushing_tds) || 0,
          targets: num(r.targets) || 0, rec: num(r.receptions) || 0, rec_yds: num(r.receiving_yards) || 0, rec_td: num(r.receiving_tds) || 0
        }));
    }

    const curRows = rowsOut.filter(x => x.season === cur);
    const fpts = curRows.map(x => x.fpts);
    const usage = isDst ? [] : curRows.map(x => x.snap);
    const sAvg = k => round(avg(curRows.map(x => x[k]).filter(v => v !== null && v !== undefined)), 1);
    const tGames = teamGames.get(team) || 0;
    // 4-nov: DraftKings muestra la misma proyeccion que usan las
    // alineaciones (70% mercado + 30% formula) cuando la hay.
    const proj = pkey === "dk" && num(pj?.stats?.mercado70_dk) !== null ? num(pj.stats.mercado70_dk) : num(pj?.[`${pkey}_points`]);
    const salary = num(sp.salary);
    const espnId = isDst ? "" : espnByGsis.get(str(sp.gsis_player_id));

    cards.push({
      sport: "nfl", platform, slate_id: slateId, slate_date: day,
      player_key: key,
      player_name: isDst ? (sp.player_name || `${team} DST`) : sp.player_name,
      team,
      opp: pj?.opponent ? nflTeam(pj.opponent) : (sp.opp_abbr || null),
      positions: [isDst ? "DST" : str(sp.position || pj?.position).toUpperCase()].filter(Boolean),
      salary,
      status: cleanStatus(sp.status),
      proj: round(proj, 2),
      proj_minutes: isDst ? null : pct(num(pj?.snap_pct)),
      pts_per_1k: proj !== null && salary ? round(proj / (salary / 1000), 2) : null,
      last3: round(avg(fpts.slice(0, 3)), 1),
      last5: round(avg(fpts.slice(0, 5)), 1),
      season_avg: round(avg(fpts), 1),
      season_games: curRows.length,
      team_games: tGames,
      tags: computeTags("nfl", fpts, usage, curRows.length, tGames),
      season: curRows.length ? (isDst
        ? { fpts: sAvg("fpts"), pts_allowed: sAvg("pts_allowed"), sacks: sAvg("sacks"), int: sAvg("int"), fum_rec: sAvg("fum_rec"), def_td: sAvg("def_td") }
        : { snap: sAvg("snap"), fpts: sAvg("fpts"), pass_yds: sAvg("pass_yds"), pass_td: sAvg("pass_td"), int: sAvg("int"),
            rush_att: sAvg("rush_att"), rush_yds: sAvg("rush_yds"), rush_td: sAvg("rush_td"),
            targets: sAvg("targets"), rec: sAvg("rec"), rec_yds: sAvg("rec_yds"), rec_td: sAvg("rec_td") }) : null,
      games: rowsOut.slice(0, LAST_GAMES),
      photo_url: isDst
        ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png`
        : espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : (photos.get(key) || null),
      source_version: version,
      updated_at: now
    });
  }
  return cards;
}


// ============================================================
// FICHAS: LEER (Y RECALCULAR SI ESTAN VIEJAS)
// ============================================================

async function sourceVersion(sport, slate) {
  return sport === "nfl" ? nflSourceVersion(slate.slate_date) : nbaSourceVersion(Number(slate.slate_id));
}

async function refreshCards(sport, slate, force = false) {
  const slateId = Number(slate.slate_id);
  const version = await sourceVersion(sport, slate);
  if (!force) {
    const { data, error } = await supabaseAdmin
      .from(CARDS).select("source_version").eq("sport", sport).eq("slate_id", slateId).limit(1).maybeSingle();
    if (error) throw new Error(`Supabase ${CARDS}: ${error.message}`);
    if (data && data.source_version === version) return { rebuilt: false, version };
  }
  const cards = sport === "nfl" ? await buildNflCards(slate, version) : await buildNbaCards(slate, version);
  if (cards.length) {
    await upsertAll(CARDS, cards, "sport,slate_id,player_key");
    // Quitar jugadores que ya no estan en el slate
    const { error } = await supabaseAdmin.from(CARDS).delete()
      .eq("sport", sport).eq("slate_id", slateId).neq("source_version", version);
    if (error) throw new Error(`Supabase ${CARDS}: ${error.message}`);
  }
  return { rebuilt: true, version, players: cards.length };
}

// 5-nov: fotos de DraftKings por jugador (columna image_url, SQL paso 4).
// Si la columna no existe todavia: sin fotos, sin error.
async function dkPhotos(sport, keys) {
  const out = new Map();
  if (!keys.length) return out;
  try {
    const rows = await selectIn("fantasy_app_dk_players", "player_key,image_url,checked_at", "player_key", keys,
      q => q.eq("sport", sport).not("image_url", "is", null));
    rows.sort((a, b) => String(a.checked_at).localeCompare(String(b.checked_at)));
    for (const r of rows) out.set(str(r.player_key), r.image_url);
  } catch { /* sin columna image_url */ }
  return out;
}

const NBA_TEAM_ID = Object.fromEntries(Object.entries(NBA_TEAMS).map(([id, abbr]) => [abbr, Number(id)]));
const hashStr = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// "TOR@DEN" -> rival del equipo
function dkOpp(game, team) {
  const [a, b] = str(game).split("@");
  const fix = t => DK_NBA_TEAMS[t] || t;
  if (!a || !b) return null;
  return fix(a) === team || a === team ? fix(b) : fix(b) === team || b === team ? fix(a) : null;
}

async function getDkSlate(dg) {
  const { data, error } = await supabaseAdmin.from("fantasy_app_dk_slates").select("*").eq("draft_group_id", dg).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_app_dk_slates: ${error.message}`);
  return data;
}

// Fichas de un slate de DraftKings (todos los slates, tambien los de otros
// dias y los mixtos). Proyeccion: la de la formula para ese jugador y dia.
async function refreshDkCards(sport, s) {
  const dg = Number(s.draft_group_id);
  const day = s.slate_date;
  const dkPlayers = (await selectAll("fantasy_app_dk_players", "*", q => q.eq("draft_group_id", dg)))
    .filter(p => p.player_key && !p.slot);
  let projVersion = "none", projections = [], runId = null;
  if (sport === "nba") {
    const ids = dkPlayers.map(p => Number(p.player_key)).filter(Boolean);
    const rows = ids.length ? await selectIn("fantasy_nba_projections", "player_id,opp_team_id,minutes,proj_mean,proj_p90,created_at", "player_id", ids,
      q => q.eq("slate_date", day).eq("platform", "draftkings")) : [];
    const latest = new Map();
    for (const r of rows) {
      const k = Number(r.player_id);
      if (!latest.has(k) || String(r.created_at) > String(latest.get(k).created_at)) latest.set(k, r);
    }
    projections = [...latest.values()];
    projVersion = projections.reduce((m, r) => (String(r.created_at) > m ? String(r.created_at) : m), "none");
  } else {
    const run = await nflLatestRun(day);
    runId = run?.run_id ?? null;
    projVersion = String(runId ?? "none");
  }
  const sig = hashStr(dkPlayers.map(p => `${p.dk_id}:${p.status || ""}:${p.salary}:${p.image_url ? 1 : 0}`).sort().join("|"));
  const version = `dk:${projVersion}:${sig}`;
  const { data: have } = await supabaseAdmin.from(CARDS).select("source_version").eq("sport", sport).eq("slate_id", dg).limit(1).maybeSingle();
  if (have && have.source_version === version) return { rebuilt: false };

  const slate = { slate_id: dg, platform: "draftkings", slate_date: day };
  const cards = sport === "nba"
    ? await buildNbaCards(slate, version, {
      players: dkPlayers.map(p => ({
        player_id: Number(p.player_key), team_id: NBA_TEAM_ID[p.team] || null, team_abbr: p.team,
        player_name: p.player_name, positions: p.positions, salary: p.salary, status: p.status, opp_abbr: dkOpp(p.game, p.team)
      })),
      projections
    })
    : await buildNflCards(slate, version, {
      runId,
      players: dkPlayers.map(p => {
        const dst = str(p.player_key).startsWith("DST:");
        return {
          entity_type: dst ? "team" : "player", gsis_player_id: dst ? null : p.player_key, entity_key: p.player_key,
          team: p.team, player_name: p.player_name, position: (p.positions || [])[0], salary: p.salary, status: p.status,
          opp_abbr: dkOpp(p.game, p.team)
        };
      })
    });
  if (cards.length) {
    await upsertAll(CARDS, cards, "sport,slate_id,player_key");
    const { error } = await supabaseAdmin.from(CARDS).delete().eq("sport", sport).eq("slate_id", dg).neq("source_version", version);
    if (error) throw new Error(`Supabase ${CARDS}: ${error.message}`);
  }
  return { rebuilt: true, players: cards.length };
}

// Slates de la pagina: DraftKings directo de su lobby (todos los
// disponibles, de hoy en adelante); FanDuel de nuestras listas.
async function listPageSlates(sport, platform, day) {
  const lastDay = addDaysStr(day, DK_DAYS_AHEAD[sport] || 0);
  const now = Date.now();
  if (platform === "draftkings") {
    const [rows, pools] = await Promise.all([
      selectAll("fantasy_app_dk_slates", "*", q => q.eq("sport", sport).eq("game_type", "classic").gte("slate_date", day).lte("slate_date", lastDay)),
      selectAll("fantasy_app_slate_pools", "slate_key,slate_date", q => q.eq("sport", sport).eq("platform", "draftkings").gte("slate_date", day))
    ]);
    const withFormula = new Set(pools.map(p => Number(p.slate_key)));
    // Main = el de mas partidos de su dia
    const mainOf = new Map();
    for (const r of rows) {
      const m = mainOf.get(r.slate_date);
      if (!m || num(r.games) > num(m.games)) mainOf.set(r.slate_date, r);
    }
    return rows
      .filter(r => Date.parse(r.starts_at) > now || r.slate_date === day)
      .map(r => ({
        slate_id: Number(r.draft_group_id), src: "dk", platform, slate_date: r.slate_date, game_type: "classic",
        starts_at: r.starts_at, last_starts_at: r.last_starts_at, games: num(r.games), game_list: r.game_list || [],
        is_main: mainOf.get(r.slate_date)?.draft_group_id === r.draft_group_id,
        has_formula: withFormula.has(Number(r.draft_group_id)), started: Date.parse(r.starts_at) <= now
      }))
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || b.games - a.games);
  }
  const rows = await listSlates(sport, platform, day, lastDay);
  const pools = await selectAll("fantasy_app_slate_pools", "slate_key", q => q.eq("sport", sport).eq("platform", platform).gte("slate_date", day));
  const withFormula = new Set(pools.map(p => Number(p.slate_key)));
  return rows.filter(r => !r.started || r.slate_date === day).map(r => ({ ...r, src: "bdl", has_formula: withFormula.has(Number(r.slate_id)) }));
}

async function readCards(sport, slateId) {
  const rows = await selectAll(CARDS, "*", q => q.eq("sport", sport).eq("slate_id", slateId));
  return rows
    .map(({ sport: _s, slate_id: _id, source_version: _v, updated_at: _u, ...card }) => card)
    .sort((a, b) => (num(b.proj) ?? -1) - (num(a.proj) ?? -1) || (num(b.salary) || 0) - (num(a.salary) || 0));
}


// ============================================================
// ACCIONES
// ============================================================

function parseSport(v) {
  const s = str(v).toLowerCase();
  return s === "nba" || s === "nfl" ? s : null;
}
function parseSite(v) {
  const s = str(v).toLowerCase();
  if (s === "draftkings" || s === "dk") return "draftkings";
  if (s === "fanduel" || s === "fd") return "fanduel";
  return null;
}

async function actionSlates(req) {
  const sport = parseSport(req.query.sport);
  const site = parseSite(req.query.site);
  if (!sport || !site) return { status: 400, body: { ok: false, error: "BAD_PARAMS", need: "sport=nba|nfl & site=draftkings|fanduel" } };
  const day = chicagoDay();
  return { status: 200, body: { ok: true, sport, site, date: day, slates: await listPageSlates(sport, site, day) } };
}

async function actionPlayers(req) {
  const sport = parseSport(req.query.sport);
  const slateId = num(req.query.slate_id);
  if (!sport || !slateId) return { status: 400, body: { ok: false, error: "BAD_PARAMS", need: "sport=nba|nfl & slate_id" } };
  // 5-nov: &src=dk -> slate de DraftKings directo (slate_id = draft group)
  if (str(req.query.src) === "dk") {
    const dk = await getDkSlate(slateId);
    if (!dk) return { status: 404, body: { ok: false, error: "SLATE_NOT_FOUND" } };
    await refreshDkCards(sport, dk);
    const all = await readCards(sport, slateId);
    const players = all.filter(p => !/^(out|o|inactive|ir|suspended)$/i.test(str(p.status)));
    return {
      status: 200,
      body: { ok: true, sport, slate_id: slateId, src: "dk", platform: "draftkings", salary_cap: 50000, starts_at: dk.starts_at,
        count: players.length, out_hidden: all.length - players.length, projected: players.filter(p => num(p.proj) > 0).length, players }
    };
  }
  const slate = await getSlate(sport, slateId);
  if (!slate) return { status: 404, body: { ok: false, error: "SLATE_NOT_FOUND" } };
  await refreshCards(sport, slate);
  // OUT no se muestran (no juegan). Q / GTD si, con su status.
  const all = await readCards(sport, slateId);
  const players = all.filter(p => !/^(out|o|inactive|ir|suspended)$/i.test(str(p.status)));
  return {
    status: 200,
    body: {
      ok: true, sport, slate_id: slateId, platform: slate.platform, salary_cap: num(slate.salary_cap),
      starts_at: slate.starts_at, roster_slots: slate.roster_slots || null,
      count: players.length, out_hidden: all.length - players.length, players
    }
  };
}

async function actionBuildCards(req) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(req.query.date)) ? str(req.query.date) : chicagoDay();
  const only = parseSport(req.query.sport);
  const force = str(req.query.force) === "1";
  const out = [];
  for (const sport of only ? [only] : ["nba", "nfl"]) {
    for (const site of ["draftkings", "fanduel"]) {
      const slates = await selectAll(sport === "nfl" ? "fantasy_nfl_slates" : "fantasy_nba_slates", "*",
        q => q.eq("slate_date", day).eq("platform", site));
      for (const slate of slates) {
        try {
          out.push({ sport, site, slate_id: Number(slate.slate_id), ...await refreshCards(sport, slate, force) });
        } catch (e) {
          out.push({ sport, site, slate_id: Number(slate.slate_id), error: e.message });
        }
      }
    }
  }
  return { status: 200, body: { ok: true, date: day, slates: out } };
}


// ============================================================
// DRAFTKINGS: SLATES E IDS OFICIALES (sync-dk)
// ============================================================
//
// Lee la lista publica de concursos de DraftKings y, de cada slate
// Classic y Showdown Captain, baja su archivo oficial de salarios
// (el mismo DKSalaries.csv). De ahi salen los IDs exactos que pide
// el CSV de subida: Classic = un ID por jugador; Captain = un ID
// para CPT y otro para UTIL.
// FanDuel NO se lee aqui (se sube a mano).

const DK_LOBBY = "https://www.draftkings.com/lobby/getcontests?sport=";
const DK_CSV = "https://www.draftkings.com/lineup/getavailableplayerscsv";
const DK_GAME_TYPES = { "classic": "classic", "showdown captain mode": "captain" };
const DK_NBA_TEAMS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", PHO: "PHX", UTAH: "UTA", WSH: "WAS", BRK: "BKN", CHO: "CHA" };
const DK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/csv, */*"
};

async function dkFetch(url, asText = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { headers: DK_HEADERS, signal: controller.signal });
    if (!r.ok) throw new Error(`DraftKings ${r.status} ${url}`);
    return asText ? await r.text() : await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// CSV simple con comillas
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== "")) rows.push(row);
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// "TOR@DEN 11/04/2026 09:00PM ET" -> fecha UTC (ET = America/New_York)
function dkGameTime(info) {
  const m = str(info).match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2})(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (/pm/i.test(m[6])) h += 12;
  const guess = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
  // diferencia de New York con UTC ese dia (4 o 5 horas)
  const ny = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess + (utc - ny));
}

function normName(v) {
  return str(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Indice nombre+equipo -> nuestra llave (NBA: player_id BDL | NFL: gsis / DST:TEAM)
async function dkMatchIndex(sport, day) {
  const from = new Date(Date.parse(`${day}T12:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
  const byNameTeam = new Map(), byName = new Map(), byLastTeam = new Map();
  const add = (name, team, key) => {
    const n = normName(name);
    if (!n || !key) return;
    byNameTeam.set(`${n}|${team}`, key);
    // apellido + equipo (para apodos: "Nic" Claxton, "GG" Jackson, "Bub" Carrington)
    const last = n.split(" ").pop();
    const lk = `${last}|${team}`;
    if (!byLastTeam.has(lk)) byLastTeam.set(lk, new Set());
    byLastTeam.get(lk).add(key);
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(key);
  };
  if (sport === "nba") {
    const rows = await selectAll("fantasy_nba_slate_players", "player_id,player_name,team_abbr,slate_date",
      q => q.gte("slate_date", from).lte("slate_date", day));
    for (const r of rows) add(r.player_name, str(r.team_abbr).toUpperCase(), String(r.player_id));
    // Respaldo: jugadores que BallDontLie no puso en su lista de salarios,
    // pero que si tienen partidos esta temporada (mismo id de jugador).
    const seen = new Set(rows.map(r => String(r.player_id)));
    const logs = await selectAll("nba_player_game_roles", "player_id,player_name,team_id,game_date",
      q => q.eq("season", nbaSeason(day)).order("game_date", { ascending: false }));
    for (const r of logs) {
      const id = String(r.player_id);
      if (seen.has(id)) continue;
      seen.add(id);                     // el mas reciente = su equipo actual
      add(r.player_name, NBA_TEAMS[Number(r.team_id)] || "", id);
    }
  } else {
    const rows = await selectAll("fantasy_nfl_slate_players", "entity_type,gsis_player_id,player_name,team,slate_date",
      q => q.gte("slate_date", from).lte("slate_date", day));
    const seen = new Set();
    for (const r of rows) {
      const team = nflTeam(r.team);
      if (r.entity_type === "team") byNameTeam.set(`DST|${team}`, `DST:${team}`);
      else if (r.gsis_player_id) { add(r.player_name, team, String(r.gsis_player_id)); seen.add(String(r.gsis_player_id)); }
    }
    // Respaldo: plantillas actuales (football_players) para jugadores
    // que BallDontLie no puso en su lista.
    const roster = await selectAll("football_players", "gsis_player_id,player_name,team,roster_status");
    for (const r of roster) {
      const id = str(r.gsis_player_id);
      if (!id || seen.has(id) || !r.team) continue;
      add(r.player_name, nflTeam(r.team), id);
    }
  }
  return (name, team, isDst) => {
    if (isDst) return byNameTeam.get(`DST|${team}`) || `DST:${team}`;
    const n = normName(name);
    const exact = byNameTeam.get(`${n}|${team}`);
    if (exact) return exact;
    const any = byName.get(n);
    if (any && any.size === 1) return [...any][0];        // mismo nombre, cambio de equipo
    const sameLast = byLastTeam.get(`${n.split(" ").pop()}|${team}`);
    return sameLast && sameLast.size === 1 ? [...sameLast][0] : null;  // apodo, mismo apellido y equipo
  };
}

// 5-nov: dias hacia adelante que se leen de DraftKings (todos los
// slates disponibles, no solo los de hoy). NBA: hoy y manana. NFL: 7 dias
// (incluye los mixtos, ej. jueves + domingo).
const DK_DAYS_AHEAD = { nba: 1, nfl: 6 };

// Fotos: lista de jugadores del slate en la API publica de DraftKings
// (draftableId = el ID del CSV). Sin foto si falla.
async function dkImages(dg) {
  try {
    const j = await dkFetch(`https://api.draftkings.com/draftgroups/v1/draftgroups/${dg}/draftables`);
    const out = new Map();
    for (const d of j?.draftables || []) {
      const img = d.playerImage160 || d.playerImageFull || d.playerImage50 || null;
      if (d.draftableId && img) out.set(Number(d.draftableId), img);
    }
    return out;
  } catch {
    return new Map();
  }
}

async function syncDkSport(sport, day, nowIso) {
  const lobby = await dkFetch(DK_LOBBY + sport.toUpperCase());
  const lastDay = addDaysStr(day, DK_DAYS_AHEAD[sport] || 0);
  const groups = new Map();
  for (const c of lobby?.Contests || []) {
    const type = DK_GAME_TYPES[str(c.gameType).toLowerCase()];
    if (!type || !c.dg) continue;
    const ms = Number(str(c.sd).replace(/\D/g, "")) || null;
    if (!ms || ms <= Date.now()) continue;
    const gDay = chicagoDay(new Date(ms));
    if (gDay < day || gDay > lastDay) continue;
    if (!groups.has(c.dg)) groups.set(c.dg, { dg: Number(c.dg), type, typeId: Number(c.gameTypeId), startsAt: new Date(ms).toISOString(), day: gDay, contests: 0 });
    groups.get(c.dg).contests++;
  }

  // Los que empiezan en mas de 6 horas se vuelven a leer cada hora (no cada 15 min)
  const prevRows = await selectAll("fantasy_app_dk_slates", "draft_group_id,checked_at,starts_at",
    q => q.eq("sport", sport).gte("slate_date", day));
  const prevChecked = new Map(prevRows.map(r => [Number(r.draft_group_id), Date.parse(r.checked_at || 0) || 0]));

  const matchers = new Map();
  const matchFor = async d => {
    if (!matchers.has(d)) matchers.set(d, await dkMatchIndex(sport, d));
    return matchers.get(d);
  };
  const out = [];
  for (const g of groups.values()) {
    const far = Date.parse(g.startsAt) - Date.now() > 6 * 3600000;
    if (far && Date.now() - (prevChecked.get(g.dg) || 0) < 60 * 60000) {
      out.push({ draft_group_id: g.dg, type: g.type, day: g.day, estado: "leido hace menos de 1 hora" });
      continue;
    }
    const match = await matchFor(g.day);
    try {
      const csv = await dkFetch(`${DK_CSV}?contestTypeId=${g.typeId}&draftGroupId=${g.dg}`, true);
      const rows = parseCsv(csv).filter(r => r.ID && r.Name);
      const images = await dkImages(g.dg);
      const games = new Map();
      const players = rows.map(r => {
        const rawTeam = str(r.TeamAbbrev).toUpperCase();
        const team = sport === "nba" ? (DK_NBA_TEAMS[rawTeam] || rawTeam) : nflTeam(rawTeam);
        const isDst = sport === "nfl" && /^(DST|D)$/i.test(r.Position);
        const gi = str(r["Game Info"]);
        const gameKey = gi.split(" ")[0] || null;
        if (gameKey && !games.has(gameKey)) games.set(gameKey, dkGameTime(gi));
        const key = match(r.Name, team, isDst);
        return {
          draft_group_id: g.dg,
          dk_id: Number(r.ID),
          sport,
          slate_date: g.day,
          image_url: images.get(Number(r.ID)) || null,
          roster_position: r["Roster Position"] || null,
          slot: g.type === "captain" ? (/^CPT$/i.test(r["Roster Position"]) ? "CPT" : "UTIL") : null,
          player_name: r.Name,
          team,
          positions: isDst ? ["DST"] : str(r.Position).toUpperCase().split("/").filter(Boolean),
          salary: num(r.Salary),
          status: cleanStatus(r.Status),
          avg_ppg: num(r.AvgPointsPerGame),
          game: gameKey,
          game_start: games.get(gameKey) ? games.get(gameKey).toISOString() : null,
          player_key: key,
          checked_at: nowIso
        };
      });
      const times = [...games.values()].filter(Boolean).map(d => d.getTime());
      await upsertAll("fantasy_app_dk_slates", [{
        draft_group_id: g.dg, sport, slate_date: g.day, game_type: g.type, game_type_id: g.typeId,
        starts_at: times.length ? new Date(Math.min(...times)).toISOString() : g.startsAt,
        last_starts_at: times.length ? new Date(Math.max(...times)).toISOString() : g.startsAt,
        games: games.size, game_list: [...games.keys()], contests: g.contests,
        players: players.length, unmatched: players.filter(p => !p.player_key).length,
        checked_at: nowIso
      }], "draft_group_id");
      if (players.length) {
        try {
          await upsertAll("fantasy_app_dk_players", players, "draft_group_id,dk_id");
        } catch (e) {
          // Sin la columna image_url (falta el SQL paso 4): se guarda sin fotos
          if (!/image_url/i.test(e.message)) throw e;
          await upsertAll("fantasy_app_dk_players", players.map(({ image_url, ...rest }) => rest), "draft_group_id,dk_id");
        }
        const { error } = await supabaseAdmin.from("fantasy_app_dk_players").delete()
          .eq("draft_group_id", g.dg).lt("checked_at", nowIso);
        if (error) throw new Error(`Supabase fantasy_app_dk_players: ${error.message}`);
      }
      out.push({
        draft_group_id: g.dg, type: g.type, day: g.day, games: games.size, players: players.length, fotos: images.size,
        sin_cruce: players.filter(p => !p.player_key).length,
        ejemplos_sin_cruce: players.filter(p => !p.player_key && p.salary >= 4000).slice(0, 5).map(p => `${p.player_name} ${p.team}`)
      });
    } catch (e) {
      out.push({ draft_group_id: g.dg, type: g.type, error: e.message });
    }
  }
  return out;
}

async function actionSyncDk(req) {
  const day = chicagoDay();
  const nowIso = new Date().toISOString();
  const only = parseSport(req.query.sport);
  const result = {};
  for (const sport of only ? [only] : ["nba", "nfl"]) {
    try {
      result[sport] = await syncDkSport(sport, day, nowIso);
    } catch (e) {
      result[sport] = { error: e.message };
    }
  }
  return { status: 200, body: { ok: true, date: day, draftkings: result } };
}


// ============================================================
// CSV PARA DRAFTKINGS (csv-official)
// ============================================================
//
// Tus alineaciones oficiales de hoy (Main de DraftKings) en el
// formato de subida de DraftKings: primera fila = puestos, cada
// fila = una alineacion con los IDs oficiales.
// FanDuel: por ahora sin CSV (se meten a mano).

const DK_HEADER = {
  nba: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
  nfl: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]
};

// Pone los jugadores en el orden de las columnas de DraftKings.
function orderBySlots(header, players) {
  const left = players.slice();
  return header.map(slot => {
    const i = left.findIndex(p => str(p.slot).toUpperCase() === slot || (slot === "DST" && /^(DST|DEF|D)$/i.test(str(p.slot))));
    return i >= 0 ? left.splice(i, 1)[0] : null;
  });
}

function sendCsv(res, filename, rows) {
  cors(res);
  const body = rows.map(r => r.map(v => {
    const t = str(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(",")).join("\r\n") + "\r\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(body);
}

async function officialCsv(sport, day) {
  const header = DK_HEADER[sport];
  const groups = await selectAll("fantasy_app_dk_slates", "*",
    q => q.eq("sport", sport).eq("slate_date", day).eq("game_type", "classic"));
  if (!groups.length) return { error: "No hay slates de DraftKings de hoy. Corre ?action=sync-dk" };

  let lineups = [];
  if (sport === "nba") {
    const rows = await selectAll("fantasy_nba_lineups", "*", q => q.eq("slate_date", day).eq("platform", "draftkings"));
    lineups = rows.sort((a, b) => a.lineup_number - b.lineup_number)
      .map(l => (l.players || []).map(p => ({ slot: p.slot, key: String(p.player_id), name: p.name })));
  } else {
    // Ultima corrida con alineaciones del slate principal de DraftKings de hoy
    const slates = await selectAll("fantasy_nfl_slates", "*", q => q.eq("slate_date", day).eq("platform", "draftkings"));
    const main = slates.find(x => x.is_main) || slates[0];
    if (!main) return { error: "No hay slate de DraftKings de NFL hoy" };
    const runs = await selectAll("fantasy_nfl_lineups", "run_id", q => q.eq("slate_id", main.slate_id));
    const runId = Math.max(...runs.map(r => Number(r.run_id)));
    if (!Number.isFinite(runId)) return { error: "Todavia no hay alineaciones de NFL para hoy" };
    const rows = await selectAll("fantasy_nfl_lineups", "*", q => q.eq("run_id", runId).eq("slate_id", main.slate_id));
    lineups = rows.sort((a, b) => a.lineup_number - b.lineup_number)
      .map(l => (l.players || []).map(p => ({ slot: p.slot, key: str(p.key), name: p.name })));
  }
  if (!lineups.length) return { error: "Todavia no hay alineaciones oficiales de hoy" };

  // El slate de DraftKings que tiene a TODOS los jugadores de las alineaciones
  const needed = new Set(lineups.flat().map(p => p.key));
  let best = null;
  for (const g of groups.sort((a, b) => Number(b.games) - Number(a.games))) {
    const rows = await selectAll("fantasy_app_dk_players", "player_key,dk_id,slot", q => q.eq("draft_group_id", Number(g.draft_group_id)));
    const ids = new Map();
    for (const r of rows) if (r.player_key && !ids.has(r.player_key)) ids.set(r.player_key, Number(r.dk_id));
    const missing = [...needed].filter(k => !ids.has(k));
    if (!best || missing.length < best.missing.length) best = { g, ids, missing };
    if (!missing.length) break;
  }
  if (best.missing.length) {
    const names = lineups.flat().filter(p => best.missing.includes(p.key)).map(p => p.name);
    return { error: `Faltan IDs de DraftKings para: ${[...new Set(names)].join(", ")}` };
  }
  const out = [header];
  for (const l of lineups) out.push(orderBySlots(header, l).map(p => (p ? best.ids.get(p.key) : "")));
  return { rows: out, draftGroupId: Number(best.g.draft_group_id) };
}

async function actionCsvOfficial(req, res) {
  const sport = parseSport(req.query.sport);
  if (!sport) return send(res, 400, { ok: false, error: "BAD_PARAMS", need: "sport=nba|nfl" });
  const day = chicagoDay();
  const r = await officialCsv(sport, day);
  if (r.error) return send(res, 404, { ok: false, error: r.error });
  return sendCsv(res, `cashedge-${sport}-draftkings-${day}.csv`, r.rows);
}


// ============================================================
// POOL DE ALINEACIONES PARA CLIENTES (pool-cron, ready, mine)
// ============================================================
//
// pool-cron (cada 5 min, con secret):
//   - Toma la lista mas nueva de cada slate (fantasy_app_slate_pools,
//     la guarda la formula en cada corrida oficial).
//   - Corrida nueva de la formula = version nueva: se borran las
//     alineaciones LIBRES (y las tuyas) de versiones viejas. Las ya
//     repartidas se quedan con su cliente.
//   - Arma de 200 en 200 (con el reparto de estrellas) hasta 1,000;
//     despues, si quedan menos de 200 libres, arma 200 mas.
//   - Tus 10: las 10 de mas proyeccion de la version actual.
// ready (cliente): toma N al azar de las libres (maximo 50 por slate).
// mine (cliente): sus alineaciones de hoy.
// csv-mine (cliente): su CSV de DraftKings.

// 5-nov: minDifferent 2 -> 3 (maximo 5 de 8 repetidos; NFL 6 de 9),
// parejas al 30% y busqueda de 20,000 pasos por alineacion (con 200,000
// no alcanzaba a hacer 200 en 40 s y los topes se rompian entre tandas).
const POOL = { target: 1000, batch: 200, refillBelow: 200, ownerTop: 10, maxPerUser: 50,
  minDifferent: 3, maxExposure: 0.4, maxPairShare: 0.3, nodeLimit: 20000, batchSeconds: 40 };
const DK_HEADER_POOL = { nba: { draftkings: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"], fanduel: ["PG", "PG", "SG", "SG", "SF", "SF", "PF", "PF", "C"] } };

let nbaLineupsLib = null, nflLineupsLib = null;
const lineupsLib = () => (nbaLineupsLib ||= require("./_lib/fantasy-nba-lineups.js"));
const nflLib = () => (nflLineupsLib ||= require("./_lib/fantasy-nfl-lineups.js"));

async function ownerUserId() {
  if (!OWNER_EMAIL) return null;
  const { data } = await supabaseAdmin.from("users").select("id").ilike("email", OWNER_EMAIL).limit(1).maybeSingle();
  return data?.id || null;
}

async function latestSlatePool(sport, platform, day) {
  const { data, error } = await supabaseAdmin.from("fantasy_app_slate_pools").select("*")
    .eq("sport", sport).eq("platform", platform).eq("slate_date", day)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_app_slate_pools: ${error.message}`);
  return data;
}

function starGroups(stars, count) {
  if (!stars?.length) return null;
  const out = stars.map(s => Math.floor(s.share * count + 1e-9));
  const target = Math.floor(stars.reduce((a, s) => a + s.share, 0) * count + 1e-9);
  for (let i = 0; out.reduce((a, b) => a + b, 0) < target; i = (i + 1) % out.length) out[i]++;
  return stars.map((s, i) => ({ ids: [s.id], names: [s.name], lineups: out[i] }));
}

// 5-nov: cada slate con su formula, segun cuantos partidos tiene
//   5+ partidos: 1000, 3 distintos, parejas 30%
//   4 partidos:   500, 3 distintos, parejas 40%
//   3 partidos:   300, 2 distintos, parejas 50%
//   2 o menos:    150, 2 distintos, sin tope de parejas
function slateGames(sp) {
  return new Set((sp.players || []).map(p => String(p.gameId))).size;
}
function poolTier(sp) {
  const g = slateGames(sp);
  if (g >= 5) return { games: g, target: 1000, minDifferent: 3, maxPairShare: 0.3 };
  if (g === 4) return { games: g, target: 500, minDifferent: 3, maxPairShare: 0.4 };
  if (g === 3) return { games: g, target: 300, minDifferent: 2, maxPairShare: 0.5 };
  return { games: g, target: 150, minDifferent: 2, maxPairShare: 1 };
}

async function poolBatch(sp, count, existing) {
  const prior = existing.map(l => (l.players || []).map(p => String(p.id)));
  const { minDifferent, maxPairShare } = poolTier(sp);
  let r;
  if (sp.sport === "nfl") {
    // NFL: la misma forma de la formula (4 partidos de Vegas + 2
    // principales; sin mercado, las pilas de antes).
    const m = sp.stars || {};
    const base = { count, minDifferent, maxExposure: POOL.maxExposure, maxPairShare, nodeLimit: POOL.nodeLimit, prior };
    r = m.metodo === "partidos"
      ? nflLib().buildGameStackLineups(sp.platform, sp.players, { ...base, games: m.games, extras: m.extras, gameTotals: new Map(m.gameTotals || []), teamImplied: new Map(m.teamImplied || []) })
      : m.metodo === "pilas"
        ? nflLib().buildStackLineups(sp.platform, sp.players, { ...base, alwaysTwo: !!m.siempreDos })
        : nflLib().buildLineups(sp.platform, sp.players, base);
  } else {
    const groups = starGroups(sp.stars, count);
    r = lineupsLib().buildLineups(sp.platform, sp.players, {
      count, minDifferent, maxExposure: POOL.maxExposure, maxPairShare,
      nodeLimit: POOL.nodeLimit, timeLimitMs: POOL.batchSeconds * 1000,
      noStarterBackup: true,
      stackPlan: groups ? { groups } : null,
      prior
    });
  }
  const byId = new Map(sp.players.map(p => [String(p.id), p]));
  return r.lineups.map(l => ({
    players: l.players.map(p => {
      const src = byId.get(String(p.id)) || {};
      return { slot: p.slot, id: String(p.id), key: src.key ?? String(p.id), dkId: src.dkId ?? null, name: p.name, team: p.team, positions: src.positions || p.positions || [], salary: p.salary, points: round(p.points, 2) };
    }),
    salary: l.salary,
    proj: round(l.points, 2),
    star: l.pila || (l.stack ? `${l.stack.qb} (${l.stack.team})` : null)
  }));
}

// 5-nov: todas las listas del dia (Main y slates pequenos), cada una por su lado
async function refillPool(sport, platform, day) {
  const rows = await selectAll("fantasy_app_slate_pools", "slate_key,version",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_date", day));
  if (!rows.length) return { platform, estado: "sin lista de la formula" };
  const latest = new Map();
  for (const r of rows) if (!latest.has(Number(r.slate_key)) || String(r.version) > String(latest.get(Number(r.slate_key)))) latest.set(Number(r.slate_key), r.version);
  const pools = [];
  for (const [key, version] of latest) {
    const { data, error } = await supabaseAdmin.from("fantasy_app_slate_pools").select("*")
      .eq("sport", sport).eq("platform", platform).eq("slate_key", key).eq("version", version).limit(1).maybeSingle();
    if (error) throw new Error(`Supabase fantasy_app_slate_pools: ${error.message}`);
    if (data) pools.push(data);
  }
  // Tus 10 reservadas: solo en el Main (el de mas partidos del dia)
  const mainKey = pools.slice().sort((a, b) => slateGames(b) - slateGames(a))[0]?.slate_key;
  const out = [];
  for (const sp of pools) {
    try { out.push(await refillOne(sp, Number(sp.slate_key) === Number(mainKey))); }
    catch (e) { out.push({ slate_key: sp.slate_key, error: e.message }); }
  }
  return { platform, listas: out };
}

let poolDeadline = Infinity;   // pool-cron: no pasarse del tiempo de Vercel
async function refillOne(sp, isMain) {
  if (Date.now() > poolDeadline) return { slate_key: sp.slate_key, estado: "sin tiempo, sigue en la proxima vuelta" };
  const { sport, platform, slate_date: day } = sp;
  const tier = poolTier(sp);
  const batchSize = Math.min(POOL.batch, tier.target);
  const refillBelow = Math.min(POOL.refillBelow, Math.round(tier.target / 5));
  if (sp.starts_at && Date.parse(sp.starts_at) <= Date.now()) return { slate_key: sp.slate_key, estado: "el slate ya empezo" };

  // Version nueva: fuera las libres y las tuyas de versiones viejas
  const { error: delErr } = await supabaseAdmin.from("fantasy_app_pool_lineups").delete()
    .eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key)
    .neq("version", sp.version).in("status", ["free", "owner"]);
  if (delErr) throw new Error(`Supabase fantasy_app_pool_lineups: ${delErr.message}`);

  const current = await selectAll("fantasy_app_pool_lineups", "id,lineup_number,players,status,proj",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key).eq("version", sp.version));
  const free = current.filter(l => l.status === "free").length;
  let need = 0;
  if (current.length < tier.target) need = Math.min(batchSize, tier.target - current.length);
  else if (free < refillBelow) need = batchSize;
  // Ya no salen mas combinaciones con estas reglas: no se sigue intentando
  if (sp.stars?.agotada && current.length >= sp.stars.agotada) need = 0;

  let built = 0;
  if (need > 0) {
    const t = Date.now();
    const lines = await poolBatch(sp, need, current);
    const startNum = current.reduce((m, l) => Math.max(m, l.lineup_number), 0);
    const rows = lines.map((l, i) => ({
      sport, platform, slate_key: sp.slate_key, game_type: sp.game_type, slate_date: day, version: sp.version,
      lineup_number: startNum + i + 1, ...l, status: "free"
    }));
    for (const part of chunks(rows, 200)) {
      const { error } = await supabaseAdmin.from("fantasy_app_pool_lineups").insert(part);
      if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
    }
    built = rows.length;
    current.push(...rows.map(r => ({ ...r, id: null })));
    if (built < need) {
      // Slate chico: no hay mas combinaciones. Se marca para no repetir.
      await supabaseAdmin.from("fantasy_app_slate_pools").update({ stars: { ...(sp.stars || {}), agotada: current.length } })
        .eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key).eq("version", sp.version);
    }
    console.log("pool", sport, platform, built, (Date.now() - t) / 1000, "s");
  }

  // Tus 10: las mejores de la version actual.
  // 5-nov: consulta directa con limite (selectAll pagina con .range() y
  // borraba el .limit(): te reservaba TODAS las libres). Y si ya tienes
  // mas de 10, las de menos proyeccion vuelven a quedar libres.
  // 5-nov: tus 10 solo en DraftKings (no juegas FanDuel) y nunca si las borraste
  let owner = isMain && platform === "draftkings" ? await ownerUserId() : null;
  if (platform !== "draftkings" && isMain) {
    const ownerId = await ownerUserId();
    if (ownerId) {
      await supabaseAdmin.from("fantasy_app_pool_lineups").update({ status: "free", user_id: null, assigned_at: null })
        .eq("slate_key", sp.slate_key).eq("platform", platform).eq("user_id", ownerId).eq("status", "owner");
    }
  }
  if (owner) {
    const { data: dropped } = await supabaseAdmin.from("fantasy_app_pool_lineups").select("id")
      .eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key).eq("user_id", owner).eq("status", "dropped").limit(1);
    if (dropped?.length) owner = null;
  }
  let mine = current.filter(l => l.status === "owner").length;
  if (owner && mine > POOL.ownerTop) {
    const { data: extra, error: exErr } = await supabaseAdmin.from("fantasy_app_pool_lineups").select("id")
      .eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key).eq("version", sp.version).eq("status", "owner")
      .order("proj", { ascending: true }).limit(mine - POOL.ownerTop);
    if (exErr) throw new Error(`Supabase fantasy_app_pool_lineups: ${exErr.message}`);
    if (extra?.length) {
      const { error } = await supabaseAdmin.from("fantasy_app_pool_lineups")
        .update({ status: "free", user_id: null, assigned_at: null }).in("id", extra.map(b => b.id)).eq("status", "owner");
      if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
      mine -= extra.length;
    }
  }
  if (owner && mine < POOL.ownerTop) {
    const { data: best, error: bErr } = await supabaseAdmin.from("fantasy_app_pool_lineups").select("id,proj")
      .eq("sport", sport).eq("platform", platform).eq("slate_key", sp.slate_key).eq("version", sp.version).eq("status", "free")
      .order("proj", { ascending: false }).limit(POOL.ownerTop - mine);
    if (bErr) throw new Error(`Supabase fantasy_app_pool_lineups: ${bErr.message}`);
    if (best?.length) {
      const { error } = await supabaseAdmin.from("fantasy_app_pool_lineups")
        .update({ status: "owner", user_id: owner, assigned_at: new Date().toISOString() }).in("id", best.map(b => b.id));
      if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
    }
  }
  return { slate_key: sp.slate_key, partidos: tier.games, meta: tier.target, version: sp.version, armadas: built, total: current.length, libres: Math.max(0, free + built - (owner ? Math.max(0, POOL.ownerTop - mine) : 0)) };
}

async function actionPoolCron(req) {
  const t0 = Date.now();
  poolDeadline = t0 + 200000;
  const day = chicagoDay();
  const body = { ok: true, date: day, cambiosPorOut: [] };
  for (const sport of ["nba", "nfl"]) {
    // primero los cambios por OUT, despues rellenar
    try { body.cambiosPorOut.push(await runOutSwaps(sport, day)); }
    catch (e) { body.cambiosPorOut.push({ sport, error: e.message }); }
    body[sport] = [];
    for (const platform of ["draftkings", "fanduel"]) {
      // 5-nov: tambien el Main de los proximos dias (ej. NFL domingo desde el jueves)
      let days = [day];
      try {
        const rows = await selectAll("fantasy_app_slate_pools", "slate_date",
          q => q.eq("sport", sport).eq("platform", platform).gte("slate_date", day).lte("slate_date", addDaysStr(day, 6)));
        days = [...new Set([day, ...rows.map(r => r.slate_date)])].sort();
      } catch { /* solo hoy */ }
      for (const d of days) {
        if (Date.now() - t0 > 200000) { body[sport].push({ platform, day: d, estado: "sin tiempo, sigue en la proxima vuelta" }); continue; }
        try { body[sport].push({ day: d, ...(await refillPool(sport, platform, d)) }); }
        catch (e) { body[sport].push({ platform, day: d, error: e.message }); }
      }
    }
  }
  return { status: 200, body };
}


// ============================================================
// 5-nov: LISTAS DE LA FORMULA PARA LOS DEMAS SLATES (cron pool-slates)
// NBA: la formula corre sola para cada slate Classic de DraftKings de hoy
//   (modo slate, igual que ?mode=slate) y guarda su lista.
// NFL: la lista sale de las proyecciones de la ultima corrida de la
//   formula (solo jugadores que la formula deja entrar) y se arma con
//   los stacks de la formula (QB + receptores).
// Se rehace cuando la formula vuelve a correr.
// ============================================================
let nbaProjectLib = null;
const nbaProject = () => (nbaProjectLib ||= require("./fantasy-nba-project.js"));

async function latestPoolsBy(sport, platform, fromDay, toDay) {
  const rows = await selectAll("fantasy_app_slate_pools", "slate_key,version,stars",
    q => q.eq("sport", sport).eq("platform", platform).gte("slate_date", fromDay).lte("slate_date", toDay));
  const by = new Map();
  for (const r of rows) if (!by.has(Number(r.slate_key)) || String(r.version) > String(by.get(Number(r.slate_key)).version)) by.set(Number(r.slate_key), r);
  return by;
}

async function nbaSlatePools(day, t0, out) {
  const [dk, pools, stamp] = await Promise.all([
    selectAll("fantasy_app_dk_slates", "*", q => q.eq("sport", "nba").eq("game_type", "classic").eq("slate_date", day)),
    latestPoolsBy("nba", "draftkings", day, day),
    supabaseAdmin.from("fantasy_nba_projections").select("created_at").eq("slate_date", day)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const projStamp = stamp?.data?.created_at || null;
  if (!projStamp) { out.push({ estado: "la formula de hoy todavia no ha corrido" }); return; }
  for (const s of dk.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
    const dg = Number(s.draft_group_id);
    if (Date.parse(s.starts_at) <= Date.now()) continue;
    const have = pools.get(dg);
    if (have && String(have.version) >= String(projStamp)) continue;   // al dia
    if (Date.now() - t0 > 150000) { out.push({ slate: dg, estado: "sigue en la proxima vuelta" }); continue; }
    try {
      const r = await nbaProject().runDraftKingsSlate(day, dg, 20, { savePool: true });
      out.push({ slate: dg, partidos: s.games, estado: "lista guardada", alineaciones: r.platforms?.[0]?.lineups?.length ?? 0 });
    } catch (e) {
      out.push({ slate: dg, error: e.message });
    }
  }
}

async function nflSlatePools(day, out) {
  const lastDay = addDaysStr(day, DK_DAYS_AHEAD.nfl);
  const run = await nflLatestRun(day);
  if (!run) { out.push({ estado: "la formula NFL todavia no ha corrido" }); return; }
  const [dk, pools] = await Promise.all([
    selectAll("fantasy_app_dk_slates", "*", q => q.eq("sport", "nfl").eq("game_type", "classic").gte("slate_date", day).lte("slate_date", lastDay)),
    latestPoolsBy("nfl", "draftkings", day, lastDay)
  ]);
  for (const s of dk) {
    const dg = Number(s.draft_group_id);
    if (Date.parse(s.starts_at) <= Date.now()) continue;
    const have = pools.get(dg);
    if (have && !have.stars?.extra) continue;                          // la hizo la formula (Main)
    const oldMethod = have && have.stars?.metodo === "pilas" && !have.stars?.siempreDos;   // hechas antes del 5-nov tarde
    if (have && !oldMethod && Number(have.stars?.run_id) === Number(run.run_id)) continue;   // al dia
    // la formula NFL corre seguido: se rehace como maximo cada 3 horas
    if (have && !oldMethod && Date.now() - Date.parse(have.version) < 3 * 3600000) continue;
    const dkPlayers = (await selectAll("fantasy_app_dk_players", "*", q => q.eq("draft_group_id", dg))).filter(p => p.player_key && !p.slot);
    const keys = dkPlayers.map(p => p.player_key);
    const proj = keys.length ? await selectIn("fantasy_nfl_projections", "entity_key,dk_points,stats,in_pool,available", "entity_key", keys,
      q => q.eq("run_id", run.run_id)) : [];
    const projBy = new Map(proj.map(p => [str(p.entity_key), p]));
    const players = dkPlayers.map(p => {
      const pj = projBy.get(str(p.player_key));
      if (!pj || pj.in_pool === false || pj.available === false) return null;
      if (/^(out|o|ir|d|doubtful|suspended)$/i.test(str(p.status))) return null;
      const points = num(pj.stats?.mercado70_dk) ?? num(pj.dk_points);
      if (!points || points <= 0) return null;
      return {
        id: str(p.player_key), key: str(p.player_key), name: p.player_name, team: p.team, opp: dkOpp(p.game, p.team),
        gameId: p.game, positions: p.positions, salary: Number(p.salary), points: round(points, 2), dkId: Number(p.dk_id)
      };
    }).filter(Boolean);
    if (players.length < 20) { out.push({ slate: dg, estado: "sin proyecciones suficientes", jugadores: players.length }); continue; }
    // 5-nov: el metodo completo de la formula (partidos de Vegas) con los
    // puntos que Vegas espera de cada equipo (ultima corrida NFL). Sin
    // lineas: stacks, siempre QB + 2 receptores.
    const implied = new Map(run.summary?.mercado?.puntosEquipo || []);
    const gameTotals = [];
    for (const g of new Set(players.map(p => p.gameId))) {
      const [a, h] = str(g).split("@").map(t => nflTeam(t));
      if (implied.has(a) && implied.has(h)) gameTotals.push([g, implied.get(a) + implied.get(h)]);
    }
    const stars = gameTotals.length
      ? { metodo: "partidos", games: run.summary.mercado.partidosVegas || 4, extras: run.summary.mercado.extrasVegas || 2,
        gameTotals, teamImplied: [...implied.entries()], extra: true, run_id: run.run_id }
      : { metodo: "pilas", siempreDos: true, extra: true, run_id: run.run_id };
    const { error } = await supabaseAdmin.from("fantasy_app_slate_pools").insert({
      sport: "nfl", platform: "draftkings", slate_key: dg, game_type: "classic", slate_date: s.slate_date,
      starts_at: s.starts_at, version: new Date().toISOString(), players, stars
    });
    if (error) throw new Error(`Supabase fantasy_app_slate_pools: ${error.message}`);
    out.push({ slate: dg, partidos: s.games, estado: "lista guardada", jugadores: players.length, metodo: stars.metodo });
  }
}

async function actionPoolSlates() {
  const t0 = Date.now();
  const day = chicagoDay();
  const body = { ok: true, date: day, nba: [], nfl: [] };
  try { await nbaSlatePools(day, t0, body.nba); } catch (e) { body.nba.push({ error: e.message }); }
  try { await nflSlatePools(day, body.nfl); } catch (e) { body.nfl.push({ error: e.message }); }
  return { status: 200, body };
}

// ============================================================
// 5-nov: RESULTADOS (cron evaluate, cada manana)
// Puntos reales de TODAS las alineaciones entregadas a clientes (aunque
// las hayan borrado) y de todas las de la formula, mas la mejor
// alineacion posible del slate. Se guarda en:
//   fantasy_app_user_lineups.actual_points / evaluated_at
//   fantasy_app_pool_lineups.actual_points / evaluated_at
//   fantasy_app_slate_results (resumen por slate)
// Ganar o no (1er lugar, ultimo que cobra, top 20) se mide aparte con
// los datos de cada contest que manda el dueno.
// ============================================================

async function slateInfo(sport, platform, slateKey) {
  const dk = await getDkSlate(slateKey).catch(() => null);
  if (dk) return { from: dk.slate_date, to: chicagoDay(new Date(dk.last_starts_at || dk.starts_at)), dk };
  const ours = await getSlate(sport, slateKey).catch(() => null);
  if (!ours) return null;
  return { from: ours.slate_date, to: sport === "nfl" ? addDaysStr(ours.slate_date, 4) : ours.slate_date, dk: null };
}

// Puntos reales por llave de jugador (NBA: id BDL | NFL: gsis o DST:TEAM)
async function actualPoints(sport, platform, from, to) {
  const out = new Map();
  if (sport === "nba") {
    const games = await selectAll("nba_games", "game_id,game_date",
      q => q.gte("game_date", `${addDaysStr(from, -1)}T00:00:00Z`).lte("game_date", `${addDaysStr(to, 1)}T23:59:59Z`));
    const ids = games.filter(g => { const d = nbaDay(g.game_date); return d >= from && d <= to; }).map(g => Number(g.game_id));
    if (!ids.length) return out;
    const rows = await selectIn("nba_player_game_roles",
      "player_id,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made", "game_id", ids);
    for (const r of rows) {
      out.set(String(r.player_id), round(nbaScore({
        pts: num(r.points) || 0, reb: num(r.rebounds) || 0, ast: num(r.assists) || 0, stl: num(r.steals) || 0,
        blk: num(r.blocks) || 0, tov: num(r.turnovers) || 0, fg3m: num(r.three_pointers_made) || 0
      }, platform), 2));
    }
    return out;
  }
  const [players, teams] = await Promise.all([
    selectAll("football_player_week_stats", "*", q => q.gte("game_date", from).lte("game_date", to)),
    selectAll("football_team_week_stats", "*", q => q.gte("game_date", from).lte("game_date", to))
  ]);
  for (const r of players) out.set(str(r.gsis_player_id), round(nflOffenseScore(r, platform), 2));
  const byGame = new Map(teams.map(t => [`${nflTeam(t.team)}|${t.game_id}`, t]));
  for (const t of teams) out.set(`DST:${nflTeam(t.team)}`, round(nflDstScore(t, byGame.get(`${nflTeam(t.opponent)}|${t.game_id}`)), 2));
  return out;
}

const lineupPoints = (players, pts) => round((players || []).reduce((s, p) => s + (pts.get(str(p.key || p.id)) || 0), 0), 2);

async function evaluateSlate(sport, platform, slateKey) {
  const info = await slateInfo(sport, platform, slateKey);
  if (!info) return { slate: slateKey, estado: "slate no encontrado" };
  if (info.to >= chicagoDay()) return { slate: slateKey, estado: "todavia se juega" };
  const pts = await actualPoints(sport, platform, info.from, info.to);
  if (pts.size < 20) return { slate: slateKey, estado: "faltan estadisticas", jugadores: pts.size };
  const now = new Date().toISOString();

  const users = await selectAll("fantasy_app_user_lineups", "id,user_id,players,source,deleted_at",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey));
  const pool = await selectAll("fantasy_app_pool_lineups", "id,players,status,user_id",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey));
  const uScored = users.map(u => ({ ...u, actual: lineupPoints(u.players, pts) }));
  const pScored = pool.map(l => ({ ...l, actual: lineupPoints(l.players, pts) }));
  for (const part of chunks(uScored, 200)) {
    await Promise.all(part.map(u => supabaseAdmin.from("fantasy_app_user_lineups").update({ actual_points: u.actual, evaluated_at: now }).eq("id", u.id)));
  }
  for (const part of chunks(pScored, 200)) {
    await Promise.all(part.map(l => supabaseAdmin.from("fantasy_app_pool_lineups").update({ actual_points: l.actual, evaluated_at: now }).eq("id", l.id)));
  }

  // La mejor alineacion posible (con lo que paso de verdad)
  let optimal = null;
  if (info.dk) {
    const dkPlayers = (await selectAll("fantasy_app_dk_players", "player_key,player_name,team,positions,salary,game,slot", q => q.eq("draft_group_id", Number(slateKey))))
      .filter(p => p.player_key && !p.slot && pts.has(str(p.player_key)));
    const list = dkPlayers.map(p => ({ id: str(p.player_key), key: str(p.player_key), name: p.player_name, team: p.team, opp: dkOpp(p.game, p.team),
      gameId: p.game, positions: p.positions, salary: Number(p.salary), points: Math.max(0.01, pts.get(str(p.player_key))) }));
    const r = sport === "nfl" ? nflLib().buildLineups(platform, list, { count: 1, nodeLimit: 2e6 })
      : lineupsLib().buildLineups(platform, list, { count: 1, nodeLimit: 2e6, timeLimitMs: 40000 });
    const best = r.lineups?.[0];
    if (best) optimal = { points: round(best.points, 2), players: best.players.map(p => ({ slot: p.slot, name: p.name, team: p.team, salary: p.salary, points: round(p.points, 2) })) };
  }

  const given = uScored;
  const bestGiven = given.slice().sort((a, b) => b.actual - a.actual)[0] || null;
  let bestEmail = null;
  if (bestGiven) {
    const { data } = await supabaseAdmin.from("users").select("email").eq("id", bestGiven.user_id).maybeSingle();
    bestEmail = data?.email || null;
  }
  const avg = list => (list.length ? round(list.reduce((s, x) => s + x.actual, 0) / list.length, 2) : null);
  const row = {
    sport, platform, slate_key: Number(slateKey), slate_date: info.from, evaluated_at: now,
    lineups_given: given.length, users: new Set(given.map(u => u.user_id)).size,
    from_formula: given.filter(u => u.source === "pool").length,
    avg_given: avg(given), best_given: bestGiven?.actual ?? null, best_given_lineup_id: bestGiven?.id ?? null, best_given_email: bestEmail,
    pool_lineups: pScored.length, avg_pool: avg(pScored), best_pool: pScored.reduce((m, x) => Math.max(m, x.actual), 0) || null,
    optimal_points: optimal?.points ?? null, optimal_players: optimal?.players ?? null
  };
  const { error } = await supabaseAdmin.from("fantasy_app_slate_results").upsert(row, { onConflict: "sport,platform,slate_key" });
  if (error) throw new Error(`Supabase fantasy_app_slate_results: ${error.message}`);
  return { slate: slateKey, estado: "evaluado", entregadas: given.length, promedio: row.avg_given, mejor: row.best_given, perfecta: row.optimal_points };
}

async function actionEvaluate(req) {
  const day = chicagoDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(req.query.date)) ? str(req.query.date) : addDaysStr(day, -7);
  const body = { ok: true, desde: from, slates: [] };
  const t0 = Date.now();
  for (const table of ["fantasy_app_user_lineups", "fantasy_app_pool_lineups"]) {
    const rows = await selectAll(table, "sport,platform,slate_key",
      q => q.gte("slate_date", from).lt("slate_date", day).is("evaluated_at", null));
    const seen = new Set(body.slates.map(x => x.key));
    for (const r of rows) {
      const key = `${r.sport}|${r.platform}|${r.slate_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (Date.now() - t0 > 200000) { body.slates.push({ key, estado: "sigue en la proxima vuelta" }); continue; }
      try { body.slates.push({ key, ...(await evaluateSlate(r.sport, r.platform, Number(r.slate_key))) }); }
      catch (e) { body.slates.push({ key, error: e.message }); }
    }
  }
  return { status: 200, body };
}

// ============================================================
// 5-nov: BUILD MY LINEUP — alineaciones de la FORMULA (lista del Main)
// Si el cliente eligio o bloqueo jugadores: solo las de la lista que
// los tienen a todos (y ninguno de sus excluidos). Al azar.
// ============================================================
async function poolForSlate(sport, platform, slateKey) {
  const { data, error } = await supabaseAdmin.from("fantasy_app_slate_pools").select("*")
    .eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_app_slate_pools: ${error.message}`);
  return data;
}

// Si la formula no tiene (suficientes) alineaciones con sus jugadores:
// se completan con los que mas proyectan y caben en el salario.
async function pickFallback(b, user, count, formulaLineups = [], matches = 0) {
  if (count <= 0) return { status: 200, body: { ok: true, given: formulaLineups.length, formula: formulaLineups.length, byProjection: 0, matches, lineups: formulaLineups } };
  const r = await actionBuild({ body: { ...b, count, _fromPick: true } }, user);
  const extra = r.body?.lineups || [];
  if (!formulaLineups.length && !extra.length) return r;
  return { status: 200, body: { ok: true, given: formulaLineups.length + extra.length, formula: formulaLineups.length, byProjection: extra.length, matches, lineups: formulaLineups.concat(extra) } };
}

async function actionPick(req, user) {
  const b = await readBody(req);
  const sport = parseSport(b.sport), platform = parseSite(b.site), slateKey = num(b.slate_id);
  if (!sport || !platform || !slateKey) return { status: 400, body: { ok: false, error: "BAD_PARAMS" } };
  const want = Math.max(1, Math.min(POOL.maxPerUser, Number(b.count) || 1));
  const sp = await poolForSlate(sport, platform, slateKey);
  if (!sp) return pickFallback(b, user, want);
  if (sp.starts_at && Date.parse(sp.starts_at) <= Date.now()) return { status: 409, body: { ok: false, error: "SLATE_STARTED" } };

  const had = await selectAll("fantasy_app_user_lineups", "id",
    q => q.eq("user_id", user.userId).eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey).eq("source", "pool").is("deleted_at", null));
  const room = POOL.maxPerUser - had.length;
  if (room <= 0) return { status: 429, body: { ok: false, error: "LIMIT_50_PER_SLATE" } };
  const count = Math.min(want, room);

  const locks = (b.locks || []).map(String), bans = new Set((b.bans || []).map(String));
  const free = await selectAll("fantasy_app_pool_lineups", "id,players",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey).eq("version", sp.version).eq("status", "free"));
  if (!free.length) return pickFallback(b, user, count);
  const matches = free.filter(l => {
    const keys = new Set((l.players || []).map(p => str(p.key || p.id)));
    return locks.every(k => keys.has(k)) && ![...keys].some(k => bans.has(k));
  });
  if (!matches.length) return pickFallback(b, user, count);
  const ids = matches.map(m => m.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }

  const got = [];
  for (let start = 0; start < ids.length && got.length < count; start += count) {
    const take = ids.slice(start, start + (count - got.length));
    const { data, error } = await supabaseAdmin.from("fantasy_app_pool_lineups")
      .update({ status: "assigned", user_id: user.userId, assigned_at: new Date().toISOString() })
      .in("id", take).eq("status", "free").select("*");
    if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
    got.push(...(data || []));
  }
  if (!got.length) return pickFallback(b, user, count);
  const rows = got.map(l => ({
    user_id: user.userId, sport, platform, slate_key: l.slate_key, game_type: l.game_type, slate_date: l.slate_date,
    source: "pool", pool_lineup_id: l.id, players: l.players, salary: l.salary, proj: l.proj
  }));
  const { data: saved, error } = await supabaseAdmin.from("fantasy_app_user_lineups").insert(rows).select("*");
  if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
  return pickFallback(b, user, count - saved.length, saved, matches.length);
}

// ---- cliente ----

async function resolveUser(req) {
  // Pruebas tuyas desde el navegador: ?secret=...&as=owner
  if (checkSecret(req) && str(req.query.as) === "owner") {
    const id = await ownerUserId();
    return id ? { ok: true, userId: id, isOwner: true } : { ok: false, status: 404, error: "OWNER_NOT_FOUND" };
  }
  return requirePremium(req);
}

async function actionReady(req, user) {
  const sport = parseSport(req.query.sport) || "nba";
  const platform = parseSite(req.query.site);
  const want = Math.max(1, Math.min(POOL.maxPerUser, Number(req.query.count) || 10));
  if (!platform) return { status: 400, body: { ok: false, error: "BAD_PARAMS", need: "site=draftkings|fanduel & count" } };
  const day = chicagoDay();
  const sp = await latestSlatePool(sport, platform, day);
  if (!sp) return { status: 404, body: { ok: false, error: "NO_SLATE_TODAY" } };
  if (sp.starts_at && Date.parse(sp.starts_at) <= Date.now()) return { status: 409, body: { ok: false, error: "SLATE_STARTED" } };

  const had = await selectAll("fantasy_app_user_lineups", "id",
    q => q.eq("user_id", user.userId).eq("sport", sport).eq("platform", platform).eq("slate_date", day).eq("source", "pool").is("deleted_at", null));
  const room = POOL.maxPerUser - had.length;
  if (room <= 0) return { status: 429, body: { ok: false, error: "LIMIT_50_PER_SLATE" } };
  const count = Math.min(want, room);

  const free = await selectAll("fantasy_app_pool_lineups", "id",
    q => q.eq("sport", sport).eq("platform", platform).eq("slate_date", day).eq("version", sp.version).eq("status", "free"));
  // Al azar
  const ids = free.map(f => f.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }

  const got = [];
  for (const part of chunks(ids, Math.max(count, 1))) {
    if (got.length >= count) break;
    const take = part.slice(0, count - got.length);
    const { data, error } = await supabaseAdmin.from("fantasy_app_pool_lineups")
      .update({ status: "assigned", user_id: user.userId, assigned_at: new Date().toISOString() })
      .in("id", take).eq("status", "free").select("*");
    if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
    got.push(...(data || []));
  }
  if (!got.length) return { status: 503, body: { ok: false, error: "POOL_BUILDING", message: "Lineups are being built. Try again in a minute." } };

  const rows = got.map(l => ({
    user_id: user.userId, sport, platform, slate_key: l.slate_key, game_type: l.game_type, slate_date: day,
    source: "pool", pool_lineup_id: l.id, players: l.players, salary: l.salary, proj: l.proj
  }));
  const { data: saved, error } = await supabaseAdmin.from("fantasy_app_user_lineups").insert(rows).select("*");
  if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
  return { status: 200, body: { ok: true, given: saved.length, asked: want, lineups: saved } };
}

async function actionMine(req, user) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(req.query.date)) ? str(req.query.date) : chicagoDay();
  // 5-nov: hoy y los slates de los proximos dias
  const rows = await selectAll("fantasy_app_user_lineups", "*", q => q.eq("user_id", user.userId).gte("slate_date", day).is("deleted_at", null).order("id", { ascending: true }));
  // Tus 10 del pool (solo el dueno)
  let reserved = [];
  if (user.isOwner) {
    reserved = await selectAll("fantasy_app_pool_lineups", "*", q => q.eq("user_id", user.userId).eq("status", "owner").eq("slate_date", day));
  }
  const groups = {};
  for (const r of rows) {
    const k = `${r.sport}|${r.platform}|${r.slate_key}|${r.game_type}`;
    (groups[k] ||= { sport: r.sport, platform: r.platform, slate_key: r.slate_key, slate_date: r.slate_date, game_type: r.game_type, lineups: [] }).lineups.push(r);
  }
  return { status: 200, body: { ok: true, date: day, groups: Object.values(groups), tus10: reserved.length ? reserved : undefined } };
}

async function actionCsvMine(req, res, user) {
  const sport = parseSport(req.query.sport) || "nba";
  const day = chicagoDay();
  // 5-nov: un CSV por slate (&slate_key=). Sin slate_key: los de hoy.
  const slateKey = num(req.query.slate_key);
  const rows = await selectAll("fantasy_app_user_lineups", "*",
    q => {
      let x = q.eq("user_id", user.userId).eq("sport", sport).eq("platform", "draftkings").is("deleted_at", null);
      x = slateKey ? x.eq("slate_key", slateKey) : x.eq("slate_date", day);
      return x.order("id", { ascending: true });
    });
  let list = rows.map(r => r.players);
  if (user.isOwner && (str(req.query.tus10) === "1" || (slateKey && str(req.query.reserved) === "1"))) {
    const reserved = await selectAll("fantasy_app_pool_lineups", "players,proj",
      q => {
        let x = q.eq("user_id", user.userId).eq("status", "owner").eq("sport", sport).eq("platform", "draftkings");
        x = slateKey ? x.eq("slate_key", slateKey) : x.eq("slate_date", day);
        return x.order("proj", { ascending: false });
      });
    list = reserved.map(r => r.players).concat(list);
  }
  if (!list.length) return send(res, 404, { ok: false, error: "NO_LINEUPS" });
  const header = DK_HEADER_POOL[sport]?.draftkings || DK_HEADER[sport];
  const out = [header];
  for (const players of list) {
    const ordered = orderBySlots(header, players);
    if (ordered.some(p => !p?.dkId)) return send(res, 409, { ok: false, error: "MISSING_DK_ID" });
    out.push(ordered.map(p => p.dkId));
  }
  return sendCsv(res, `cashedge-${sport}-draftkings-${slateKey || day}.csv`, out);
}


// ============================================================
// CAMBIOS AUTOMATICOS POR OUT (dentro de pool-cron)
// ============================================================
//
// Para cada alineacion de HOY (de clientes, tuyas y las libres del
// pool) con un jugador que DraftKings marca OUT y cuyo partido
// todavia no empezo:
//   - Se cambia por el que mas proyecta de la lista mas nueva de la
//     formula que: juega ese puesto, cabe en el salario que queda,
//     no esta ya en la alineacion, no esta OUT y su partido no empezo.
//   - En las de clientes se guarda el cambio (para el aviso rojo).
// NBA y NFL, DraftKings y FanDuel.

async function outInfo(sport, day) {
  const rows = await selectAll("fantasy_app_dk_players", "player_key,status,game_start",
    q => q.eq("sport", sport).eq("slate_date", day));
  const out = new Set(), start = new Map();
  for (const r of rows) {
    if (!r.player_key) continue;
    if (/^(out|o|inactive)$/i.test(str(r.status))) out.add(r.player_key);
    if (r.game_start && !start.has(r.player_key)) start.set(r.player_key, Date.parse(r.game_start));
  }
  return { out, start };
}

function swapLineup(players, rule, candidates, info, now) {
  const changes = [];
  let list = players.map(p => ({ ...p }));
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const key = str(p.key || p.id);
    if (!info.out.has(key)) continue;
    const st = info.start.get(key);
    if (st && st <= now) continue;                       // su partido ya empezo: no se puede
    const used = new Set(list.map(x => str(x.key || x.id)));
    const left = rule.salaryCap - list.reduce((s, x, j) => s + (j === i ? 0 : Number(x.salary) || 0), 0);
    const ok = rule.eligible[str(p.slot).toUpperCase()] || [str(p.slot).toUpperCase()];
    const best = candidates
      .filter(c => !used.has(str(c.key || c.id)) && !info.out.has(str(c.key || c.id)))
      .filter(c => !(info.start.get(str(c.key || c.id)) <= now))
      .filter(c => (c.positions || []).some(x => ok.includes(String(x).toUpperCase())))
      .filter(c => Number(c.salary) <= left)
      .sort((a, b) => b.points - a.points)[0];
    if (!best) continue;
    list[i] = { slot: p.slot, id: String(best.id), key: best.key ?? String(best.id), dkId: best.dkId ?? null, name: best.name, team: best.team, positions: best.positions || [], salary: Number(best.salary), points: round(best.points, 2) };
    changes.push({ slot: p.slot, out: p.name, in: best.name });
  }
  return { players: list, changes };
}

async function runOutSwaps(sport, day) {
  const info = await outInfo(sport, day);
  if (!info.out.size) return { sport, cambios: 0 };
  const lib = sport === "nfl" ? nflLib() : lineupsLib();
  const now = Date.now();
  let total = 0, clientes = 0;
  for (const platform of ["draftkings", "fanduel"]) {
    const sp = await latestSlatePool(sport, platform, day);
    if (!sp) continue;
    const rule = lib.RULES[platform];
    const cands = sp.players || [];
    // 1) alineaciones de clientes
    const users = await selectAll("fantasy_app_user_lineups", "*", q => q.eq("sport", sport).eq("platform", platform).eq("slate_date", day).is("deleted_at", null));
    for (const ul of users) {
      if (!(ul.players || []).some(p => info.out.has(str(p.key || p.id)))) continue;
      const r = swapLineup(ul.players, rule, cands, info, now);
      if (!r.changes.length) continue;
      const salary = r.players.reduce((s, x) => s + (Number(x.salary) || 0), 0);
      const proj = round(r.players.reduce((s, x) => s + (Number(x.points) || 0), 0), 2);
      const { error } = await supabaseAdmin.from("fantasy_app_user_lineups")
        .update({ players: r.players, salary, proj, updated_at: new Date().toISOString() }).eq("id", ul.id);
      if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
      const { error: e2 } = await supabaseAdmin.from("fantasy_app_lineup_changes").insert(r.changes.map(c => ({
        user_lineup_id: ul.id, user_id: ul.user_id, out_player: c.out, in_player: c.in, slot: c.slot, changed_by: "auto"
      })));
      if (e2) throw new Error(`Supabase fantasy_app_lineup_changes: ${e2.message}`);
      total += r.changes.length; clientes++;
    }
    // 2) pool (libres y tuyas)
    const pool = await selectAll("fantasy_app_pool_lineups", "id,players",
      q => q.eq("sport", sport).eq("platform", platform).eq("slate_date", day).in("status", ["free", "owner"]));
    for (const pl of pool) {
      if (!(pl.players || []).some(p => info.out.has(str(p.key || p.id)))) continue;
      const r = swapLineup(pl.players, rule, cands, info, now);
      if (!r.changes.length) continue;
      const salary = r.players.reduce((s, x) => s + (Number(x.salary) || 0), 0);
      const proj = round(r.players.reduce((s, x) => s + (Number(x.points) || 0), 0), 2);
      const { error } = await supabaseAdmin.from("fantasy_app_pool_lineups").update({ players: r.players, salary, proj }).eq("id", pl.id);
      if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
      total += r.changes.length;
    }
  }
  return { sport, cambios: total, alineacionesDeClientes: clientes };
}

// Aviso rojo: cambios sin confirmar de hoy
async function actionChanges(req, user) {
  const day = chicagoDay();
  const since = new Date(Date.parse(`${day}T00:00:00-06:00`)).toISOString();
  const rows = await selectAll("fantasy_app_lineup_changes", "*",
    q => q.eq("user_id", user.userId).is("uploaded_at", null).gte("changed_at", since).order("changed_at", { ascending: true }));
  return { status: 200, body: { ok: true, pendientes: rows.length, cambios: rows } };
}

// "I uploaded it": marca los cambios como subidos
async function actionChangesAck(req, user) {
  const { error } = await supabaseAdmin.from("fantasy_app_lineup_changes")
    .update({ uploaded_at: new Date().toISOString() }).eq("user_id", user.userId).is("uploaded_at", null);
  if (error) throw new Error(`Supabase fantasy_app_lineup_changes: ${error.message}`);
  return { status: 200, body: { ok: true } };
}


// ============================================================
// PAGINA FANTASY: acceso, guardar, armar con bloqueos
// ============================================================

// ¿Mostrar el boton Fantasy Sports? (sin error si no hay sesion)
async function actionAccess(req) {
  const r = await requirePremium(req);
  return { status: 200, body: { ok: true, visible: r.ok, reason: r.ok ? null : r.error, owner: !!r.isOwner } };
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); } }
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const PAGE_RULES = {
  nba: {
    draftkings: { cap: 50000, slots: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"], eligible: { PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"], G: ["PG", "SG"], F: ["SF", "PF"], UTIL: ["PG", "SG", "SF", "PF", "C"] } },
    fanduel: { cap: 60000, slots: ["PG", "PG", "SG", "SG", "SF", "SF", "PF", "PF", "C"], eligible: { PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"] } }
  },
  nfl: {
    draftkings: { cap: 50000, slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"], eligible: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], DST: ["DST"] } },
    fanduel: { cap: 60000, slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DEF"], eligible: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], DEF: ["DST"] } }
  }
};

// Datos completos de cada jugador del slate (ficha + ID DraftKings + id del pool)
// 5-nov: sirve para cualquier slate (DraftKings directo con src "dk",
// o nuestras listas). La lista de 1000 (pool) solo si es ese mismo slate.
async function playerIndex(sport, platform, slateId, src = null) {
  const dkSlate = src === "dk" ? await getDkSlate(slateId) : null;
  const ourSlate = dkSlate ? null : await getSlate(sport, slateId);
  const day = dkSlate?.slate_date || ourSlate?.slate_date || chicagoDay();
  const startsAt = dkSlate?.starts_at || ourSlate?.starts_at || null;
  const cards = await selectAll(CARDS, "player_key,player_name,team,opp,positions,salary,proj,status",
    q => q.eq("sport", sport).eq("slate_id", slateId));
  const spAny = await latestSlatePool(sport, platform, day);
  const sp = spAny && Number(spAny.slate_key) === Number(slateId) ? spAny : null;
  const poolByKey = new Map((sp?.players || []).map(p => [str(p.key || p.id), p]));
  const dkGroup = dkSlate ? Number(slateId) : platform === "draftkings" ? Number(spAny?.slate_key) || -1 : null;
  const dkRows = dkGroup
    ? await selectAll("fantasy_app_dk_players", "player_key,dk_id,draft_group_id,slot", q => q.eq("draft_group_id", dkGroup))
    : [];
  const dkByKey = new Map(dkRows.filter(r => r.player_key && !r.slot).map(r => [r.player_key, Number(r.dk_id)]));
  const map = new Map();
  for (const c of cards) {
    const pool = poolByKey.get(c.player_key);
    map.set(c.player_key, {
      id: pool ? String(pool.id) : c.player_key, key: c.player_key, name: c.player_name, team: c.team, opp: c.opp,
      positions: c.positions || [], salary: Number(c.salary), points: Number(pool?.points ?? c.proj ?? 0),
      dkId: pool?.dkId ?? dkByKey.get(c.player_key) ?? null, status: c.status,
      gameId: pool?.gameId ?? [c.team, c.opp || "?"].sort().join("@")
    });
  }
  return { map, sp, slateKey: Number(slateId), day, startsAt };
}

// Guardar (nueva) o actualizar (con lineup_id) una alineacion armada por el cliente
async function actionSave(req, user) {
  const b = await readBody(req);
  const sport = parseSport(b.sport), platform = parseSite(b.site), slateId = num(b.slate_id);
  const rule = PAGE_RULES[sport]?.[platform];
  if (!rule || !slateId || !Array.isArray(b.players)) return { status: 400, body: { ok: false, error: "BAD_PARAMS" } };
  if (b.players.length !== rule.slots.length) return { status: 400, body: { ok: false, error: "LINEUP_INCOMPLETE" } };
  const idx = await playerIndex(sport, platform, slateId, str(b.src) || null);
  const day = idx.day;
  if (idx.startsAt && Date.parse(idx.startsAt) <= Date.now()) return { status: 409, body: { ok: false, error: "SLATE_STARTED" } };
  const players = [];
  for (let i = 0; i < rule.slots.length; i++) {
    const slot = rule.slots[i];
    const want = b.players[i] || {};
    const p = idx.map.get(str(want.key || want.id));
    if (!p) return { status: 400, body: { ok: false, error: "UNKNOWN_PLAYER", player: want.key || want.id } };
    if (!(p.positions || []).some(x => rule.eligible[slot].includes(String(x).toUpperCase()))) return { status: 400, body: { ok: false, error: "WRONG_POSITION", player: p.name, slot } };
    if (/^(out|o)$/i.test(str(p.status))) return { status: 400, body: { ok: false, error: "PLAYER_OUT", player: p.name } };
    players.push({ slot, id: p.id, key: p.key, dkId: p.dkId, name: p.name, team: p.team, positions: p.positions, salary: p.salary, points: round(p.points, 2) });
  }
  if (new Set(players.map(p => p.key)).size !== players.length) return { status: 400, body: { ok: false, error: "DUPLICATE_PLAYER" } };
  const salary = players.reduce((s, p) => s + p.salary, 0);
  if (salary > rule.cap) return { status: 400, body: { ok: false, error: "OVER_CAP", salary } };
  const proj = round(players.reduce((s, p) => s + p.points, 0), 2);
  const row = { players, salary, proj, updated_at: new Date().toISOString() };
  if (b.lineup_id) {
    const { data, error } = await supabaseAdmin.from("fantasy_app_user_lineups")
      .update({ ...row, edited: true }).eq("id", Number(b.lineup_id)).eq("user_id", user.userId).select("*");
    if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
    if (!data?.length) return { status: 404, body: { ok: false, error: "LINEUP_NOT_FOUND" } };
    return { status: 200, body: { ok: true, lineup: data[0] } };
  }
  const { data, error } = await supabaseAdmin.from("fantasy_app_user_lineups").insert({
    user_id: user.userId, sport, platform, slate_key: idx.slateKey, game_type: "classic", slate_date: day, source: "built", ...row
  }).select("*");
  if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
  return { status: 200, body: { ok: true, lineup: data[0] } };
}

// Armar N con sus bloqueados y excluidos (maximo 10 pedidos cada 5 minutos)
async function actionBuild(req, user) {
  const b = await readBody(req);
  const sport = parseSport(b.sport), platform = parseSite(b.site), slateId = num(b.slate_id);
  const count = Math.max(1, Math.min(50, Number(b.count) || 10));
  if (!PAGE_RULES[sport]?.[platform] || !slateId) return { status: 400, body: { ok: false, error: "BAD_PARAMS" } };
  const since = new Date(Date.now() - 5 * 60000).toISOString();
  const recent = await selectAll("fantasy_app_user_lineups", "id,created_at",
    q => q.eq("user_id", user.userId).eq("source", "locks").gte("created_at", since));
  const batches = new Set(recent.map(r => String(r.created_at).slice(0, 19))).size;
  if (batches >= 10 && !b._fromPick) return { status: 429, body: { ok: false, error: "TOO_MANY_BUILDS", message: "Max 10 builds every 5 minutes." } };

  const idx = await playerIndex(sport, platform, slateId, str(b.src) || null);
  const day = idx.day;
  if (idx.startsAt && Date.parse(idx.startsAt) <= Date.now()) return { status: 409, body: { ok: false, error: "SLATE_STARTED" } };
  const locks = new Set((b.locks || []).map(String)), bans = new Set((b.bans || []).map(String));
  // Base: la lista de la formula (las reglas) + los bloqueados aunque no esten en ella.
  // 5-nov: otros slates (sin lista de la formula): los jugadores con proyeccion,
  // sin OUT ni en duda.
  const fromCards = () => [...idx.map.values()]
    .filter(p => p.points > 0 && !/^(out|o|q|gtd|d|questionable|doubtful)/i.test(str(p.status)));
  const base = (idx.sp ? idx.sp.players : fromCards()).filter(p => !bans.has(str(p.key || p.id)));
  if (base.length < 12) return { status: 409, body: { ok: false, error: "NO_PROJECTIONS", message: "Projections for this slate aren't ready yet. Try again later." } };
  for (const k of locks) if (!base.some(p => str(p.key || p.id) === k) && idx.map.get(k)) base.push({ ...idx.map.get(k) });
  const BONUS = 1000;   // obliga a los bloqueados
  const players = base.map(p => (locks.has(str(p.key || p.id)) ? { ...p, points: Number(p.points) + BONUS, _locked: true } : p));
  // 5-nov: mismas reglas de variedad; los bloqueados no cuentan para parejas
  const tier = poolTier({ players: base });
  const opts = { count, minDifferent: tier.minDifferent, maxExposure: 1, maxPairShare: tier.maxPairShare, pairExempt: players.filter(p => p._locked).map(p => p.id) };
  const r = sport === "nfl"
    ? nflLib().buildLineups(platform, players, opts)
    : lineupsLib().buildLineups(platform, players, { ...opts, nodeLimit: POOL.nodeLimit, timeLimitMs: 40000, noStarterBackup: true });
  const byId = new Map(players.map(p => [String(p.id), p]));
  const hasLocks = l => [...locks].every(k => l.players.some(p => str(byId.get(String(p.id))?.key || p.id) === k));
  const lines = r.lineups.filter(hasLocks);
  // 5-nov: nunca quedarse corto. Si con las reglas de variedad no salen
  // todas, las que faltan se arman con reglas sueltas (1 distinto, sin tope de parejas).
  if (lines.length < count) {
    const prior = lines.map(l => l.players.map(p => String(p.id)));
    const loose = { count: count - lines.length, minDifferent: 1, maxExposure: 1, maxPairShare: 1, prior };
    const r2 = sport === "nfl"
      ? nflLib().buildLineups(platform, players, loose)
      : lineupsLib().buildLineups(platform, players, { ...loose, nodeLimit: POOL.nodeLimit, timeLimitMs: 20000 });
    lines.push(...r2.lineups.filter(hasLocks));
  }
  if (!lines.length) return { status: 409, body: { ok: false, error: "LOCKS_DO_NOT_FIT", message: "Your locked players don't fit together under the cap." } };
  const now = new Date().toISOString();
  const rows = lines.map(l => {
    const ps = l.players.map(p => {
      const src = byId.get(String(p.id)) || {};
      const pts = Number(p.points) - (src._locked ? BONUS : 0);
      return { slot: p.slot, id: String(p.id), key: src.key ?? String(p.id), dkId: src.dkId ?? idx.map.get(str(src.key || p.id))?.dkId ?? null, name: p.name, team: p.team, positions: src.positions || [], salary: p.salary, points: round(pts, 2) };
    });
    return { user_id: user.userId, sport, platform, slate_key: idx.slateKey, game_type: "classic", slate_date: day, source: "locks",
      players: ps, salary: ps.reduce((s, x) => s + x.salary, 0), proj: round(ps.reduce((s, x) => s + x.points, 0), 2), created_at: now, updated_at: now };
  });
  const { data, error } = await supabaseAdmin.from("fantasy_app_user_lineups").insert(rows).select("*");
  if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
  return { status: 200, body: { ok: true, built: data.length, lineups: data } };
}

// 5-nov: borrar una (lineup_id), todas las de un slate (slate_key + sport + site),
// o tus reservadas de un slate (reserved: true). No se pueden recuperar.
// Tus reservadas quedan "dropped": no se reparten y no se te vuelven a reservar.
async function actionDelete(req, user) {
  const b = await readBody(req);
  if (b.reserved) {
    if (!user.isOwner) return { status: 403, body: { ok: false, error: "OWNER_ONLY" } };
    let q = supabaseAdmin.from("fantasy_app_pool_lineups").update({ status: "dropped" })
      .eq("user_id", user.userId).eq("status", "owner");
    q = b.lineup_id ? q.eq("id", Number(b.lineup_id)) : q.eq("slate_key", Number(b.slate_key));
    const { data, error } = await q.select("id");
    if (error) throw new Error(`Supabase fantasy_app_pool_lineups: ${error.message}`);
    return { status: 200, body: { ok: true, deleted: data?.length || 0 } };
  }
  // No se borra de verdad: se esconde (deleted_at) y queda para medir resultados
  let q = supabaseAdmin.from("fantasy_app_user_lineups").update({ deleted_at: new Date().toISOString() })
    .eq("user_id", user.userId).is("deleted_at", null);
  if (b.lineup_id) q = q.eq("id", Number(b.lineup_id));
  else {
    const sport = parseSport(b.sport), platform = parseSite(b.site), slateKey = num(b.slate_key);
    if (!sport || !platform || !slateKey) return { status: 400, body: { ok: false, error: "BAD_PARAMS" } };
    q = q.eq("sport", sport).eq("platform", platform).eq("slate_key", slateKey);
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(`Supabase fantasy_app_user_lineups: ${error.message}`);
  return { status: 200, body: { ok: true, deleted: data?.length || 0 } };
}


// ============================================================
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {
  try {
    const action = str(req.query.action).toLowerCase();
    if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }

    if (action === "access") {
      const r = await actionAccess(req);
      return send(res, r.status, r.body);
    }

    if (["save", "build", "delete", "pick"].includes(action)) {
      const user = await resolveUser(req);
      if (!user.ok) return send(res, user.status, { ok: false, error: user.error });
      const r = action === "save" ? await actionSave(req, user) : action === "build" ? await actionBuild(req, user)
        : action === "pick" ? await actionPick(req, user) : await actionDelete(req, user);
      return send(res, r.status, r.body);
    }

    if (action === "evaluate") {
      if (!checkSecret(req)) return send(res, 401, { ok: false, error: "BAD_SECRET" });
      const r = await actionEvaluate(req);
      return send(res, r.status, r.body);
    }
    if (action === "pool-slates") {
      if (!checkSecret(req)) return send(res, 401, { ok: false, error: "BAD_SECRET" });
      const r = await actionPoolSlates();
      return send(res, r.status, r.body);
    }
    if (action === "pool-cron") {
      if (!checkSecret(req)) return send(res, 401, { ok: false, error: "BAD_SECRET" });
      const r = await actionPoolCron(req);
      return send(res, r.status, r.body);
    }

    if (["ready", "mine", "csv-mine", "changes", "changes-ack"].includes(action)) {
      const user = await resolveUser(req);
      if (!user.ok) return send(res, user.status, { ok: false, error: user.error });
      if (action === "csv-mine") return await actionCsvMine(req, res, user);
      const r = action === "ready" ? await actionReady(req, user)
        : action === "mine" ? await actionMine(req, user)
          : action === "changes" ? await actionChanges(req, user)
            : await actionChangesAck(req, user);
      return send(res, r.status, r.body);
    }

    if (action === "csv-official") {
      // Por ahora solo tu (secret o tu sesion). Los clientes van con su pool.
      if (!checkSecret(req)) {
        const auth = await requirePremium(req);
        if (!auth.ok || !auth.isOwner) return send(res, 401, { ok: false, error: "OWNER_ONLY" });
      }
      return await actionCsvOfficial(req, res);
    }

    if (action === "sync-dk") {
      if (!checkSecret(req)) return send(res, 401, { ok: false, error: "BAD_SECRET" });
      const r = await actionSyncDk(req);
      return send(res, r.status, r.body);
    }

    if (action === "build-cards") {
      if (!checkSecret(req)) return send(res, 401, { ok: false, error: "BAD_SECRET" });
      const r = await actionBuildCards(req);
      return send(res, r.status, r.body);
    }

    if (action === "slates" || action === "players") {
      const auth = await requirePremium(req);
      if (!auth.ok) return send(res, auth.status, { ok: false, error: auth.error });
      const r = action === "slates" ? await actionSlates(req) : await actionPlayers(req);
      return send(res, r.status, r.body);
    }

    return send(res, 400, { ok: false, error: "UNKNOWN_ACTION", actions: ["slates", "players", "build-cards", "sync-dk", "csv-official", "pool-cron", "ready", "mine", "csv-mine", "changes", "changes-ack", "access", "save", "build", "delete", "pick", "pool-slates", "evaluate"] });
  } catch (e) {
    console.error("fantasy-app", e);
    return send(res, 500, { ok: false, error: "SERVER_ERROR", detail: e.message });
  }
};

module.exports.config = { maxDuration: 60 };

// Para pruebas locales
module.exports._test = { computeTags, nbaScore, nbaSeason, nflSeason, parseCsv, dkGameTime, normName, poolBatch, starGroups, swapLineup };

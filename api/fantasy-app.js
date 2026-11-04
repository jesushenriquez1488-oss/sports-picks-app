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

function send(res, status, body) {
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

async function listSlates(sport, platform, day) {
  const table = sport === "nfl" ? "fantasy_nfl_slates" : "fantasy_nba_slates";
  const rows = await selectAll(table, "*", q => q.eq("slate_date", day).eq("platform", platform).order("starts_at", { ascending: true }));
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

async function buildNbaCards(slate, version) {
  const slateId = Number(slate.slate_id);
  const platform = slate.platform;
  const day = slate.slate_date;
  const cur = nbaSeason(day), prev = cur - 1;

  const [players, projections] = await Promise.all([
    selectAll("fantasy_nba_slate_players", "*", q => q.eq("slate_id", slateId)),
    selectAll("fantasy_nba_projections", "player_id,opp_team_id,minutes,proj_mean,proj_p90", q => q.eq("slate_id", slateId))
  ]);
  if (!players.length) return [];
  const projById = new Map(projections.map(p => [Number(p.player_id), p]));
  const ids = players.map(p => Number(p.player_id)).filter(Boolean);

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
      opp: pj?.opp_team_id ? (NBA_TEAMS[Number(pj.opp_team_id)] || null) : null,
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
      photo_url: null,
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
    .from("fantasy_nfl_runs").select("run_id,run_at,run_date")
    .lte("run_date", day).order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Supabase fantasy_nfl_runs: ${error.message}`);
  return data;
}

async function nflSourceVersion(day) {
  const run = await nflLatestRun(day);
  return run ? `nfl:${run.run_id}` : "nfl:none";
}

async function buildNflCards(slate, version) {
  const slateId = Number(slate.slate_id);
  const platform = slate.platform;
  const day = slate.slate_date;
  const cur = nflSeason(day), prev = cur - 1;
  const pkey = platform === "fanduel" ? "fd" : "dk";
  const runId = version.startsWith("nfl:") && version !== "nfl:none" ? Number(version.slice(4)) : null;

  const players = await selectAll("fantasy_nfl_slate_players", "*", q => q.eq("slate_id", slateId));
  if (!players.length) return [];

  const keyOf = sp => (sp.entity_type === "team" ? `DST:${nflTeam(sp.team)}` : str(sp.gsis_player_id) || `SLATE:${sp.entity_key}`);
  const gsisList = players.filter(sp => sp.entity_type !== "team" && sp.gsis_player_id).map(sp => String(sp.gsis_player_id));
  const teams = [...new Set(players.map(sp => nflTeam(sp.team)))];

  const [projections, weekStats, snaps, teamStats, roster] = await Promise.all([
    runId ? selectAll("fantasy_nfl_projections", "entity_key,opponent,position,snap_pct,dk_points,dk_p90,fd_points,fd_p90", q => q.eq("run_id", runId)) : [],
    gsisList.length ? selectIn("football_player_week_stats", "*", "gsis_player_id", gsisList, q => q.in("season", [cur, prev])) : [],
    gsisList.length ? selectIn("football_player_game_stats", "gsis_player_id,game_date,offense_pct", "gsis_player_id", gsisList, q => q.eq("sport", "nfl").in("season", [cur, prev])) : [],
    selectAll("football_team_week_stats", "*", q => q.in("season", [cur, prev])),
    gsisList.length ? selectIn("football_players", "gsis_player_id,espn_athlete_id", "gsis_player_id", gsisList) : []
  ]);

  const projByKey = new Map(projections.map(p => [str(p.entity_key), p]));
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
    const proj = num(pj?.[`${pkey}_points`]);
    const salary = num(sp.salary);
    const espnId = isDst ? "" : espnByGsis.get(str(sp.gsis_player_id));

    cards.push({
      sport: "nfl", platform, slate_id: slateId, slate_date: day,
      player_key: key,
      player_name: isDst ? (sp.player_name || `${team} DST`) : sp.player_name,
      team,
      opp: pj?.opponent ? nflTeam(pj.opponent) : null,
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
        : espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : null,
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
  return { status: 200, body: { ok: true, sport, site, date: day, slates: await listSlates(sport, site, day) } };
}

async function actionPlayers(req) {
  const sport = parseSport(req.query.sport);
  const slateId = num(req.query.slate_id);
  if (!sport || !slateId) return { status: 400, body: { ok: false, error: "BAD_PARAMS", need: "sport=nba|nfl & slate_id" } };
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
    .replace(/[.'’\-]/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Indice nombre+equipo -> nuestra llave (NBA: player_id BDL | NFL: gsis / DST:TEAM)
async function dkMatchIndex(sport, day) {
  const from = new Date(Date.parse(`${day}T12:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
  const byNameTeam = new Map(), byName = new Map();
  const add = (name, team, key) => {
    const n = normName(name);
    if (!n || !key) return;
    byNameTeam.set(`${n}|${team}`, key);
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(key);
  };
  if (sport === "nba") {
    const rows = await selectAll("fantasy_nba_slate_players", "player_id,player_name,team_abbr,slate_date",
      q => q.gte("slate_date", from).lte("slate_date", day));
    for (const r of rows) add(r.player_name, str(r.team_abbr).toUpperCase(), String(r.player_id));
  } else {
    const rows = await selectAll("fantasy_nfl_slate_players", "entity_type,gsis_player_id,player_name,team,slate_date",
      q => q.gte("slate_date", from).lte("slate_date", day));
    for (const r of rows) {
      const team = nflTeam(r.team);
      if (r.entity_type === "team") byNameTeam.set(`DST|${team}`, `DST:${team}`);
      else if (r.gsis_player_id) add(r.player_name, team, String(r.gsis_player_id));
    }
  }
  return (name, team, isDst) => {
    if (isDst) return byNameTeam.get(`DST|${team}`) || `DST:${team}`;
    const n = normName(name);
    const exact = byNameTeam.get(`${n}|${team}`);
    if (exact) return exact;
    const any = byName.get(n);
    return any && any.size === 1 ? [...any][0] : null;   // mismo nombre, cambio de equipo
  };
}

async function syncDkSport(sport, day, nowIso) {
  const lobby = await dkFetch(DK_LOBBY + sport.toUpperCase());
  const groups = new Map();
  for (const c of lobby?.Contests || []) {
    const type = DK_GAME_TYPES[str(c.gameType).toLowerCase()];
    if (!type || !c.dg) continue;
    const ms = Number(str(c.sd).replace(/\D/g, "")) || null;
    if (!ms || chicagoDay(new Date(ms)) !== day) continue;
    if (!groups.has(c.dg)) groups.set(c.dg, { dg: Number(c.dg), type, typeId: Number(c.gameTypeId), startsAt: new Date(ms).toISOString(), contests: 0 });
    groups.get(c.dg).contests++;
  }

  const match = await dkMatchIndex(sport, day);
  const out = [];
  for (const g of groups.values()) {
    try {
      const csv = await dkFetch(`${DK_CSV}?contestTypeId=${g.typeId}&draftGroupId=${g.dg}`, true);
      const rows = parseCsv(csv).filter(r => r.ID && r.Name);
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
          slate_date: day,
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
        draft_group_id: g.dg, sport, slate_date: day, game_type: g.type, game_type_id: g.typeId,
        starts_at: times.length ? new Date(Math.min(...times)).toISOString() : g.startsAt,
        last_starts_at: times.length ? new Date(Math.max(...times)).toISOString() : g.startsAt,
        games: games.size, game_list: [...games.keys()], contests: g.contests,
        players: players.length, unmatched: players.filter(p => !p.player_key).length,
        checked_at: nowIso
      }], "draft_group_id");
      if (players.length) {
        await upsertAll("fantasy_app_dk_players", players, "draft_group_id,dk_id");
        const { error } = await supabaseAdmin.from("fantasy_app_dk_players").delete()
          .eq("draft_group_id", g.dg).lt("checked_at", nowIso);
        if (error) throw new Error(`Supabase fantasy_app_dk_players: ${error.message}`);
      }
      out.push({
        draft_group_id: g.dg, type: g.type, games: games.size, players: players.length,
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
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {
  try {
    const action = str(req.query.action).toLowerCase();

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

    return send(res, 400, { ok: false, error: "UNKNOWN_ACTION", actions: ["slates", "players", "build-cards", "sync-dk"] });
  } catch (e) {
    console.error("fantasy-app", e);
    return send(res, 500, { ok: false, error: "SERVER_ERROR", detail: e.message });
  }
};

module.exports.config = { maxDuration: 60 };

// Para pruebas locales
module.exports._test = { computeTags, nbaScore, nbaSeason, nflSeason, parseCsv, dkGameTime, normName };

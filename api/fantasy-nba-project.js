// ============================================================
// CASHEDGE FANTASY NBA — LA FORMULA (FASE 2)
// ============================================================
//
// Lee SOLO Supabase. Cero APIs externas.
// Guarda el resultado en Supabase. No publica nada.
//
// USO (navegador)
//   /api/fantasy-nba-project?secret=...              -> proyecta hoy (JSON)
//   /api/fantasy-nba-project?secret=...&view=1       -> lo mismo en tablas faciles de leer
//   /api/fantasy-nba-project?secret=...&mode=evaluate&date=YYYY-MM-DD&view=1
//                                                    -> compara una fecha contra lo real
//
// La tarea diaria (fantasy-nba-daily) la corre sola.
//
// ------------------------------------------------------------
// LA FORMULA, EN ORDEN
// ------------------------------------------------------------
//
// 1. ROL (depth chart ESPN de hoy)
//    Se quitan los OUT. El primero de cada posicion es TITULAR.
//    Solo pueden entrar a alineaciones los 2 primeros de su
//    posicion (contados despues de quitar a los OUT).
//
// 2. MINUTOS
//    a) Esta temporada en ese rol con ese equipo: con 2 partidos
//       pesa 50%, con 4 pesa 67%, con 8 pesa 80%.
//    b) Temporada pasada en ese rol con ese equipo.
//    c) Estilo del equipo: minutos que da a sus titulares y a
//       cada puesto de la banca (6to, 7mo...).
//    d) Si cambia de rol (suplente -> titular) se usa cuanto
//       cambian los minutos en la NBA cuando pasa eso, medido
//       con los 12,000+ partidos de la temporada pasada.
//    e) Partidos decididos por 20+ puntos no deforman sus minutos.
//    f) Companeros OUT: cuanto cambio el, en ese rol, cuando
//       faltaron (sin contar dos veces lo que ya esta en su
//       promedio).
//    g) El equipo debe sumar 241 minutos (240 + tiempo extra).
//
// 3. PRODUCCION SEGUN SU FUNCION
//    Por minuto, en ese rol: puntos, triples, rebotes,
//    asistencias, robos, tapones, perdidas y JUGADAS QUE USA
//    (tiros + tiros libres + perdidas).
//    Tipo de jugador: CREADOR, TIRADOR, ATACA_EL_ARO o
//    REBOTEADOR, segun lo que mas lo distingue en la liga.
//    Las jugadas del equipo deben sumar lo normal de ese equipo:
//    si falta un jugador que usa muchas jugadas, esas jugadas
//    se reparten entre los que juegan.
//
// 4. DEFENSA RIVAL
//    Cuanto permite ESE rival a ESE tipo de jugador, stat por stat.
//    Y como rinde EL contra ese tipo de defensa.
//
// 5. PUNTOS FANTASY
//    10,000 simulaciones -> DraftKings (doble y triple doble)
//    y FanDuel.
//
// REGLAS: salario <= $3,500 fuera; lesionados o en duda fuera;
// fuera del top 2 de su posicion fuera; menos de 18 minutos fuera.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  // Reglas
  minSalary: 3501,
  maxDepthRank: 2,
  minProjectedMinutes: 18,
  minHistoryMinutes: 40,

  // Minutos
  teamMinutes: 241,
  currentPriorGames: 2,      // w = n / (n + 2)
  teamPriorGames: 3,
  currentDecay: 0.85,
  previousDecay: 0.95,
  previousGames: 30,
  otherTeamWeight: 0.5,
  profilePriorGames: 5,
  blowoutMargin: 20,
  injuryExitShare: 0.4,
  maxStarterMinutes: 40,
  maxBenchMinutes: 34,
  normalizeMin: 0.85,
  normalizeMax: 1.25,
  deepBenchRank: 3,
  appearanceGames: 10,

  // Companeros OUT
  importantMateMinutes: 18,
  mateMinWith: 3,
  mateMinWithout: 2,
  mateMinutesPrior: 4,
  mateRatePriorMinutes: 250,

  // Produccion
  rateMinMinutes: 8,
  rateGames: 80,
  rateDecay: 0.97,
  currentRateWeight: 1.5,
  leaguePriorMinutes: 150,
  rolePriorMinutes: 300,
  archetypeMinMinutes: 200,
  usageMin: 0.92,
  usageMax: 1.12,

  // Defensa
  defensePriorGames: 15,
  previousDefenseWeight: 0.5,
  defenseMin: 0.85,
  defenseMax: 1.15,
  softDefense: 1.03,
  hardDefense: 0.97,
  affinityPriorMinutes: 400,
  affinityMin: 0.93,
  affinityMax: 1.07,

  // Simulacion
  simulations: 10000,
  bootstrapMinGames: 8,
  minutesSdStarter: 5,
  minutesSdBench: 6,
  minutesSdMin: 3,
  minutesSdMax: 8
};

const STATS = ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov"];
const RATE_KEYS = [...STATS, "use"];
const POSITIONS = ["pg", "sg", "sf", "pf", "c"];
const ARCHETYPES = ["CREADOR", "REBOTEADOR", "TIRADOR", "ATACA_EL_ARO"];

// Estado de lesion: OUT (no juega) o DUDA.
function injuryClass(value) {
  const n = str(value).toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (!n) return "";
  if (n === "o" || n === "d" || /^(out|doubtful|inactive|suspen)/.test(n)) return "OUT";
  if (n === "q" || n === "gtd" || n === "dtd" || /^(questionable|day to day|game time)/.test(n)) return "DUDA";
  return "";
}

function getCurrentNBASeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

const CUR = getCurrentNBASeason();
const PREV = CUR - 1;


// ============================================================
// UTILIDADES
// ============================================================

const str = v => String(v ?? "").trim();
const ok = Number.isFinite;
const round = (x, d = 2) => (ok(x) ? Number(x.toFixed(d)) : null);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function std(a) {
  const m = mean(a);
  if (m === null || a.length < 2) return null;
  return Math.sqrt(mean(a.map(v => (v - m) ** 2)));
}

function dayIn(zone, value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
}

const chicagoDay = (v = new Date()) => dayIn("America/Chicago", v);
const nbaDay = v => dayIn("America/New_York", v);

function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weighted(rows, valueFn, weightFn) {
  let s = 0;
  let w = 0;
  rows.forEach((r, i) => {
    const wi = weightFn(r, i);
    s += valueFn(r) * wi;
    w += wi;
  });
  return { value: w > 0 ? s / w : null, weight: w };
}

function makeRandom(seedText) {
  let h = 2166136261;
  for (const c of String(seedText)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const a = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random());
}

function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = p => s[Math.floor((s.length - 1) * p)];
  return { mean: round(mean(s)), p10: round(at(0.1)), p50: round(at(0.5)), p90: round(at(0.9)) };
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function escapeHtml(v) {
  return str(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}


// ============================================================
// PUNTUACION OFICIAL
// ============================================================

function scoreDK(s) {
  const tens = [s.pts, s.reb, s.ast, s.stl, s.blk].filter(v => v >= 10).length;
  return s.pts + 0.5 * s.fg3m + 1.25 * s.reb + 1.5 * s.ast + 2 * s.stl + 2 * s.blk -
    0.5 * s.tov + (tens >= 2 ? 1.5 : 0) + (tens >= 3 ? 3 : 0);
}

function scoreFD(s) {
  return s.pts + 1.2 * s.reb + 1.5 * s.ast + 3 * s.stl + 3 * s.blk - s.tov;
}


// ============================================================
// SUPABASE
// ============================================================

async function selectAll(table, columns, build = q => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(supabaseAdmin.from(table).select(columns))
      .range(from, from + 999);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function upsertAll(table, rows, onConflict) {
  for (const part of chunks(rows, 500)) {
    const { error } = await supabaseAdmin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}


// ============================================================
// CARGA DE DATOS
// ============================================================

async function loadHistory(day) {
  const [games, raw] = await Promise.all([
    selectAll(
      "nba_games",
      "game_id,season,game_date,home_team_id,visitor_team_id,home_score,visitor_score",
      q => q
        .in("season", [CUR, PREV])
        .or("postseason.is.null,postseason.eq.false")
        .order("game_id", { ascending: true })
    ),
    selectAll(
      "nba_player_game_roles",
      "game_id,season,team_id,player_id,player_name,minutes,points,rebounds,assists," +
      "steals,blocks,turnovers,three_pointers_made,starter,fga,fta,fg3a,oreb,dreb",
      q => q
        .in("season", [CUR, PREV])
        .order("game_id", { ascending: true })
        .order("player_id", { ascending: true })
    )
  ]);

  // Solo partidos ANTES del dia que se proyecta.
  const gameMap = new Map();
  for (const g of games) {
    const date = nbaDay(g.game_date);
    if (!date || date >= day) continue;
    gameMap.set(Number(g.game_id), {
      id: Number(g.game_id),
      season: Number(g.season),
      date,
      home: Number(g.home_team_id),
      visitor: Number(g.visitor_team_id),
      homeScore: Number(g.home_score),
      visitorScore: Number(g.visitor_score)
    });
  }

  const byPlayer = new Map();
  const teamGames = new Map();
  const names = new Map();

  const teamGame = (team, g) => {
    if (!teamGames.has(team)) teamGames.set(team, new Map());
    const map = teamGames.get(team);
    if (!map.has(g.id)) {
      const isHome = g.home === team;
      const margin = isHome ? g.homeScore - g.visitorScore : g.visitorScore - g.homeScore;
      map.set(g.id, {
        id: g.id,
        season: g.season,
        date: g.date,
        opp: isHome ? g.visitor : g.home,
        margin,
        blowout: Math.abs(margin) >= CONFIG.blowoutMargin,
        rows: new Map()
      });
    }
    return map.get(g.id);
  };

  // Todos los partidos de cada equipo (aunque nadie tenga fila).
  for (const g of gameMap.values()) {
    teamGame(g.home, g);
    teamGame(g.visitor, g);
  }

  for (const r of raw) {
    const g = gameMap.get(Number(r.game_id));
    const min = Number(r.minutes);
    const team = Number(r.team_id);
    const id = Number(r.player_id);
    if (!g || !(min > 0) || (team !== g.home && team !== g.visitor)) continue;

    const tg = teamGame(team, g);
    const row = {
      gameId: g.id,
      season: g.season,
      date: g.date,
      team,
      opp: tg.opp,
      margin: tg.margin,
      blowout: tg.blowout,
      starter: r.starter === null || r.starter === undefined ? null : r.starter === true,
      min,
      pts: Number(r.points) || 0,
      fg3m: Number(r.three_pointers_made) || 0,
      reb: Number(r.rebounds) || 0,
      ast: Number(r.assists) || 0,
      stl: Number(r.steals) || 0,
      blk: Number(r.blocks) || 0,
      tov: Number(r.turnovers) || 0,
      fga: Number(r.fga) || 0,
      fta: Number(r.fta) || 0,
      fg3a: Number(r.fg3a) || 0,
      oreb: Number(r.oreb) || 0,
      dreb: Number(r.dreb) || 0
    };
    row.use = row.fga + 0.44 * row.fta + row.tov;

    tg.rows.set(id, row);
    if (!byPlayer.has(id)) byPlayer.set(id, []);
    byPlayer.get(id).push(row);
    names.set(id, str(r.player_name));
  }

  // Mas reciente primero.
  for (const list of byPlayer.values()) list.sort((a, b) => b.date.localeCompare(a.date) || b.gameId - a.gameId);
  const teams = new Map();
  for (const [team, map] of teamGames) {
    teams.set(team, [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id));
  }

  return { byPlayer, teamGames: teams, names, gamesCount: gameMap.size };
}

async function loadToday(day) {
  const { data: snaps, error } = await supabaseAdmin
    .from("nba_depth_chart")
    .select("snapshot_date")
    .lte("snapshot_date", day)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Supabase nba_depth_chart: ${error.message}`);
  const snapshotDate = snaps?.[0]?.snapshot_date || null;
  if (!snapshotDate) throw new Error("No hay depth chart guardado. Corre fantasy-nba-daily?step=depth");

  const [slates, slatePlayers, depth, injuries] = await Promise.all([
    selectAll("fantasy_nba_slates", "*", q => q.eq("slate_date", day)),
    selectAll("fantasy_nba_slate_players", "*", q => q.eq("slate_date", day)),
    selectAll("nba_depth_chart", "*", q => q.eq("snapshot_date", snapshotDate)),
    selectAll("nba_player_injuries_current", "player_id,status")
  ]);

  return {
    snapshotDate,
    slates,
    slatePlayers,
    depth,
    injuries: new Map(injuries.map(i => [Number(i.player_id), str(i.status)]))
  };
}


// ============================================================
// MODELOS DE LA LIGA (todo medido con tus datos)
// ============================================================

// Estilo de rotacion de cada equipo.
function buildProfiles(teamGames) {
  const leagueAll = { S: Array(5).fill(0), B: Array(10).fill(0), n: 0 };
  const leagueNormal = { S: Array(5).fill(0), B: Array(10).fill(0), n: 0 };
  const profiles = new Map();
  const usage = new Map();

  const add = (acc, g) => {
    const played = [...g.rows.values()];
    const S = played.filter(r => r.starter === true).map(r => r.min).sort((a, b) => b - a);
    if (S.length !== 5) return false;
    const B = played.filter(r => r.starter === false).map(r => r.min).sort((a, b) => b - a);
    while (B.length < 10) B.push(0);
    S.forEach((m, i) => (acc.S[i] += m));
    B.slice(0, 10).forEach((m, i) => (acc.B[i] += m));
    acc.n++;
    return true;
  };

  const avg = acc => ({ S: acc.S.map(x => x / acc.n), B: acc.B.map(x => x / acc.n) });

  for (const [team, games] of teamGames) {
    const cur = { S: Array(5).fill(0), B: Array(10).fill(0), n: 0 };
    const prev = { S: Array(5).fill(0), B: Array(10).fill(0), n: 0 };
    const useCur = [];
    const usePrev = [];

    for (const g of games) {
      add(leagueAll, g);
      if (!g.blowout) {
        add(leagueNormal, g);
        add(g.season === CUR ? cur : prev, g);
      }

      // Jugadas usadas por el equipo, llevadas a 240 minutos.
      const rows = [...g.rows.values()];
      const minutes = rows.reduce((s, r) => s + r.min, 0);
      if (minutes >= 200) {
        const u = rows.reduce((s, r) => s + r.use, 0) * 240 / minutes;
        (g.season === CUR ? useCur : usePrev).push(u);
      }
    }

    const wU = useCur.length / (useCur.length + CONFIG.profilePriorGames);
    const uC = mean(useCur);
    const uP = mean(usePrev);
    usage.set(team, uC !== null && uP !== null ? wU * uC + (1 - wU) * uP : uC ?? uP);

    let S;
    let B;
    if (cur.n && prev.n) {
      const w = cur.n / (cur.n + CONFIG.profilePriorGames);
      const a = avg(cur);
      const b = avg(prev);
      S = a.S.map((x, i) => w * x + (1 - w) * b.S[i]);
      B = a.B.map((x, i) => w * x + (1 - w) * b.B[i]);
    } else if (cur.n || prev.n) {
      ({ S, B } = avg(cur.n ? cur : prev));
    } else {
      continue;
    }

    profiles.set(team, { S, B, gamesCur: cur.n, gamesPrev: prev.n });
  }

  if (!leagueNormal.n) throw new Error("No hay partidos con titulares para medir rotaciones");

  const ln = avg(leagueNormal);
  const la = avg(leagueAll);
  const league = { S: ln.S, B: ln.B, gamesCur: 0, gamesPrev: 0 };

  for (const p of [...profiles.values(), league]) {
    p.starterAvg = mean(p.S);
    p.label =
      p.starterAvg >= 32 ? "TITULARES CARGADOS" :
      p.starterAvg <= 29 ? "ROTA MUCHO" : "NORMAL";
  }

  // Cuanto bajan/suben los minutos por las palizas (medido).
  const blowout = {
    S: mean(la.S) / mean(ln.S),
    B: ln.B.map((x, i) => (x > 0.5 ? la.B[i] / x : 1))
  };

  return { profiles, league, blowout, usage };
}

// Cambio de minutos al pasar de suplente a titular (medido).
function buildRoleChange(byPlayer) {
  const up = [];
  for (const rows of byPlayer.values()) {
    const groups = new Map();
    for (const r of rows) {
      if (r.blowout || r.starter === null) continue;
      const key = `${r.team}:${r.season}`;
      if (!groups.has(key)) groups.set(key, { S: [], B: [] });
      groups.get(key)[r.starter ? "S" : "B"].push(r.min);
    }
    for (const g of groups.values()) {
      if (g.S.length >= 5 && g.B.length >= 5) up.push(mean(g.S) / mean(g.B));
    }
  }
  const ratio = median(up) || 1.35;
  return { up: ratio, down: 1 / ratio, samples: up.length };
}

// Tipo de jugador segun lo que mas lo distingue en la liga.
function buildArchetypes(byPlayer) {
  const features = new Map();

  for (const [id, rows] of byPlayer) {
    const list = rows.filter(r => r.min >= CONFIG.rateMinMinutes);
    const min = list.reduce((s, r) => s + r.min, 0);
    if (min < CONFIG.minHistoryMinutes) continue;
    const sum = k => list.reduce((s, r) => s + r[k], 0);
    const fga = sum("fga");
    features.set(id, {
      min,
      CREADOR: sum("ast") * 36 / min,
      REBOTEADOR: (sum("oreb") + sum("dreb")) * 36 / min,
      TIRADOR: fga > 0 ? sum("fg3a") / fga : 0,
      ATACA_EL_ARO: fga > 0 ? sum("fta") / fga : 0
    });
  }

  const reference = [...features.values()].filter(f => f.min >= CONFIG.archetypeMinMinutes);
  const sorted = Object.fromEntries(ARCHETYPES.map(a => [a, reference.map(f => f[a]).sort((x, y) => x - y)]));

  const percentile = (a, v) => {
    const s = sorted[a];
    if (!s.length) return 0.5;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo / s.length;
  };

  const types = new Map();
  for (const [id, f] of features) {
    let best = ARCHETYPES[0];
    let bestP = -1;
    for (const a of ARCHETYPES) {
      const p = percentile(a, f[a]);
      if (p > bestP) {
        bestP = p;
        best = a;
      }
    }
    types.set(id, best);
  }
  return types;
}

// Promedio de la liga por minuto: tipo de jugador x rol.
function buildLeagueRates(byPlayer, types) {
  const acc = {};
  for (const [id, rows] of byPlayer) {
    const type = types.get(id) || "ALL";
    for (const r of rows) {
      if (r.min < CONFIG.rateMinMinutes || r.starter === null) continue;
      for (const key of [`${type}:${r.starter ? "S" : "B"}`, `ALL:${r.starter ? "S" : "B"}`]) {
        if (!acc[key]) acc[key] = Object.fromEntries([...RATE_KEYS, "min"].map(k => [k, 0]));
        for (const k of RATE_KEYS) acc[key][k] += r[k];
        acc[key].min += r.min;
      }
    }
  }
  const rates = {};
  for (const [key, a] of Object.entries(acc)) {
    rates[key] = Object.fromEntries(RATE_KEYS.map(k => [k, a[k] / a.min]));
  }
  return rates;
}

// Lo que permite cada defensa a cada tipo de jugador.
function buildDefense(teamGames, types) {
  const zero = () => Object.fromEntries([...STATS, "dk", "min"].map(k => [k, 0]));
  const league = Object.fromEntries(ARCHETYPES.map(a => [a, zero()]));
  const raw = new Map();

  for (const [team, games] of teamGames) {
    const acc = { games: 0, ...Object.fromEntries(ARCHETYPES.map(a => [a, zero()])) };

    for (const g of games) {
      const w = g.season === CUR ? 1 : CONFIG.previousDefenseWeight;
      const opp = (teamGames.get(g.opp) || []).find(x => x.id === g.id);
      if (!opp || !opp.rows.size) continue;
      acc.games += w;

      for (const [id, r] of opp.rows) {
        const type = types.get(id);
        if (!type) continue;
        const dk = scoreDK(r);
        for (const k of STATS) {
          acc[type][k] += w * r[k];
          league[type][k] += r[k];
        }
        acc[type].dk += w * dk;
        acc[type].min += w * r.min;
        league[type].dk += dk;
        league[type].min += r.min;
      }
    }
    raw.set(team, acc);
  }

  const factors = new Map();
  for (const [team, acc] of raw) {
    const trust = acc.games / (acc.games + CONFIG.defensePriorGames);
    const out = {};
    for (const type of ARCHETYPES) {
      out[type] = {};
      for (const k of [...STATS, "dk"]) {
        const lr = league[type].min ? league[type][k] / league[type].min : 0;
        const tr = acc[type].min ? acc[type][k] / acc[type].min : lr;
        const f = lr > 0 ? tr / lr : 1;
        out[type][k] = clamp(1 + (f - 1) * trust, CONFIG.defenseMin, CONFIG.defenseMax);
      }
    }
    factors.set(team, out);
  }
  return factors;
}

const defenseTier = f => (f >= CONFIG.softDefense ? "BLANDA" : f <= CONFIG.hardDefense ? "DURA" : "NORMAL");


// ============================================================
// PASO 1 Y 2: ROL Y MINUTOS DE UN EQUIPO
// ============================================================

function statusOf(depthRow, ctx) {
  const id = Number(depthRow.nba_player_id);
  const all = [
    str(depthRow.injury_status),
    ctx.injuries.get(id) || "",
    ...(ctx.slateStatus.get(id) || [])
  ].filter(Boolean);
  const classes = all.map(injuryClass);
  if (classes.includes("OUT")) return "OUT";
  if (classes.includes("DUDA")) return "DUDA";
  return "";
}

function teamRows(id, team, ctx) {
  return (ctx.byPlayer.get(id) || []).filter(r => r.team === team);
}

function roleBaseline(id, team, role, order, profile, ctx) {
  const all = ctx.byPlayer.get(id) || [];
  const isRole = r => r.starter === (role === "S");
  const pool = all.filter(r => !r.blowout && r.starter !== null);

  let roleRows = pool.filter(isRole);

  // Titular que salio lesionado o expulsado: no representa su rol.
  if (role === "S") {
    const med = median(roleRows.filter(r => r.team === team).map(r => r.min)) ?? median(roleRows.map(r => r.min));
    if (med) roleRows = roleRows.filter(r => r.min >= CONFIG.injuryExitShare * med);
  }

  const cur = roleRows.filter(r => r.team === team && r.season === CUR);
  const prevSame = roleRows.filter(r => r.team === team && r.season === PREV).slice(0, CONFIG.previousGames);
  const prevOther = roleRows.filter(r => r.team !== team).slice(0, CONFIG.previousGames);

  const teamPrior = role === "S"
    ? profile.starterAvg
    : profile.B[Math.min(order, 9)] ?? 0.5;

  const curEst = weighted(cur, r => r.min, (r, i) => Math.pow(CONFIG.currentDecay, i));
  const prevEst = prevSame.length
    ? weighted(prevSame, r => r.min, (r, i) => Math.pow(CONFIG.previousDecay, i))
    : (() => {
        const e = weighted(prevOther, r => r.min, (r, i) => Math.pow(CONFIG.previousDecay, i));
        return { value: e.value, weight: e.weight * CONFIG.otherTeamWeight };
      })();

  let source = "historial en el rol";
  let prior = prevEst;

  // Nunca ha jugado este rol: se usa el cambio medido en la liga.
  if (!cur.length && prior.value === null) {
    const other = pool.filter(r => !isRole(r) && r.team === team).slice(0, CONFIG.previousGames);
    const otherEst = weighted(other, r => r.min, (r, i) => Math.pow(CONFIG.previousDecay, i));
    if (otherEst.value !== null) {
      const ratio = role === "S" ? ctx.roleChange.up : ctx.roleChange.down;
      const capped = role === "S" ? Math.min(otherEst.value * ratio, profile.S[0]) : otherEst.value * ratio;
      prior = { value: capped, weight: 2 };
      source = role === "S" ? "nuevo titular (cambio medido en la liga)" : "nuevo suplente (cambio medido en la liga)";
    } else {
      source = "sin historial: estilo del equipo";
    }
  }

  const prevBlend = prior.value === null
    ? teamPrior
    : (prior.weight * prior.value + CONFIG.teamPriorGames * teamPrior) / (prior.weight + CONFIG.teamPriorGames);

  const w = cur.length / (cur.length + CONFIG.currentPriorGames);
  const base = cur.length ? w * curEst.value + (1 - w) * prevBlend : prevBlend;

  // Variacion de minutos en ese rol.
  const sameTeam = roleRows.filter(r => r.team === team).slice(0, 20).map(r => r.min);
  const sdPrior = role === "S" ? CONFIG.minutesSdStarter : CONFIG.minutesSdBench;
  const s = std(sameTeam);
  const n = sameTeam.length;
  const sd = clamp(
    s === null ? sdPrior : Math.sqrt((n * s * s + 4 * sdPrior * sdPrior) / (n + 4)),
    CONFIG.minutesSdMin,
    CONFIG.minutesSdMax
  );

  return {
    base,
    teamPrior,
    current: curEst.value,
    currentGames: cur.length,
    currentWeight: w,
    previous: prior.value,
    previousGames: prevSame.length,
    source,
    roleRows,
    sd
  };
}

// Companeros OUT: con ellos vs sin ellos, en el mismo rol.
function mateEffect(id, team, role, mates, baseline, ctx) {
  const none = { minutes: 0, rates: {}, detail: null, alreadyIncluded: 0 };
  if (!mates.length) return none;

  const games = ctx.teamGames.get(team) || [];
  const firstDate = mates
    .map(m => {
      const rows = teamRows(m.id, team, ctx);
      return rows.length ? rows[rows.length - 1].date : null;
    })
    .filter(Boolean)
    .sort()
    .pop();

  if (!firstDate) return { ...none, detail: "Companeros OUT sin historial con el equipo" };

  const sample = games.filter(g => g.date >= firstDate && g.rows.has(id));
  const withAll = sample.filter(g => mates.every(m => g.rows.has(m.id)));
  const without = sample.filter(g => mates.some(m => !g.rows.has(m.id)));
  const mine = g => g.rows.get(id);
  const inRole = list => list.map(mine).filter(r => !r.blowout && r.starter === (role === "S"));

  // Parte del promedio que YA se jugo sin ellos (no contar doble).
  const missing = r => {
    const g = games.find(x => x.id === r.gameId);
    return g && g.date >= firstDate && mates.some(m => !g.rows.has(m.id));
  };
  const curRows = baseline.roleRows.filter(r => r.team === team && r.season === CUR);
  const prevRows = baseline.roleRows.filter(r => r.team === team && r.season === PREV);
  const share = list => (list.length ? list.filter(missing).length / list.length : 0);
  const already = baseline.currentWeight * share(curRows) + (1 - baseline.currentWeight) * share(prevRows);

  const out = { minutes: 0, rates: {}, detail: null, alreadyIncluded: already };
  const notes = [];

  const mW = inRole(withAll);
  const mWo = inRole(without);
  if (mW.length >= CONFIG.mateMinWith && mWo.length >= CONFIG.mateMinWithout) {
    const trust = mWo.length / (mWo.length + CONFIG.mateMinutesPrior);
    out.minutes = (mean(mWo.map(r => r.min)) - mean(mW.map(r => r.min))) * trust * (1 - already);
    notes.push(`minutos: con ${mW.length} / sin ${mWo.length}`);
  }

  const rW = withAll.map(mine).filter(r => r.min >= CONFIG.rateMinMinutes);
  const rWo = without.map(mine).filter(r => r.min >= CONFIG.rateMinMinutes);
  const minWo = rWo.reduce((s, r) => s + r.min, 0);
  if (rW.length >= CONFIG.mateMinWith && rWo.length >= CONFIG.mateMinWithout) {
    const trust = minWo / (minWo + CONFIG.mateRatePriorMinutes);
    const pooled = (list, k) => list.reduce((s, r) => s + r[k], 0) / list.reduce((s, r) => s + r.min, 0);
    // Solo stats que NO dependen de las jugadas usadas
    // (esas se ajustan con el reparto de jugadas del equipo).
    for (const k of ["reb", "ast", "stl", "blk"]) {
      out.rates[k] = (pooled(rWo, k) - pooled(rW, k)) * trust * (1 - already);
    }
    notes.push(`produccion: con ${rW.length} / sin ${rWo.length}`);
  }

  if (already > 0) notes.push(`${Math.round(already * 100)}% ya estaba en su promedio`);
  out.detail = notes.length ? notes.join(" | ") : "Muestra insuficiente";
  return out;
}

function projectTeam(team, ctx) {
  const depth = ctx.depthByTeam.get(team) || [];
  const profile = ctx.models.profiles.get(team) || ctx.models.league;

  const athletes = depth.map(d => ({
    key: d.nba_player_id ? String(d.nba_player_id) : `espn:${d.espn_player_id}`,
    id: d.nba_player_id ? Number(d.nba_player_id) : null,
    espnId: str(d.espn_player_id),
    name: str(d.player_name),
    ranks: Object.fromEntries(POSITIONS.map(p => [p, d[`${p}_rank`] ?? null])),
    status: statusOf(d, ctx)
  }));

  const available = athletes.filter(a => a.status !== "OUT");
  const out = athletes.filter(a => a.status === "OUT");

  // Lista de cada posicion sin los OUT (rango efectivo).
  const lists = {};
  for (const pos of POSITIONS) {
    lists[pos] = available
      .filter(a => a.ranks[pos] !== null)
      .sort((a, b) => a.ranks[pos] - b.ranks[pos])
      .map(a => a.key);
  }

  const effectiveRank = key => {
    let best = 99;
    for (const pos of POSITIONS) {
      const i = lists[pos].indexOf(key);
      if (i >= 0) best = Math.min(best, i + 1);
    }
    return best;
  };

  // PASO 1: titulares = primero disponible en cada posicion.
  const starters = [];
  const startPos = {};
  for (const pos of POSITIONS) {
    const key = lists[pos].find(k => !starters.includes(k));
    if (key) {
      starters.push(key);
      startPos[key] = pos.toUpperCase();
    }
  }

  const recent = a => {
    if (!a.id) return 0;
    const rows = teamRows(a.id, team, ctx).slice(0, 10);
    return rows.length ? mean(rows.map(r => r.min)) : 0;
  };

  const bench = available
    .filter(a => !starters.includes(a.key))
    .sort((a, b) => effectiveRank(a.key) - effectiveRank(b.key) || recent(b) - recent(a))
    .map(a => a.key);

  const importantOut = out
    .filter(a => a.id)
    .map(a => ({ id: a.id, name: a.name, minutes: recent(a) }))
    .filter(a => a.minutes >= CONFIG.importantMateMinutes);

  // PASO 2: minutos.
  const rows = [];
  const add = (key, role, order) => {
    const a = available.find(x => x.key === key);
    const effRank = effectiveRank(key);
    const factor = role === "S" ? ctx.models.blowout.S : ctx.models.blowout.B[Math.min(order, 9)];

    if (!a.id) {
      // Sin enlace a BALLDONTLIE: solo ocupa minutos del equipo.
      const teamPrior = role === "S" ? profile.starterAvg : profile.B[Math.min(order, 9)] ?? 0.5;
      rows.push({
        ...a, role, order, effRank, depthPosition: startPos[key] || null,
        teamPrior, base: teamPrior, raw: teamPrior * factor, injury: { minutes: 0, rates: {} },
        cap: role === "S" ? CONFIG.maxStarterMinutes : CONFIG.maxBenchMinutes,
        sd: role === "S" ? CONFIG.minutesSdStarter : CONFIG.minutesSdBench,
        baseline: null, appearance: 1, noHistory: true
      });
      return;
    }

    const baseline = roleBaseline(a.id, team, role, order, profile, ctx);
    const injury = mateEffect(a.id, team, role, importantOut, baseline, ctx);

    // Banca profunda: ¿de verdad entra a jugar?
    let appearance = 1;
    if (role === "B" && effRank >= CONFIG.deepBenchRank) {
      const first = teamRows(a.id, team, ctx).slice(-1)[0];
      const window = first
        ? (ctx.teamGames.get(team) || []).filter(g => g.date >= first.date).slice(0, CONFIG.appearanceGames)
        : [];
      if (window.length >= 3) appearance = window.filter(g => g.rows.has(a.id)).length / window.length;
    }

    const history = (ctx.byPlayer.get(a.id) || []).slice(0, 30).map(r => r.min);
    const cap = Math.min(44, Math.max(role === "S" ? CONFIG.maxStarterMinutes : CONFIG.maxBenchMinutes,
      (history.length ? Math.max(...history) : 0) + 2));

    rows.push({
      ...a, role, order, effRank, depthPosition: startPos[key] || null,
      teamPrior: baseline.teamPrior,
      base: baseline.base,
      raw: Math.max(0, baseline.base * factor * appearance + injury.minutes),
      blowoutFactor: factor,
      appearance,
      injury,
      cap,
      sd: baseline.sd,
      baseline
    });
  };

  starters.forEach((k, i) => add(k, "S", i));
  bench.forEach((k, i) => add(k, "B", i));

  // 241 minutos: reparto proporcional respetando maximos.
  const rawSum = rows.reduce((s, r) => s + r.raw, 0);
  const factor = clamp(rawSum > 0 ? CONFIG.teamMinutes / rawSum : 1, CONFIG.normalizeMin, CONFIG.normalizeMax);
  rows.forEach(r => (r.minutes = r.raw * factor));
  for (let k = 0; k < 10; k++) {
    const over = rows.filter(r => r.minutes > r.cap);
    if (!over.length) break;
    let excess = 0;
    over.forEach(r => {
      excess += r.minutes - r.cap;
      r.minutes = r.cap;
    });
    const free = rows.filter(r => r.minutes < r.cap);
    const freeSum = free.reduce((s, r) => s + r.minutes, 0);
    if (!freeSum) break;
    free.forEach(r => (r.minutes += excess * (r.minutes / freeSum)));
  }

  return {
    team,
    code: depth[0]?.team_abbr || String(team),
    profile,
    out: out.map(a => a.name),
    importantOut: importantOut.map(a => a.name),
    doubtful: available.filter(a => a.status === "DUDA").map(a => a.name),
    rawSum,
    factor,
    rows
  };
}


// ============================================================
// PASO 3, 4 Y 5: PRODUCCION, DEFENSA, SIMULACION
// ============================================================

function playerRates(row, ctx) {
  const rows = (ctx.byPlayer.get(row.id) || [])
    .filter(r => r.min >= CONFIG.rateMinMinutes)
    .slice(0, CONFIG.rateGames);
  const totalMinutes = rows.reduce((s, r) => s + r.min, 0);
  const type = ctx.models.types.get(row.id) || null;
  const league =
    ctx.models.leagueRates[`${type}:${row.role}`] ||
    ctx.models.leagueRates[`ALL:${row.role}`];

  const w = (r, i) => Math.pow(CONFIG.rateDecay, i) * (r.season === CUR ? CONFIG.currentRateWeight : 1);
  const roleRows = rows.filter(r => r.starter === (row.role === "S"));

  const rates = {};
  for (const k of RATE_KEYS) {
    let s = 0;
    let m = 0;
    rows.forEach((r, i) => {
      s += w(r, i) * r[k];
      m += w(r, i) * r.min;
    });
    const overall = (s + CONFIG.leaguePriorMinutes * league[k]) / (m + CONFIG.leaguePriorMinutes);

    let rs = 0;
    let rm = 0;
    roleRows.forEach((r, i) => {
      rs += w(r, i) * r[k];
      rm += w(r, i) * r.min;
    });
    const base = (rs + CONFIG.rolePriorMinutes * overall) / (rm + CONFIG.rolePriorMinutes);
    rates[k] = Math.max(0, base + (row.injury?.rates?.[k] || 0));
  }

  return { rates, rows, roleGames: roleRows.length, totalMinutes, type };
}

function projectFantasy(row, team, opp, usageFactor, ctx) {
  const pr = playerRates(row, ctx);
  if (pr.totalMinutes < CONFIG.minHistoryMinutes) return { excluded: "POCO_HISTORIAL" };

  const type = pr.type || "TIRADOR";
  const rates = { ...pr.rates };

  // Reparto de jugadas del equipo (lesiones de jugadores que usan mucho).
  rates.pts *= usageFactor;
  rates.fg3m *= usageFactor;
  rates.tov *= usageFactor;
  rates.ast *= 1 + (usageFactor - 1) / 2;

  // Defensa del rival contra ESTE tipo de jugador.
  const def = ctx.models.defense.get(opp)?.[type] || {};
  for (const k of STATS) rates[k] *= def[k] ?? 1;

  // Como rinde EL contra este tipo de defensa (comparado con lo esperado).
  const oppDk = def.dk ?? 1;
  const tier = defenseTier(oppDk);
  const games = pr.rows.filter(r => r.min >= 15);
  const dkMin = games.reduce((s, r) => s + scoreDK(r), 0) / Math.max(1, games.reduce((s, r) => s + r.min, 0));
  let actual = 0;
  let expected = 0;
  let minutes = 0;
  let count = 0;
  for (const r of games) {
    const f = ctx.models.defense.get(r.opp)?.[type]?.dk ?? 1;
    if (defenseTier(f) !== tier) continue;
    actual += scoreDK(r);
    expected += dkMin * r.min * f;
    minutes += r.min;
    count++;
  }
  const affinity = expected > 0
    ? clamp(1 + (actual / expected - 1) * minutes / (minutes + CONFIG.affinityPriorMinutes), CONFIG.affinityMin, CONFIG.affinityMax)
    : 1;
  for (const k of STATS) rates[k] *= affinity;

  // Simulacion.
  const m0 = row.minutes;
  let sample = pr.rows.filter(r => r.min >= Math.max(10, 0.5 * m0)).slice(0, 40);
  if (sample.length < CONFIG.bootstrapMinGames) sample = pr.rows.slice(0, 40);
  const bootstrap = sample.length >= CONFIG.bootstrapMinGames;

  const calibration = {};
  for (const k of STATS) {
    const m = bootstrap ? mean(sample.map(r => r[k] / r.min)) : 0;
    calibration[k] = m > 0 ? rates[k] / m : null;
  }

  const random = makeRandom(`${row.id}:${m0.toFixed(2)}`);
  const dk = [];
  const fd = [];
  let dd = 0;
  let td = 0;

  for (let i = 0; i < CONFIG.simulations; i++) {
    const m = clamp(m0 + normal(random) * row.sd, 0, row.cap + 4);
    const g = bootstrap ? sample[Math.floor(random() * sample.length)] : null;
    const s = {};
    for (const k of STATS) {
      let v;
      if (g && calibration[k] !== null) v = (g[k] / g.min) * calibration[k] * m;
      else {
        const mu = rates[k] * m;
        v = mu + Math.sqrt(Math.max(mu, 0)) * 1.15 * normal(random);
      }
      s[k] = Math.max(0, Math.round(v));
    }
    s.fg3m = Math.min(s.fg3m, Math.floor(s.pts / 3));
    const tens = [s.pts, s.reb, s.ast, s.stl, s.blk].filter(v => v >= 10).length;
    if (tens >= 2) dd++;
    if (tens >= 3) td++;
    dk.push(scoreDK(s));
    fd.push(scoreFD(s));
  }

  return {
    excluded: null,
    type,
    draftkings: summarize(dk),
    fanduel: summarize(fd),
    doubleDouble: round(dd / CONFIG.simulations),
    tripleDouble: round(td / CONFIG.simulations),
    stats: Object.fromEntries(STATS.map(k => [k, round(rates[k] * m0, 1)])),
    explain: {
      tipoDeJugador: type,
      jugadasPor36: round(pr.rates.use * 36, 1),
      porCada36Min: Object.fromEntries(STATS.map(k => [k, round(pr.rates[k] * 36, 1)])),
      partidosEnEseRol: pr.roleGames,
      repartoJugadasEquipo: round(usageFactor, 3),
      defensaRival: tier,
      defensaRivalFactor: round(oppDk, 3),
      afinidadContraEsaDefensa: round(affinity, 3),
      partidosContraEsaDefensa: count,
      simulacion: bootstrap ? `${sample.length} partidos reales` : "variacion estandar (pocos partidos)"
    }
  };
}


// ============================================================
// PROYECCION COMPLETA
// ============================================================

async function runProjection(day = chicagoDay()) {
  const runAt = new Date().toISOString();
  const t0 = Date.now();

  const [history, today] = await Promise.all([loadHistory(day), loadToday(day)]);
  if (!today.slates.length) {
    return { date: day, message: "No hay slate guardado para hoy. Corre fantasy-nba-daily?step=slate", platforms: [] };
  }

  const types = buildArchetypes(history.byPlayer);
  const models = {
    ...buildProfiles(history.teamGames),
    roleChange: buildRoleChange(history.byPlayer),
    types,
    leagueRates: buildLeagueRates(history.byPlayer, types),
    defense: buildDefense(history.teamGames, types)
  };

  const slateStatus = new Map();
  for (const p of today.slatePlayers) {
    const id = Number(p.player_id);
    if (!slateStatus.has(id)) slateStatus.set(id, []);
    if (p.status) slateStatus.get(id).push(str(p.status));
  }

  const depthByTeam = new Map();
  for (const d of today.depth) {
    const t = Number(d.team_id);
    if (!ok(t)) continue;
    if (!depthByTeam.has(t)) depthByTeam.set(t, []);
    depthByTeam.get(t).push(d);
  }

  const ctx = {
    ...history,
    models,
    injuries: today.injuries,
    slateStatus,
    depthByTeam
  };

  // Rival de cada equipo (por el partido del slate).
  const eventTeams = new Map();
  for (const p of today.slatePlayers) {
    const e = String(p.event_id);
    if (!eventTeams.has(e)) eventTeams.set(e, new Set());
    eventTeams.get(e).add(Number(p.team_id));
  }
  const opponents = new Map();
  for (const teams of eventTeams.values()) {
    const [a, b] = [...teams];
    if (teams.size === 2) {
      opponents.set(a, b);
      opponents.set(b, a);
    }
  }

  // PASO 1 y 2 para cada equipo del slate.
  const teamIds = [...new Set(today.slatePlayers.map(p => Number(p.team_id)))].filter(t => depthByTeam.has(t));
  const teamProjections = new Map(teamIds.map(t => [t, projectTeam(t, ctx)]));

  // Reparto de jugadas por equipo.
  const usageFactors = new Map();
  for (const tp of teamProjections.values()) {
    let used = 0;
    for (const r of tp.rows) {
      const rate = r.id
        ? playerRates(r, ctx).rates.use
        : (models.leagueRates[`ALL:${r.role}`]?.use || 0);
      used += rate * r.minutes;
    }
    const normalUse = models.usage.get(tp.team);
    tp.usageFactor = normalUse && used > 0
      ? clamp(normalUse * (CONFIG.teamMinutes / 240) / used, CONFIG.usageMin, CONFIG.usageMax)
      : 1;
    usageFactors.set(tp.team, tp.usageFactor);
  }

  const fantasyCache = new Map();
  const projectionRows = [];
  const platforms = [];

  for (const slate of today.slates) {
    const players = today.slatePlayers.filter(p => Number(p.slate_id) === Number(slate.slate_id));
    const excluded = {};
    const list = [];
    const exclude = (p, reason, extra = {}) => {
      excluded[reason] = (excluded[reason] || 0) + 1;
      list.push({ p, reason, ...extra });
    };

    for (const p of players) {
      const id = Number(p.player_id);
      const team = Number(p.team_id);
      const tp = teamProjections.get(team);
      const row = tp?.rows.find(r => r.id === id);
      const outRow = tp && !row && (ctx.depthByTeam.get(team) || []).some(d => Number(d.nba_player_id) === id);

      if (!(Number(p.salary) >= CONFIG.minSalary)) exclude(p, "SALARIO_3500_O_MENOS", { row });
      else if (!p.positions?.length) exclude(p, "SIN_POSICION", { row });
      else if (!tp) exclude(p, "EQUIPO_SIN_DEPTH_CHART");
      else if (outRow) exclude(p, "LESION_OUT");
      else if (!row) exclude(p, "NO_ESTA_EN_DEPTH_CHART");
      else if (row.status === "DUDA" || (slateStatus.get(id) || []).some(s => injuryClass(s) !== "")) exclude(p, "LESION_O_DUDA", { row });
      else if (row.effRank > CONFIG.maxDepthRank) exclude(p, "FUERA_DEL_TOP2_ESPN", { row });
      else if (row.minutes < CONFIG.minProjectedMinutes) exclude(p, "POCOS_MINUTOS", { row });
      else {
        const opp = opponents.get(team);
        if (!fantasyCache.has(id)) fantasyCache.set(id, projectFantasy(row, team, opp, usageFactors.get(team) || 1, ctx));
        const f = fantasyCache.get(id);
        if (f.excluded) exclude(p, f.excluded, { row });
        else list.push({ p, row, f, opp });
      }
    }

    const platform = slate.platform;
    const eligible = list.filter(x => x.f).sort((a, b) => b.f[platform].mean - a.f[platform].mean);

    for (const x of list) {
      const { p, row, f } = x;
      const pts = f?.[platform];
      projectionRows.push({
        slate_id: Number(slate.slate_id),
        player_id: Number(p.player_id),
        platform,
        slate_date: day,
        player_name: p.player_name,
        team_id: Number(p.team_id),
        team_abbr: p.team_abbr,
        opp_team_id: opponents.get(Number(p.team_id)) ?? null,
        salary: Number(p.salary),
        positions: p.positions,
        role: row ? (row.role === "S" ? "TITULAR" : `BANCA #${row.order + 1}`) : null,
        depth_rank: row?.effRank ?? null,
        minutes: row ? round(row.minutes, 1) : null,
        eligible: Boolean(f),
        excluded_reason: f ? null : x.reason,
        proj_mean: pts?.mean ?? null,
        proj_p10: pts?.p10 ?? null,
        proj_p50: pts?.p50 ?? null,
        proj_p90: pts?.p90 ?? null,
        value_per_1k: pts ? round(pts.mean / (Number(p.salary) / 1000)) : null,
        double_double: f?.doubleDouble ?? null,
        triple_double: f?.tripleDouble ?? null,
        stats: f?.stats ?? null,
        explain: row ? {
          minutos: {
            fuente: row.baseline?.source || "sin historial",
            estaTemporada: round(row.baseline?.current, 1),
            partidosEstaTemporada: row.baseline?.currentGames ?? 0,
            pesoEstaTemporada: round(row.baseline?.currentWeight, 2),
            temporadaPasada: round(row.baseline?.previous, 1),
            estiloEquipo: round(row.teamPrior, 1),
            mezcla: round(row.base, 1),
            ajustePalizas: round(row.blowoutFactor, 3),
            entraAJugar: round(row.appearance, 2),
            companerosOut: round(row.injury?.minutes, 1),
            companerosDetalle: row.injury?.detail || null,
            ajuste241: round(teamProjections.get(Number(p.team_id))?.factor, 3),
            final: round(row.minutes, 1)
          },
          ...(f?.explain || {})
        } : null,
        model_version: "fantasy-nba-v2",
        created_at: runAt
      });
    }

    platforms.push({
      platform,
      slateId: Number(slate.slate_id),
      games: slate.event_count,
      players: players.length,
      eligible: eligible.length,
      excluded,
      top: eligible.slice(0, 25).map(x => ({
        jugador: x.p.player_name,
        equipo: x.p.team_abbr,
        rival: teamProjections.get(x.opp)?.code || null,
        rol: x.row.role === "S" ? "TITULAR" : `BANCA #${x.row.order + 1}`,
        tipo: x.f.type,
        salario: Number(x.p.salary),
        minutos: round(x.row.minutes, 1),
        puntos: x.f[platform].mean,
        p10: x.f[platform].p10,
        p90: x.f[platform].p90,
        ptsPor1k: round(x.f[platform].mean / (Number(x.p.salary) / 1000)),
        defensa: x.f.explain.defensaRival
      }))
    });
  }

  // Guardar proyecciones.
  if (projectionRows.length) {
    await upsertAll("fantasy_nba_projections", projectionRows, "slate_id,player_id");
    for (const slate of today.slates) {
      const { error } = await supabaseAdmin
        .from("fantasy_nba_projections")
        .delete()
        .eq("slate_id", Number(slate.slate_id))
        .lt("created_at", runAt);
      if (error) throw new Error(`Supabase fantasy_nba_projections: ${error.message}`);
    }
  }

  // Guardar minutos de cada equipo (para revisar y evaluar).
  const teamRowsOut = [];
  for (const tp of teamProjections.values()) {
    for (const r of tp.rows) {
      teamRowsOut.push({
        slate_date: day,
        team_id: tp.team,
        team_abbr: tp.code,
        player_key: r.key,
        player_id: r.id,
        player_name: r.name,
        role: r.role === "S" ? "TITULAR" : `BANCA #${r.order + 1}`,
        depth_position: r.depthPosition,
        depth_rank: r.effRank,
        status: r.status || null,
        minutes: round(r.minutes, 1),
        created_at: runAt
      });
    }
    for (const name of tp.out) {
      const d = (ctx.depthByTeam.get(tp.team) || []).find(x => str(x.player_name) === name);
      teamRowsOut.push({
        slate_date: day,
        team_id: tp.team,
        team_abbr: tp.code,
        player_key: d?.nba_player_id ? String(d.nba_player_id) : `espn:${d?.espn_player_id}`,
        player_id: d?.nba_player_id ? Number(d.nba_player_id) : null,
        player_name: name,
        role: "OUT",
        depth_position: null,
        depth_rank: null,
        status: "OUT",
        minutes: 0,
        created_at: runAt
      });
    }
  }
  if (teamRowsOut.length) {
    await upsertAll("fantasy_nba_team_minutes", teamRowsOut, "slate_date,team_id,player_key");
    const { error } = await supabaseAdmin
      .from("fantasy_nba_team_minutes")
      .delete()
      .eq("slate_date", day)
      .lt("created_at", runAt);
    if (error) throw new Error(`Supabase fantasy_nba_team_minutes: ${error.message}`);
  }

  return {
    date: day,
    depthChartDate: today.snapshotDate,
    seconds: (Date.now() - t0) / 1000,
    historyGames: history.gamesCount,
    medido: {
      suplenteATitular: `x${round(models.roleChange.up, 2)} minutos (${models.roleChange.samples} casos)`,
      palizasTitulares: `x${round(models.blowout.S, 3)}`
    },
    teams: [...teamProjections.values()].map(tp => ({
      equipo: tp.code,
      estilo: tp.profile.label,
      titularesPromedio: round(tp.profile.starterAvg, 1),
      ajuste241: round(tp.factor, 3),
      repartoJugadas: round(tp.usageFactor, 3),
      out: tp.out,
      duda: tp.doubtful,
      titulares: tp.rows.filter(r => r.role === "S").map(r => `${r.name} ${round(r.minutes, 1)}`),
      banca: tp.rows.filter(r => r.role === "B" && r.minutes >= 6).map(r => `${r.name} ${round(r.minutes, 1)}`)
    })),
    platforms
  };
}


// ============================================================
// EVALUACION (despues de los partidos)
// ============================================================

async function runEvaluation(day) {
  const [games, minutesRows, projections] = await Promise.all([
    selectAll("nba_games", "game_id,game_date", q => q.in("season", [CUR, PREV]).order("game_id", { ascending: true })),
    selectAll("fantasy_nba_team_minutes", "*", q => q.eq("slate_date", day)),
    selectAll("fantasy_nba_projections", "*", q => q.eq("slate_date", day))
  ]);

  const gameIds = games.filter(g => nbaDay(g.game_date) === day).map(g => Number(g.game_id));
  if (!gameIds.length) return { date: day, message: "No hay partidos terminados guardados para esa fecha" };
  if (!minutesRows.length && !projections.length) return { date: day, message: "No hay proyecciones guardadas para esa fecha" };

  const actualRows = await selectAll(
    "nba_player_game_roles",
    "game_id,team_id,player_id,minutes,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made,starter",
    q => q.in("game_id", gameIds)
  );

  const actual = new Map();
  const playedTeams = new Set();
  for (const r of actualRows) {
    playedTeams.add(Number(r.team_id));
    actual.set(Number(r.player_id), {
      min: Number(r.minutes) || 0,
      starter: r.starter === true,
      s: {
        pts: Number(r.points) || 0, fg3m: Number(r.three_pointers_made) || 0, reb: Number(r.rebounds) || 0,
        ast: Number(r.assists) || 0, stl: Number(r.steals) || 0, blk: Number(r.blocks) || 0, tov: Number(r.turnovers) || 0
      }
    });
  }

  // Minutos y titulares (todos los jugadores de cada equipo).
  const evaluated = minutesRows.filter(r => playedTeams.has(Number(r.team_id)) && r.player_id);
  const minErr = { S: [], B: [] };
  let starterHits = 0;
  let starterTotal = 0;
  const byTeam = new Map();

  for (const r of evaluated) {
    const a = actual.get(Number(r.player_id));
    const realMin = a ? a.min : 0;
    if (r.role === "TITULAR") {
      starterTotal++;
      if (a?.starter) starterHits++;
      minErr.S.push(Number(r.minutes) - realMin);
    } else if (r.role !== "OUT" && (Number(r.minutes) >= 8 || realMin >= 8)) {
      minErr.B.push(Number(r.minutes) - realMin);
    }
    const teamKey = r.team_abbr || String(r.team_id);
    if (!byTeam.has(teamKey)) byTeam.set(teamKey, { hits: 0, total: 0 });
    if (r.role === "TITULAR") {
      byTeam.get(teamKey).total++;
      if (a?.starter) byTeam.get(teamKey).hits++;
    }
  }

  const absMean = a => round(mean(a.map(Math.abs)), 1);
  const now = new Date().toISOString();
  const updates = [];
  const platforms = {};

  for (const p of projections) {
    if (!playedTeams.has(Number(p.team_id))) continue;
    const a = actual.get(Number(p.player_id));
    const dk = a ? round(scoreDK(a.s)) : 0;
    const fd = a ? round(scoreFD(a.s)) : 0;
    const real = p.platform === "draftkings" ? dk : fd;
    updates.push({
      ...p,
      actual_minutes: a ? round(a.min, 1) : 0,
      actual_starter: a ? a.starter : false,
      actual_points: real,
      evaluated_at: now
    });

    if (!p.eligible) continue;
    if (!platforms[p.platform]) platforms[p.platform] = [];
    platforms[p.platform].push({
      jugador: p.player_name,
      rol: p.role,
      minProy: Number(p.minutes),
      minReal: a ? round(a.min, 1) : 0,
      proyectado: Number(p.proj_mean),
      real,
      error: round(Number(p.proj_mean) - real, 1)
    });
  }

  if (updates.length) await upsertAll("fantasy_nba_projections", updates, "slate_id,player_id");

  const summary = {
    date: day,
    titularesAcertados: starterTotal ? `${starterHits}/${starterTotal} (${round(100 * starterHits / starterTotal, 1)}%)` : null,
    equiposConFallosDeTitular: [...byTeam.entries()]
      .filter(([, t]) => t.total && t.hits < t.total)
      .map(([team, t]) => `${team}: ${t.hits}/${t.total}`),
    errorMinutosTitulares: absMean(minErr.S),
    errorMinutosBanca: absMean(minErr.B),
    sesgoMinutos: round(mean([...minErr.S, ...minErr.B]), 1),
    platforms: Object.fromEntries(Object.entries(platforms).map(([platform, rows]) => {
      const e = rows.map(r => r.error);
      return [platform, {
        jugadores: rows.length,
        errorPromedio: absMean(e),
        sesgo: round(mean(e), 1),
        dentroDe10: `${round(100 * e.filter(x => Math.abs(x) <= 10).length / Math.max(1, e.length), 1)}%`,
        mayoresFallos: [...rows].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 12)
      }];
    }))
  };

  const { error } = await supabaseAdmin
    .from("fantasy_nba_evaluations")
    .upsert([{ eval_date: day, summary, created_at: now }], { onConflict: "eval_date" });
  if (error) throw new Error(`Supabase fantasy_nba_evaluations: ${error.message}`);

  return summary;
}


// ============================================================
// VISTA HTML (para revisar con captura)
// ============================================================

function table(rows) {
  if (!rows.length) return "<p>Sin datos</p>";
  const cols = Object.keys(rows[0]);
  return `<table><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>${
    rows.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(Array.isArray(r[c]) ? r[c].join(", ") : r[c])}</td>`).join("")}</tr>`).join("")
  }</table>`;
}

function renderHtml(result, mode) {
  const css = `body{font-family:Arial,sans-serif;background:#020814;color:#e8f6ff;padding:16px}
h1,h2{color:#00ffe7}table{border-collapse:collapse;margin:8px 0 24px;font-size:13px}
th,td{border:1px solid #1d3550;padding:4px 8px;text-align:left}th{background:#0b1a2e;color:#00ffe7}
.box{background:#0b1a2e;padding:10px;border-radius:6px;margin-bottom:12px}`;

  let body = "";
  if (mode === "evaluate") {
    body += `<h1>Evaluacion ${escapeHtml(result.date)}</h1>`;
    if (result.message) body += `<p>${escapeHtml(result.message)}</p>`;
    else {
      body += `<div class="box">Titulares acertados: ${escapeHtml(result.titularesAcertados)}<br>
        Error minutos titulares: ${result.errorMinutosTitulares} | banca: ${result.errorMinutosBanca} | sesgo: ${result.sesgoMinutos}</div>`;
      for (const [platform, p] of Object.entries(result.platforms)) {
        body += `<h2>${escapeHtml(platform)}</h2><div class="box">Jugadores ${p.jugadores} | error promedio ${p.errorPromedio} | sesgo ${p.sesgo} | dentro de ±10: ${p.dentroDe10}</div>`;
        body += table(p.mayoresFallos);
      }
    }
  } else {
    body += `<h1>Fantasy NBA ${escapeHtml(result.date)}</h1>`;
    if (result.message) body += `<p>${escapeHtml(result.message)}</p>`;
    else {
      body += `<div class="box">Depth chart: ${escapeHtml(result.depthChartDate)} | partidos de historial: ${result.historyGames} |
        suplente a titular: ${escapeHtml(result.medido.suplenteATitular)} | palizas: ${escapeHtml(result.medido.palizasTitulares)} | ${result.seconds}s</div>`;
      body += `<h2>Paso 1-2: rol y minutos por equipo</h2>`;
      body += table(result.teams.map(t => ({
        Equipo: t.equipo, Estilo: t.estilo, "Min titulares": t.titularesPromedio, "Ajuste 241": t.ajuste241,
        "Jugadas": t.repartoJugadas, OUT: t.out, Duda: t.duda, Titulares: t.titulares, Banca: t.banca
      })));
      for (const p of result.platforms) {
        body += `<h2>${escapeHtml(p.platform)} — slate ${p.slateId} (${p.games} partidos)</h2>`;
        body += `<div class="box">Jugadores ${p.players} | elegibles ${p.eligible} | excluidos ${escapeHtml(JSON.stringify(p.excluded))}</div>`;
        body += table(p.top);
      }
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fantasy NBA</title><style>${css}</style></head><body>${body}</body></html>`;
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

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isInternalRequest(req)) return res.status(401).json({ error: "Unauthorized" });

  const mode = String(req.query.mode || "project");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : null;

  try {
    const result = mode === "evaluate"
      ? await runEvaluation(date || shiftDay(chicagoDay(), -1))
      : await runProjection(date || chicagoDay());

    if (String(req.query.view || "") === "1") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(renderHtml(result, mode));
    }
    return res.status(200).json({ ok: true, mode, ...result });
  } catch (error) {
    console.error("FANTASY NBA PROJECT:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = handler;
module.exports.runProjection = runProjection;
module.exports.runEvaluation = runEvaluation;
module.exports.shiftDay = shiftDay;
module.exports.chicagoDay = chicagoDay;

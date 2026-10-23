// ============================================================
// CASHEDGE FANTASY NFL — MODELO DE PROYECCION
// ============================================================
//
// Funciones puras: NO llaman a Supabase ni a ninguna API.
// Reciben las filas ya leidas y devuelven proyecciones.
// Archivo con "_" al inicio: Vercel NO lo publica como endpoint.
//
// ORDEN (el que aprobaste):
//   1. Rol del jugador (depth chart ESPN de hoy)
//   2. Snaps esperados (historial de esta temporada, casi todo el peso)
//   3. Oportunidades: parte de los targets / acarreos / pases del equipo
//   4. Eficiencia y TD (TD "que debieron ser")
//   5. Lesiones: quien hereda targets y acarreos; cambio de QB
//   6. Defensa rival: por aire, por tierra, por posicion y por
//      jugadores parecidos (arquetipo)
//   7. Partido esperado (game script) y clima
//   8. Puntos DK / FD
//   9. Simulacion de 10,000 partidos (QB y receptores suben juntos)
//
// LAS CONSTANTES NO SON INVENTADAS: se midieron con tus datos
// NFLverse 2022-2025 (ver comentario de cada una).
// ============================================================

"use strict";

// ------------------------------------------------------------
// CONFIGURACION (medida con datos 2022-2025)
// ------------------------------------------------------------

const CONFIG = {
  // Cuanto se acerca cada estadistica de equipo al promedio de la
  // liga. k = "partidos/intentos de mentira" con valor de liga.
  // Medido con la estabilidad mitad-mitad de cada temporada.
  // Mas k = el dato propio se parece menos a lo que pasara despues.
  teamK: {
    off: { plays: 19, pass_rate: 420, ypa: 240, comp: 400, ptd: 480, int: 1100, sack: 330, ypc: 470, rtd: 410, points: 7 },
    def: { plays: 41, pass_rate: 1370, ypa: 1500, comp: 565, ptd: 5000, int: 1040, sack: 840, ypc: 440, rtd: 4000, points: 34 }
  },

  // Cuanto de la temporada pasada sigue valiendo (pendiente medida
  // temporada anterior -> actual). Solo se usa como punto de
  // partida; con cada partido de esta temporada pesa menos.
  teamCarry: {
    off: { plays: 0.11, pass_rate: 0.40, ypa: 0.49, comp: 0.37, ptd: 0.38, int: 0.09, sack: 0.34, ypc: 0.31, rtd: 0.33, points: 0.39 },
    def: { plays: 0.06, pass_rate: 0.27, ypa: 0.10, comp: 0.26, ptd: 0.00, int: 0.03, sack: 0.12, ypc: 0.08, rtd: 0.17, points: 0.31 }
  },

  // Ventaja de local medida: 2.15 puntos (1,064 partidos). Mitad a cada lado.
  homeEdgePoints: 1.08,

  // Partido esperado (game script), medido 2022-2025:
  // por cada punto de margen esperado, el % de pases baja 0.10 puntos
  // y el equipo corre 0.08 jugadas mas.
  scriptPassRatePerPoint: -0.00099,
  scriptPlaysPerPoint: 0.082,

  // Clima medido (yardas de pase reales / esperadas):
  // techo 1.015 | viento 0-9 mph 1.00 | 10-14 0.983 | 15+ 0.935.
  // TD de pase con viento 10-14 0.92 y 15+ 0.91 (se usa un valor
  // intermedio prudente porque son pocos partidos).
  weather: {
    dome: { ypa: 1.015, ptd: 1.0 },
    calm: { ypa: 1.0, ptd: 1.0 },
    breezy: { ypa: 0.983, ptd: 0.96 },   // 10-14 mph
    windy: { ypa: 0.935, ptd: 0.91 }     // 15+ mph
  },

  // Ponderacion por recencia (medida: error minimo al predecir el
  // siguiente partido). Snaps cambian rapido; targets/acarreos menos.
  snapHalfLife: 1.5,
  shareHalfLife: 3,

  // Peso del rol del depth chart cuando el jugador tiene historial.
  // Con 6 partidos propios el historial pesa ~86% (tu regla: casi
  // todo el peso a esta temporada).
  snapPriorGames: 1,
  sharePriorGames: 2,
  // Si el depth chart le da un rol MAYOR al que venia jugando
  // (hereda el puesto), el rol nuevo pesa mas.
  promotedPriorGames: 4,

  // Temporada pasada en eficiencia (yardas por target, etc.).
  previousSeasonWeight: 0.5,

  // Eficiencia por jugador: k en targets / acarreos / intentos.
  // Medido con estabilidad mitad-mitad 2022-2025.
  playerK: {
    ypt: { WR: 130, TE: 200, RB: 190, QB: 190 },
    catch: { WR: 70, TE: 70, RB: 100000, QB: 100000 },   // RB: no es estable -> liga
    recTd: 90,          // TD por target (usando TD esperados)
    ypc: { RB: 240, QB: 23, WR: 60, TE: 60 },
    rushTd: { RB: 226, QB: 209, WR: 300, TE: 300 },
    qbYpa: 200,
    qbComp: 300,
    qbPtd: 150,
    qbInt: 4800         // las intercepciones casi no se repiten
  },

  // TD reales vs TD "que debieron ser" (peso optimo medido para
  // predecir los TD de la segunda mitad de temporada).
  realTdWeight: { WR: 0.1, TE: 0.1, RB: 0.3, QB: 0.1 },

  // Defensa por posicion (puntos fantasy permitidos vs lo normal de
  // cada jugador). k en jugadores-partido, medido mitad-mitad:
  // QB 20, RB 60, WR 206, TE 227. Por arquetipo (jugadores
  // parecidos) la senal medida es casi nula en WR: k 140.
  defPosK: { QB: 20, RB: 60, WR: 206, TE: 227 },
  defArchK: 140,
  defClamp: [0.8, 1.25],
  // Cuanto del factor defensivo contra QB se aplica ademas de la
  // defensa de equipo (se ajusta con la evaluacion semanal).
  qbDefExtraPower: 0.5,

  // Cambio de QB: limites del ajuste.
  qbChangeClamp: [0.75, 1.15],

  // Lesiones: la parte del que no juega va el doble a su misma
  // posicion (ej. targets de un WR a los otros WR).
  samePositionBoost: 1.5,
  // Confianza en el "con / sin" medido: partidos sin el jugador /
  // (partidos sin el jugador + 2).
  withoutPriorGames: 2,

  // Roles con historial minimo para entrar al reparto.
  recentTeamGames: 4,

  // Simulacion
  sims: 10000,
  sigma: {
    plays: 0.10,
    pass: 0.27,
    rush: 0.28,
    // Variacion propia de cada jugador (cuantos balones le tocan hoy
    // y que hace con ellos). Ajustada para que el resultado real caiga
    // ~75-80% de las veces entre el p10 y el p90 (backtest 2025: 75%).
    share: { WR: 0.55, TE: 0.50, RB: 0.35, QB: 0.18 },
    recYards: { WR: 0.50, TE: 0.50, RB: 0.60 },
    rushYards: { RB: 0.35, QB: 0.60, WR: 0.9, TE: 0.9 },
    fieldGoalPoints: 3.5
  },
  pointsPerTD: 6.95
};

const POS = ["QB", "RB", "WR", "TE"];


// ------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// Normaliza posiciones: FB cuenta como RB.
const normPos = p => {
  const v = String(p || "").toUpperCase();
  return v === "FB" ? "RB" : v;
};

// Puntos PPR sin bonos (para medir defensas contra posicion).
function pprPoints(r) {
  return num(r.passing_yards) * 0.04 + num(r.passing_tds) * 4 - num(r.interceptions) +
    num(r.rushing_yards) * 0.1 + num(r.rushing_tds) * 6 +
    num(r.receptions) + num(r.receiving_yards) * 0.1 + num(r.receiving_tds) * 6 -
    num(r.fumbles_lost) + num(r.two_point_conversions) * 2;
}

// Generador aleatorio con semilla (resultados repetibles).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSampler(rand) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
}

function poisson(rand, lambda) {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normalSampler(rand)()));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}


// ------------------------------------------------------------
// PUNTOS FANTASY (reglas de scoring.js y dst-scoring.js)
// ------------------------------------------------------------

function offensePoints(s, platform) {
  const dk = platform === "draftkings";
  return s.passYds * 0.04 + s.passTd * 4 - s.int +
    s.rushYds * 0.1 + s.rushTd * 6 +
    s.rec * (dk ? 1 : 0.5) + s.recYds * 0.1 + s.recTd * 6 -
    s.fumbles * (dk ? 1 : 2) + s.twoPt * 2 +
    (dk ? (s.passYds >= 300 ? 3 : 0) + (s.rushYds >= 100 ? 3 : 0) + (s.recYds >= 100 ? 3 : 0) : 0);
}

function pointsAllowedScore(points) {
  if (points <= 0) return 10;
  if (points <= 6) return 7;
  if (points <= 13) return 4;
  if (points <= 20) return 1;
  if (points <= 27) return 0;
  if (points <= 34) return -1;
  return -4;
}

function dstPoints(s) {
  // Mismas reglas en DK y FD (dst-scoring.js).
  return s.sacks + s.int * 2 + s.fr * 2 + (s.defTd + s.retTd) * 6 + s.safety * 2 + s.blocks * 2 +
    pointsAllowedScore(s.pa);
}


// ------------------------------------------------------------
// 1) LIGA Y EQUIPOS
// ------------------------------------------------------------

// Cada estadistica de equipo como (numerador, denominador).
const TEAM_STATS = {
  plays: g => [g.plays, 1],
  pass_rate: g => [g.dropbacks, g.plays],
  ypa: g => [g.passing_yards, g.pass_attempts],
  comp: g => [g.completions, g.pass_attempts],
  ptd: g => [g.passing_tds, g.pass_attempts],
  int: g => [g.interceptions_thrown, g.pass_attempts],
  sack: g => [g.sacks_suffered, g.dropbacks],
  ypc: g => [g.rushing_yards, g.carries],
  rtd: g => [g.rushing_tds, g.carries],
  points: g => [g.points_for, 1]
};

function prepTeamGame(r) {
  const g = { ...r };
  for (const k of ["pass_attempts", "sacks_suffered", "carries", "passing_yards", "completions", "passing_tds",
    "interceptions_thrown", "rushing_yards", "rushing_tds", "points_for", "points_against", "targets",
    "def_sacks", "def_interceptions", "def_fumble_recoveries", "def_tds", "def_safeties",
    "blocked_punts", "blocked_fgs", "blocked_pats", "return_tds", "fumbles_lost", "receptions"]) {
    g[k] = num(r[k]);
  }
  g.dropbacks = g.pass_attempts + g.sacks_suffered;
  g.plays = g.dropbacks + g.carries;
  return g;
}

function aggregate(games, stat) {
  let n = 0, d = 0;
  for (const g of games) {
    const [a, b] = TEAM_STATS[stat](g);
    n += a;
    d += b;
  }
  return { n, d, rate: d > 0 ? n / d : null };
}

function buildLeague(teamGames) {
  const league = {};
  for (const s of Object.keys(TEAM_STATS)) league[s] = aggregate(teamGames, s).rate;
  const n = teamGames.length || 1;
  league.defPerGame = {
    sacks: sum(teamGames, g => g.def_sacks) / n,
    int: sum(teamGames, g => g.def_interceptions) / n,
    fr: sum(teamGames, g => g.def_fumble_recoveries) / n,
    defTd: sum(teamGames, g => g.def_tds) / n,
    retTd: sum(teamGames, g => g.return_tds) / n,
    safety: sum(teamGames, g => g.def_safeties) / n,
    blocks: sum(teamGames, g => g.blocked_punts + g.blocked_fgs + g.blocked_pats) / n,
    fumblesLost: sum(teamGames, g => g.fumbles_lost) / n
  };
  league.fumblesLostPerPlay = sum(teamGames, g => g.fumbles_lost) / Math.max(1, sum(teamGames, g => g.plays));
  // TD defensivos por cada robo de balon.
  league.defTdPerTakeaway = sum(teamGames, g => g.def_tds) /
    Math.max(1, sum(teamGames, g => g.def_interceptions + g.def_fumble_recoveries));
  league.games = teamGames.length;
  return league;
}

// Rating de cada equipo: esta temporada + punto de partida de la
// anterior, con el k medido.
function teamRatings(current, previous, league, prevLeague) {
  const teams = new Set([...current, ...previous].map(g => g.team));
  const out = new Map();

  for (const team of teams) {
    const r = { off: {}, def: {}, gamesCurrent: 0 };
    const curOff = current.filter(g => g.team === team);
    const curDef = current.filter(g => g.opponent === team);
    const prevOff = previous.filter(g => g.team === team);
    const prevDef = previous.filter(g => g.opponent === team);
    r.gamesCurrent = curOff.length;

    for (const side of ["off", "def"]) {
      const cur = side === "off" ? curOff : curDef;
      const prev = side === "off" ? prevOff : prevDef;
      for (const s of Object.keys(TEAM_STATS)) {
        const lg = league[s];
        const k = CONFIG.teamK[side][s];
        const carry = CONFIG.teamCarry[side][s];
        const p = aggregate(prev, s);
        const prior = p.rate !== null && prevLeague[s] !== null
          ? lg + carry * (p.rate - prevLeague[s])
          : lg;
        const c = aggregate(cur, s);
        r[side][s] = (c.n + k * prior) / (c.d + k);
      }
    }

    // Defensa (para la DST): por partido, con la misma idea.
    const dpg = (key, k) => {
      const n = sum(curOff, g => g[key]);
      const lg = league.defPerGame[key === "def_sacks" ? "sacks" : key === "def_interceptions" ? "int" : "fr"];
      return (n + k * lg) / (curOff.length + k);
    };
    r.dstSacksPerGame = dpg("def_sacks", 8);
    r.dstFrPerGame = dpg("def_fumble_recoveries", 12);
    r.fumblesLostPerPlay = (sum(curOff, g => g.fumbles_lost) + 600 * league.fumblesLostPerPlay) /
      (sum(curOff, g => g.plays) + 600);
    out.set(team, r);
  }
  return out;
}

// Combina ataque y defensa: liga * (ataque/liga) * (defensa/liga).
function matchup(lg, off, def) {
  if (!(lg > 0)) return off;
  return lg * (off / lg) * (def / lg);
}


// ------------------------------------------------------------
// 2) HISTORIAL DE JUGADORES
// ------------------------------------------------------------

function buildPlayerHistory({ season, asOfDate, playerGames, expected, snaps, teamGames, players }) {
  const expByKey = new Map(expected.map(e => [`${e.gsis_player_id}|${e.game_id}`, e]));
  const teamByGame = new Map(teamGames.map(g => [`${g.team}|${g.game_id}`, g]));
  const teamGameByDate = new Map(teamGames.map(g => [`${g.team}|${g.game_date}`, g]));
  const posByGsis = new Map(players.map(p => [p.gsis_player_id, normPos(p.position)]));

  // Partidos de cada jugador (antes de la fecha de corte).
  const games = new Map();
  for (const r of playerGames) {
    if (!r.game_date || r.game_date >= asOfDate) continue;
    const tg = teamByGame.get(`${r.team}|${r.game_id}`);
    if (!tg) continue;
    const e = expByKey.get(`${r.gsis_player_id}|${r.game_id}`);
    pushTo(games, r.gsis_player_id, {
      season: num(r.season),
      week: num(r.week),
      game_id: r.game_id,
      game_date: r.game_date,
      team: r.team,
      opponent: r.opponent,
      position: normPos(r.position),
      tgt: num(r.targets), rec: num(r.receptions), recYds: num(r.receiving_yards), recTd: num(r.receiving_tds),
      car: num(r.rushing_attempts), rushYds: num(r.rushing_yards), rushTd: num(r.rushing_tds),
      att: num(r.passing_attempts), comp: num(r.completions), passYds: num(r.passing_yards), passTd: num(r.passing_tds),
      int: num(r.interceptions), fumbles: num(r.fumbles_lost), twoPt: num(r.two_point_conversions),
      recTdX: e ? num(e.rec_td_exp) : null, rushTdX: e ? num(e.rush_td_exp) : null, passTdX: e ? num(e.pass_td_exp) : null,
      ppr: pprPoints(r),
      teamTgt: tg.targets, teamCar: tg.carries, teamAtt: tg.pass_attempts,
      snaps: null, snapPct: null
    });
  }

  // Snaps: se unen por jugador + fecha. Un jugador con snaps pero
  // sin produccion (ej. TE bloqueador) tambien cuenta como partido.
  for (const s of snaps) {
    if (!s.game_date || s.game_date >= asOfDate) continue;
    const gsis = s.gsis_player_id;
    if (!gsis) continue;
    const list = games.get(gsis) || [];
    let g = list.find(x => x.game_date === s.game_date);
    let pct = num(s.offense_pct);
    if (pct > 1.5) pct /= 100;
    if (!g) {
      if (!(num(s.offense_snaps) > 0)) continue;
      // Equipo: el de su ultimo partido conocido que jugo esa fecha.
      const pos = posByGsis.get(gsis);
      if (!POS.includes(pos)) continue;
      const known = [...list].reverse().find(x => teamGameByDate.has(`${x.team}|${s.game_date}`));
      const team = known?.team || s.team || null;
      const tg = team ? teamGameByDate.get(`${team}|${s.game_date}`) : null;
      if (!tg) continue;
      g = {
        season: num(s.season), week: num(tg.week), game_id: tg.game_id, game_date: s.game_date,
        team, opponent: tg.opponent, position: pos,
        tgt: 0, rec: 0, recYds: 0, recTd: 0, car: 0, rushYds: 0, rushTd: 0, att: 0, comp: 0, passYds: 0, passTd: 0,
        int: 0, fumbles: 0, twoPt: 0, recTdX: 0, rushTdX: 0, passTdX: 0, ppr: 0,
        teamTgt: tg.targets, teamCar: tg.carries, teamAtt: tg.pass_attempts,
        snaps: null, snapPct: null
      };
      pushTo(games, gsis, g);
    }
    g.snaps = num(s.offense_snaps);
    g.snapPct = pct;
  }

  for (const list of games.values()) list.sort((a, b) => a.game_date.localeCompare(b.game_date));
  return games;
}

// Promedios de la liga por posicion (eficiencia), S y S-1.
function positionLeague(history, season) {
  const acc = {};
  for (const list of history.values()) {
    for (const g of list) {
      if (g.season < season - 1) continue;
      const p = g.position;
      if (!POS.includes(p)) continue;
      const a = acc[p] || (acc[p] = { tgt: 0, rec: 0, recYds: 0, recTd: 0, recTdX: 0, car: 0, rushYds: 0, rushTd: 0, rushTdX: 0,
        att: 0, comp: 0, passYds: 0, passTd: 0, passTdX: 0, int: 0, fumbles: 0, touches: 0, twoPt: 0, tds: 0 });
      a.tgt += g.tgt; a.rec += g.rec; a.recYds += g.recYds; a.recTd += g.recTd; a.recTdX += num(g.recTdX);
      a.car += g.car; a.rushYds += g.rushYds; a.rushTd += g.rushTd; a.rushTdX += num(g.rushTdX);
      a.att += g.att; a.comp += g.comp; a.passYds += g.passYds; a.passTd += g.passTd; a.passTdX += num(g.passTdX); a.int += g.int;
      a.fumbles += g.fumbles;
      a.touches += g.car + g.rec + (p === "QB" ? g.att : 0);
      a.twoPt += g.twoPt;
      a.tds += g.recTd + g.rushTd + g.passTd;
    }
  }
  const out = {};
  for (const p of POS) {
    const a = acc[p] || {};
    const div = (x, y, fb) => (y > 0 ? x / y : fb);
    out[p] = {
      ypt: div(a.recYds, a.tgt, 7.5),
      catch: div(a.rec, a.tgt, 0.65),
      recTd: div(a.recTdX || a.recTd, a.tgt, 0.045),
      ypc: div(a.rushYds, a.car, 4.3),
      rushTd: div(a.rushTdX || a.rushTd, a.car, 0.03),
      ypa: div(a.passYds, a.att, 7.0),
      comp: div(a.comp, a.att, 0.65),
      passTd: div(a.passTdX || a.passTd, a.att, 0.045),
      int: div(a.int, a.att, 0.023),
      fumblePerTouch: div(a.fumbles, a.touches, 0.004),
      twoPtPerTd: div(a.twoPt, a.tds, 0.04)
    };
  }
  return out;
}

// Eficiencia de un jugador: esta temporada + la anterior a medio
// peso, acercada al promedio de su posicion.
function efficiency(list, season, pos, lgPos) {
  const w = g => (g.season === season ? 1 : g.season === season - 1 ? CONFIG.previousSeasonWeight : 0);
  const S = key => sum(list, g => w(g) * num(g[key]));
  const K = CONFIG.playerK;
  const lg = lgPos[pos] || lgPos.WR;
  const shrink = (n, d, k, prior) => (n + k * prior) / (d + k);
  const blendTd = (real, exp) => {
    const rw = CONFIG.realTdWeight[pos] ?? 0.2;
    return rw * real + (1 - rw) * exp;
  };

  const tgt = S("tgt"), car = S("car"), att = S("att");
  const recTdN = blendTd(S("recTd"), S("recTdX"));
  const rushTdN = blendTd(S("rushTd"), S("rushTdX"));
  const passTdN = blendTd(S("passTd"), S("passTdX"));

  return {
    ypt: shrink(S("recYds"), tgt, K.ypt[pos] ?? 150, lg.ypt),
    catch: shrink(S("rec"), tgt, K.catch[pos] ?? 70, lg.catch),
    recTd: shrink(recTdN, tgt, K.recTd, lg.recTd),
    ypc: shrink(S("rushYds"), car, K.ypc[pos] ?? 100, lg.ypc),
    rushTd: shrink(rushTdN, car, K.rushTd[pos] ?? 250, lg.rushTd),
    ypa: shrink(S("passYds"), att, K.qbYpa, lgPos.QB.ypa),
    comp: shrink(S("comp"), att, K.qbComp, lgPos.QB.comp),
    passTd: shrink(passTdN, att, K.qbPtd, lgPos.QB.passTd),
    int: shrink(S("int"), att, K.qbInt, lgPos.QB.int),
    attempts: att
  };
}


// ------------------------------------------------------------
// 3) DEFENSA CONTRA POSICION Y CONTRA JUGADORES PARECIDOS
// ------------------------------------------------------------

// Arquetipo de cada jugador (temporada actual + anterior).
function archetype(list, pos, season) {
  const rel = list.filter(g => g.season >= season - 1);
  const tgt = sum(rel, g => g.tgt);
  const car = sum(rel, g => g.car);
  if (pos === "WR" || pos === "TE") {
    // aDOT: yardas por aire por target. Necesita receiving_air_yards;
    // si no hay, se usa yardas por recepcion como aproximacion.
    const air = sum(rel, g => num(g.recAir));
    const adot = tgt > 0 && air ? air / tgt : null;
    const ypr = sum(rel, g => g.rec) > 0 ? sum(rel, g => g.recYds) / sum(rel, g => g.rec) : 11;
    const deep = adot !== null ? adot >= 12 : ypr >= 14.5;
    const short = adot !== null ? adot < 8 : ypr < 10;
    return `${pos}_${deep ? "profundo" : short ? "corto" : "medio"}`;
  }
  if (pos === "RB") return tgt / Math.max(1, tgt + car) >= 0.2 ? "RB_receptor" : "RB_corredor";
  if (pos === "QB") {
    const n = rel.filter(g => g.att >= 10).length || 1;
    return sum(rel, g => g.rushYds) / n >= 25 ? "QB_corredor" : "QB_bolsillo";
  }
  return pos;
}

// Factor de cada defensa: puntos permitidos / lo normal de cada
// rival que enfrento (sin contar ese partido), acercado a 1.
function defenseFactors(history, season) {
  const pos = new Map();   // `${def}|${pos}` -> {act, base, n}
  const arch = new Map();  // `${def}|${arch}`
  const archOf = new Map();

  for (const [gsis, list] of history) {
    const cur = list.filter(g => g.season === season && (g.snaps === null || g.snaps > 0));
    if (cur.length < 3) continue;
    const p = cur[cur.length - 1].position;
    if (!POS.includes(p)) continue;
    const a = archetype(list, p, season);
    archOf.set(gsis, a);
    const total = sum(cur, g => g.ppr);

    for (const g of cur) {
      const base = (total - g.ppr) / (cur.length - 1);
      if (base < 3) continue;
      for (const [map, key] of [[pos, `${g.opponent}|${p}`], [arch, `${g.opponent}|${a}`]]) {
        const v = map.get(key) || { act: 0, base: 0, n: 0 };
        v.act += g.ppr;
        v.base += base;
        v.n += 1;
        map.set(key, v);
      }
    }
  }

  const factor = (v, k, center = 1) => {
    if (!v) return center;
    const bbar = v.base / v.n;
    return clamp((v.act + k * bbar * center) / (v.base + k * bbar), ...CONFIG.defClamp);
  };

  return {
    archOf,
    get(def, p, a) {
      const fp = factor(pos.get(`${def}|${p}`), CONFIG.defPosK[p] ?? 150);
      const va = arch.get(`${def}|${a}`);
      if (!va) return { pos: fp, arch: fp };
      // Capa de "jugadores parecidos" sobre la de posicion.
      const bbar = va.base / va.n;
      const ratio = (va.act + CONFIG.defArchK * bbar * fp) / (va.base + CONFIG.defArchK * bbar);
      return { pos: fp, arch: clamp(ratio, ...CONFIG.defClamp) };
    }
  };
}


// ------------------------------------------------------------
// 4) ROLES (priors por rol, medidos en la liga)
// ------------------------------------------------------------

// Rol historico de cada partido: orden por snaps dentro de su
// posicion y equipo (WR1, WR2, WR3, RB1...).
function rolePriors(history, season) {
  const byTeamGame = new Map();
  for (const [gsis, list] of history) {
    for (const g of list) {
      if (g.season < season - 1 || g.snapPct === null || !(g.snaps > 0)) continue;
      pushTo(byTeamGame, `${g.team}|${g.game_id}|${g.position}`, g);
    }
  }
  const acc = new Map();
  for (const list of byTeamGame.values()) {
    list.sort((a, b) => b.snaps - a.snaps);
    list.forEach((g, i) => {
      const key = `${g.position}${Math.min(i + 1, g.position === "WR" ? 5 : 4)}`;
      const a = acc.get(key) || { snap: 0, tshare: 0, cshare: 0, pshare: 0, n: 0 };
      a.snap += g.snapPct;
      a.tshare += g.teamTgt > 0 ? g.tgt / g.teamTgt : 0;
      a.cshare += g.teamCar > 0 ? g.car / g.teamCar : 0;
      a.pshare += g.teamAtt > 0 ? g.att / g.teamAtt : 0;
      a.n += 1;
      acc.set(key, a);
    });
  }
  const out = {};
  for (const [key, a] of acc) {
    out[key] = { snap: a.snap / a.n, tshare: a.tshare / a.n, cshare: a.cshare / a.n, pshare: a.pshare / a.n, n: a.n };
  }
  return out;
}

function priorFor(priors, pos, rank) {
  const r = Math.max(1, Math.min(rank || 9, pos === "WR" ? 5 : 4));
  return priors[`${pos}${r}`] || { snap: 0.2, tshare: 0.03, cshare: 0.02, pshare: 0, n: 0 };
}


// ------------------------------------------------------------
// CONTEXTO COMPLETO
// ------------------------------------------------------------

function buildContext({ season, asOfDate, teamGames, playerGames, expected, snaps, players }) {
  const tg = teamGames.map(prepTeamGame).filter(g => g.game_date && g.game_date < asOfDate);
  const current = tg.filter(g => num(g.season) === season);
  const previous = tg.filter(g => num(g.season) === season - 1);

  // Liga: esta temporada; si aun hay pocos partidos, se mezcla con la anterior.
  const league = buildLeague(current.length >= 64 ? current : [...current, ...previous]);
  const prevLeague = buildLeague(previous.length ? previous : current);

  const ratings = teamRatings(current, previous, league, prevLeague);

  // aire de recepcion (para arquetipos)
  const airByKey = new Map(playerGames.map(r => [`${r.gsis_player_id}|${r.game_id}`, num(r.receiving_air_yards)]));
  const history = buildPlayerHistory({ season, asOfDate, playerGames, expected, snaps, teamGames: tg, players });
  for (const [gsis, list] of history) for (const g of list) g.recAir = airByKey.get(`${gsis}|${g.game_id}`) || 0;

  const lgPos = positionLeague(history, season);
  const defense = defenseFactors(history, season);
  const priors = rolePriors(history, season);

  // Juegos de cada equipo en la temporada (para "ultimos N partidos").
  const teamDates = new Map();
  for (const g of current) pushTo(teamDates, g.team, g.game_date);
  for (const list of teamDates.values()) list.sort();

  return { season, asOfDate, league, prevLeague, ratings, history, lgPos, defense, priors, teamDates, teamGames: tg };
}


// ------------------------------------------------------------
// 5) ENTORNO DEL PARTIDO (equipo)
// ------------------------------------------------------------

function weatherBucket(game, weather) {
  const roof = String(game.roof || "").toLowerCase();
  if (roof === "dome" || roof === "closed") return "dome";
  const wind = weather?.wind_mph;
  if (!Number.isFinite(wind)) return "calm";
  if (wind >= 15) return "windy";
  if (wind >= 10) return "breezy";
  return "calm";
}

// QB: compara al QB que va a jugar con los QB que tiro el equipo
// esta temporada. Si es el mismo, factor 1.
function qbChange(ctx, team, starterGsis) {
  const games = [];
  for (const [gsis, list] of ctx.history) {
    for (const g of list) {
      if (g.season === ctx.season && g.team === team && g.att > 0) games.push({ gsis, att: g.att });
    }
  }
  const byQb = new Map();
  for (const g of games) byQb.set(g.gsis, (byQb.get(g.gsis) || 0) + g.att);
  const total = [...byQb.values()].reduce((s, v) => s + v, 0);
  if (!starterGsis || !total) return { ypa: 1, comp: 1, ptd: 1, int: 1, usualShare: null };

  const eff = gsis => efficiency(ctx.history.get(gsis) || [], ctx.season, "QB", ctx.lgPos);
  const mix = { ypa: 0, comp: 0, passTd: 0, int: 0 };
  for (const [gsis, att] of byQb) {
    const e = eff(gsis);
    for (const k of Object.keys(mix)) mix[k] += e[k] * att / total;
  }
  const e = eff(starterGsis);
  const [lo, hi] = CONFIG.qbChangeClamp;
  return {
    ypa: clamp(e.ypa / mix.ypa, lo, hi),
    comp: clamp(e.comp / mix.comp, lo, hi),
    ptd: clamp(e.passTd / mix.passTd, lo, hi),
    int: clamp(e.int / mix.int, 0.7, 1.4),
    usualShare: (byQb.get(starterGsis) || 0) / total
  };
}

function teamEnvironment(ctx, game, team, opponent, isHome, neutral, weather, qbFactor) {
  const lg = ctx.league;
  const o = ctx.ratings.get(team)?.off;
  const d = ctx.ratings.get(opponent)?.def;
  if (!o || !d) return null;

  const m = s => matchup(lg[s], o[s], d[s]);
  const bucket = weatherBucket(game, weather);
  const w = CONFIG.weather[bucket];

  return {
    team, opponent, isHome,
    base: {
      plays: m("plays"), passRate: m("pass_rate"), ypa: m("ypa") * w.ypa * qbFactor.ypa,
      comp: clamp(m("comp") * qbFactor.comp, 0.4, 0.85), ptd: m("ptd") * w.ptd * qbFactor.ptd,
      int: m("int") * qbFactor.int, sack: m("sack"), ypc: m("ypc"), rtd: m("rtd"),
      points: m("points") * (0.55 + 0.45 * qbFactor.ypa) * (w.ypa + w.ptd) / 2
    },
    home: neutral ? 0 : isHome ? CONFIG.homeEdgePoints : -CONFIG.homeEdgePoints,
    weather: bucket
  };
}

function finishEnvironment(env, oppEnv) {
  const b = env.base;
  const points = b.points + env.home;
  const oppPoints = oppEnv.base.points + oppEnv.home;
  const margin = points - oppPoints;

  const plays = b.plays + CONFIG.scriptPlaysPerPoint * margin;
  const passRate = clamp(b.passRate + CONFIG.scriptPassRatePerPoint * margin, 0.4, 0.75);
  const dropbacks = plays * passRate;
  const sacks = dropbacks * b.sack;
  const att = dropbacks - sacks;
  const carries = plays - dropbacks;

  return {
    ...env,
    points, margin, plays, passRate, dropbacks, sacks, att, carries,
    passYds: att * b.ypa,
    comp: att * b.comp,
    passTd: att * b.ptd,
    int: att * b.int,
    rushYds: carries * b.ypc,
    rushTd: carries * b.rtd
  };
}


// ------------------------------------------------------------
// 6) REPARTO DENTRO DEL EQUIPO (roles, snaps, lesiones)
// ------------------------------------------------------------

function weightedShare(list, numKey, denKey, halfLife) {
  let n = 0, d = 0, wsum = 0;
  list.forEach((g, i) => {
    const w = 0.5 ** ((list.length - 1 - i) / halfLife);
    n += w * g[numKey];
    d += w * g[denKey];
    wsum += w;
  });
  return { share: d > 0 ? n / d : 0, nEff: wsum, n, d };
}

function weightedMean(list, key, halfLife) {
  let n = 0, wsum = 0;
  list.forEach((g, i) => {
    if (g[key] === null || g[key] === undefined) return;
    const w = 0.5 ** ((list.length - 1 - i) / halfLife);
    n += w * g[key];
    wsum += w;
  });
  return { mean: wsum > 0 ? n / wsum : null, nEff: wsum };
}

// Rol que venia jugando cada uno: orden por snaps (promedio de los
// ultimos 3 partidos del equipo) dentro de su posicion.
function usualRanks(ctx, team) {
  const dates = new Set((ctx.teamDates.get(team) || []).slice(-3));
  const acc = new Map();
  for (const [gsis, list] of ctx.history) {
    const g = list.filter(x => x.team === team && dates.has(x.game_date) && x.snaps !== null);
    if (!g.length) continue;
    acc.set(gsis, { pos: g[g.length - 1].position, snaps: sum(g, x => x.snaps) / dates.size });
  }
  const out = new Map();
  for (const pos of POS) {
    [...acc].filter(([, v]) => v.pos === pos && v.snaps > 0)
      .sort((a, b) => b[1].snaps - a[1].snaps)
      .forEach(([gsis], i) => out.set(gsis, i + 1));
  }
  return out;
}

// Candidatos de un equipo: los del depth chart de hoy + los que
// jugaron en sus ultimos partidos (si hoy no estan, su parte se
// reparte entre los que si juegan).
// depth: [{gsis, name, position, depthRank}]
// availability(gsis) -> { ok: true } | { ok: false, reason }
function buildCandidates(ctx, team, depth, availability, names) {
  const dates = new Set((ctx.teamDates.get(team) || []).slice(-CONFIG.recentTeamGames));
  const usual = usualRanks(ctx, team);
  const map = new Map();

  for (const d of depth) {
    const pos = normPos(d.position);
    if (!POS.includes(pos) || !d.gsis || String(d.position).toUpperCase() === "FB") continue;
    if (map.has(d.gsis)) continue;
    const a = availability(d.gsis);
    map.set(d.gsis, {
      gsis: d.gsis, name: d.name, position: pos, depthRank: d.depthRank ?? null,
      usualRank: usual.get(d.gsis) ?? null, available: a.ok, reason: a.ok ? null : a.reason, inDepth: true
    });
  }

  for (const [gsis, list] of ctx.history) {
    if (map.has(gsis)) continue;
    const g = list.filter(x => x.season === ctx.season && x.team === team && dates.has(x.game_date) && (x.snaps === null || x.snaps > 0));
    if (!g.length) continue;
    const pos = g[g.length - 1].position;
    if (!POS.includes(pos)) continue;
    map.set(gsis, {
      gsis, name: names?.get(gsis) || gsis, position: pos, depthRank: null,
      usualRank: usual.get(gsis) ?? null, available: false, reason: "NO_ESTA_EN_DEPTH_CHART", inDepth: false
    });
  }
  return [...map.values()];
}

// candidates: [{gsis, name, position, depthRank, usualRank, available, reason}]
function teamShares(ctx, team, candidates) {
  const dates = ctx.teamDates.get(team) || [];
  const recentDates = new Set(dates.slice(-CONFIG.recentTeamGames));

  const rows = candidates.map(c => {
    const list = (ctx.history.get(c.gsis) || []).filter(g => g.season === ctx.season && g.team === team && (g.snaps === null || g.snaps > 0));
    const prior = priorFor(ctx.priors, c.position, c.depthRank);
    const snap = weightedMean(list, "snapPct", CONFIG.snapHalfLife);
    const ts = weightedShare(list, "tgt", "teamTgt", CONFIG.shareHalfLife);
    const cs = weightedShare(list, "car", "teamCar", CONFIG.shareHalfLife);
    const ps = weightedShare(list, "att", "teamAtt", CONFIG.shareHalfLife);

    // Rol que venia jugando (orden por snaps en sus ultimos partidos)
    // vs rol del depth chart de hoy: si sube, hereda el puesto.
    const usualRank = c.usualRank ?? null;
    const promoted = usualRank !== null && c.depthRank !== null && c.depthRank < usualRank;
    const mSnap = promoted ? CONFIG.promotedPriorGames : CONFIG.snapPriorGames;
    const mShare = promoted ? CONFIG.promotedPriorGames : CONFIG.sharePriorGames;

    const blend = (own, nEff, pr, m) => (own === null || nEff === 0 ? pr : (own * nEff + pr * m) / (nEff + m));

    return {
      ...c,
      games: list.length,
      playedRecently: list.some(g => recentDates.has(g.game_date)),
      promoted,
      snapPct: clamp(blend(snap.mean, snap.nEff, prior.snap, mSnap), 0, 1),
      tshare: blend(ts.d > 0 ? ts.share : null, ts.d > 0 ? ts.nEff : 0, prior.tshare, mShare),
      cshare: blend(cs.d > 0 ? cs.share : null, cs.d > 0 ? cs.nEff : 0, prior.cshare, mShare),
      pshare: c.position === "QB" ? blend(ps.d > 0 ? ps.share : null, ps.d > 0 ? ps.nEff : 0, prior.pshare, mShare) : 0,
      history: list
    };
  });

  // ---- Lesiones: quien hereda lo de los que no juegan ----
  const out = rows.filter(r => !r.available && r.playedRecently);
  const ok = rows.filter(r => r.available);

  const redistribute = (key, sameGroup) => {
    for (const m of out) {
      const lost = m[key];
      if (!(lost > 0)) continue;

      // Partidos de esta temporada en que ESE jugador no estuvo:
      // cuanto subio cada companero (el "con / sin" medido).
      const withoutDates = new Set(dates.filter(d => !m.history.some(g => g.game_date === d)));
      const gains = new Map();
      let nWithout = 0;
      for (const j of ok) {
        const wo = j.history.filter(g => withoutDates.has(g.game_date));
        const wi = j.history.filter(g => !withoutDates.has(g.game_date));
        nWithout = Math.max(nWithout, wo.length);
        if (wo.length && wi.length) {
          const den = key === "tshare" ? "teamTgt" : key === "cshare" ? "teamCar" : "teamAtt";
          const num = key === "tshare" ? "tgt" : key === "cshare" ? "car" : "att";
          const a = sum(wo, g => g[num]) / Math.max(1, sum(wo, g => g[den]));
          const b = sum(wi, g => g[num]) / Math.max(1, sum(wi, g => g[den]));
          gains.set(j.gsis, Math.max(0, a - b));
        }
      }

      // Reparto por defecto: proporcional a lo que ya tiene cada uno,
      // el doble para la misma posicion.
      const weights = ok.map(j => {
        const same = sameGroup(m, j);
        return { j, w: j[key] * (same ? CONFIG.samePositionBoost : 1) * (same || key === "tshare" ? 1 : 0) };
      });
      const wTotal = weights.reduce((s, x) => s + x.w, 0);
      const measured = [...gains.values()].reduce((s, v) => s + v, 0);
      const trust = measured > 0 ? nWithout / (nWithout + CONFIG.withoutPriorGames) : 0;

      for (const { j, w } of weights) {
        const byDefault = wTotal > 0 ? lost * w / wTotal : 0;
        const byData = measured > 0 ? lost * (gains.get(j.gsis) || 0) / measured : 0;
        j[key] += (1 - trust) * byDefault + trust * byData;
        j.inherits = (j.inherits || 0) + (1 - trust) * byDefault + trust * byData;
      }
    }
  };

  redistribute("tshare", (m, j) => m.position === j.position);
  redistribute("cshare", (m, j) => m.position === j.position || (m.position === "RB" && j.position === "RB"));

  // QB: el titular de hoy se queda con los pases.
  const qbs = ok.filter(r => r.position === "QB").sort((a, b) => (a.depthRank ?? 9) - (b.depthRank ?? 9));
  qbs.forEach((q, i) => {
    // El titular: su parte historica de los pases (los suplentes
    // tambien tiran en palizas o si el titular se lesiona en el juego).
    if (i === 0 && !(q.pshare > 0.5)) q.pshare = priorFor(ctx.priors, "QB", 1).pshare;
    if (i > 0) q.pshare = 0;
    if (i > 0) {
      q.cshare = 0;
      q.snapPct = 0;
    }
  });

  // Normalizar: lo de todos no puede pasar del 100%.
  // "otros" = lo que historicamente va a jugadores fuera de la lista.
  for (const key of ["tshare", "cshare"]) {
    const total = sum(ok, r => r[key]);
    const cap = 0.98;
    if (total > cap) for (const r of ok) r[key] *= cap / total;
  }

  return ok;
}


// ------------------------------------------------------------
// 7) PROYECCION DE UN PARTIDO
// ------------------------------------------------------------

// game: {game_id, home_team, away_team, location, roof}
// candidatesByTeam: Map(team -> candidatos)
function projectGame(ctx, game, candidatesByTeam, weather) {
  const neutral = String(game.location || "").toLowerCase() === "neutral";
  const teams = [game.home_team, game.away_team];

  const starters = {};
  const qbF = {};
  for (const t of teams) {
    const qb = (candidatesByTeam.get(t) || [])
      .filter(c => c.position === "QB" && c.available)
      .sort((a, b) => (a.depthRank ?? 9) - (b.depthRank ?? 9))[0];
    starters[t] = qb?.gsis || null;
    qbF[t] = qbChange(ctx, t, starters[t]);
  }

  const envH = teamEnvironment(ctx, game, game.home_team, game.away_team, true, neutral, weather, qbF[game.home_team]);
  const envA = teamEnvironment(ctx, game, game.away_team, game.home_team, false, neutral, weather, qbF[game.away_team]);
  if (!envH || !envA) return null;

  const env = {
    [game.home_team]: finishEnvironment(envH, envA),
    [game.away_team]: finishEnvironment(envA, envH)
  };

  const players = [];
  for (const t of teams) {
    const e = env[t];
    const opp = t === game.home_team ? game.away_team : game.home_team;
    const list = teamShares(ctx, t, candidatesByTeam.get(t) || []);

    // Eficiencia y defensa por jugador.
    for (const p of list) {
      p.eff = efficiency(ctx.history.get(p.gsis) || [], ctx.season, p.position, ctx.lgPos);
      p.arch = ctx.defense.archOf.get(p.gsis) || archetype(ctx.history.get(p.gsis) || [], p.position, ctx.season);
      p.def = ctx.defense.get(opp, p.position, p.arch).arch;
    }

    // Defensa RELATIVA dentro del equipo: la defensa de equipo ya
    // bajo/subio el total de pases y carreras; esto decide A QUIEN
    // le va mejor o peor dentro de ese total.
    const relTo = (key, group) => {
      const g = list.filter(group);
      const w = sum(g, p => p[key]);
      const avgDef = w > 0 ? sum(g, p => p[key] * p.def) / w : 1;
      for (const p of g) p[`rel_${key}`] = p.def / (avgDef || 1);
    };
    relTo("tshare", p => p.position !== "QB");
    relTo("cshare", () => true);

    const lgW = ctx.lgPos.WR;
    const others = { tshare: Math.max(0, 1 - sum(list, p => p.tshare)), cshare: Math.max(0, 1 - sum(list, p => p.cshare)) };
    const yW = sum(list, p => p.tshare * p.eff.ypt * (p.rel_tshare || 1)) + others.tshare * lgW.ypt;
    const cW = sum(list, p => p.tshare * p.eff.catch) + others.tshare * lgW.catch;
    const tdW = sum(list, p => p.tshare * p.eff.recTd * (p.rel_tshare || 1)) + others.tshare * lgW.recTd;
    const ryW = sum(list, p => p.cshare * p.eff.ypc * (p.rel_cshare || 1)) + others.cshare * ctx.lgPos.RB.ypc;
    const rtW = sum(list, p => p.cshare * p.eff.rushTd * (p.rel_cshare || 1)) + others.cshare * ctx.lgPos.RB.rushTd;

    // Defensa contra QB (medida contra QB parecidos): ajusta el total
    // de pases del equipo, y por lo tanto tambien a sus receptores.
    const qbDef = list.find(p => p.position === "QB" && p.pshare > 0.5);
    const qbExtra = qbDef ? Math.pow(qbDef.def, CONFIG.qbDefExtraPower) : 1;
    if (qbExtra !== 1) {
      e.passYds *= qbExtra;
      e.passTd *= qbExtra;
      e.qbDefExtra = qbExtra;
    }

    for (const p of list) {
      const lg = ctx.lgPos[p.position] || ctx.lgPos.WR;
      const tgt = e.att * p.tshare;
      const s = {
        snaps: e.plays * p.snapPct,
        targets: tgt,
        carries: e.carries * p.cshare,
        passAtt: e.att * p.pshare,
        rec: cW > 0 ? e.comp * (p.tshare * p.eff.catch) / cW : 0,
        recYds: yW > 0 ? e.passYds * (p.tshare * p.eff.ypt * (p.rel_tshare || 1)) / yW : 0,
        recTd: tdW > 0 ? e.passTd * (p.tshare * p.eff.recTd * (p.rel_tshare || 1)) / tdW : 0,
        rushYds: ryW > 0 ? e.rushYds * (p.cshare * p.eff.ypc * (p.rel_cshare || 1)) / ryW : 0,
        rushTd: rtW > 0 ? e.rushTd * (p.cshare * p.eff.rushTd * (p.rel_cshare || 1)) / rtW : 0,
        passYds: e.passYds * p.pshare,
        passTd: e.passTd * p.pshare,
        int: e.int * p.pshare
      };
      const touches = s.carries + s.rec + (p.position === "QB" ? s.passAtt : 0);
      s.fumbles = touches * lg.fumblePerTouch;
      s.twoPt = (s.recTd + s.rushTd + s.passTd) * lg.twoPtPerTd;

      players.push({
        gsis: p.gsis, name: p.name, team: t, opponent: opp, game_id: game.game_id,
        position: p.position, depthRank: p.depthRank, promoted: p.promoted, inherits: round(p.inherits || 0, 3),
        games: p.games, archetype: p.arch, defFactor: round(p.def, 3),
        snapPct: p.snapPct, tshare: p.tshare, cshare: p.cshare, pshare: p.pshare,
        eff: p.eff, stats: s,
        dk: offensePoints(s, "draftkings"),
        fd: offensePoints(s, "fanduel")
      });
    }
  }

  // DST de cada equipo: defiende al otro.
  const dst = teams.map(t => {
    const opp = t === game.home_team ? game.away_team : game.home_team;
    const eo = env[opp];
    const r = ctx.ratings.get(t);
    const ro = ctx.ratings.get(opp);
    const lgD = ctx.league.defPerGame;
    const takeaway = eo.int + (0.5 * r.dstFrPerGame + 0.5 * ro.fumblesLostPerPlay * eo.plays);
    const s = {
      sacks: eo.sacks,
      int: eo.int,
      fr: 0.5 * r.dstFrPerGame + 0.5 * ro.fumblesLostPerPlay * eo.plays,
      defTd: takeaway * ctx.league.defTdPerTakeaway,
      retTd: lgD.retTd,
      safety: lgD.safety,
      blocks: lgD.blocks,
      pa: eo.points
    };
    return { team: t, opponent: opp, game_id: game.game_id, stats: s };
  });

  return { env, players, dst, starters };
}


// ------------------------------------------------------------
// 8) SIMULACION (equipo primero, luego jugadores)
// ------------------------------------------------------------
// Cada simulacion sortea como le va a cada OFENSIVA (volumen,
// pase, carrera). Todos los jugadores de ese equipo comparten
// ese sorteo: si el QB tiene un gran dia, sus receptores tambien.
// La DST rival usa los mismos sacks, intercepciones y puntos.

function simulateGame(ctx, proj, { sims = CONFIG.sims, seed = 1 } = {}) {
  const rand = rng(seed);
  const gauss = normalSampler(rand);
  const S = CONFIG.sigma;
  const teams = Object.keys(proj.env);

  const byTeam = new Map(teams.map(t => [t, proj.players.filter(p => p.team === t)]));
  const results = new Map(proj.players.map(p => [p.gsis, { dk: new Float32Array(sims), fd: new Float32Array(sims) }]));
  const dstRes = new Map(proj.dst.map(d => [d.team, new Float32Array(sims)]));

  for (let i = 0; i < sims; i++) {
    const teamOut = {};
    for (const t of teams) {
      const e = proj.env[t];
      const zv = gauss() * S.plays, zp = gauss() * S.pass, zr = gauss() * S.rush;
      const vol = Math.exp(zv - S.plays ** 2 / 2);
      const pf = Math.exp(zp - S.pass ** 2 / 2);
      const rf = Math.exp(zr - S.rush ** 2 / 2);
      const passTd = poisson(rand, e.passTd * vol * Math.exp(1.2 * zp - (1.2 * S.pass) ** 2 / 2));
      const rushTd = poisson(rand, e.rushTd * vol * Math.exp(1.2 * zr - (1.2 * S.rush) ** 2 / 2));
      const ints = poisson(rand, e.int * vol);
      const sacks = poisson(rand, e.sacks * vol);
      const fg = Math.max(0, e.points - CONFIG.pointsPerTD * (e.passTd + e.rushTd) + gauss() * S.fieldGoalPoints);
      teamOut[t] = { vol, pf, rf, passTd, rushTd, ints, sacks, points: Math.round(CONFIG.pointsPerTD * (passTd + rushTd) + fg) };
    }

    for (const t of teams) {
      const e = proj.env[t];
      const o = teamOut[t];
      const players = byTeam.get(t);

      // Cuantos balones le tocan hoy a cada uno (sorteo propio).
      const shock = new Map();
      for (const p of players) {
        const ss = S.share[p.position] || 0.3;
        shock.set(p.gsis, Math.exp(gauss() * ss - ss * ss / 2));
      }

      // Repartir los TD del equipo entre los jugadores (el que hoy
      // recibe mas balones tiene mas opciones).
      const recTdOwner = new Map();
      const rushTdOwner = new Map();
      const assign = (count, key, totalKey, owner) => {
        if (!count) return;
        const weights = players.map(p => p.stats[key] * shock.get(p.gsis));
        const listed = weights.reduce((a, b) => a + b, 0);
        const others = Math.max(0, e[totalKey] - players.reduce((a, p) => a + p.stats[key], 0));
        const total = listed + others;
        for (let k = 0; k < count; k++) {
          let u = rand() * total;
          for (let j = 0; j < players.length; j++) {
            u -= weights[j];
            if (u <= 0) {
              owner.set(players[j].gsis, (owner.get(players[j].gsis) || 0) + 1);
              break;
            }
          }
        }
      };
      assign(o.passTd, "recTd", "passTd", recTdOwner);
      assign(o.rushTd, "rushTd", "rushTd", rushTdOwner);

      for (const p of players) {
        const s = p.stats;
        const sh = shock.get(p.gsis);
        const sy = S.recYards[p.position] || 0.5;
        const sr = S.rushYards[p.position] || 0.6;
        const isQB = p.position === "QB" && p.pshare > 0.5;
        const sim = {
          passYds: isQB ? s.passYds * o.vol * o.pf * sh : 0,
          passTd: isQB ? Math.round(o.passTd * Math.min(1, s.passTd / Math.max(1e-9, e.passTd))) : 0,
          int: isQB ? o.ints : 0,
          rushYds: s.rushYds * o.vol * o.rf * sh * Math.exp(gauss() * sr - sr * sr / 2),
          rushTd: rushTdOwner.get(p.gsis) || 0,
          rec: s.rec > 0 ? poisson(rand, s.rec * o.vol * sh) : 0,
          recYds: s.recYds * o.vol * o.pf * sh * Math.exp(gauss() * sy - sy * sy / 2),
          recTd: recTdOwner.get(p.gsis) || 0,
          fumbles: poisson(rand, s.fumbles),
          twoPt: s.twoPt
        };
        const r = results.get(p.gsis);
        r.dk[i] = offensePoints(sim, "draftkings");
        r.fd[i] = offensePoints(sim, "fanduel");
      }
    }

    for (const d of proj.dst) {
      const o = teamOut[d.opponent];
      const s = d.stats;
      const fr = poisson(rand, s.fr);
      const sim = {
        sacks: o.sacks,
        int: o.ints,
        fr,
        defTd: poisson(rand, (o.ints + fr) * ctx.league.defTdPerTakeaway),
        retTd: poisson(rand, s.retTd),
        safety: poisson(rand, s.safety),
        blocks: poisson(rand, s.blocks),
        pa: o.points
      };
      dstRes.get(d.team)[i] = dstPoints(sim);
    }
  }

  const summarize = arr => {
    const sorted = Float32Array.from(arr).sort();
    let total = 0;
    for (const v of arr) total += v;
    return { mean: round(total / arr.length), p10: round(quantile(sorted, 0.1)), p50: round(quantile(sorted, 0.5)), p90: round(quantile(sorted, 0.9)) };
  };

  for (const p of proj.players) {
    const r = results.get(p.gsis);
    p.sim = { draftkings: summarize(r.dk), fanduel: summarize(r.fd) };
  }
  for (const d of proj.dst) {
    const s = summarize(dstRes.get(d.team));
    d.sim = { draftkings: s, fanduel: s };
  }
  return proj;
}


module.exports = {
  CONFIG,
  buildContext,
  buildCandidates,
  usualRanks,
  projectGame,
  simulateGame,
  offensePoints,
  dstPoints,
  pointsAllowedScore,
  pprPoints,
  priorFor,
  normPos
};

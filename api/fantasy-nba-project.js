// ============================================================
// CASHEDGE FANTASY NBA — LA FORMULA (FASE 2)
// ============================================================
//
// Lee SOLO Supabase. Cero APIs externas.
// Guarda el resultado en Supabase. No publica nada.
//
// USO (navegador)
//   /api/fantasy-nba-project?secret=...&view=1       -> VER la proyeccion guardada de hoy
//   /api/fantasy-nba-project?secret=...&run=1&view=1 -> RECALCULAR hoy, guardar y ver
//                       (no recalcula fechas pasadas ni slates que ya empezaron)
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
const { buildLineups } = require("./_lib/fantasy-nba-lineups.js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  // Reglas
  minSalary: 3501,
  maxDepthRank: 2,
  lineupCount: 10,          // alineaciones por casa (de la mas optima a la menos)
  lineupMinDifferent: 2,    // cada alineacion cambia al menos 2 jugadores
  minProjectedMinutes: 18,
  minHistoryMinutes: 40,

  // Minutos
  teamMinutes: 241,
  // Peso de esta temporada: ruido de un partido (desviacion de
  // sus minutos) contra cuanto puede cambiar un rol de una
  // temporada a otra. Con 2 partidos esta temporada pesa ~75%.
  seasonShiftSd: 6,
  teamPriorGames: 3,
  currentDecay: 0.85,
  previousDecay: 0.95,
  previousGames: 30,
  otherTeamWeight: 0.5,
  profilePriorGames: 5,
  blowoutMargin: 20,
  strengthPriorGames: 10,
  previousStrengthCarry: 0.65,
  injuryExitShare: 0.4,
  maxStarterMinutes: 40,
  maxBenchMinutes: 34,
  starterMinScale: 0.9,      // recortar titulares mas de 10% = datos incompletos
  normalizeMax: 1.25,        // necesitar 25%+ de minutos extra = datos incompletos
  roleChangeMinSamples: 20,
  deepBenchRank: 3,
  appearanceGames: 10,
  appearancePriorGames: 3,
  benchMinScale: 0.6,        // la banca absorbe primero el exceso de minutos
  benchMinMinutes: 15,       // proteccion de suplentes
  benchMinShare: 0.6,
  benchMinGames: 2,

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

  // Marcador por cuarto (si la tabla todavia no existe, se sigue
  // solo con el marcador final).
  const quarters = new Map();
  try {
    const q = await selectAll(
      "nba_game_quarters",
      "game_id,home_q1,home_q2,home_q3,visitor_q1,visitor_q2,visitor_q3",
      b => b.order("game_id", { ascending: true })
    );
    for (const r of q) {
      const h = [r.home_q1, r.home_q2, r.home_q3].map(Number);
      const v = [r.visitor_q1, r.visitor_q2, r.visitor_q3].map(Number);
      if ([...h, ...v].every(ok)) {
        quarters.set(Number(r.game_id), { home: h[0] + h[1] + h[2], visitor: v[0] + v[1] + v[2] });
      }
    }
  } catch (error) {
    console.warn("Sin marcador por cuarto:", error.message);
  }

  // Linea de apertura de cada partido (si la tabla aun no existe,
  // se sigue sin linea).
  const spreads = new Map();
  try {
    const rows = await selectAll(
      "nba_game_spreads",
      "game_id,opening_home_spread,current_home_spread",
      b => b.order("game_id", { ascending: true })
    );
    for (const r of rows) {
      const v = r.opening_home_spread ?? r.current_home_spread;
      if (v !== null && v !== undefined && ok(Number(v))) spreads.set(Number(r.game_id), Number(v));
    }
  } catch (error) {
    console.warn("Sin lineas de apuesta:", error.message);
  }

  // Solo partidos ANTES del dia que se proyecta.
  const gameMap = new Map();
  for (const g of games) {
    const date = nbaDay(g.game_date);
    if (!date || date >= day) continue;
    const q3 = quarters.get(Number(g.game_id)) || null;
    gameMap.set(Number(g.game_id), {
      homeSpread: spreads.has(Number(g.game_id)) ? spreads.get(Number(g.game_id)) : null,
      q3Home: q3 ? q3.home : null,
      q3Visitor: q3 ? q3.visitor : null,
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
      // Que tan decidido estuvo: la mayor diferencia entre el final
      // del 3er cuarto y el final. Un partido que iba por 34 en el
      // 3ro y termino por 22 se trata como de 34: ahi sentaron a
      // los titulares.
      const q3 = g.q3Home === null ? null
        : (isHome ? g.q3Home - g.q3Visitor : g.q3Visitor - g.q3Home);
      const decided = q3 !== null && Math.abs(q3) > Math.abs(margin) ? q3 : margin;
      map.set(g.id, {
        id: g.id,
        season: g.season,
        date: g.date,
        opp: isHome ? g.visitor : g.home,
        margin,
        q3Margin: q3,
        decided,
        // Linea desde el punto de vista de ESTE equipo
        // (negativo = era favorito).
        spread: g.homeSpread === null ? null : (isHome ? g.homeSpread : -g.homeSpread),
        blowout: Math.abs(decided) >= CONFIG.blowoutMargin,
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
      decided: tg.decided,
      spread: tg.spread,
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

  // Linea de hoy por equipo (negativo = favorito).
  const todaySpreads = new Map();
  try {
    const rows = await selectAll(
      "nba_game_spreads",
      "home_team_id,visitor_team_id,current_home_spread,opening_home_spread",
      q => q.eq("game_date", day)
    );
    for (const r of rows) {
      const v = r.current_home_spread ?? r.opening_home_spread;
      if (v === null || v === undefined || !ok(Number(v))) continue;
      todaySpreads.set(Number(r.home_team_id), Number(v));
      todaySpreads.set(Number(r.visitor_team_id), -Number(v));
    }
  } catch (error) {
    console.warn("Sin lineas de hoy:", error.message);
  }

  return {
    snapshotDate,
    slates,
    slatePlayers,
    depth,
    todaySpreads,
    injuries: new Map(injuries.map(i => [Number(i.player_id), str(i.status)]))
  };
}


// ============================================================
// MODELOS DE LA LIGA (todo medido con tus datos)
// ============================================================

// Estilo de rotacion de cada equipo.
//   S[i]     minutos del titular i (de mas a menos minutos)
//   Bcond[k] minutos del suplente k CUANDO entra a jugar
//   Bplay[k] que tan seguido entra el suplente k
//   B[k]     promedio total del suplente k (incluye cuando no entra)
function normalCdf(x) {
  // Aproximacion de Abramowitz-Stegun.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function buildProfiles(teamGames) {
  const empty = () => ({ S: Array(5).fill(0), B: Array(10).fill(0), Bpos: Array(10).fill(0), n: 0 });
  const leagueAll = empty();
  const leagueNormal = empty();
  const leagueBlow = empty();
  const profiles = new Map();
  const usage = new Map();

  const add = (acc, g) => {
    const played = [...g.rows.values()];
    const S = played.filter(r => r.starter === true).map(r => r.min).sort((a, b) => b - a);
    if (S.length !== 5) return false;
    const B = played.filter(r => r.starter === false).map(r => r.min).sort((a, b) => b - a);
    while (B.length < 10) B.push(0);
    S.forEach((m, i) => (acc.S[i] += m));
    B.slice(0, 10).forEach((m, i) => {
      acc.B[i] += m;
      if (m > 0) acc.Bpos[i]++;
    });
    acc.n++;
    return true;
  };

  const avg = acc => ({
    S: acc.S.map(x => x / acc.n),
    B: acc.B.map(x => x / acc.n),
    Bcond: acc.B.map((x, i) => (acc.Bpos[i] ? x / acc.Bpos[i] : 0)),
    Bplay: acc.Bpos.map(x => x / acc.n)
  });

  const blend = (a, b, w) => Object.fromEntries(
    Object.keys(a).map(k => [k, a[k].map((x, i) => w * x + (1 - w) * b[k][i])])
  );

  for (const [team, games] of teamGames) {
    const cur = empty();
    const prev = empty();
    const useCur = [];
    const usePrev = [];

    for (const g of games) {
      add(leagueAll, g);
      if (g.blowout) add(leagueBlow, g);
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

    let profile;
    if (cur.n && prev.n) profile = blend(avg(cur), avg(prev), cur.n / (cur.n + CONFIG.profilePriorGames));
    else if (cur.n || prev.n) profile = avg(cur.n ? cur : prev);
    else continue;

    profiles.set(team, { ...profile, gamesCur: cur.n, gamesPrev: prev.n });
  }

  if (!leagueNormal.n) throw new Error("No hay partidos con titulares para medir rotaciones");

  const ln = avg(leagueNormal);
  const la = avg(leagueAll);
  const league = { ...ln, gamesCur: 0, gamesPrev: 0 };

  for (const p of [...profiles.values(), league]) {
    p.starterAvg = mean(p.S);
    p.label =
      p.starterAvg >= 32 ? "TITULARES CARGADOS" :
      p.starterAvg <= 29 ? "ROTA MUCHO" : "NORMAL";
  }

  // PALIZAS (todo medido con tus partidos):
  //  - cuanto juegan titulares y suplentes en una paliza vs normal
  //  - nivel de cada equipo (diferencia de puntos promedio)
  //  - que tan lejos queda el marcador real de lo esperado
  // Con eso cada partido de hoy tiene SU probabilidad de paliza
  // segun la diferencia de nivel entre los dos equipos.
  const lb = leagueBlow.n ? avg(leagueBlow) : ln;
  const benchCond = acc => {
    const minutes = acc.B.reduce((x, y) => x + y, 0);
    const played = acc.Bpos.reduce((x, y) => x + y, 0);
    return played ? minutes / played : 0;
  };
  const strength = new Map();
  for (const [team, games] of teamGames) {
    const cur = games.filter(g => g.season === CUR).map(g => g.margin);
    const prev = games.filter(g => g.season === PREV).map(g => g.margin);
    // La temporada pasada se acerca a 0 (los rosters cambian en el
    // verano). Valor estandar NBA; la evaluacion diaria lo revisa.
    const prevLevel = prev.length ? mean(prev) * CONFIG.previousStrengthCarry : 0;
    const w = cur.length / (cur.length + CONFIG.strengthPriorGames);
    strength.set(team, cur.length ? w * mean(cur) + (1 - w) * prevLevel : prevLevel);
  }
  const residuals = [];
  for (const [team, games] of teamGames) {
    for (const g of games) {
      residuals.push(g.decided - ((strength.get(team) ?? 0) - (strength.get(g.opp) ?? 0)));
    }
  }
  const blowout = {
    starterRatio: leagueBlow.n ? mean(lb.S) / mean(ln.S) : 1,
    benchRatio: leagueBlow.n && benchCond(leagueNormal) ? benchCond(leagueBlow) / benchCond(leagueNormal) : 1,
    marginSd: std(residuals) || 13,
    games: leagueBlow.n
  };
  // Probabilidad de que la diferencia final caiga en cada rango.
  const absBetween = (mu, sd, lo, hi) => {
    const p = (a, b) => normalCdf((b - mu) / sd) - normalCdf((a - mu) / sd);
    return hi === Infinity
      ? (1 - normalCdf((lo - mu) / sd)) + normalCdf((-lo - mu) / sd)
      : p(lo, hi) + p(-hi, -lo);
  };
  blowout.binProbabilities = (team, opp) => {
    const mu = (strength.get(team) ?? 0) - (strength.get(opp) ?? 0);
    const sd = blowout.marginSd;
    return MARGIN_BINS.map((b, i) => (i === 0
      ? normalCdf((b.hi - mu) / sd) - normalCdf((-b.hi - mu) / sd)
      : absBetween(mu, sd, b.lo, b.hi)));
  };
  blowout.probability = (team, opp) => blowout.binProbabilities(team, opp)[MARGIN_BINS.length - 1];

  return { profiles, league, blowout, usage, strength };
}

// Cuanto cambian los minutos de UN MISMO jugador segun la
// diferencia final del partido (0-9, 10-14, 15-19, 20+ puntos),
// comparado con sus partidos cerrados (0-9). No hace falta llegar
// a 20 puntos: en un partido de 15 la banca ya juega mas.
// Se compara a cada jugador consigo mismo (no el promedio de la
// banca, porque en esos partidos entran suplentes que casi no
// juegan y eso deforma el promedio).
const MARGIN_BINS = [
  { lo: 0, hi: 10, label: "0-9" },
  { lo: 10, hi: 15, label: "10-14" },
  { lo: 15, hi: 20, label: "15-19" },
  { lo: 20, hi: 25, label: "20-24" },
  { lo: 25, hi: 30, label: "25-29" },
  { lo: 30, hi: Infinity, label: "30+" }
];

function marginBin(margin) {
  const a = Math.abs(margin);
  return MARGIN_BINS.findIndex(b => a >= b.lo && a < b.hi);
}

function measureMarginRatios(byPlayer) {
  const ratios = { S: MARGIN_BINS.map(() => []), B: MARGIN_BINS.map(() => []) };
  // Minutos de cada partido divididos entre los minutos normales
  // del jugador: sirve para medir cuanto "ruido" trae cada rango.
  const spread = { S: MARGIN_BINS.map(() => []), B: MARGIN_BINS.map(() => []) };
  for (const rows of byPlayer.values()) {
    const groups = new Map();
    for (const r of rows) {
      if (r.starter === null) continue;
      const role = r.starter ? "S" : "B";
      const key = `${r.team}:${r.season}:${role}`;
      if (!groups.has(key)) groups.set(key, { role, bins: MARGIN_BINS.map(() => []) });
      groups.get(key).bins[marginBin(r.decided)].push(r.min);
    }
    for (const g of groups.values()) {
      const close = g.bins[0];
      if (close.length < 5) continue;
      const base = mean(close);
      for (let i = 0; i < MARGIN_BINS.length; i++) {
        for (const m of g.bins[i]) spread[g.role][i].push(m / base);
        if (i > 0 && g.bins[i].length >= 3) ratios[g.role][i].push(mean(g.bins[i]) / base);
      }
    }
  }
  // Sin suficientes casos en un rango: no se ajusta (x1).
  const pick = list => list.map((l, i) => (i === 0 ? 1 : l.length >= CONFIG.roleChangeMinSamples ? median(l) : 1));
  const S = pick(ratios.S);
  const B = pick(ratios.B);

  // Cuanto vale un partido de cada rango comparado con uno cerrado:
  // si en las palizas los minutos varian el doble, ese partido
  // cuenta como 1/4 de partido (menos informacion).
  const weights = (list, r) => {
    const v = list.map((l, i) => (l.length >= CONFIG.roleChangeMinSamples ? std(l.map(x => x / r[i])) : null));
    return v.map(x => (x && v[0] ? clamp((v[0] * v[0]) / (x * x), 0.1, 1) : 1));
  };

  return {
    S,
    B,
    weightS: weights(spread.S, S),
    weightB: weights(spread.B, B),
    samplesS: ratios.S.map(l => l.length),
    samplesB: ratios.B.map(l => l.length)
  };
}

// MINUTOS SEGUN LA LINEA DEL PARTIDO (antes de jugarse).
// Para cada jugador: sus minutos en partidos donde su equipo era
// favorito o underdog por cierta cantidad, comparados con sus
// minutos de partido cerrado. Mediana de todos los jugadores.
// Esto es lo que se aplica al partido de HOY.
const SPREAD_BINS = [
  { label: "parejo (menos de 4)", test: s => Math.abs(s) < 4 },
  { label: "favorito 4-7.5", test: s => s <= -4 && s > -8 },
  { label: "favorito 8-11.5", test: s => s <= -8 && s > -12 },
  { label: "favorito 12+", test: s => s <= -12 },
  { label: "underdog 4-7.5", test: s => s >= 4 && s < 8 },
  { label: "underdog 8-11.5", test: s => s >= 8 && s < 12 },
  { label: "underdog 12+", test: s => s >= 12 }
];

const spreadBin = s => SPREAD_BINS.findIndex(b => b.test(s));

function measureSpreadRatios(byPlayer, marginRatios) {
  const ratios = { S: SPREAD_BINS.map(() => []), B: SPREAD_BINS.map(() => []) };
  for (const rows of byPlayer.values()) {
    const groups = new Map();
    for (const r of rows) {
      if (r.starter === null || r.spread === null || r.spread === undefined) continue;
      const role = r.starter ? "S" : "B";
      const key = `${r.team}:${r.season}:${role}`;
      if (!groups.has(key)) groups.set(key, { role, rows: [] });
      groups.get(key).rows.push(r);
    }
    for (const g of groups.values()) {
      if (g.rows.length < 8) continue;
      const mr = g.role === "S" ? marginRatios.S : marginRatios.B;
      // Sus minutos de "partido cerrado" (cada partido corregido).
      const base = mean(g.rows.map(r => r.min / (mr[marginBin(r.decided)] || 1)));
      if (!(base > 0)) continue;
      SPREAD_BINS.forEach((b, i) => {
        const inBin = g.rows.filter(r => b.test(r.spread));
        if (inBin.length >= 3) ratios[g.role][i].push(mean(inBin.map(r => r.min)) / base);
      });
    }
  }
  const pick = list => list.map(l => (l.length >= CONFIG.roleChangeMinSamples ? median(l) : null));
  return {
    S: pick(ratios.S),
    B: pick(ratios.B),
    samplesS: ratios.S.map(l => l.length),
    samplesB: ratios.B.map(l => l.length)
  };
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
  // Sin suficientes casos reales NO se inventa un aumento.
  if (up.length < CONFIG.roleChangeMinSamples) return { up: null, down: null, samples: up.length };
  const ratio = median(up);
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
  // Cada partido se lleva a "partido cerrado" segun su diferencia
  // final (medido): si la banca jugo mucho porque el partido se
  // decidio, los minutos del titular se corrigen hacia arriba.
  const mr = ctx.models.marginRatios;
  const pool = all
    .filter(r => r.starter !== null)
    .map(r => {
      const bin = marginBin(r.decided);
      const ratio = (r.starter ? mr.S : mr.B)[bin] || 1;
      const info = (r.starter ? mr.weightS : mr.weightB)?.[bin] ?? 1;
      return { ...r, rawMin: r.min, min: r.min / ratio, info };
    });

  let roleRows = pool.filter(isRole);

  // Titular que salio lesionado o expulsado: no representa su rol.
  if (role === "S") {
    const med = median(roleRows.filter(r => r.team === team).map(r => r.min)) ?? median(roleRows.map(r => r.min));
    if (med) roleRows = roleRows.filter(r => r.min >= CONFIG.injuryExitShare * med);
  }

  const cur = roleRows.filter(r => r.team === team && r.season === CUR);
  const prevSame = roleRows.filter(r => r.team === team && r.season === PREV).slice(0, CONFIG.previousGames);
  const prevOther = roleRows.filter(r => r.team !== team).slice(0, CONFIG.previousGames);

  // Banca: minutos del puesto CUANDO entra (su historial tambien
  // es solo de partidos jugados). Que tan seguido entra va aparte.
  const teamPrior = role === "S"
    ? profile.starterAvg
    : profile.Bcond[Math.min(order, 9)] || 0.5;

  // Un partido decidido informa menos que uno cerrado (peso medido).
  const curEst = weighted(cur, r => r.min, (r, i) => Math.pow(CONFIG.currentDecay, i) * (r.info ?? 1));
  const curGamesEffective = cur.reduce((sum, r) => sum + (r.info ?? 1), 0);
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
    const ratio = role === "S" ? ctx.models.roleChange.up : ctx.models.roleChange.down;
    if (otherEst.value !== null && ratio) {
      const capped = role === "S" ? Math.min(otherEst.value * ratio, profile.S[0]) : otherEst.value * ratio;
      prior = { value: capped, weight: 2 };
      source = role === "S" ? "nuevo titular (cambio medido en la liga)" : "nuevo suplente (cambio medido en la liga)";
    } else {
      source = otherEst.value !== null
        ? "sin evidencia suficiente de cambio de rol: estilo del equipo"
        : "sin historial: estilo del equipo";
    }
  }

  const prevBlend = prior.value === null
    ? teamPrior
    : (prior.weight * prior.value + CONFIG.teamPriorGames * teamPrior) / (prior.weight + CONFIG.teamPriorGames);

  // Variacion de minutos en ese rol (ruido de un partido).
  const sameTeam = roleRows.filter(r => r.team === team).slice(0, 20).map(r => r.min);
  const sdPrior = role === "S" ? CONFIG.minutesSdStarter : CONFIG.minutesSdBench;
  const s = std(sameTeam);
  const n = sameTeam.length;
  const sd = clamp(
    s === null ? sdPrior : Math.sqrt((n * s * s + 4 * sdPrior * sdPrior) / (n + 4)),
    CONFIG.minutesSdMin,
    CONFIG.minutesSdMax
  );

  // Esta temporada manda: cada partido actual vale segun lo
  // estable que es el jugador. Si un jugador de minutos estables
  // cambia de 20 a 36, se le cree rapido.
  const k = (sd * sd) / (CONFIG.seasonShiftSd * CONFIG.seasonShiftSd);
  const w = curGamesEffective / (curGamesEffective + k);
  const base = cur.length ? w * curEst.value + (1 - w) * prevBlend : prevBlend;

  return {
    base,
    teamPrior,
    current: curEst.value,
    currentGames: cur.length,
    currentGamesEffective: curGamesEffective,
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
    // Rango publicado por ESPN (antes de quitar lesionados).
    originalRank: Math.min(99, ...POSITIONS.map(p => d[`${p}_rank`]).filter(v => v !== null && v !== undefined)),
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
    // Partido de HOY: probabilidad de cada diferencia final segun el
    // nivel de los dos equipos, por cuanto cambian los minutos en
    // cada caso (medido).
    const bl = ctx.models.blowout;
    const probs = ctx.opponents?.has(team)
      ? bl.binProbabilities(team, ctx.opponents.get(team))
      : MARGIN_BINS.map((_, i) => (i === 0 ? 1 : 0));
    const ratios = role === "S" ? ctx.models.marginRatios.S : ctx.models.marginRatios.B;
    let factor = probs.reduce((sum, p, i) => sum + p * ratios[i], 0);
    const pBlow = probs[MARGIN_BINS.length - 1];
    let factorSource = "nivel de los equipos";

    // Si hay linea de apuesta de hoy: se usa lo medido para esa
    // linea (mas preciso que el nivel calculado).
    const todaySpread = ctx.todaySpreads?.get(team);
    if (todaySpread !== undefined) {
      const bin = spreadBin(todaySpread);
      const measured = bin >= 0 ? (role === "S" ? ctx.models.spreadRatios.S : ctx.models.spreadRatios.B)[bin] : null;
      if (measured) {
        factor = measured;
        factorSource = `linea ${todaySpread > 0 ? "+" : ""}${todaySpread} (${SPREAD_BINS[bin].label})`;
      }
    }

    if (!a.id) {
      // Sin enlace a BALLDONTLIE: solo ocupa minutos del equipo.
      const slot = Math.min(order, 9);
      const teamPrior = role === "S" ? profile.starterAvg : profile.Bcond[slot] || 0.5;
      const play = role === "S" ? 1 : profile.Bplay[slot] ?? 0.5;
      rows.push({
        ...a, role, order, effRank, depthPosition: startPos[key] || null,
        teamPrior, base: teamPrior, raw: teamPrior * factor * play, injury: { minutes: 0, rates: {} },
        cap: role === "S" ? CONFIG.maxStarterMinutes : CONFIG.maxBenchMinutes,
        sd: role === "S" ? CONFIG.minutesSdStarter : CONFIG.minutesSdBench,
        baseline: null, appearance: play, noHistory: true
      });
      return;
    }

    const baseline = roleBaseline(a.id, team, role, order, profile, ctx);
    const injury = mateEffect(a.id, team, role, importantOut, baseline, ctx);

    // Suplente: ¿que tan seguido entra a jugar?
    // Partidos del equipo desde que llego (un partido sin fila =
    // no jugo), mezclado con lo seguido que entra ese puesto de la
    // banca en ese equipo. Un jugador nuevo sin partidos jugados
    // ya no recibe minutos completos.
    let appearance = 1;
    if (role === "B") {
      const slotPlay = profile.Bplay[Math.min(order, 9)] ?? 0.5;
      const games = ctx.teamGames.get(team) || [];
      const first = teamRows(a.id, team, ctx).slice(-1)[0];
      const curGames = games.filter(g => g.season === CUR);
      // Si nunca ha jugado con el equipo, cuentan los partidos de
      // esta temporada (estaba en el roster y no jugo).
      const window = (first ? games.filter(g => g.date >= first.date) : curGames).slice(0, CONFIG.appearanceGames);
      const played = window.filter(g => g.rows.has(a.id)).length;
      appearance = (played + CONFIG.appearancePriorGames * slotPlay) / (window.length + CONFIG.appearancePriorGames);
    }

    // Proteccion de suplentes: ¿de verdad juega 15+ minutos?
    // Ultimos 10 partidos del equipo desde que llego (si no aparece
    // en el boxscore cuenta como 0). Si faltan companeros importantes,
    // se miran los partidos donde ellos ya faltaron.
    let playShare = null;
    let playShareBasis = null;
    if (role === "B") {
      const first = teamRows(a.id, team, ctx).slice(-1)[0];
      const since = first ? (ctx.teamGames.get(team) || []).filter(g => g.date >= first.date) : [];
      let window = since.slice(0, CONFIG.appearanceGames);
      playShareBasis = "ultimos partidos del equipo";
      if (importantOut.length) {
        const without = since
          .filter(g => importantOut.some(m => !g.rows.has(m.id)))
          .slice(0, CONFIG.appearanceGames);
        if (without.length >= CONFIG.benchMinGames) {
          window = without;
          playShareBasis = "partidos sin los companeros OUT";
        }
      }
      if (window.length >= CONFIG.benchMinGames) {
        playShare = window.filter(g => (g.rows.get(a.id)?.min || 0) >= CONFIG.benchMinMinutes).length / window.length;
      }
      playShareBasis = `${playShareBasis} (${window.length})`;
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
      blowoutProbability: pBlow,
      factorSource,
      todaySpread: todaySpread ?? null,
      appearance,
      playShare,
      playShareBasis,
      injury,
      cap,
      sd: baseline.sd,
      baseline
    });
  };

  starters.forEach((k, i) => add(k, "S", i));
  bench.forEach((k, i) => add(k, "B", i));

  // 241 minutos: reparto proporcional respetando maximos.
  // Si el ajuste necesario es muy grande, faltan datos del equipo
  // (jugadores sin enlace, depth chart incompleto): se marca y sus
  // jugadores no entran a alineaciones.
  //
  // Si sobran minutos: los minutos de los titulares son mas firmes
  // que los de la banca, asi que primero se recorta la banca (hasta
  // 60% de lo que traia) y solo despues a todos por igual.
  // Si faltan minutos (lesiones): se reparten entre todos.
  const rawSum = rows.reduce((s, r) => s + r.raw, 0);
  const factor = rawSum > 0 ? CONFIG.teamMinutes / rawSum : 0;
  const warnings = [];

  const benchRaw = rows.filter(r => r.role === "B").reduce((s, r) => s + r.raw, 0);
  const starterRaw = rawSum - benchRaw;
  let benchScale = 1;
  let allScale = factor;

  if (rawSum > CONFIG.teamMinutes && benchRaw > 0) {
    benchScale = Math.max(CONFIG.benchMinScale, (CONFIG.teamMinutes - starterRaw) / benchRaw);
    const afterBench = starterRaw + benchRaw * benchScale;
    allScale = CONFIG.teamMinutes / afterBench;
  }

  rows.forEach(r => (r.minutes = r.raw * (r.role === "B" ? benchScale : 1) * allScale));

  // Avisos = datos del equipo incompletos (sus jugadores no entran).
  if (allScale < CONFIG.starterMinScale) {
    warnings.push(`hubo que recortar a los titulares x${round(allScale, 2)}`);
  }
  if (factor > CONFIG.normalizeMax) {
    warnings.push(`faltan minutos en el equipo (x${round(factor, 2)})`);
  }
  for (let k = 0; k < 20; k++) {
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

  const finalSum = rows.reduce((s, r) => s + r.minutes, 0);
  if (Math.abs(finalSum - CONFIG.teamMinutes) > 1) {
    warnings.push(`los minutos suman ${round(finalSum, 1)}, no ${CONFIG.teamMinutes}`);
  }

  return {
    team,
    code: depth[0]?.team_abbr || String(team),
    profile,
    warnings,
    finalSum,
    benchScale,
    allScale,
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

  // Nunca recalcular el pasado: usaria lesiones y depth chart de
  // HOY y contaminaria la evaluacion.
  if (day < chicagoDay()) {
    return { date: day, message: "Fecha pasada: no se recalcula para no contaminar la evaluacion", platforms: [] };
  }

  const [history, today] = await Promise.all([loadHistory(day), loadToday(day)]);
  if (!today.slates.length) {
    return { date: day, message: "No hay slate guardado para hoy. Corre fantasy-nba-daily?step=slate", platforms: [] };
  }

  // Slates que ya empezaron quedan congelados (la proyeccion
  // guardada es la que se evalua).
  const lockedSlates = today.slates.filter(sl => sl.starts_at && Date.parse(sl.starts_at) <= Date.now());
  today.slates = today.slates.filter(sl => !lockedSlates.includes(sl));
  const openIds = new Set(today.slates.map(sl => Number(sl.slate_id)));
  today.slatePlayers = today.slatePlayers.filter(p => openIds.has(Number(p.slate_id)));
  if (!today.slates.length) {
    return { date: day, message: "Todos los slates de hoy ya empezaron: proyeccion congelada", platforms: [] };
  }

  const types = buildArchetypes(history.byPlayer);
  const models = {
    ...buildProfiles(history.teamGames),
    roleChange: buildRoleChange(history.byPlayer),
    marginRatios: measureMarginRatios(history.byPlayer),
    types,
    leagueRates: buildLeagueRates(history.byPlayer, types),
    defense: buildDefense(history.teamGames, types)
  };
  models.spreadRatios = measureSpreadRatios(history.byPlayer, models.marginRatios);


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
    depthByTeam,
    todaySpreads: today.todaySpreads
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

  ctx.opponents = opponents;

  // Revisar que TODOS los equipos del slate tengan depth chart.
  const slateTeams = [...new Set(today.slatePlayers.map(p => Number(p.team_id)))];
  const missingDepth = slateTeams
    .filter(t => !depthByTeam.has(t))
    .map(t => today.slatePlayers.find(p => Number(p.team_id) === t)?.team_abbr || String(t));
  const dataWarnings = [];
  if (missingDepth.length) dataWarnings.push(`Equipos sin depth chart (sus jugadores no entran): ${missingDepth.join(", ")}`);
  if (today.snapshotDate !== day) dataWarnings.push(`El depth chart es del ${today.snapshotDate}, no de hoy`);

  // PASO 1 y 2 para cada equipo del slate.
  const teamIds = slateTeams.filter(t => depthByTeam.has(t));
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
  const lineupRows = [];
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
      else if (tp.warnings.length) exclude(p, "MINUTOS_EQUIPO_NO_CUADRAN", { row });
      // Solo los puestos 1 y 2 que publico ESPN. Un #3 que sube por
      // lesion cuenta para repartir minutos, pero NO entra.
      else if (row.originalRank > CONFIG.maxDepthRank) exclude(p, "FUERA_DEL_TOP2_ESPN", { row });
      else if (row.role === "B" && !(row.playShare >= CONFIG.benchMinShare)) {
        exclude(p, row.playShare === null ? "SUPLENTE_SIN_HISTORIAL_CON_EQUIPO" : "SUPLENTE_NO_JUEGA_15_MIN_SEGURO", { row });
      }
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
            partidosEfectivos: round(row.baseline?.currentGamesEffective, 2),
            pesoEstaTemporada: round(row.baseline?.currentWeight, 2),
            temporadaPasada: round(row.baseline?.previous, 1),
            estiloEquipo: round(row.teamPrior, 1),
            mezcla: round(row.base, 1),
            probabilidadPaliza: round(row.blowoutProbability, 3),
            ajustePartido: round(row.blowoutFactor, 3),
            ajustePartidoFuente: row.factorSource || null,
            lineaDelPartido: row.todaySpread ?? null,
            entraAJugar: round(row.appearance, 2),
            juega15MasMinutos: row.playShare === null || row.playShare === undefined ? null : round(row.playShare, 2),
            basePara15Min: row.playShareBasis || null,
            rangoESPN: row.originalRank,
            rangoSinLesionados: row.effRank,
            companerosOut: round(row.injury?.minutes, 1),
            companerosDetalle: row.injury?.detail || null,
            ajuste241: (() => {
              const t = teamProjections.get(Number(p.team_id));
              return t ? round((row.role === "B" ? t.benchScale : 1) * t.allScale, 3) : null;
            })(),
            final: round(row.minutes, 1)
          },
          ...(f?.explain || {})
        } : null,
        model_version: "fantasy-nba-v2",
        created_at: runAt
      });
    }

    // PASO 6: ALINEACIONES (optimo exacto con los puntos proyectados).
    const lineupResult = buildLineups(platform, eligible.map(x => ({
      id: String(x.p.player_id),
      name: x.p.player_name,
      team: x.p.team_abbr,
      gameId: String(x.p.event_id),
      salary: Number(x.p.salary),
      points: x.f[platform].mean,
      positions: x.p.positions
    })), { count: CONFIG.lineupCount, minDifferent: CONFIG.lineupMinDifferent });

    lineupRows.push(...lineupResult.lineups.map(l => ({
      slate_id: Number(slate.slate_id),
      lineup_number: l.number,
      platform,
      slate_date: day,
      salary: l.salary,
      projected_points: l.points,
      optimal: l.optimal,
      players: l.players.map(p => ({ slot: p.slot, player_id: Number(p.id), name: p.name, team: p.team, salary: p.salary, points: p.points })),
      created_at: runAt
    })));

    platforms.push({
      platform,
      lineupStatus: lineupResult.status,
      lineupsOptimal: lineupResult.optimal,
      lineups: lineupResult.lineups.map(l => ({
        "#": l.number,
        proyectado: l.points,
        salario: l.salary,
        jugadores: l.players.map(p => `${p.slot}: ${p.name} ($${p.salary}, ${round(p.points, 1)})`).join(" | ")
      })),
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

  // Guardar alineaciones (se reemplazan las anteriores del slate).
  for (const slate of today.slates) {
    const rows = lineupRows.filter(r => r.slate_id === Number(slate.slate_id));
    if (rows.length) await upsertAll("fantasy_nba_lineups", rows, "slate_id,lineup_number");
    const { error } = await supabaseAdmin
      .from("fantasy_nba_lineups")
      .delete()
      .eq("slate_id", Number(slate.slate_id))
      .lt("created_at", runAt);
    if (error) throw new Error(`Supabase fantasy_nba_lineups: ${error.message}`);
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
      .in("team_id", [...teamProjections.keys()])
      .lt("created_at", runAt);
    if (error) throw new Error(`Supabase fantasy_nba_team_minutes: ${error.message}`);
  }

  const result = {
    date: day,
    depthChartDate: today.snapshotDate,
    avisos: dataWarnings,
    seconds: (Date.now() - t0) / 1000,
    historyGames: history.gamesCount,
    medido: {
      suplenteATitular: models.roleChange.up
        ? `x${round(models.roleChange.up, 2)} minutos (${models.roleChange.samples} casos)`
        : `sin evidencia suficiente (${models.roleChange.samples} casos)`,
      linea: "minutos segun la linea de apuesta (vs partido cerrado) — " +
        SPREAD_BINS.map((b, i) =>
          `${b.label}: titulares ${models.spreadRatios.S[i] ? "x" + round(models.spreadRatios.S[i], 2) : "sin datos"} (${models.spreadRatios.samplesS[i]}), ` +
          `banca ${models.spreadRatios.B[i] ? "x" + round(models.spreadRatios.B[i], 2) : "sin datos"} (${models.spreadRatios.samplesB[i]})`
        ).join(" | "),
      palizas: "minutos segun que tan decidido estuvo el partido (mayor diferencia entre el 3er cuarto y el final), vs partido cerrado — " +
        MARGIN_BINS.slice(1).map((b, j) => {
          const i = j + 1;
          return `${b.label} pts: titulares x${round(models.marginRatios.S[i], 2)} vale ${round(models.marginRatios.weightS[i], 2)} partido (${models.marginRatios.samplesS[i]}), ` +
            `banca x${round(models.marginRatios.B[i], 2)} (${models.marginRatios.samplesB[i]})`;
        }).join(" | ")
    },
    teams: [...teamProjections.values()].map(tp => ({
      equipo: tp.code,
      estilo: tp.profile.label,
      linea: ctx.todaySpreads?.get(tp.team) ?? null,
      titularesPromedio: round(tp.profile.starterAvg, 1),
      ajuste241: round(tp.factor, 3),
      ajusteBanca: round(tp.benchScale * tp.allScale, 3),
      ajusteTitulares: round(tp.allScale, 3),
      sumaMinutos: round(tp.finalSum, 1),
      avisos: tp.warnings,
      repartoJugadas: round(tp.usageFactor, 3),
      out: tp.out,
      duda: tp.doubtful,
      titulares: tp.rows.filter(r => r.role === "S").map(r => `${r.name} ${round(r.minutes, 1)}`),
      banca: tp.rows.filter(r => r.role === "B" && r.minutes >= 6).map(r => `${r.name} ${round(r.minutes, 1)}`)
    })),
    platforms
  };

  // Guardar el resumen para verlo sin recalcular. Los slates
  // congelados conservan su resumen anterior.
  const { data: previousRun } = await supabaseAdmin
    .from("fantasy_nba_runs")
    .select("summary")
    .eq("slate_date", day)
    .limit(1);
  const lockedIds = new Set(lockedSlates.map(sl => Number(sl.slate_id)));
  const keptPlatforms = (previousRun?.[0]?.summary?.platforms || []).filter(p => lockedIds.has(Number(p.slateId)));
  const stored = { ...result, platforms: [...keptPlatforms, ...result.platforms] };

  const { error: runError } = await supabaseAdmin
    .from("fantasy_nba_runs")
    .upsert([{ slate_date: day, summary: stored, created_at: runAt }], { onConflict: "slate_date" });
  if (runError) throw new Error(`Supabase fantasy_nba_runs: ${runError.message}`);

  return stored;
}

// Lee lo ya calculado (no recalcula ni escribe).
async function readStored(table, dateColumn, day) {
  const { data, error } = await supabaseAdmin.from(table).select("summary").eq(dateColumn, day).limit(1);
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return data?.[0]?.summary || null;
}


// ============================================================
// EVALUACION (despues de los partidos)
// ============================================================

async function runEvaluation(day) {
  const [games, minutesRows, projections] = await Promise.all([
    selectAll("nba_games", "game_id,game_date,stats_complete", q => q.in("season", [CUR, PREV]).order("game_id", { ascending: true })),
    selectAll("fantasy_nba_team_minutes", "*", q => q.eq("slate_date", day)),
    selectAll("fantasy_nba_projections", "*", q => q.eq("slate_date", day))
  ]);

  // Solo partidos con boxscore COMPLETO: si un jugador no aparece
  // ahi, de verdad no jugo (no es que falte cargar el boxscore).
  const dayGames = games.filter(g => nbaDay(g.game_date) === day);
  const gameIds = dayGames.filter(g => g.stats_complete === true).map(g => Number(g.game_id));
  const pendingBox = dayGames.length - gameIds.length;
  if (!gameIds.length) {
    return { date: day, message: pendingBox ? `Faltan ${pendingBox} boxscores por cargar; se evalua cuando esten completos` : "No hay partidos terminados guardados para esa fecha" };
  }
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

  // Calibracion: ¿que predijo mejor los minutos? La mezcla final,
  // solo esta temporada o solo la temporada pasada. Con los dias
  // esto dice cuanto peso merece la temporada actual.
  const calib = { final: [], estaTemporada: [], temporadaPasada: [] };
  const seenPlayers = new Set();
  for (const p of projections) {
    const m = p.explain?.minutos;
    const a = actual.get(Number(p.player_id));
    if (!m || !a || !(a.min > 0) || seenPlayers.has(p.player_id)) continue;
    const cur = Number(m.estaTemporada);
    const prev = Number(m.temporadaPasada);
    if (!ok(cur) || !ok(prev) || m.estaTemporada === null || m.temporadaPasada === null) continue;
    seenPlayers.add(p.player_id);
    calib.final.push(Number(p.minutes) - a.min);
    calib.estaTemporada.push(cur - a.min);
    calib.temporadaPasada.push(prev - a.min);
  }
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

  // ALINEACIONES: puntos reales de cada una y la alineacion
  // perfecta (la mejor posible sabiendo el resultado, con las
  // mismas reglas: salario mayor a $3,500).
  const lineupEval = {};
  const savedLineups = await selectAll("fantasy_nba_lineups", "*", q => q.eq("slate_date", day));
  const realById = new Map(updates.map(u => [`${u.slate_id}:${u.player_id}`, u.actual_points]));
  const lineupUpdates = [];

  for (const l of savedLineups) {
    const values = (l.players || []).map(pl => realById.get(`${l.slate_id}:${pl.player_id}`));
    const complete = values.every(v => v !== undefined && v !== null);
    const real = round(values.reduce((sum, v) => sum + (Number(v) || 0), 0));
    lineupUpdates.push({ ...l, actual_points: real, evaluated_at: now });
    if (!lineupEval[l.platform]) lineupEval[l.platform] = { slateId: l.slate_id, lineups: [] };
    lineupEval[l.platform].lineups.push({
      "#": l.lineup_number,
      proyectado: Number(l.projected_points),
      real,
      diferencia: round(real - Number(l.projected_points), 1),
      completo: complete ? "si" : "faltan boxscores",
      jugadores: (l.players || []).map(pl => `${pl.slot}: ${pl.name} (${realById.get(`${l.slate_id}:${pl.player_id}`) ?? "?"})`).join(" | ")
    });
  }
  if (lineupUpdates.length) await upsertAll("fantasy_nba_lineups", lineupUpdates, "slate_id,lineup_number");

  for (const [platform, ev] of Object.entries(lineupEval)) {
    ev.lineups.sort((a, b) => a["#"] - b["#"]);
    const pool = projections
      .filter(p => p.platform === platform && Number(p.slate_id) === Number(ev.slateId))
      .filter(p => Number(p.salary) >= CONFIG.minSalary && playedTeams.has(Number(p.team_id)))
      .map(p => ({
        id: String(p.player_id),
        name: p.player_name,
        team: p.team_abbr,
        gameId: String(p.team_id < p.opp_team_id ? `${p.team_id}-${p.opp_team_id}` : `${p.opp_team_id}-${p.team_id}`),
        salary: Number(p.salary),
        points: Number(realById.get(`${p.slate_id}:${p.player_id}`)) || 0,
        positions: p.positions
      }));
    const perfect = buildLineups(platform, pool, { count: 1 }).lineups[0];
    ev.perfecta = perfect ? {
      real: perfect.points,
      salario: perfect.salary,
      jugadores: perfect.players.map(p => `${p.slot}: ${p.name} (${p.points})`).join(" | ")
    } : null;
    const best = Math.max(...ev.lineups.map(l => l.real));
    ev.mejorNuestra = best;
    ev.porcentajeDeLaPerfecta = perfect && perfect.points > 0 ? `${round(100 * best / perfect.points, 1)}%` : null;
  }

  const summary = {
    date: day,
    partidosEvaluados: gameIds.length,
    partidosSinBoxscoreCompleto: pendingBox,
    titularesAcertados: starterTotal ? `${starterHits}/${starterTotal} (${round(100 * starterHits / starterTotal, 1)}%)` : null,
    equiposConFallosDeTitular: [...byTeam.entries()]
      .filter(([, t]) => t.total && t.hits < t.total)
      .map(([team, t]) => `${team}: ${t.hits}/${t.total}`),
    calibracionMinutos: {
      jugadores: calib.final.length,
      errorConLaMezcla: absMean(calib.final),
      errorSoloEstaTemporada: absMean(calib.estaTemporada),
      errorSoloTemporadaPasada: absMean(calib.temporadaPasada)
    },
    errorMinutosTitulares: absMean(minErr.S),
    errorMinutosBanca: absMean(minErr.B),
    sesgoMinutos: round(mean([...minErr.S, ...minErr.B]), 1),
    alineaciones: lineupEval,
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
        Error minutos titulares: ${result.errorMinutosTitulares} | banca: ${result.errorMinutosBanca} | sesgo: ${result.sesgoMinutos}<br>
        Calibracion minutos (${result.calibracionMinutos?.jugadores ?? 0} jugadores): mezcla ${result.calibracionMinutos?.errorConLaMezcla} |
        solo esta temporada ${result.calibracionMinutos?.errorSoloEstaTemporada} | solo temporada pasada ${result.calibracionMinutos?.errorSoloTemporadaPasada}</div>`;
      for (const [platform, p] of Object.entries(result.platforms)) {
        body += `<h2>${escapeHtml(platform)}</h2><div class="box">Jugadores ${p.jugadores} | error promedio ${p.errorPromedio} | sesgo ${p.sesgo} | dentro de ±10: ${p.dentroDe10}</div>`;
        body += table(p.mayoresFallos);
        const le = result.alineaciones?.[platform];
        if (le) {
          body += `<h2>${escapeHtml(platform)} — alineaciones: proyectado vs real</h2>`;
          body += `<div class="box">Mejor alineacion nuestra: ${le.mejorNuestra} pts | perfecta (sabiendo el resultado): ${le.perfecta?.real ?? "?"} pts | logramos ${le.porcentajeDeLaPerfecta ?? "?"} de la perfecta<br>
            Perfecta: ${escapeHtml(le.perfecta?.jugadores || "")}</div>`;
          body += table(le.lineups);
        }
      }
    }
  } else {
    body += `<h1>Fantasy NBA ${escapeHtml(result.date)}</h1>`;
    if (result.message) body += `<p>${escapeHtml(result.message)}</p>`;
    else {
      body += `<div class="box">Depth chart: ${escapeHtml(result.depthChartDate)} | partidos de historial: ${result.historyGames} |
        suplente a titular: ${escapeHtml(result.medido.suplenteATitular)}<br>palizas: ${escapeHtml(result.medido.palizas || result.medido.palizasTitulares)}<br>linea: ${escapeHtml(result.medido.linea || "")} | ${result.seconds}s</div>`;
      if (result.avisos?.length) body += `<div class="box" style="color:#ffb547">AVISOS: ${result.avisos.map(escapeHtml).join("<br>")}</div>`;
      body += `<h2>Paso 1-2: rol y minutos por equipo</h2>`;
      body += table(result.teams.map(t => ({
        Equipo: t.equipo, Estilo: t.estilo, Linea: t.linea, "Min titulares": t.titularesPromedio, "Ajuste 241": t.ajuste241,
        "Ajuste titulares": t.ajusteTitulares, "Ajuste banca": t.ajusteBanca,
        "Suma min": t.sumaMinutos, Avisos: t.avisos,
        "Jugadas": t.repartoJugadas, OUT: t.out, Duda: t.duda, Titulares: t.titulares, Banca: t.banca
      })));
      for (const p of result.platforms) {
        body += `<h2>${escapeHtml(p.platform)} — slate ${p.slateId} (${p.games} partidos)</h2>`;
        body += `<div class="box">Jugadores ${p.players} | elegibles ${p.eligible} | excluidos ${escapeHtml(JSON.stringify(p.excluded))}</div>`;
        body += table(p.top);
        body += `<h2>${escapeHtml(p.platform)} — ${p.lineups?.length || 0} alineaciones (de la mas optima a la menos)${p.lineupsOptimal ? " · optimo garantizado" : ""}</h2>`;
        body += table(p.lineups || []);
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

  // Por defecto SOLO LEE lo guardado. &run=1 recalcula y guarda.
  const run = String(req.query.run || "") === "1";

  try {
    let result;
    if (mode === "evaluate") {
      const day = date || shiftDay(chicagoDay(), -1);
      result = (!run && await readStored("fantasy_nba_evaluations", "eval_date", day)) || await runEvaluation(day);
    } else {
      const day = date || chicagoDay();
      result = run
        ? await runProjection(day)
        : (await readStored("fantasy_nba_runs", "slate_date", day)) ||
          { date: day, message: "Todavia no hay proyeccion guardada para esta fecha. Agrega &run=1 para calcularla.", platforms: [] };
    }

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

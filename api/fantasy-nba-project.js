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
// 5. RITMO DEL PARTIDO (27-oct)
//    Posesiones esperadas del partido vs las normales de su equipo.
//    Partido mas rapido = mas de todo; mas lento = menos.
//
// 6. MERCADO (oficial desde el 27-oct)
//    Lineas de props de las casas: 85% mercado, 15% nuestra formula.
//    Jugador sin linea: 100% nuestra formula.
//
// 7. PUNTOS FANTASY
//    10,000 simulaciones -> DraftKings (doble y triple doble)
//    y FanDuel.
//
// 8. ALINEACIONES (27-oct)
//    Titular y su suplente de la misma posicion nunca juntos.
//    Pilas en partidos rapidos; el nucleo del partido MUY RAPIDO
//    va en la mitad de las alineaciones (tope 50% esos 3).
//
// REGLAS: salario <= $3,500 fuera; lesionados o en duda fuera;
// fuera del top 2 de su posicion fuera; menos de 18 minutos fuera.
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const { buildLineups, planStacks } = require("./_lib/fantasy-nba-lineups.js");

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
  lineupMaxExposure: 0.4,   // ningun jugador en mas del 40% de las alineaciones
  // Muestra de prueba: alineaciones extra por version SOLO para
  // medir (nadie las juega). 10 por noche es muy poco para saber
  // que version es mejor.
  testLineupCount: 150,
  testNodeLimit: 200000,
  testSecondsPerPlatform: 25,
  // Si la corrida completa pasa de esto, las variantes que falten
  // se saltan (Vercel corta a los 300 s).
  maxRunSeconds: 200,
  // Nombre de la formula oficial (queda guardado en cada corrida).
  // 27-oct (aprobado): mercado 85% + ritmo del partido + pilas en
  // partidos rapidos + regla titular/suplente.
  formulaVersion: "mercado85+ritmo+pilas",
  // Pruebas en paralelo: mismos datos, un solo ajuste distinto.
  // Solo se archivan; nunca cambian las alineaciones oficiales.
  // 27-oct: la oficial anterior ("produccion-propia+10%") y mercado
  // al 70% quedan como pruebas para seguir comparando. El reparto
  // medido se quito: dio practicamente lo mismo que mercado.
  shadowVariants: [
    {
      version: "produccion-propia+10%",
      config: {
        useProps: false, questionableScenarios: false, usePace: false, lineupStrategy: false,
        previousSeasonGames: 1
      }
    },
    {
      version: "mercado+escenarios",
      config: {
        usePace: false, lineupStrategy: false, previousSeasonGames: 1,
        propWeights: { pts: 0.7, reb: 0.7, ast: 0.7, fg3m: 0.6, stl: 0.5, blk: 0.5 }
      }
    }
  ],

  // RITMO DEL PARTIDO (27-oct, medido con temporadas 2024+: las
  // estrellas explotan 23-24% en partidos rapidos vs 13-17% en lentos).
  // Ritmo = posesiones por partido = tiros + 0.44 x tiros libres
  //         - rebotes ofensivos + perdidas (de nuestra base).
  // Ritmo normal de cada equipo: esta temporada; la pasada (mismo
  // equipo) vale pacePriorGames partidos mientras hay pocos juegos.
  // Ritmo esperado del partido = promedio de los dos equipos.
  // Factor = ritmo esperado / ritmo normal de SU equipo (mas
  // posesiones = mas de todo). Se aplica a nuestra formula ANTES de
  // mezclar con el mercado (el mercado ya cuenta el ritmo: asi no
  // se cuenta dos veces). Jugador sin linea: se aplica completo.
  usePace: true,
  pacePriorGames: 5,
  paceMinGames: 3,
  paceFactorMin: 0.94,
  paceFactorMax: 1.06,
  // Clase del partido: se compara contra todos los cruces posibles
  // de la liga con el ritmo de hoy de cada equipo.
  paceVeryFast: 0.90,   // 10% mas rapido = MUY RAPIDO
  paceFast: 0.67,       // tercio mas rapido = RAPIDO
  paceSlow: 0.33,       // tercio mas lento = LENTO
  // Partido "parejo" para la pila estrella vs estrella.
  closeMargin: 5,

  // ALINEACIONES (27-oct, aprobado):
  //  - titular y su suplente de la misma posicion nunca juntos;
  //  - pilas en partidos rapidos; nucleo del MUY RAPIDO en el 50%.
  lineupStrategy: true,
  coreExposure: 0.5,

  // REPARTO DE JUGADAS cuando falta alguien (factor de uso del equipo).
  // Puntos y perdidas suben con el factor completo. Cuanto de ese
  // factor se lleva cada estadistica:
  //   actual (oficial): asistencias 0.5, triples 1, rebotes 0.
  //   MEDIDO (historial 2025-26, 364 partidos con un titular de 25+
  //   minutos ausente contra 705 sin ausentes, mismos minutos):
  //     puntos   -> el factor completo acierta (real 5.76 vs 5.91)
  //     asist.   -> 0.85 (con 0.5 nos quedamos cortos: real 1.15 vs 0.68)
  //     triples  -> 0   (no suben: real -0.03 vs 0.70 que dabamos)
  //     rebotes  -> 0.27 (suben poco: real +0.64 por partido)
  usageAstShare: 0.5,
  usage3pmShare: 1,
  usageRebShare: 0,

  // MERCADO (lineas de props). Oficial desde el 27-oct.
  useProps: true,
  // Peso del mercado por estadistica (el resto = nuestra formula).
  // 27-oct: subido de 70% a 85% (prueba 25 y 26-oct: el error baja
  // siempre con mas mercado; las alineaciones salen mejor con
  // 70-90%). Cada estadistica sube en la misma proporcion (x 85/70).
  propWeights: { pts: 0.85, reb: 0.85, ast: 0.85, fg3m: 0.73, stl: 0.61, blk: 0.61 },
  // Si en su equipo hubo una baja DESPUES de la linea, la linea
  // no la trae: se confia menos en ella (peso x0.35).
  propNewsFactor: 0.35,
  // Variacion de los puntos (medido con 314 jugadores):
  // desviacion = 1.61 x raiz(media). Rebotes, asistencias, triples,
  // robos y tapones se comportan como conteo simple (Poisson).
  pointsSdFactor: 1.61,
  newsMateMinutes: 15,

  // DUDOSOS: sus companeros se proyectan en dos escenarios
  // (juega / no juega) y se mezclan. El dudoso sigue SIN entrar
  // a alineaciones hasta que se confirme. Oficial desde el 27-oct.
  questionableScenarios: true,
  questionablePlayProb: 0.5,
  minProjectedMinutes: 18,
  minHistoryMinutes: 40,

  // Minutos
  teamMinutes: 241,
  // Peso de esta temporada: ruido de un partido (desviacion de
  // sus minutos) contra cuanto puede cambiar un rol de una
  // temporada a otra. Con 2 partidos esta temporada pesa ~75%.
  seasonShiftSd: 6,
  // +10 puntos de peso a esta temporada en los minutos (decision
  // tuya, 24-oct: la evaluacion mostro que "solo esta temporada"
  // erro menos que la mezcla: 4.9 vs 5.6 minutos).
  currentWeightBoost: 0.10,
  teamPriorGames: 3,
  currentDecay: 0.85,
  previousDecay: 0.95,
  previousGames: 30,
  otherTeamWeight: 0.5,
  profilePriorGames: 5,
  blowoutMargin: 20,
  strengthPriorGames: 10,
  previousStrengthCarry: 0.65,
  // Partido de hoy (palizas): localia, cansancio y bajas. Los tres
  // se MIDEN con tus partidos; si hay pocos casos no se aplican.
  gameModelMinGames: 150,
  homeEdgeMax: 5,              // puntos
  restEdgeMax: 5,              // puntos por jugar 2 noches seguidas
  missingEdgeMax: 30,          // puntos si faltara el 100% del aporte
  rotationGames: 10,           // "titulares habituales": ultimos 10 partidos
  rotationMinApps: 3,
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
  // Temporada pasada (mismo equipo y rol) = 3 partidos de peso.
  // 27-oct: antes 1. La comparacion contra el mercado mostro que la
  // formula le creia demasiado a los primeros 3-4 partidos (inflaba
  // a los que arrancaron bien y bajaba a estrellas que arrancaron
  // flojo). Solo cuenta el MISMO equipo y rol; si cambio de equipo
  // sigue valiendo medio partido.
  previousSeasonGames: 3,
  // Si cambio de equipo (mismo rol): medio partido, y se quita
  // cuando ya tiene 8 partidos con el equipo nuevo.
  previousOtherTeamGames: 0.5,
  otherTeamDropGames: 8,
  previousRateGames: 30,
  // Partidos que no cuentan: salio antes (<60% de sus minutos
  // normales) o paliza donde lo sentaron (<80%).
  rateShortShare: 0.6,
  rateBlowoutShare: 0.8,
  // Noche rara: con 3+ partidos se recorta a +-35% de su mediana.
  outlierMinGames: 3,
  outlierBand: 0.35,
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

// Valor en la posicion q (0..1) de la lista ordenada.
function quantile(a, q) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
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

  // Solo partidos ANTES del dia que se proyecta.
  const gameMap = new Map();
  // Partidos de HOY: quien es local.
  const todayGames = new Map();
  for (const g of games) {
    const date = nbaDay(g.game_date);
    if (date === day) {
      todayGames.set(Number(g.home_team_id), { home: true, opp: Number(g.visitor_team_id) });
      todayGames.set(Number(g.visitor_team_id), { home: false, opp: Number(g.home_team_id) });
    }
    if (!date || date >= day) continue;
    const q3 = quarters.get(Number(g.game_id)) || null;
    gameMap.set(Number(g.game_id), {
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
        home: isHome,
        margin,
        q3Margin: q3,
        decided,
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

  return { byPlayer, teamGames: teams, names, gamesCount: gameMap.size, todayGames };
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
//   S[i]     minutos del titular i (de mas a menos minutos)
//   Bcond[k] minutos del suplente k CUANDO entra a jugar
//   Bplay[k] que tan seguido entra el suplente k
//   B[k]     promedio total del suplente k (incluye cuando no entra)
// ============================================================
// MERCADO: lineas de props -> lo que espera el mercado
// ============================================================

const PROP_STAT = {
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_threes: "fg3m",
  player_steals: "stl",
  player_blocks: "blk"
};

function normName(value) {
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

function americanProb(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p === 0) return null;
  return p < 0 ? -p / (-p + 100) : 100 / (p + 100);
}

// Probabilidad real del OVER (sin la comision de la casa).
function overProbability(overPrice, underPrice) {
  const o = americanProb(overPrice);
  const u = americanProb(underPrice);
  if (o !== null && u !== null) return o / (o + u);
  if (o !== null) return clamp(o - 0.024, 0.02, 0.98);
  if (u !== null) return clamp(1 - u + 0.024, 0.02, 0.98);
  return 0.5;
}

function poissonAtLeast(lambda, k) {
  if (k <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return 1 - cdf;
}

// Promedio esperado a partir de la linea y su probabilidad.
//   Conteos (rebotes, asistencias, triples, robos, tapones): Poisson.
//   Puntos: normal con desviacion = 1.61 x raiz(media).
function marketMean(stat, line, pOver) {
  const p = clamp(pOver, 0.03, 0.97);
  let lo = 0.01;
  let hi = stat === "pts" ? 90 : 40;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    let prob;
    if (stat === "pts") {
      const sd = CONFIG.pointsSdFactor * Math.sqrt(m);
      prob = 1 - normalCdf((line - m) / sd);
    } else {
      prob = poissonAtLeast(m, Math.floor(line) + 1);
    }
    if (prob < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// Lee la foto de lineas mas reciente del dia y calcula, por
// jugador y estadistica, lo que espera el mercado (mediana de
// las casas).
async function loadMarket(day) {
  const { data: snaps, error } = await supabaseAdmin
    .from("fantasy_nba_prop_snapshots")
    .select("snapshot,fetched_at,injuries")
    .eq("prop_date", day)
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Supabase fantasy_nba_prop_snapshots: ${error.message}`);
  const snap = snaps?.[0];
  if (!snap) return null;

  const lines = await selectAll(
    "fantasy_nba_prop_lines",
    "nba_player_id,player_key,bookmaker,market,line,over_price,under_price",
    q => q.eq("prop_date", day).eq("snapshot", snap.snapshot)
  );

  const acc = new Map();
  for (const l of lines) {
    const stat = PROP_STAT[l.market];
    if (!stat) continue;
    const mean = marketMean(stat, Number(l.line), overProbability(l.over_price, l.under_price));
    if (!ok(mean)) continue;
    const key = str(l.player_key);
    if (!acc.has(key)) acc.set(key, { id: l.nba_player_id ? Number(l.nba_player_id) : null, stats: {} });
    const a = acc.get(key);
    if (!a.id && l.nba_player_id) a.id = Number(l.nba_player_id);
    (a.stats[stat] = a.stats[stat] || []).push(mean);
  }

  const byKey = new Map();
  const byId = new Map();
  for (const [key, a] of acc) {
    const stats = {};
    for (const [stat, list] of Object.entries(a.stats)) stats[stat] = median(list);
    const v = { stats, books: Math.max(...Object.values(a.stats).map(l => l.length)) };
    byKey.set(key, v);
    if (a.id) byId.set(a.id, v);
  }

  const injuries = new Map(Object.entries(snap.injuries || {}).map(([id, s]) => [Number(id), str(s)]));
  return { snapshot: snap.snapshot, fetchedAt: snap.fetched_at, byKey, byId, injuries, players: byKey.size };
}

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

// ============================================================
// PARTIDO DE HOY: ¿que tan desparejo es? (palizas)
// ============================================================
// Diferencia esperada = nivel del equipo - nivel del rival
//   + LOCALIA   (cuanto gana de mas el local)
//   + CANSANCIO (cuanto pierde quien jugo la noche anterior)
//   + BAJAS     (cuanto pierde un equipo segun el aporte de sus
//                titulares habituales que no juegan)
// Los tres numeros se MIDEN con tus partidos (regresion sobre la
// diferencia real). Con pocos casos no se aplican, y cada uno tiene
// un limite para que nunca "ensucie" la proyeccion.

// Aporte de un jugador en un partido (puntos DK sin bonos).
const playerValue = r => r.pts + 1.25 * r.reb + 1.5 * r.ast + 2 * r.stl + 2 * r.blk - 0.5 * r.tov + 0.5 * r.fg3m;

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// Titulares/rotacion habitual antes de un partido: los que jugaron
// 3+ de los ultimos 10 partidos del equipo con 18+ minutos de promedio.
function rotationBefore(list, index) {
  const prev = list.slice(index + 1, index + 1 + CONFIG.rotationGames);
  const acc = new Map();
  for (const g of prev) {
    for (const [id, r] of g.rows) {
      const a = acc.get(id) || { apps: 0, min: 0, value: 0 };
      a.apps++;
      a.min += r.min;
      a.value += playerValue(r);
      acc.set(id, a);
    }
  }
  const rotation = new Map();
  for (const [id, a] of acc) {
    if (a.apps >= CONFIG.rotationMinApps && a.min / a.apps >= CONFIG.importantMateMinutes) {
      rotation.set(id, a.value / a.apps);
    }
  }
  return rotation;
}

// Parte del aporte habitual que falta (0 = completo, 1 = no queda nadie).
function missingShare(rotation, missingIds) {
  let total = 0, miss = 0;
  for (const [id, v] of rotation) {
    total += v;
    if (missingIds.has(id)) miss += v;
  }
  return total > 0 ? miss / total : 0;
}

function solve3(A, b) {
  // Eliminacion de Gauss 3x3.
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-9) return null;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[3] / m[i][i]);
}

function buildGameModel(teamGames, strength) {
  const info = new Map();   // `${team}|${gameId}` -> { miss, b2b, home, decided }
  for (const [team, list] of teamGames) {
    list.forEach((g, i) => {
      const rotation = rotationBefore(list, i);
      const missing = new Set([...rotation.keys()].filter(id => !g.rows.has(id)));
      const prev = list[i + 1];
      info.set(`${team}|${g.id}`, {
        miss: g.rows.size ? missingShare(rotation, missing) : null,
        b2b: prev ? (daysBetween(prev.date, g.date) === 1 ? 1 : 0) : 0,
        home: g.home,
        decided: g.decided,
        team,
        opp: g.opp
      });
    });
  }

  // Una observacion por partido (desde el local).
  const obs = [];
  for (const [key, a] of info) {
    if (!a.home || a.miss === null) continue;
    const b = info.get(`${a.opp}|${key.split("|")[1]}`);
    if (!b || b.miss === null) continue;
    const base = (strength.get(a.team) ?? 0) - (strength.get(a.opp) ?? 0);
    obs.push({ y: a.decided - base, x1: b.miss - a.miss, x2: b.b2b - a.b2b });
  }

  const fallback = { home: 0, missing: 0, rest: 0 };
  let coef = fallback;
  let fitted = false;
  if (obs.length >= CONFIG.gameModelMinGames) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const v = [0, 0, 0];
    for (const o of obs) {
      const x = [1, o.x1, o.x2];
      for (let i = 0; i < 3; i++) {
        v[i] += x[i] * o.y;
        for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j];
      }
    }
    const sol = solve3(A, v);
    if (sol) {
      coef = {
        home: clamp(sol[0], 0, CONFIG.homeEdgeMax),
        missing: clamp(sol[1], 0, CONFIG.missingEdgeMax),
        rest: clamp(sol[2], 0, CONFIG.restEdgeMax)
      };
      fitted = true;
    }
  }

  const residuals = obs.map(o => o.y - (coef.home + coef.missing * o.x1 + coef.rest * o.x2));
  return {
    coef,
    fitted,
    games: obs.length,
    b2bGames: obs.filter(o => o.x2 !== 0).length,
    gamesWithMissing: obs.filter(o => o.x1 !== 0).length,
    marginSd: std(residuals) || null
  };
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
  // Escenario "el dudoso no juega".
  if (ctx.forceOut?.has(id)) return "OUT";
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
  const w = cur.length
    ? Math.min(1, curGamesEffective / (curGamesEffective + k) + CONFIG.currentWeightBoost)
    : 0;
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
    const factor = probs.reduce((sum, p, i) => sum + p * ratios[i], 0);
    const pBlow = probs[MARGIN_BINS.length - 1];


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

// PRODUCCION POR MINUTO (aprobado el 24-oct):
//   1. Solo SUS partidos. Nada de promedio de liga.
//   2. Temporada actual: sus partidos con ESTE equipo y en ESTE rol
//      (titular o banca). Si no tiene en ese rol, sus partidos de
//      esta temporada con este equipo en cualquier rol.
//   3. Temporada pasada: solo si fue con el mismo equipo y el mismo
//      rol, con mas peso a los ultimos juegos, y vale como UN partido.
//      1 partido actual = 50/50, 2 = 67/33, 10 = 91/9.
//   4. Se descartan los partidos donde salio antes (lesion,
//      expulsion: menos del 60% de sus minutos normales) y los de
//      paliza en los que de verdad lo sentaron (menos del 80%).
//   5. Con 3 o mas partidos, una noche fuera de lo normal se recorta
//      a +-35% de su mediana: un 80 no arrastra a un jugador de 40.
//      Con 2 partidos es promedio simple (no se sabe cual es el raro).
function rateGameFilter(rows) {
  const normal = rows.filter(r => !r.blowout);
  const typical = median((normal.length >= 2 ? normal : rows).map(r => r.min));
  if (!typical) return { valid: rows, dropped: [] };
  const valid = [];
  const dropped = [];
  for (const r of rows) {
    if (r.min < CONFIG.rateShortShare * typical) dropped.push({ r, why: "SALIO_ANTES" });
    else if (r.blowout && r.min < CONFIG.rateBlowoutShare * typical) dropped.push({ r, why: "PALIZA" });
    else valid.push(r);
  }
  return { valid, dropped, typical };
}

function capOutliers(rows) {
  if (rows.length < CONFIG.outlierMinGames) return { rows, capped: 0 };
  const per = rows.map(r => scoreDK(r) / r.min);
  const med = median(per);
  if (!(med > 0)) return { rows, capped: 0 };
  let capped = 0;
  const out = rows.map((r, i) => {
    const target = clamp(per[i], (1 - CONFIG.outlierBand) * med, (1 + CONFIG.outlierBand) * med);
    if (Math.abs(target - per[i]) < 1e-9 || !(per[i] > 0)) return r;
    capped++;
    const f = target / per[i];
    const c = { ...r, capped: round(f, 3) };
    for (const k of RATE_KEYS) c[k] = r[k] * f;
    return c;
  });
  return { rows: out, capped };
}

function blockRates(rows) {
  if (!rows.length) return null;
  const rates = {};
  for (const k of RATE_KEYS) {
    let s = 0;
    let m = 0;
    rows.forEach((r, i) => {
      const w = Math.pow(CONFIG.rateDecay, i);
      s += w * r[k];
      m += w * r.min;
    });
    rates[k] = m > 0 ? s / m : 0;
  }
  return rates;
}

function playerRates(row, ctx, team) {
  const teamId = team ?? row.team ?? null;
  const isRole = r => r.starter === (row.role === "S");
  const all = (ctx.byPlayer.get(row.id) || []).filter(r => r.min >= CONFIG.rateMinMinutes);
  const type = ctx.models.types.get(row.id) || null;

  const curTeam = all.filter(r => r.season === CUR && (teamId === null || r.team === teamId));

  // Partidos validos (sin salidas por lesion ni palizas donde lo sentaron).
  const fCur = rateGameFilter(curTeam);

  let curRows = fCur.valid.filter(isRole);
  let curBasis = "temporada actual, mismo equipo y rol";
  if (!curRows.length && fCur.valid.length) {
    curRows = fCur.valid;
    curBasis = "temporada actual, mismo equipo (otro rol)";
  }

  const cur = capOutliers(curRows);
  const rCur = blockRates(cur.rows);
  const n = cur.rows.length;

  // Temporada pasada, siempre en su MISMO rol:
  //  - con este mismo equipo: vale 1 partido;
  //  - si cambio de equipo: vale medio partido y deja de contar
  //    cuando ya tiene 8 partidos validos con el equipo nuevo.
  const prevRole = all.filter(r => r.season === PREV && isRole(r));
  let prevRows = prevRole.filter(r => teamId === null || r.team === teamId);
  let prevWeight = CONFIG.previousSeasonGames;
  let prevBasis = "mismo equipo y rol";
  if (!prevRows.length) {
    prevRows = n < CONFIG.otherTeamDropGames ? prevRole : [];
    prevWeight = CONFIG.previousOtherTeamGames;
    prevBasis = "otro equipo, mismo rol";
  }
  const fPrev = rateGameFilter(prevRows.slice(0, CONFIG.previousRateGames));
  const prev = capOutliers(fPrev.valid);
  const rPrev = blockRates(prev.rows);

  const p = rPrev ? prevWeight : 0;
  const used = [...cur.rows, ...prev.rows];
  const totalMinutes = used.reduce((s, r) => s + r.min, 0);

  if (!rCur && !rPrev) {
    return { rates: null, rows: [], roleGames: 0, totalMinutes: 0, type, info: { basis: "sin partidos validos" } };
  }

  const curWeight = n / (n + p);
  const rates = {};
  for (const k of RATE_KEYS) {
    const base = (n * (rCur?.[k] || 0) + p * (rPrev?.[k] || 0)) / (n + p);
    rates[k] = Math.max(0, base + (row.injury?.rates?.[k] || 0));
  }

  return {
    rates,
    rows: used,
    roleGames: cur.rows.filter(isRole).length,
    totalMinutes,
    type,
    info: {
      basis: (n ? curBasis : "sin partidos este ano") + (rPrev ? ` + temporada pasada (${prevBasis}, vale ${p} partido)` : ""),
      currentGames: n,
      previousGames: prev.rows.length,
      currentWeight: round(curWeight, 2),
      dropped: [...fCur.dropped, ...fPrev.dropped].map(d => `${d.r.date} ${d.why} (${round(d.r.min, 0)} min)`),
      capped: cur.capped + prev.capped
    }
  };
}

function projectFantasy(row, team, opp, usageFactor, ctx) {
  const pr = playerRates(row, ctx, team);
  if (!pr.rates) return { excluded: "POCO_HISTORIAL" };

  const type = pr.type || "TIRADOR";
  const rates = { ...pr.rates };

  // Reparto de jugadas del equipo (lesiones de jugadores que usan mucho).
  // Cuanto se lleva cada estadistica: ver CONFIG.usage*Share
  // (los valores por defecto dan exactamente lo de antes).
  rates.pts *= usageFactor;
  rates.fg3m *= 1 + CONFIG.usage3pmShare * (usageFactor - 1);
  rates.tov *= usageFactor;
  rates.ast *= 1 + CONFIG.usageAstShare * (usageFactor - 1);
  rates.reb *= 1 + CONFIG.usageRebShare * (usageFactor - 1);

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

  // RITMO DEL PARTIDO: mas posesiones que lo normal de su equipo =
  // mas de todo (y menos si es mas lento). Va ANTES del mercado:
  // la linea ya trae el ritmo, asi que solo afecta la parte de
  // nuestra formula (o todo, si el jugador no tiene linea).
  const pace = CONFIG.usePace ? ctx.paceByTeam?.get(team) || null : null;
  const paceFactor = pace ? pace.factor : 1;
  for (const k of STATS) rates[k] *= paceFactor;

  // MERCADO: mezcla lo que espera el mercado (lineas de props) con
  // nuestra formula, estadistica por estadistica. Lo que no tiene
  // linea (perdidas, o un jugador sin lineas) queda con la formula.
  // Si hubo una baja en su equipo DESPUES de la linea, la linea no
  // la trae y se le da menos peso.
  const m0 = row.minutes;
  let market = null;
  if (ctx.market && m0 > 0) {
    const mk = (row.id && ctx.market.byId.get(row.id)) || ctx.market.byKey.get(normName(row.name));
    if (mk) {
      const news = ctx.market.newsTeams?.has(team) || false;
      market = { foto: ctx.market.snapshot, casas: mk.books, noticiaDespuesDeLaLinea: news, mercado: {}, formula: {}, final: {} };
      for (const [k, expected] of Object.entries(mk.stats)) {
        if (!STATS.includes(k) || !ok(expected)) continue;
        const w = (CONFIG.propWeights[k] ?? 0) * (news ? CONFIG.propNewsFactor : 1);
        const ours = rates[k] * m0;
        const final = w * expected + (1 - w) * ours;
        rates[k] = Math.max(0, final / m0);
        market.mercado[k] = round(expected, 1);
        market.formula[k] = round(ours, 1);
        market.final[k] = round(final, 1);
      }
    }
  }

  // Simulacion (m0 = minutos proyectados, definido arriba).
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
      produccionBase: pr.info.basis,
      partidosTemporadaActual: pr.info.currentGames,
      partidosTemporadaPasada: pr.info.previousGames,
      pesoTemporadaActual: pr.info.currentWeight,
      partidosDescartados: pr.info.dropped,
      nochesRecortadas: pr.info.capped,
      repartoJugadasEquipo: round(usageFactor, 3),
      defensaRival: tier,
      defensaRivalFactor: round(oppDk, 3),
      afinidadContraEsaDefensa: round(affinity, 3),
      partidosContraEsaDefensa: count,
      ritmo: pace ? {
        partido: pace.cls,
        posesionesEsperadas: round(pace.pace, 1),
        normalSuEquipo: round(pace.teamPace, 1),
        normalRival: round(pace.oppPace, 1),
        percentil: round(pace.percentile, 2),
        factor: round(paceFactor, 3)
      } : null,
      simulacion: bootstrap ? `${sample.length} partidos reales` : "variacion estandar (pocos partidos)",
      mercado: market,
      escenarioDudoso: row.scenario || null
    }
  };
}


// ============================================================
// RITMO (PACE) DE CADA EQUIPO Y DEL PARTIDO DE HOY
// ============================================================
// Posesiones de un equipo en un partido = tiros + 0.44 x tiros
// libres - rebotes ofensivos + perdidas (suma de sus jugadores).
// Ritmo del partido = promedio de las posesiones de los dos.
// Ritmo normal del equipo = sus partidos de esta temporada; la
// temporada pasada (mismo equipo) vale pacePriorGames partidos.
function buildPace(teamGames) {
  const possOf = tg => {
    let fga = 0, fta = 0, oreb = 0, tov = 0;
    for (const r of tg.rows.values()) {
      fga += r.fga; fta += r.fta; oreb += r.oreb; tov += r.tov;
    }
    // Partido con datos incompletos: no cuenta.
    if (fga < 50) return null;
    return fga + 0.44 * fta - oreb + tov;
  };

  // Posesiones de cada equipo en cada partido.
  const poss = new Map();   // `${team}:${gameId}` -> posesiones
  for (const [team, list] of teamGames) {
    for (const tg of list) {
      const p = possOf(tg);
      if (p !== null) poss.set(`${team}:${tg.id}`, p);
    }
  }

  const teamPace = new Map();
  for (const [team, list] of teamGames) {
    const cur = [];
    const prev = [];
    for (const tg of list) {
      const a = poss.get(`${team}:${tg.id}`);
      const b = poss.get(`${tg.opp}:${tg.id}`);
      if (a === undefined || b === undefined) continue;
      const gamePace = (a + b) / 2;
      if (tg.season === CUR) cur.push(gamePace);
      else if (tg.season === PREV) prev.push(gamePace);
    }
    const n = cur.length;
    const k = prev.length ? CONFIG.pacePriorGames : 0;
    // Sin temporada pasada hacen falta al menos paceMinGames de esta.
    if (!prev.length && n < CONFIG.paceMinGames) continue;
    const value = (n * (n ? mean(cur) : 0) + k * (prev.length ? mean(prev) : 0)) / (n + k);
    teamPace.set(team, { pace: value, games: n, previous: prev.length ? round(mean(prev), 1) : null });
  }

  // Todos los cruces posibles de la liga con el ritmo de hoy:
  // sirve para decir si un partido es rapido o lento.
  const paces = [...teamPace.values()].map(t => t.pace);
  const matchups = [];
  for (let i = 0; i < paces.length; i++) {
    for (let j = i + 1; j < paces.length; j++) matchups.push((paces[i] + paces[j]) / 2);
  }
  matchups.sort((a, b) => a - b);
  const percentile = v => {
    if (!matchups.length) return null;
    let lo = 0, hi = matchups.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (matchups[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo / matchups.length;
  };

  const game = (team, opp) => {
    const a = teamPace.get(team);
    const b = teamPace.get(opp);
    if (!a || !b) return null;
    const pace = (a.pace + b.pace) / 2;
    const pct = percentile(pace);
    const cls = pct === null ? "NORMAL"
      : pct >= CONFIG.paceVeryFast ? "MUY_RAPIDO"
        : pct >= CONFIG.paceFast ? "RAPIDO"
          : pct <= CONFIG.paceSlow ? "LENTO" : "NORMAL";
    return {
      pace,
      percentile: pct,
      cls,
      factor: clamp(pace / a.pace, CONFIG.paceFactorMin, CONFIG.paceFactorMax),
      teamPace: a.pace,
      oppPace: b.pace
    };
  };

  return { teamPace, game };
}


// ============================================================
// PROYECCION COMPLETA
// ============================================================

// Corrida normal + variantes de prueba (shadow). Las variantes
// usan los MISMOS datos de hoy y solo cambian un ajuste; no tocan
// las alineaciones oficiales, solo se archivan para compararlas.
async function runProjection(day = chicagoDay()) {
  const started = Date.now();
  const result = await runProjectionCore(day, { version: CONFIG.formulaVersion });
  if (result.message) return result;
  const variantes = [];
  for (const v of CONFIG.shadowVariants) {
    if ((Date.now() - started) / 1000 > CONFIG.maxRunSeconds) {
      variantes.push({ version: v.version, error: "saltada: la corrida se acerco al limite de tiempo" });
      continue;
    }
    const saved = {};
    for (const k of Object.keys(v.config)) saved[k] = CONFIG[k];
    try {
      Object.assign(CONFIG, v.config);
      const r = await runProjectionCore(day, { version: v.version, archiveOnly: true, runAt: result.runAt });
      variantes.push({ version: v.version, mejores: r.best, prueba: r.prueba, mercado: r.mercado, dudosos: r.dudosos, segundos: round((Date.now() - started) / 1000, 1) });
    } catch (error) {
      console.warn("Variante", v.version, error.message);
      variantes.push({ version: v.version, error: error.message });
    } finally {
      Object.assign(CONFIG, saved);
    }
  }
  return { ...result, variantesDePrueba: variantes };
}

// Archivo de cada corrida: nunca se borra ni se reemplaza. Asi se
// pueden comparar las alineaciones de la manana, las de la tarde y
// las variantes de prueba contra el resultado real.
async function archiveRun(runAt, version, lineupRows, projectionRows, testLineupRows = []) {
  const testVersion = `${version} [prueba ${CONFIG.testLineupCount}]`;
  const lineups = [
    ...lineupRows.map(l => ({ ...l, archiveVersion: version })),
    ...testLineupRows.map(l => ({ ...l, archiveVersion: testVersion }))
  ].map(l => ({
    run_at: runAt,
    version: l.archiveVersion,
    slate_date: l.slate_date,
    slate_id: l.slate_id,
    platform: l.platform,
    lineup_number: l.lineup_number,
    salary: l.salary,
    projected_points: l.projected_points,
    players: l.players
  }));
  const players = projectionRows.map(p => ({
    run_at: runAt,
    version,
    slate_date: p.slate_date,
    slate_id: p.slate_id,
    platform: p.platform,
    player_id: p.player_id,
    player_name: p.player_name,
    eligible: p.eligible,
    minutes: p.minutes,
    proj_mean: p.proj_mean ?? null
  }));
  if (lineups.length) await upsertAll("fantasy_nba_lineup_runs", lineups, "run_at,version,slate_id,lineup_number");
  if (players.length) await upsertAll("fantasy_nba_projection_runs", players, "run_at,version,slate_id,player_id");
}

async function runProjectionCore(day = chicagoDay(), opts = {}) {
  const runAt = opts.runAt || new Date().toISOString();
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

  ctx.opponents = opponents;

  // ---- Ritmo del partido de hoy (cada equipo del slate) ----
  const paceModel = buildPace(history.teamGames);
  ctx.paceByTeam = new Map();
  for (const [team, opp] of opponents) {
    const g = paceModel.game(team, opp);
    if (g) ctx.paceByTeam.set(team, g);
  }

  // ---- Partido de hoy: localia, cansancio y bajas ----
  const gameModel = buildGameModel(history.teamGames, models.strength);
  const todayInfo = new Map();
  for (const team of new Set(today.slatePlayers.map(p => Number(p.team_id)))) {
    const list = history.teamGames.get(team) || [];
    const rotation = rotationBefore(list, -1);
    const outIds = new Set((depthByTeam.get(team) || [])
      .filter(d => d.nba_player_id && statusOf(d, ctx) === "OUT")
      .map(d => Number(d.nba_player_id)));
    const tg = history.todayGames.get(team);
    todayInfo.set(team, {
      miss: missingShare(rotation, outIds),
      b2b: list[0] && daysBetween(list[0].date, day) === 1 ? 1 : 0,
      home: tg ? (tg.home ? 1 : -1) : 0
    });
  }
  const expectedMargin = (team, opp) => {
    const a = todayInfo.get(team) || { miss: 0, b2b: 0, home: 0 };
    const b = todayInfo.get(opp) || { miss: 0, b2b: 0, home: 0 };
    const c = gameModel.coef;
    return {
      total: (models.strength.get(team) ?? 0) - (models.strength.get(opp) ?? 0) +
        c.home * a.home + c.missing * (b.miss - a.miss) + c.rest * (b.b2b - a.b2b),
      nivel: (models.strength.get(team) ?? 0) - (models.strength.get(opp) ?? 0),
      localia: c.home * a.home,
      bajas: c.missing * (b.miss - a.miss),
      cansancio: c.rest * (b.b2b - a.b2b)
    };
  };
  if (gameModel.fitted && gameModel.marginSd) models.blowout.marginSd = gameModel.marginSd;
  models.blowout.binProbabilities = (team, opp) => {
    const mu = expectedMargin(team, opp).total;
    const sd = models.blowout.marginSd;
    return MARGIN_BINS.map((b, i) => {
      if (i === 0) return normalCdf((b.hi - mu) / sd) - normalCdf((-b.hi - mu) / sd);
      const p = (lo, hi) => normalCdf((hi - mu) / sd) - normalCdf((lo - mu) / sd);
      return b.hi === Infinity
        ? (1 - normalCdf((b.lo - mu) / sd)) + normalCdf((-b.lo - mu) / sd)
        : p(b.lo, b.hi) + p(-b.hi, -b.lo);
    });
  };
  models.blowout.probability = (team, opp) => models.blowout.binProbabilities(team, opp)[MARGIN_BINS.length - 1];

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

  // DUDOSOS (solo variante de prueba): sus companeros se proyectan
  // con el dudoso jugando y sin el dudoso, y se mezclan segun la
  // probabilidad de que juegue. El dudoso sigue fuera de las
  // alineaciones hasta que se confirme.
  if (CONFIG.questionableScenarios) {
    const p = CONFIG.questionablePlayProb;
    for (const [team, tp] of teamProjections) {
      const dudas = tp.rows.filter(r => r.status === "DUDA" && r.id).map(r => r.id);
      if (!dudas.length) continue;
      const tpOut = projectTeam(team, { ...ctx, forceOut: new Set(dudas) });
      for (const r of tp.rows) {
        if (r.status === "DUDA") continue;
        const ro = tpOut.rows.find(x => x.key === r.key);
        if (!ro) continue;
        const mPlay = r.minutes;
        const mOut = ro.minutes;
        r.minutes = p * mPlay + (1 - p) * mOut;
        r.sd = Math.sqrt(p * r.sd ** 2 + (1 - p) * ro.sd ** 2 + p * (1 - p) * (mPlay - mOut) ** 2);
        r.cap = Math.max(r.cap, ro.cap);
        const ratesPlay = r.injury?.rates || {};
        const ratesOut = ro.injury?.rates || {};
        const mixed = {};
        for (const k of RATE_KEYS) mixed[k] = p * (ratesPlay[k] || 0) + (1 - p) * (ratesOut[k] || 0);
        r.injury = { ...(r.injury || {}), rates: mixed };
        r.scenario = { dudosos: tp.doubtful, minutosSiJuegan: round(mPlay, 1), minutosSiNoJuegan: round(mOut, 1), probabilidadJuegan: p };
      }
    }
  }

  // MERCADO (solo variante de prueba): lineas de props de hoy y
  // equipos con bajas que salieron DESPUES de la linea.
  if (CONFIG.useProps) {
    ctx.market = await loadMarket(day).catch(error => {
      console.warn("Mercado:", error.message);
      return null;
    });
    if (ctx.market) {
      const newsTeams = new Set();
      for (const team of teamIds) {
        for (const d of ctx.depthByTeam.get(team) || []) {
          const id = Number(d.nba_player_id);
          if (!id) continue;
          const recentRows = teamRows(id, team, ctx).slice(0, 10);
          const recentMin = recentRows.length ? mean(recentRows.map(r => r.min)) : 0;
          if (recentMin < CONFIG.newsMateMinutes) continue;
          const before = injuryClass(ctx.market.injuries.get(id) || "");
          const now = injuryClass(ctx.injuries.get(id) || "");
          if (before !== now) newsTeams.add(team);
        }
      }
      ctx.market.newsTeams = newsTeams;
    }
  }

  // Reparto de jugadas por equipo.
  const usageFactors = new Map();
  for (const tp of teamProjections.values()) {
    let used = 0;
    for (const r of tp.rows) {
      const own = r.id ? playerRates(r, ctx, tp.team).rates : null;
      const rate = own
        ? own.use
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
  const testLineupRows = [];
  const testInfo = [];
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
            probabilidadPaliza: round(row.blowoutProbability, 3),   // por 30+ puntos
            paliza20oMas: (() => {
              const o = opponents.get(Number(p.team_id));
              if (!o) return null;
              return round(models.blowout.binProbabilities(Number(p.team_id), o).slice(3).reduce((a, b) => a + b, 0), 3);
            })(),
            diferenciaEsperada: (() => {
              const o = opponents.get(Number(p.team_id));
              if (!o) return null;
              const m = expectedMargin(Number(p.team_id), o);
              return { total: round(m.total, 1), nivel: round(m.nivel, 1), localia: round(m.localia, 1), bajas: round(m.bajas, 1), cansancio: round(m.cansancio, 1) };
            })(),
            ajustePartido: round(row.blowoutFactor, 3),
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
    const optimizerPool = eligible.map(x => ({
      id: String(x.p.player_id),
      name: x.p.player_name,
      team: x.p.team_abbr,
      gameId: String(x.p.event_id),
      salary: Number(x.p.salary),
      points: x.f[platform].mean,
      positions: x.p.positions,
      // Regla titular / suplente de su posicion (depth chart de hoy):
      // titular -> su posicion; suplente -> posiciones donde ESPN lo
      // tiene como reemplazo (puesto 2 o 3 de esa posicion).
      starter: x.row.role === "S",
      startPos: x.row.role === "S" ? x.row.depthPosition || null : null,
      backupOf: x.row.role === "S" ? [] :
        POSITIONS.filter(pos => x.row.ranks?.[pos] !== null && x.row.ranks?.[pos] !== undefined && x.row.ranks[pos] <= 3)
          .map(pos => pos.toUpperCase())
    }));

    // Partidos del slate con su ritmo (para las pilas).
    const slateGames = [];
    if (CONFIG.lineupStrategy) {
      const byEvent = new Map();
      for (const x of eligible) {
        const e = String(x.p.event_id);
        if (!byEvent.has(e)) byEvent.set(e, new Map());
        byEvent.get(e).set(x.p.team_abbr, Number(x.p.team_id));
      }
      for (const [gameId, teams] of byEvent) {
        if (teams.size !== 2) continue;
        const [[abbrA, idA], [abbrB, idB]] = [...teams];
        const pace = ctx.paceByTeam.get(idA);
        if (!pace) continue;
        slateGames.push({
          gameId,
          teams: [abbrA, abbrB],
          cls: pace.cls,
          pace: pace.pace,
          close: Math.abs(expectedMargin(idA, idB).total) <= CONFIG.closeMargin
        });
      }
    }
    const lineupOptions = count => {
      if (!CONFIG.lineupStrategy) return {};
      return {
        noStarterBackup: true,
        stackPlan: planStacks(optimizerPool, slateGames, count, { coreShare: CONFIG.coreExposure }),
        coreExposure: CONFIG.coreExposure
      };
    };

    const officialOptions = lineupOptions(CONFIG.lineupCount);
    const lineupResult = buildLineups(platform, optimizerPool, {
      count: CONFIG.lineupCount, minDifferent: CONFIG.lineupMinDifferent, maxExposure: CONFIG.lineupMaxExposure,
      ...officialOptions
    });

    // MUESTRA DE PRUEBA: 150 alineaciones mas por version, solo
    // para medir (nadie las juega). Se archivan con la etiqueta
    // "[prueba 150]" y la evaluacion las compara contra lo real.
    if (CONFIG.testLineupCount > 0) {
      // Casi optimas (busqueda mas corta) y con tope de tiempo:
      // para medir sirven igual y la corrida no se pasa del limite.
      const test = buildLineups(platform, optimizerPool, {
        count: CONFIG.testLineupCount,
        minDifferent: CONFIG.lineupMinDifferent,
        maxExposure: CONFIG.lineupMaxExposure,
        nodeLimit: CONFIG.testNodeLimit,
        timeLimitMs: CONFIG.testSecondsPerPlatform * 1000,
        ...lineupOptions(CONFIG.testLineupCount)
      });
      testInfo.push(`${platform}: ${test.lineups.length}${test.timedOut ? " (tope de tiempo)" : ""}`);
      testLineupRows.push(...test.lineups.map(l => ({
        slate_id: Number(slate.slate_id),
        lineup_number: l.number,
        platform,
        slate_date: day,
        salary: l.salary,
        projected_points: l.points,
        players: l.players.map(p => ({ slot: p.slot, player_id: Number(p.id), name: p.name, team: p.team, salary: p.salary, points: p.points }))
      })));
    }

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
        pila: l.pila || "-",
        jugadores: l.players.map(p => `${p.slot}: ${p.name} ($${p.salary}, ${round(p.points, 1)})`).join(" | ")
      })),
      ritmoPartidos: slateGames
        .sort((a, b) => b.pace - a.pace)
        .map(g => `${g.teams.join(" @ ")}: ${g.cls} (${round(g.pace, 1)} posesiones${g.close ? ", parejo" : ""})`),
      plan: officialOptions.stackPlan ? officialOptions.stackPlan.resumen : "sin estrategia de pilas",
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

  // Variante de prueba: solo se archiva, no toca lo oficial.
  if (opts.archiveOnly) {
    await archiveRun(runAt, opts.version, lineupRows, projectionRows, testLineupRows);
    return {
      best: platforms.map(p => ({ platform: p.platform, slateId: p.slateId, proyectadoMejor: p.lineups?.[0]?.proyectado ?? null })),
      prueba: testInfo,
      mercado: CONFIG.useProps
        ? (ctx.market
          ? { foto: ctx.market.snapshot, hora: ctx.market.fetchedAt, jugadoresConLinea: ctx.market.players, equiposConNoticiaDespues: [...(ctx.market.newsTeams || [])].map(t => teamProjections.get(t)?.code || t) }
          : "sin lineas de props guardadas para hoy")
        : undefined,
      dudosos: CONFIG.questionableScenarios
        ? [...teamProjections.values()].filter(tp => tp.doubtful.length).map(tp => `${tp.code}: ${tp.doubtful.join(", ")}`)
        : undefined
    };
  }

  // Guardar alineaciones (se reemplazan las anteriores del slate;
  // la copia de cada corrida queda en fantasy_nba_lineup_runs).
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
      partidoDeHoy: gameModel.fitted
        ? `localia +${round(gameModel.coef.home, 1)} pts | por cada 10% del aporte habitual que falta ${round(gameModel.coef.missing / 10, 1)} pts | jugar 2 noches seguidas -${round(gameModel.coef.rest, 1)} pts | ` +
          `${gameModel.games} partidos (${gameModel.b2bGames} con cansancio distinto, ${gameModel.gamesWithMissing} con bajas) | diferencia real vs esperada: +-${round(models.blowout.marginSd, 1)} pts`
        : `sin datos suficientes (${gameModel.games} partidos): no se aplica`,
      suplenteATitular: models.roleChange.up
        ? `x${round(models.roleChange.up, 2)} minutos (${models.roleChange.samples} casos)`
        : `sin evidencia suficiente (${models.roleChange.samples} casos)`,
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

  await archiveRun(runAt, opts.version, lineupRows, projectionRows, testLineupRows);

  return { ...stored, runAt, version: opts.version, prueba: testInfo };
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
  if (!dayGames.length) return { date: day, message: "No hay partidos guardados para esa fecha" };
  // Nada se evalua ni se guarda mientras falte UN partido del dia:
  // un resultado a medias se veria como definitivo.
  if (pendingBox > 0) {
    return { date: day, message: `Faltan ${pendingBox} de ${dayGames.length} boxscores por cargar; se evalua cuando esten todos (no se guardo nada)` };
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
    // Cada slate por separado (fecha + plataforma + slate).
    const key = `${l.platform} slate ${l.slate_id}`;
    if (!lineupEval[key]) lineupEval[key] = { platform: l.platform, slateId: l.slate_id, lineups: [] };
    lineupEval[key].lineups.push({
      "#": l.lineup_number,
      proyectado: Number(l.projected_points),
      real,
      diferencia: round(real - Number(l.projected_points), 1),
      completo: complete ? "si" : "faltan boxscores",
      jugadores: (l.players || []).map(pl => `${pl.slot}: ${pl.name} (${realById.get(`${l.slate_id}:${pl.player_id}`) ?? "?"})`).join(" | ")
    });
  }
  if (lineupUpdates.length) await upsertAll("fantasy_nba_lineups", lineupUpdates, "slate_id,lineup_number");

  for (const ev of Object.values(lineupEval)) {
    const platform = ev.platform;
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

  // COMPARACION DE VERSIONES: cada corrida archivada (manana, tarde,
  // variantes de prueba) contra el mismo resultado real.
  const comparacionVersiones = [];
  try {
    const [runLineups, runPlayers] = await Promise.all([
      selectAll("fantasy_nba_lineup_runs", "*", q => q.eq("slate_date", day)),
      selectAll("fantasy_nba_projection_runs", "*", q => q.eq("slate_date", day))
    ]);
    const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const realByName = new Map(updates.map(u => [`${u.slate_id}:${norm(u.player_name)}`, u.actual_points]));
    const realOf = (slateId, pl) => {
      const byId = pl.player_id ? realById.get(`${slateId}:${pl.player_id}`) : undefined;
      return byId !== undefined ? byId : realByName.get(`${slateId}:${norm(pl.name)}`);
    };
    const perfectBySlate = new Map(Object.values(lineupEval).map(ev => [Number(ev.slateId), ev.perfecta?.real ?? null]));

    const groups = new Map();
    const archiveUpdates = [];
    for (const l of runLineups) {
      const values = (l.players || []).map(pl => realOf(l.slate_id, pl));
      const missing = values.filter(v => v === undefined || v === null).length;
      const real = round(values.reduce((s, v) => s + (Number(v) || 0), 0));
      // Sin "id": esa columna la crea Supabase sola y no deja
      // escribirla (por eso antes no se guardaban los puntos reales).
      const { id: _archiveId, ...rest } = l;
      archiveUpdates.push({ ...rest, actual_points: real, evaluated_at: now });
      const key = `${l.version}|${l.run_at}|${l.slate_id}`;
      if (!groups.has(key)) groups.set(key, { l, reals: [], missing: 0 });
      const g = groups.get(key);
      g.reals.push(real);
      g.missing += missing;
    }
    if (archiveUpdates.length) await upsertAll("fantasy_nba_lineup_runs", archiveUpdates, "run_at,version,slate_id,lineup_number");

    const playerErr = new Map();
    for (const p of runPlayers) {
      if (!p.eligible || p.proj_mean === null) continue;
      const real = realOf(p.slate_id, { player_id: p.player_id, name: p.player_name });
      if (real === undefined || real === null) continue;
      const key = `${p.version}|${p.run_at}|${p.slate_id}`;
      if (!playerErr.has(key)) playerErr.set(key, []);
      playerErr.get(key).push(Number(p.proj_mean) - Number(real));
    }

    for (const [key, g] of groups) {
      const perfect = perfectBySlate.get(Number(g.l.slate_id)) ?? null;
      const best = Math.max(...g.reals);
      // Las 150 de prueba usan las proyecciones de su misma version.
      const e = playerErr.get(key) || playerErr.get(key.replace(/ \[prueba \d+\]/, "")) || [];
      comparacionVersiones.push({
        version: g.l.version,
        corrida: new Intl.DateTimeFormat("es-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }).format(new Date(g.l.run_at)),
        plataforma: g.l.platform,
        slate: g.l.slate_id,
        alineaciones: g.reals.length,
        mejorReal: best,
        promedioReal: round(mean(g.reals), 1),
        medianaReal: round(quantile(g.reals, 0.5), 1),
        top10porCientoReal: round(quantile(g.reals, 0.9), 1),
        // Zona donde se gana dinero en torneos grandes.
        llegan85porCientoPerfecta: perfect ? `${g.reals.filter(v => v >= 0.85 * perfect).length}/${g.reals.length}` : null,
        llegan90porCientoPerfecta: perfect ? `${g.reals.filter(v => v >= 0.9 * perfect).length}/${g.reals.length}` : null,
        perfecta: perfect,
        porcentajeDeLaPerfecta: perfect ? `${round(100 * best / perfect, 1)}%` : null,
        errorPromedioJugadores: e.length ? round(mean(e.map(Math.abs)), 2) : null,
        jugadoresSinResultado: g.missing
      });
    }
    comparacionVersiones.sort((a, b) => String(a.plataforma).localeCompare(String(b.plataforma)) || b.mejorReal - a.mejorReal);
  } catch (error) {
    console.warn("Comparacion de versiones:", error.message);
  }

  const summary = {
    date: day,
    partidosEvaluados: gameIds.length,
    comparacionVersiones,
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
      if (result.comparacionVersiones?.length) {
        body += `<h2>Comparacion de versiones (mismo resultado real)</h2>`;
        body += table(result.comparacionVersiones);
      }
      for (const [platform, p] of Object.entries(result.platforms)) {
        body += `<h2>${escapeHtml(platform)}</h2><div class="box">Jugadores ${p.jugadores} | error promedio ${p.errorPromedio} | sesgo ${p.sesgo} | dentro de ±10: ${p.dentroDe10}</div>`;
        body += table(p.mayoresFallos);
        const slates = Object.entries(result.alineaciones || {})
          .filter(([key, x]) => (x.platform || key) === platform)
          .map(([, x]) => x);
        for (const le of slates) {
          body += `<h2>${escapeHtml(platform)} — slate ${escapeHtml(le.slateId)} — alineaciones: proyectado vs real</h2>`;
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
        suplente a titular: ${escapeHtml(result.medido.suplenteATitular)}<br>palizas: ${escapeHtml(result.medido.palizas || result.medido.palizasTitulares)} | ${result.seconds}s</div>`;
      if (result.avisos?.length) body += `<div class="box" style="color:#ffb547">AVISOS: ${result.avisos.map(escapeHtml).join("<br>")}</div>`;
      body += `<h2>Paso 1-2: rol y minutos por equipo</h2>`;
      body += table(result.teams.map(t => ({
        Equipo: t.equipo, Estilo: t.estilo, "Min titulares": t.titularesPromedio, "Ajuste 241": t.ajuste241,
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
module.exports.buildGameModel = buildGameModel;

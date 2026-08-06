const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const MAX_GAMES_USED = 7;

const SPORT_PATHS = {
  nfl: "football/nfl",
  ncaaf: "football/college-football"
};

const ODDS_SPORT_KEYS = {
  nfl: "americanfootball_nfl",
  ncaaf: "americanfootball_ncaaf"
};

const MAX_WEEKS = {
  nfl: 22,
  ncaaf: 16
};
// ===== AJUSTE POR CALIDAD DE RIVAL (FPI) — SOLO NCAAF =====
const NCAAF_FPI_ACTIVE = false;   // false = vuelve al comportamiento de hoy
const NCAAF_FPI_MULT   = 1.0;    // 1.0 = escala del FPI tal cual
const PREMIUM_EDGE_MIN = { nfl: 10, ncaaf: 10 };
// ===== MODELO DE CONSENSO CASHEDGE =====
const SOS_ALPHA       = 0.6;   // 0 = Edge sin tocar, 1 = regla de tres completa. CALIBRAR.
const SOS_RATIO_MIN   = 0.55;
const SOS_RATIO_MAX   = 1.80;
const CONSENSUS_BETA  = 0.15;  // cuánto se inclina el consenso. 0 = 50/50 fijo. CALIBRAR DESPUÉS.
const CONSENSUS_SCALE = 10;    // pts de diferencia para inclinar el peso
const MIN_PROJECTION  = 3;

const TEAM_MAP = {
  // NFL
  "arizona cardinals":    { id: "22", keys: ["arizona cardinals", "cardinals", "arizona"] },
  "atlanta falcons":      { id: "1",  keys: ["atlanta falcons", "falcons", "atlanta"] },
  "baltimore ravens":     { id: "33", keys: ["baltimore ravens", "ravens", "baltimore", "bal"] },
  "buffalo bills":        { id: "2",  keys: ["buffalo bills", "bills", "buffalo", "buf"] },
  "carolina panthers":    { id: "29", keys: ["carolina panthers", "panthers"] },
  "chicago bears":        { id: "3",  keys: ["chicago bears", "bears", "chicago"] },
  "cincinnati bengals":   { id: "4",  keys: ["cincinnati bengals", "bengals", "cincinnati", "cin"] },
  "cleveland browns":     { id: "5",  keys: ["cleveland browns", "browns", "cleveland"] },
  "dallas cowboys":       { id: "6",  keys: ["dallas cowboys", "cowboys", "dallas", "dal"] },
  "denver broncos":       { id: "7",  keys: ["denver broncos", "broncos", "denver"] },
  "detroit lions":        { id: "8",  keys: ["detroit lions", "lions", "detroit", "det"] },
  "green bay packers":    { id: "9",  keys: ["green bay packers", "packers", "green bay"] },
  "houston texans":       { id: "34", keys: ["houston texans", "texans", "houston"] },
  "indianapolis colts":   { id: "11", keys: ["indianapolis colts", "colts", "indianapolis"] },
  "jacksonville jaguars": { id: "30", keys: ["jacksonville jaguars", "jaguars", "jacksonville"] },
  "kansas city chiefs":   { id: "12", keys: ["kansas city chiefs", "chiefs", "kansas city", "kc"] },
  "las vegas raiders":    { id: "13", keys: ["las vegas raiders", "raiders", "las vegas"] },
  "los angeles chargers": { id: "24", keys: ["los angeles chargers", "chargers"] },
  "los angeles rams":     { id: "14", keys: ["los angeles rams", "rams"] },
  "miami dolphins":       { id: "15", keys: ["miami dolphins", "dolphins", "miami"] },
  "minnesota vikings":    { id: "16", keys: ["minnesota vikings", "vikings", "minnesota"] },
  "new england patriots": { id: "17", keys: ["new england patriots", "patriots", "new england"] },
  "new orleans saints":   { id: "18", keys: ["new orleans saints", "saints", "new orleans"] },
  "new york giants":      { id: "19", keys: ["new york giants", "giants"] },
  "new york jets":        { id: "20", keys: ["new york jets", "jets"] },
  "philadelphia eagles":  { id: "21", keys: ["philadelphia eagles", "eagles", "philadelphia", "phi"] },
  "pittsburgh steelers":  { id: "23", keys: ["pittsburgh steelers", "steelers", "pittsburgh"] },
  "san francisco 49ers":  { id: "25", keys: ["san francisco 49ers", "49ers", "san francisco", "sf"] },
  "seattle seahawks":     { id: "26", keys: ["seattle seahawks", "seahawks", "seattle"] },
  "tampa bay buccaneers": { id: "27", keys: ["tampa bay buccaneers", "buccaneers", "tampa bay", "tampa"] },
  "tennessee titans":     { id: "10", keys: ["tennessee titans", "titans", "tennessee"] },
  "washington commanders":{ id: "28", keys: ["washington commanders", "commanders", "washington"] },

  // Abreviaciones NFL
  kc:   { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },
  phi:  { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },
  dal:  { id: "6",  keys: ["dal", "cowboys", "dallas cowboys", "dallas"] },
  buf:  { id: "2",  keys: ["buf", "bills", "buffalo bills", "buffalo"] },
  bal:  { id: "33", keys: ["bal", "ravens", "baltimore ravens", "baltimore"] },
  cin:  { id: "4",  keys: ["cin", "bengals", "cincinnati bengals", "cincinnati"] },
  sf:   { id: "25", keys: ["sf", "49ers", "san francisco 49ers", "san francisco"] },
  det:  { id: "8",  keys: ["det", "lions", "detroit lions", "detroit"] },

  // NCAAF
  clemson:              { id: "228",  keys: ["clemson", "clemson tigers", "tigers"] },
  "clemson tigers":     { id: "228",  keys: ["clemson", "clemson tigers", "tigers"] },
  unc:                  { id: "153",  keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north carolina":     { id: "153",  keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north-carolina":     { id: "153",  keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north carolina tar heels": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  alabama:              { id: "333",  keys: ["alabama", "alabama crimson tide", "crimson tide"] },
  georgia:              { id: "61",   keys: ["georgia", "georgia bulldogs", "bulldogs"] },
  "ohio state":         { id: "194",  keys: ["ohio state", "ohio state buckeyes", "osu", "buckeyes"] },
  texas:                { id: "251",  keys: ["texas", "texas longhorns", "longhorns"] },
  oregon:               { id: "2483", keys: ["oregon", "oregon ducks", "ducks"] },
  michigan:             { id: "130",  keys: ["michigan", "michigan wolverines", "wolverines"] },
  fsu:                  { id: "52",   keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] },
  "florida state":      { id: "52",   keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] }
};
function cleanText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("-", " ")
    .replaceAll(".", "")
    .replaceAll("'", "")
    .replaceAll("&", "and")
    .trim();
}

function getDefaultSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  return month >= 8 ? year : year - 1;
}
// Cache en memoria para IDs de equipos resueltos dinámicamente
const dynamicTeamCache = global.__FOOTBALL_TEAM_ID_CACHE__ || {};
global.__FOOTBALL_TEAM_ID_CACHE__ = dynamicTeamCache;

async function findNCAAFTeamIdDynamic(teamName) {
  const cacheKey = cleanText(teamName);

  if (dynamicTeamCache[cacheKey]) {
    return dynamicTeamCache[cacheKey];
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=500`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const groups = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const clean = cleanText(teamName);

    const match = groups.find(t => {
      const team = t.team || {};
      const displayName = cleanText(team.displayName || "");
      const shortName = cleanText(team.shortDisplayName || "");
      const location = cleanText(team.location || "");
      const nickname = cleanText(team.name || "");

      return (
        displayName === clean || shortName === clean ||
        clean === location ||
        (clean.includes(location) && location.length > 2) ||
        (clean.includes(nickname) && nickname.length > 2) ||
        displayName.includes(clean) || clean.includes(displayName)
      );
    });

    if (match?.team?.id) {
      const result = {
        id: match.team.id,
        keys: [
          cleanText(match.team.displayName || ""),
          cleanText(match.team.shortDisplayName || ""),
          cleanText(match.team.location || ""),
          cleanText(match.team.name || "")
        ].filter(Boolean)
      };
      dynamicTeamCache[cacheKey] = result;
      return result;
    }

    return null;
  } catch {
    return null;
  }
}
function normalizeTeam(team, type = "nfl") {
  const key = cleanText(team);

  // Match exacto por llave del mapa
  const mapped = TEAM_MAP[key];
  if (mapped) return mapped;

  // Match exacto contra los alias
  for (const mapVal of Object.values(TEAM_MAP)) {
    if (mapVal.keys.some(k => cleanText(k) === key)) return mapVal;
  }

  // NCAAF: nunca cae al TEAM_MAP de NFL por parecido
  return {
    id: key,
    keys: [key],
    needsDynamicResolution: true
  };
}
function average(numbers) {
  const valid = numbers.filter((n) => Number.isFinite(Number(n)));
  if (!valid.length) return 0;
  return valid.reduce((sum, n) => sum + Number(n), 0) / valid.length;
}

function round(num, decimals = 1) {
  if (!Number.isFinite(Number(num))) return 0;
  return Number(Number(num).toFixed(decimals));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
// Regla de tres parcial: (rival de hoy / rivales enfrentados)^alpha
function sosRatio(target, faced, alpha = SOS_ALPHA) {
  const t = Number(target), f = Number(faced);
  if (!(t > 0) || !(f > 0)) return 1;
  return Math.pow(clamp(t / f, SOS_RATIO_MIN, SOS_RATIO_MAX), alpha);
}
function getConfidenceFromEdge(edge, type = "nfl") {
  const e = Math.abs(Number(edge || 0));
  if (!Number.isFinite(e)) return 0;

  const minPremium = PREMIUM_EDGE_MIN[type] || 13;

  if (e < minPremium) {
    return round(Math.min(74, Math.max(50, 50 + e * 1.5)));
  }
  if (e >= 30) return 99;

  return round(75 + ((e - minPremium) / (30 - minPremium)) * 24);
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${url}`);
  }

  return response.json();
}

function isCompletedGame(event, comp) {
  const statusType = comp?.status?.type || event?.status?.type;

  return (
    statusType?.completed === true ||
    statusType?.name === "STATUS_FINAL" ||
    statusType?.state === "post"
  );
}

function competitorMatchesTeam(competitor, teamRef) {
  const id = String(competitor.team?.id || "");
  const abbreviation = cleanText(competitor.team?.abbreviation);
  const displayName = cleanText(competitor.team?.displayName);
  const shortName = cleanText(competitor.team?.shortDisplayName);
  const location = cleanText(competitor.team?.location);
  const name = cleanText(competitor.team?.name);

  // ID numerico: match directo (NFL y NCAAF de TEAM_MAP)
  if (teamRef.id && String(teamRef.id) === id) return true;

  return teamRef.keys.some((key) => {
    const k = cleanText(key);
    if (!k) return false;

    // Solo match EXACTO. Nada de includes sobre mascota.
    if (displayName && displayName === k) return true;
    if (shortName && shortName === k) return true;
    if (location && location === k) return true;
    if (abbreviation && abbreviation === k) return true;

    // "usc trojans" -> location "usc" + mascota "trojans"
    if (location && name && `${location} ${name}` === k) return true;

    return false;
  });
}

async function getSeasonGames(type, season) {
  const sportPath = SPORT_PATHS[type];
  const weeks = MAX_WEEKS[type];

  const allGames = [];

  for (let week = 1; week <= weeks; week++) {
    const groupParam =
      type === "ncaaf"
        ? "&groups=80"
        : "";

    const url =
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard` +
      `?dates=${season}` +
      `&seasontype=2` +
      `&week=${week}` +
      groupParam;

    try {
      const data = await fetchJson(url);
      const events = data.events || [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        const competitors =
          comp?.competitors || [];

        if (competitors.length !== 2) continue;
        if (!isCompletedGame(event, comp)) {
          continue;
        }

        const c1 = competitors[0];
        const c2 = competitors[1];

        const score1 = Number(c1.score);
        const score2 = Number(c2.score);

        if (
          !Number.isFinite(score1) ||
          !Number.isFinite(score2)
        ) {
          continue;
        }

        allGames.push({
          id: event.id,
          date: event.date,
          week,

          team1Id:
            String(c1.team?.id || ""),

          team1Abbr:
            c1.team?.abbreviation || "",

          team1Name:
            c1.team?.displayName || "",

          team1ShortName:
            c1.team?.shortDisplayName || "",

          team1Location:
            c1.team?.location || "",

          team1Mascot:
            c1.team?.name || "",

          team1Score: score1,

          team2Id:
            String(c2.team?.id || ""),

          team2Abbr:
            c2.team?.abbreviation || "",

          team2Name:
            c2.team?.displayName || "",

          team2ShortName:
            c2.team?.shortDisplayName || "",

          team2Location:
            c2.team?.location || "",

          team2Mascot:
            c2.team?.name || "",

          team2Score: score2
        });
      }
    } catch (err) {
      console.log(
        `No se pudo cargar ${type} week ${week}:`,
        err.message
      );
    }
  }

  return allGames.sort(
    (a, b) =>
      new Date(b.date) - new Date(a.date)
  );
}

function gameSideMatches(game, side, teamRef) {
  const fakeCompetitor =
    side === 1
      ? {
          team: {
            id: game.team1Id,
            abbreviation: game.team1Abbr,
            displayName: game.team1Name,
            shortDisplayName: game.team1ShortName,
            location: game.team1Location,
            name: game.team1Mascot
          }
        }
      : {
          team: {
            id: game.team2Id,
            abbreviation: game.team2Abbr,
            displayName: game.team2Name,
            shortDisplayName: game.team2ShortName,
            location: game.team2Location,
            name: game.team2Mascot
          }
        };

  return competitorMatchesTeam(fakeCompetitor, teamRef);
}

function getTeamGamesFromSeason(allGames, teamRef) {
  return allGames
    .filter((game) => gameSideMatches(game, 1, teamRef) || gameSideMatches(game, 2, teamRef))
    .map((game) => {
      const isTeam1 = gameSideMatches(game, 1, teamRef);

      return {
        date: game.date,
        week: game.week,
        teamPoints: isTeam1 ? game.team1Score : game.team2Score,
        pointsAllowed: isTeam1 ? game.team2Score : game.team1Score,
        opponentId: isTeam1 ? game.team2Id : game.team1Id,
        opponentName: isTeam1 ? game.team2Name : game.team1Name,
        opponentAbbr: isTeam1 ? game.team2Abbr : game.team1Abbr,
        opponentKeys: [
          isTeam1 ? game.team2Name : game.team1Name,
          isTeam1 ? game.team2Abbr : game.team1Abbr,
          isTeam1 ? game.team2Location : game.team1Location,
          isTeam1 ? game.team2Mascot : game.team1Mascot
        ].map(cleanText)
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getOpponentRefFromGame(game) {
  return {
    id: String(game.opponentId || ""),
    keys: game.opponentKeys || []
  };
}

function getOpponentAveragesFromSeason(allGames, opponentRef, beforeDate) {
  const games = getTeamGamesFromSeason(allGames, opponentRef);

  const previousGames = games
    .filter((game) => new Date(game.date) < new Date(beforeDate))
    .slice(0, MAX_GAMES_USED);

  return {
    opponentAvgPointsAllowed: round(
      average(previousGames.map((g) => g.pointsAllowed))
    ),
    opponentAvgPointsScored: round(
      average(previousGames.map((g) => g.teamPoints))
    ),
    gamesUsedForOpponent: previousGames.length
  };
}

function buildTeamGamesFromSeason(allGames, teamRef) {
  const schedule = getTeamGamesFromSeason(allGames, teamRef);

  const recentGames = schedule.slice(
    0,
    Math.min(MAX_GAMES_USED, schedule.length)
  );

  return recentGames.map((game) => {
    const opponentRef = getOpponentRefFromGame(game);

    const opponentAvg = getOpponentAveragesFromSeason(
      allGames,
      opponentRef,
      game.date
    );

    return {
      date: game.date,
      week: game.week,
      opponent: game.opponentName,
      opponentId: game.opponentId,
      teamPoints: game.teamPoints,
      pointsAllowed: game.pointsAllowed,
      opponentAvgPointsAllowed: opponentAvg.opponentAvgPointsAllowed,
      opponentAvgPointsScored: opponentAvg.opponentAvgPointsScored,
      opponentGamesUsed: opponentAvg.gamesUsedForOpponent
    };
  });
}
function blendFootballSeasonGames(
  currentSeasonGames = [],
  previousSeasonGames = []
) {
  const current = currentSeasonGames.slice(0, MAX_GAMES_USED);

  // Desde el cuarto juego usamos solamente la temporada actual.
  if (current.length >= 4) {
    return current;
  }

  const previousGamesNeeded =
    MAX_GAMES_USED - current.length;

  return [
    ...current,
    ...previousSeasonGames.slice(0, previousGamesNeeded)
  ];
}
const fpiCache = global.__NCAAF_FPI_CACHE__ || {};
global.__NCAAF_FPI_CACHE__ = fpiCache;
function resolveTeamIdFromGames(allGames, teamRef) {
  if (teamRef?.id && /^\d+$/.test(String(teamRef.id))) return String(teamRef.id);
  for (const g of allGames) {
    if (gameSideMatches(g, 1, teamRef)) return String(g.team1Id);
    if (gameSideMatches(g, 2, teamRef)) return String(g.team2Id);
  }
  return null;
}
// Devuelve { teamId: { off, def } } — null si falla
async function getFPIMap(season) {
  const key = `ncaaf-${season}`;
  if (fpiCache[key] !== undefined) return fpiCache[key];

  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/powerindex?limit=200`;
    const res = await fetch(url);
    if (!res.ok) { fpiCache[key] = null; return null; }
    const data = await res.json();

    const map = {};
    for (const item of data?.items || []) {
      const ref = item?.team?.$ref || "";
      const m = ref.match(/teams\/(\d+)/);
      if (!m) continue;

      const find = (n) => {
        const p = (item.predictives || []).find(x => x.name === n);
        return p ? Number(p.value) : null;
      };

      const off = find("epaoffense");
      const def = find("epadefense");
      if (off === null || def === null) continue;

      map[m[1]] = { off, def };
    }

    const result = Object.keys(map).length ? map : null;
    fpiCache[key] = result;
    return result;
  } catch {
    fpiCache[key] = null;
    return null;
  }
}

// Nivel promedio de los rivales que este equipo ya enfrentó
function getScheduleBaseline(games, fpiMap) {
  const defs = [], offs = [];
  for (const g of games) {
    const f = fpiMap[String(g.opponentId)];
    if (!f) continue;
    defs.push(f.def);
    offs.push(f.off);
  }
  if (!defs.length) return null;
  return {
    avgOppDef: average(defs),
    avgOppOff: average(offs),
    matched: defs.length
  };
}
const LEAGUE_AVG_FALLBACK = 28;

// Promedio de puntos por equipo/partido, calculado de TU muestra real
function computeLeagueBaseline(allGames) {
  const scores = [];
  for (const g of allGames) {
    scores.push(Number(g.team1Score));
    scores.push(Number(g.team2Score));
  }
  const avg = average(scores);
  return avg > 0 ? round(avg) : LEAGUE_AVG_FALLBACK;
}
// Traduce FPI a puntos y recalcula los Edges contra el nivel REAL del calendario
function buildFPIProfile(edges, fpi, base, leagueAvg) {
  // Qué haría este equipo contra un rival PROMEDIO de FBS (según FPI, alto = bueno)
  const fpiPF = leagueAvg + Number(fpi.off);   // anotaría
  const fpiPA = leagueAvg - Number(fpi.def);   // permitiría

  // Nivel real del calendario que enfrentó, en puntos
  const facedPA = leagueAvg - Number(base.avgOppDef); // lo que permitían las defensas que enfrentó
  const facedPF = leagueAvg + Number(base.avgOppOff); // lo que anotaban las ofensivas que enfrentó

  // Edges limpios: vs lo que REALMENTE debía esperarse de ese calendario
  const edgeOffClean = edges.avgPointsScored  - facedPA;  // + = ofensiva buena
  const edgeDefClean = edges.avgPointsAllowed - facedPF;  // + = defensa MALA (tu convención)

  return {
    ...edges,
    fpiPF: round(fpiPF),
    fpiPA: round(fpiPA),
    facedPA: round(facedPA),
    facedPF: round(facedPF),
    edgeOffClean: round(edgeOffClean),
    edgeDefClean: round(edgeDefClean)
  };
}
function calculateFootballEdges(games = []) {
  const recentGames = games.slice(0, Math.min(MAX_GAMES_USED, games.length));
  const usableGames = recentGames.filter((game) => Number(game.opponentGamesUsed) > 0);
  const gamesForCalc = usableGames.length ? usableGames : recentGames;

  // Edge ofensivo: anoté MÁS de lo que suelen permitir -> positivo = ofensiva buena
  const offensiveEdges = gamesForCalc.map(
    (g) => Number(g.teamPoints) - Number(g.opponentAvgPointsAllowed)
  );

  // Edge defensivo: permití MÁS de lo que suelen anotar -> positivo = defensa MALA
  // (INVERTIDO respecto a la versión anterior del archivo)
  const defensiveEdges = gamesForCalc.map(
    (g) => Number(g.pointsAllowed) - Number(g.opponentAvgPointsScored)
  );

  return {
    gamesUsed: gamesForCalc.length,
    avgPointsScored:  round(average(gamesForCalc.map((g) => g.teamPoints))),
    avgPointsAllowed: round(average(gamesForCalc.map((g) => g.pointsAllowed))),

    // Fuerza del calendario
    sosDef: round(average(gamesForCalc.map((g) => g.opponentAvgPointsAllowed))), // qué permitían las defensas que enfrenté
    sosOff: round(average(gamesForCalc.map((g) => g.opponentAvgPointsScored))),  // qué anotaban las ofensivas que enfrenté

    avgOffensiveEdge: round(average(offensiveEdges)),
    avgDefensiveEdge: round(average(defensiveEdges))
  };
}

// team = equipo que anota (A), opponent = equipo que defiende (B)
function projectFootballTeam(team, opponent, alpha = SOS_ALPHA, beta = CONSENSUS_BETA) {
  // --- VÍA 1: Edge ofensivo de A sobre la base defensiva de B ---
  // El Edge de A se obtuvo vs defensas que permitían team.sosDef.
  // Hoy enfrenta una que permite opponent.avgPointsAllowed.
  // Defensa de hoy mejor -> ratio < 1 -> el Edge se encoge.
  const offRatio   = sosRatio(opponent.avgPointsAllowed, team.sosDef, alpha);
  const edgeOffRaw = Number(team.avgOffensiveEdge) || 0;
  const edgeOffAdj = edgeOffRaw * offRatio;
  const projectionFromOffense = Number(opponent.avgPointsAllowed || 0) + edgeOffAdj;

  // --- VÍA 2: Edge defensivo de B sobre la base ofensiva de A ---
  const defRatio   = sosRatio(team.avgPointsScored, opponent.sosOff, alpha);
  const edgeDefRaw = Number(opponent.avgDefensiveEdge) || 0;
  const edgeDefAdj = edgeDefRaw * defRatio;
  // El signo del Edge manda: defensa mala (+) suma, defensa buena (-) resta.
  const projectionFromOpponentDefense = Number(team.avgPointsScored || 0) + edgeDefAdj;

  // --- CONSENSO PONDERADO ---
  // Fuerzas YA corregidas por calendario para este matchup, no las crudas.
  const offStrength = edgeOffAdj;   // + = ofensiva buena
  const defStrength = -edgeDefAdj;  // + = defensa buena (signo volteado)

  // diff > 0 -> manda la ofensiva -> pesa más la vía 1
  // diff < 0 -> manda la defensa  -> pesa más la vía 2
  const diff = offStrength - defStrength;

  const safeBeta = clamp(Number(beta) || 0, 0, 0.49);
  const tilt = Math.tanh(diff / CONSENSUS_SCALE); // satura: ninguna vía se apaga
  const w1 = clamp(0.5 + safeBeta * tilt, 0.5 - safeBeta, 0.5 + safeBeta);
  const w2 = 1 - w1;

  const finalProjection = projectionFromOffense * w1 + projectionFromOpponentDefense * w2;

  return {
    projectionFromOffense: round(projectionFromOffense),
    projectionFromOpponentDefense: round(projectionFromOpponentDefense),
    finalProjection: round(Math.max(MIN_PROJECTION, finalProjection)),
    debug: {
      offRatio: round(offRatio, 3),
      edgeOffRaw: round(edgeOffRaw),
      edgeOffAdj: round(edgeOffAdj),
      defRatio: round(defRatio, 3),
      edgeDefRaw: round(edgeDefRaw),
      edgeDefAdj: round(edgeDefAdj),
      offStrength: round(offStrength),
      defStrength: round(defStrength),
      diff: round(diff),
      tilt: round(tilt, 3),
      w1: round(w1, 3),
      w2: round(w2, 3)
    }
  };
}
// team = equipo que anota (A), opponent = equipo que defiende (B)
// Ambos perfiles vienen de buildFPIProfile
function projectFootballTeamFPI(team, opponent, alpha = SOS_ALPHA, beta = CONSENSUS_BETA) {
  // --- VÍA 1: puntos reales de A sobre la base defensiva de B (FPI) ---
  const offRatio   = sosRatio(opponent.fpiPA, team.facedPA, alpha);
  const edgeOffAdj = team.edgeOffClean * offRatio;
  const projectionFromOffense = opponent.fpiPA + edgeOffAdj;

  // --- VÍA 2: puntos reales de B sobre la base ofensiva de A (FPI) ---
  const defRatio   = sosRatio(team.fpiPF, opponent.facedPF, alpha);
  const edgeDefAdj = opponent.edgeDefClean * defRatio;
  const projectionFromOpponentDefense = team.fpiPF + edgeDefAdj;

  // --- CONSENSO PONDERADO (fuerzas ya corregidas) ---
  const offStrength = edgeOffAdj;
  const defStrength = -edgeDefAdj;
  const diff = offStrength - defStrength;

  const safeBeta = clamp(Number(beta) || 0, 0, 0.49);
  const tilt = Math.tanh(diff / CONSENSUS_SCALE);
  const w1 = clamp(0.5 + safeBeta * tilt, 0.5 - safeBeta, 0.5 + safeBeta);
  const w2 = 1 - w1;

  const finalProjection = projectionFromOffense * w1 + projectionFromOpponentDefense * w2;

  return {
    projectionFromOffense: round(projectionFromOffense),
    projectionFromOpponentDefense: round(projectionFromOpponentDefense),
    finalProjection: round(Math.max(MIN_PROJECTION, finalProjection)),
    debug: {
      offRatio: round(offRatio, 3),
      edgeOffClean: round(team.edgeOffClean),
      edgeOffAdj: round(edgeOffAdj),
      defRatio: round(defRatio, 3),
      edgeDefClean: round(opponent.edgeDefClean),
      edgeDefAdj: round(edgeDefAdj),
      diff: round(diff),
      w1: round(w1, 3),
      w2: round(w2, 3)
    }
  };
}
function oddsTeamMatches(oddsName, teamRef) {
  const cleanOddsName = cleanText(oddsName);

  return teamRef.keys.some((key) => {
    const cleanKey = cleanText(key);
    return (
      cleanOddsName === cleanKey ||
      cleanOddsName.includes(cleanKey) ||
      cleanKey.includes(cleanOddsName)
    );
  });
}

async function getFootballOdds(type, teamARef, teamBRef) {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    return {
      available: false,
      message: "Falta ODDS_API_KEY en Vercel"
    };
  }

  const sportKey = ODDS_SPORT_KEYS[type];

  if (!sportKey) {
    return {
      available: false,
      message: "Sport no soportado para odds"
    };
  }

  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
    `?apiKey=${apiKey}` +
    `&regions=us` +
    `&markets=spreads,totals` +
    `&oddsFormat=american`;

  try {
    const data = await fetchJson(url);

    const game = data.find((g) => {
      const homeMatchesA = oddsTeamMatches(g.home_team, teamARef);
      const awayMatchesA = oddsTeamMatches(g.away_team, teamARef);
      const homeMatchesB = oddsTeamMatches(g.home_team, teamBRef);
      const awayMatchesB = oddsTeamMatches(g.away_team, teamBRef);

      return (homeMatchesA || awayMatchesA) && (homeMatchesB || awayMatchesB);
    });

    if (!game) {
      return {
        available: false,
        message: "No se encontraron odds para este matchup"
      };
    }

 let spreadLineA = null;
    let spreadLineB = null;
    let totalLine = null;

    let spreadPriceA = -110;
    let spreadPriceB = -110;
    let overPrice = -110;
    let underPrice = -110;

    for (const bookmaker of game.bookmakers || []) {
      const spreadMarket = bookmaker.markets?.find((m) => m.key === "spreads");
      const totalMarket = bookmaker.markets?.find((m) => m.key === "totals");

      if (spreadMarket) {
        for (const outcome of spreadMarket.outcomes || []) {
          if (oddsTeamMatches(outcome.name, teamARef)) {
            spreadLineA = Number(outcome.point);
            spreadPriceA = Number(outcome.price) || -110;
          }

          if (oddsTeamMatches(outcome.name, teamBRef)) {
            spreadLineB = Number(outcome.point);
            spreadPriceB = Number(outcome.price) || -110;
          }
        }
      }

      if (totalMarket) {
        const over = totalMarket.outcomes?.find(
          (o) => cleanText(o.name) === "over"
        );
        const under = totalMarket.outcomes?.find(
          (o) => cleanText(o.name) === "under"
        );

        if (over) {
          totalLine = Number(over.point);
          overPrice = Number(over.price) || -110;
        }

        if (under) {
          underPrice = Number(under.price) || -110;
        }
      }

      if (
        Number.isFinite(spreadLineA) &&
        Number.isFinite(spreadLineB) &&
        Number.isFinite(totalLine)
      ) {
        break;
      }
    }

    return {
      available: true,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      spreadLineA,
      spreadLineB,
      spreadPriceA,
      spreadPriceB,
      totalLine,
      overPrice,
      underPrice
    };
  } catch (error) {
    return {
      available: false,
      message: error.message
    };
  }
}
function findStatValue(data, statName, section = "stats") {
  const groups = section === "opponent"
    ? data?.results?.stats?.opponent ||
      data?.results?.opponent ||
      data?.stats?.opponent ||
      data?.opponent ||
      []
    : data?.results?.stats?.categories ||
      data?.stats?.categories ||
      [];

  for (const category of groups) {
    for (const stat of category.stats || []) {
      if (stat.name === statName) {
        if (
          section === "opponent" &&
          (statName === "totalPointsPerGame" || statName === "yardsPerGame")
        ) {
          return Number(stat.value ?? stat.perGameValue ?? 0);
        }

        return Number(stat.perGameValue ?? stat.value ?? 0);
      }
    }
  }

  return 0;
}

async function getTeamStatsProfile(type, teamRef, season) {
  const sportPath = SPORT_PATHS[type];

  if (teamRef.needsDynamicResolution && type === "ncaaf") {
    const resolved = await findNCAAFTeamIdDynamic(teamRef.id);
    if (resolved) {
      teamRef = { ...teamRef, ...resolved, needsDynamicResolution: false };
    } else {
      return {
        plays: 68, yards: 390, thirdDown: 40, redZone: 60,
        defPoints: 27, defYards: 390, defThirdDown: 40, defRedZone: 60
      };
    }
  }
const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamRef.id}/statistics?season=${season}`;
  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    console.log(`Stats no disponibles para team ${teamRef.id}:`, err.message);
    return {
      plays: 68, yards: 390, thirdDown: 40, redZone: 60,
      defPoints: 27, defYards: 390, defThirdDown: 40, defRedZone: 60
    };
  }

  return {
    plays: findStatValue(data, "totalOffensivePlays"),
    yards: findStatValue(data, "yardsPerGame"),
    thirdDown: findStatValue(data, "thirdDownConvPct"),
    redZone: findStatValue(data, "redzoneScoringPct"),
    defPoints: findStatValue(data, "totalPointsPerGame", "opponent"),
    defYards: findStatValue(data, "yardsPerGame", "opponent"),
    defThirdDown: findStatValue(data, "thirdDownConvPct", "opponent"),
    defRedZone: findStatValue(data, "redzoneScoringPct", "opponent")
  };
}

function calculatePaceEfficiencyAdjustment({ type, projectedTotal, teamAProfile, teamBProfile }) {
   if (type === "ncaaf") return { adjustment: 0, gameEdge: 0, teamAOffenseScore: 1, teamBOffenseScore: 1, teamADefenseScore: 1, teamBDefenseScore: 1 };
  const leagueAvg = {
    nfl: {
      plays: 62,
      yards: 335,
      thirdDown: 39,
      redZone: 58,
      defPoints: 22,
      defYards: 335,
      defThirdDown: 39,
      defRedZone: 58,
      max: 8
    },
    ncaaf: {
      plays: 68,
      yards: 390,
      thirdDown: 40,
      redZone: 60,
      defPoints: 27,
      defYards: 390,
      defThirdDown: 40,
      defRedZone: 60,
      max: 12
    }
  }[type];

  if (!leagueAvg) return { adjustment: 0 };

  function offenseScore(p) {
    return (
      (p.plays / leagueAvg.plays) * 0.45 +
      (p.yards / leagueAvg.yards) * 0.25 +
      (p.thirdDown / leagueAvg.thirdDown) * 0.15 +
      (p.redZone / leagueAvg.redZone) * 0.15
    );
  }

  function defenseScore(p) {
    return (
      (leagueAvg.defPoints / p.defPoints) * 0.35 +
      (leagueAvg.defYards / p.defYards) * 0.35 +
      (leagueAvg.defThirdDown / p.defThirdDown) * 0.15 +
      (leagueAvg.defRedZone / p.defRedZone) * 0.15
    );
  }

  const teamAEdge = offenseScore(teamAProfile) - defenseScore(teamBProfile);
  const teamBEdge = offenseScore(teamBProfile) - defenseScore(teamAProfile);

  const gameEdge = (teamAEdge + teamBEdge) / 2;

  const rawAdjustment = projectedTotal * gameEdge * 0.60;

  const adjustment = clamp(rawAdjustment, -leagueAvg.max, leagueAvg.max);

  return {
    adjustment: round(adjustment),
    gameEdge: round(gameEdge, 3),
    teamAOffenseScore: round(offenseScore(teamAProfile), 3),
    teamBOffenseScore: round(offenseScore(teamBProfile), 3),
    teamADefenseScore: round(defenseScore(teamAProfile), 3),
    teamBDefenseScore: round(defenseScore(teamBProfile), 3)
  };
}
function buildFootballPicks({
  teamA,
  teamB,
  projectedSpread,
  projectedTotal,
  odds,
    type = "nfl"
}) {
  if (!odds || !odds.available) {
    return {
      available: false,
      message: odds?.message || "Odds no disponibles"
    };
  }

  let spreadPick = null;

  const spreadEdgeA = Number.isFinite(odds.spreadLineA)
    ? projectedSpread + odds.spreadLineA
    : null;

  const spreadEdgeB = Number.isFinite(odds.spreadLineB)
    ? -projectedSpread + odds.spreadLineB
    : null;

  let chosenSide = null;
  let chosenEdge = 0;
  let chosenLine = 0;

  if (Number.isFinite(spreadEdgeA) && spreadEdgeA > 0 && spreadEdgeA >= spreadEdgeB) {
    chosenSide = teamA;
    chosenEdge = spreadEdgeA;
    chosenLine = odds.spreadLineA;
  } else if (Number.isFinite(spreadEdgeB) && spreadEdgeB > 0) {
    chosenSide = teamB;
    chosenEdge = spreadEdgeB;
    chosenLine = odds.spreadLineB;
  }

 if (chosenSide) {
    const edge = round(chosenEdge);
    const confidence = getConfidenceFromEdge(edge, type);

    const chosenPrice = chosenSide === teamA
      ? (odds.spreadPriceA ?? -110)
      : (odds.spreadPriceB ?? -110);

    spreadPick = {
      type: "spread",
      side: chosenSide,
      pick: `${chosenSide} ${chosenLine > 0 ? "+" : ""}${chosenLine}`,
      edge,
      confidence,
      odds_american: chosenPrice,
      isPremium: edge >= (PREMIUM_EDGE_MIN[type] || 13) && confidence >= 75
    };
  }
  let totalPick = null;

  if (Number.isFinite(odds.totalLine)) {
    const rawEdge = projectedTotal - odds.totalLine;
    const edge = round(Math.abs(rawEdge));

    if (edge > 0) {
      const confidence = getConfidenceFromEdge(edge, type);
      const isOver = rawEdge >= 0;

      totalPick = {
        type: "total",
        pick: isOver ? `OVER ${odds.totalLine}` : `UNDER ${odds.totalLine}`,
        edge,
        confidence,
        odds_american: isOver ? (odds.overPrice ?? -110) : (odds.underPrice ?? -110),
       isPremium: edge >= (PREMIUM_EDGE_MIN[type] || 13) && confidence >= 75
      };
    }
  }

  return {
    available: true,
    spreadPick,
    totalPick
  };
}

function sanitizePicksForPublic(picks, isPremiumUser) {
  if (!picks || !picks.available) return picks;

  const sanitizePick = (pick) => {
    if (!pick) return null;

    const shouldHide = pick.isPremium && !isPremiumUser;

    return {
      available: true,
      isPremium: pick.isPremium,
      confidence: shouldHide ? null : pick.confidence,
edge: shouldHide ? null : pick.edge,
      locked: shouldHide,
      type: pick.isPremium ? "premium" : pick.type,
      pick: shouldHide ? "🔒 Premium Pick" : pick.pick,
side: shouldHide ? "Suscríbete para desbloquear" : pick.side || null
    };
  };

  return {
    available: true,
    spreadPick: sanitizePick(picks.spreadPick),
    totalPick: sanitizePick(picks.totalPick)
  };
}
// ============================================================
// NFL/NCAAF INJURY IMPACT SYSTEM
// ============================================================

const NFL_INJURY_ACTIVE = true; // cambiar a true para aplicar al modelo (Paso final)

const NFL_POS_LEAGUE_AVG = {
  QB: { yds: 230.4, td: 1.59 },
  RB: { yds: 71.2,  td: 0.54 },
  WR: { yds: 70.9,  td: 0.42 },
  TE: { yds: 70.9,  td: 0.42 }
};

const NFL_POS_MULTIPLIER = { QB: 1.5, RB: 0.8, WR: 0.7, TE: 0.7, DEFAULT: 0.5 };
const NFL_DEF_CROSSOVER  = { QB: 0.35, RB: 0.15, WR: 0.10, TE: 0.10, DEFAULT: 0.05 };
const NFL_MAX_TEAM_INJURY_IMPACT = 10;

function getNFLPesoStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("out") || s.includes("injured reserve")) return 4;
  if (s.includes("doubtful")) return 3;
  if (s.includes("questionable")) return 1.5;
  if (s.includes("day-to-day") || s.includes("day to day")) return 1;
  return 0;
}

function normalizeNFLPosition(pos) {
  const p = String(pos || "").toUpperCase().trim();
  if (["QB", "RB", "WR", "TE"].includes(p)) return p;
  if (p === "FB" || p === "HB") return "RB";
  return "DEFAULT";
}

const nflInjuryStatsCache = global.__NFL_INJURY_STATS_CACHE__ || {};
global.__NFL_INJURY_STATS_CACHE__ = nflInjuryStatsCache;

async function getNFLPlayerSeasonStats(athleteId, type, season) {
  if (!athleteId) return null;
  const cacheKey = `${type}-${season}-${athleteId}`;
  if (nflInjuryStatsCache[cacheKey]) return nflInjuryStatsCache[cacheKey];

  const leaguePath = type === "ncaaf" ? "college-football" : "nfl";

  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/${leaguePath}/seasons/${season}/types/2/athletes/${athleteId}/statistics`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const categories = data?.splits?.categories || [];
    function findStat(name) {
      for (const cat of categories)
        for (const s of cat.stats || [])
          if (s.name === name) return nflSafeNum(s.value);
      return 0;
    }

    const gp = Math.max(findStat("gamesPlayed"), 1);

    const result = {
      passYdsPG: findStat("passingYards") / gp,
      rushYdsPG: findStat("rushingYards") / gp,
      recYdsPG:  findStat("receivingYards") / gp,
      passTDPG:  findStat("passingTouchdowns") / gp,
      rushTDPG:  findStat("rushingTouchdowns") / gp,
      recTDPG:   findStat("receivingTouchdowns") / gp
    };

    nflInjuryStatsCache[cacheKey] = result;
    return result;
  } catch {
    return null;
  }
}

function calcNFLOIS(pos, stats) {
    if (!stats) return 0; // sin stats = sin evidencia de impacto = no cuenta
  const avg = NFL_POS_LEAGUE_AVG[pos];
  if (!avg) return 0.5;

  let yds = 0, td = 0;
  if (pos === "QB")      { yds = stats.passYdsPG + stats.rushYdsPG; td = stats.passTDPG + stats.rushTDPG; }
  else if (pos === "RB") { yds = stats.rushYdsPG + stats.recYdsPG;  td = stats.rushTDPG + stats.recTDPG; }
  else                   { yds = stats.recYdsPG;                    td = stats.recTDPG; }

if (yds <= 0 && td <= 0) return 0; // tiene registro pero cero producción = no cuenta

  const ois = (yds / avg.yds) * 0.5 + (td / avg.td) * 0.5;
  return nflClamp(ois, 0.2, 2.5);
}

async function getNFLTeamInjuriesList(teamName, type) {
  try {
    const res = await fetch(
      `https://cashedgeapp.com/api/injuries?team=${encodeURIComponent(teamName)}&sport=${type}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.injuries || [];
  } catch {
    return [];
  }
}
// Cache de QB1 por equipo
const nflQB1Cache = global.__NFL_QB1_CACHE__ || {};
global.__NFL_QB1_CACHE__ = nflQB1Cache;

// Devuelve el athleteId del QB titular según el depth chart de ESPN (null si no se pudo)
async function getNFLStarterQBId(teamRef, type, season) {
  if (!teamRef?.id) return null;
  const cacheKey = `${type}-${season}-${teamRef.id}`;
  if (nflQB1Cache[cacheKey] !== undefined) return nflQB1Cache[cacheKey];

  const leaguePath = type === "ncaaf" ? "college-football" : "nfl";

  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/${leaguePath}/seasons/${season}/teams/${teamRef.id}/depthcharts`;
    const res = await fetch(url);
    if (!res.ok) { nflQB1Cache[cacheKey] = null; return null; }
    const data = await res.json();

    for (const formation of data?.items || []) {
      const qbGroup = formation?.positions?.qb;
      if (!qbGroup?.athletes?.length) continue;

      const starter = qbGroup.athletes.find(a => Number(a.rank) === 1);
      const ref = starter?.athlete?.$ref || "";
      const match = ref.match(/athletes\/(\d+)/);
      if (match) {
        nflQB1Cache[cacheKey] = match[1];
        return match[1];
      }
    }

    nflQB1Cache[cacheKey] = null;
    return null;
  } catch {
    nflQB1Cache[cacheKey] = null;
    return null;
  }
}
async function getInjuryAdjustmentNFL(teamName, teamRef, type, season) {
  try {
    const [injuries, starterQBId] = await Promise.all([
      getNFLTeamInjuriesList(teamName, type),
      getNFLStarterQBId(teamRef, type, season)
    ]);
    let totalImpact = 0;
    const counted = [];

    for (const player of injuries) {
      const peso = getNFLPesoStatus(player.status);
      if (peso === 0) continue;

      // Lesión ya resuelta según ESPN
      if (player.returnDate && new Date(player.returnDate).getTime() < Date.now()) continue;

      if (player.startDate) {
        const days = (Date.now() - new Date(player.startDate).getTime()) / 86400000;
        const estimatedGamesMissed = Math.floor(days / 7); // NFL: 1 juego por semana

        // Ya se perdió 5+ juegos: los últimos juegos del equipo ya reflejan su ausencia
        if (estimatedGamesMissed > 5) continue;

        // Lesión vieja sin gravedad (no Out/IR) — probablemente resuelta
        if (peso < 4 && days > 30) continue;
      }
      const pos = normalizeNFLPosition(player.position);
       // Solo posiciones con impacto medible cuentan (QB/RB/WR/TE)
      if (!NFL_POS_LEAGUE_AVG[pos]) continue;
      // QB: solo el titular del depth chart cuenta — el backup no juega
      if (pos === "QB" && starterQBId && String(player.athleteId) !== String(starterQBId)) continue;
      const mult = NFL_POS_MULTIPLIER[pos] ?? NFL_POS_MULTIPLIER.DEFAULT;
      const cross = NFL_DEF_CROSSOVER[pos] ?? NFL_DEF_CROSSOVER.DEFAULT;

      const stats = NFL_POS_LEAGUE_AVG[pos]
        ? await getNFLPlayerSeasonStats(player.athleteId, type, season)
        : null;

      const ois = calcNFLOIS(pos, stats);
// Suplente / pieza menor: producción insuficiente para ser el titular que iba a jugar
      const minOIS = pos === "QB" ? 0.6 : 0.4;
      if (NFL_POS_LEAGUE_AVG[pos] && ois < minOIS) continue;
      const impact = peso * ois * mult * 0.5;
      totalImpact += impact * (1 + cross);

      counted.push(`${player.name} (${pos}, ${player.status})`);
    }

    totalImpact = Math.min(totalImpact, NFL_MAX_TEAM_INJURY_IMPACT);

    return {
      pointsImpact: round(-totalImpact, 2),
      note: counted.length ? counted.join(", ") : "No key injuries reported."
    };
  } catch {
    return { pointsImpact: 0, note: "Injury data unavailable." };
  }
}
// ============================================================
// FIN INJURY SYSTEM
// ============================================================
// ============================================================
// NFL PLAYER PROPS — CASHEDGE FASE 1
// Pegar este bloque COMPLETO justo ANTES de:
//   module.exports = async function handler(req, res) {
//
// Luego dentro del handler, después de los headers CORS y
// antes del try {, agregar:
//

// ============================================================
 
// ---- Utilidades ----
 
function nflSafeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
 
function nflClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
 
// ---- Líneas mínimas anti-trivial ----
const NFL_MIN_LINES = {
  player_pass_yds:       150,
  player_rush_yds:        25,
  player_rush_attempts:    8,
  player_receptions:     2.5,
  player_reception_yds:   20
};
 
// ---- Confidence por mercado ----
// Escala exacta del documento CASHEDGE NFL FASE 1
function calculateNFLConfidence(market, edge) {
  const e = nflSafeNum(edge);
  if (e <= 0) return 0;
 
  // Interpolación lineal entre puntos fijos
  function interpolate(points, e) {
    if (e < points[0][0]) return 0;
    if (e >= points[points.length - 1][0]) return points[points.length - 1][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (e >= x0 && e < x1) {
        return Number((y0 + ((e - x0) / (x1 - x0)) * (y1 - y0)).toFixed(1));
      }
    }
    return 0;
  }
 
  const scales = {
    player_pass_yds: [
      [15, 75], [20, 80], [25, 85], [30, 90], [35, 95], [40, 99]
    ],
    player_rush_attempts: [
      [2.0, 75], [3.0, 85], [4.0, 92], [5.0, 99]
    ],
    player_receptions: [
      [0.8, 75], [1.2, 82], [1.6, 88], [2.0, 94], [2.5, 99]
    ],
    player_reception_yds: [
      [10, 75], [15, 82], [20, 90], [25, 95], [30, 99]
    ],
    player_rush_yds: [
      [10, 75], [15, 82], [20, 90], [25, 95], [30, 99]
    ]
  };
 
  const scale = scales[market];
  if (!scale) return 0;
 
  return interpolate(scale, e);
}
 
// ---- ESPN Helpers ----
 
async function espnFetchNFL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${url}`);
  return res.json();
}
 
// ESPN team ID por nombre de equipo NFL
function findESPNTeamId(teamName) {
  const NFL_ESPN_IDS = {
    "arizona cardinals":    "22",
    "atlanta falcons":       "1",
    "baltimore ravens":     "33",
    "buffalo bills":         "2",
    "carolina panthers":    "29",
    "chicago bears":         "3",
    "cincinnati bengals":    "4",
    "cleveland browns":      "5",
    "dallas cowboys":        "6",
    "denver broncos":        "7",
    "detroit lions":         "8",
    "green bay packers":     "9",
    "houston texans":       "34",
    "indianapolis colts":   "11",
    "jacksonville jaguars": "30",
    "kansas city chiefs":   "12",
    "las vegas raiders":    "13",
    "los angeles chargers": "24",
    "los angeles rams":     "14",
    "miami dolphins":       "15",
    "minnesota vikings":    "16",
    "new england patriots": "17",
    "new orleans saints":   "18",
    "new york giants":      "19",
    "new york jets":        "20",
    "philadelphia eagles":  "21",
    "pittsburgh steelers":  "23",
    "san francisco 49ers":  "25",
    "seattle seahawks":     "26",
    "tampa bay buccaneers": "27",
    "tennessee titans":     "10",
    "washington commanders":"28"
  };
 
  const clean = String(teamName || "").toLowerCase().trim();
  if (NFL_ESPN_IDS[clean]) return NFL_ESPN_IDS[clean];
 
  for (const [key, id] of Object.entries(NFL_ESPN_IDS)) {
    const parts = key.split(" ");
    const mascot = parts[parts.length - 1];
    const city = parts.slice(0, -1).join(" ");
    if (clean.includes(mascot) || clean.includes(city)) return id;
  }
 
  return null;
}
 
// Últimos N game IDs completados de un equipo
async function getNFLTeamRecentGameIds(espnTeamId, season, count = 5) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeamId}/schedule?season=${season}`;
  const data = await espnFetchNFL(url);
  const events = data?.events || [];
 
  return events
    .filter(e => {
      const comp = e?.competitions?.[0];
      return (
        comp?.status?.type?.state === "post" ||
        comp?.status?.type?.completed === true
      );
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, count)
    .map(e => e.id);
}
 
// Stats de un jugador específico en un boxscore
async function getNFLPlayerStatsFromBoxscore(gameId, playerName) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
  const data = await espnFetchNFL(url);
 
  const result = {
    passingYards:    0,
    rushingYards:    0,
    rushingCarries:  0,
    receivingYards:  0,
    receptions:      0,
    targets:         0,
    totalPlays:      0,
    found:           false
  };
 
  const cleanName = n => String(n || "").toLowerCase().trim();
  const targetClean = cleanName(playerName);
  const targetLastName = targetClean.split(" ").slice(-1)[0];
 
  const allPlayers = data?.boxscore?.players || [];
 
  for (const teamBlock of allPlayers) {
    for (const statGroup of teamBlock?.statistics || []) {
      const category = String(statGroup?.name || "").toLowerCase();
      const keys = statGroup?.keys || [];
      const athletes = statGroup?.athletes || [];
 
      for (const entry of athletes) {
        const athleteName = cleanName(
          entry?.athlete?.displayName || entry?.athlete?.shortName || ""
        );
 
        const matchFull = athleteName.includes(targetClean) || targetClean.includes(athleteName);
        const matchLast = athleteName.includes(targetLastName);
        if (!matchFull && !matchLast) continue;
 
        const stats = entry?.stats || [];
 
        if (category.includes("passing")) {
          const idx = keys.indexOf("passingYards");
          if (idx >= 0) result.passingYards = nflSafeNum(stats[idx]);
          result.found = true;
        }
 
        if (category.includes("rushing")) {
          const yIdx = keys.indexOf("rushingYards");
          const cIdx = keys.indexOf("carries");
          if (yIdx >= 0) result.rushingYards  = nflSafeNum(stats[yIdx]);
          if (cIdx >= 0) result.rushingCarries = nflSafeNum(stats[cIdx]);
          result.found = true;
        }
 
        if (category.includes("receiving")) {
          const yIdx = keys.indexOf("receivingYards");
          const rIdx = keys.indexOf("receptions");
          const tIdx = keys.indexOf("receivingTargets");
          if (yIdx >= 0) result.receivingYards = nflSafeNum(stats[yIdx]);
          if (rIdx >= 0) result.receptions     = nflSafeNum(stats[rIdx]);
          if (tIdx >= 0) result.targets         = nflSafeNum(stats[tIdx]);
          result.found = true;
        }
      }
    }
  }
 
  // Total plays para PaceScore
  const teamStats = data?.teamStats || [];
  for (const ts of teamStats) {
    for (const cat of ts?.statistics || []) {
      if (String(cat?.name || "").toLowerCase().includes("totaloffensiveplays")) {
        result.totalPlays += nflSafeNum(cat?.value);
      }
    }
  }
 
  return result;
}
 
// Stats de temporada del equipo ESPN (offense + defense)
async function getNFLTeamSeasonStats(espnTeamId, season) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeamId}/statistics?season=${season}`;
  const data = await espnFetchNFL(url);
 
  function findOff(name) {
    const groups = data?.results?.stats?.categories || data?.stats?.categories || [];
    for (const cat of groups)
      for (const s of cat?.stats || [])
        if (s.name === name) return nflSafeNum(s.perGameValue ?? s.value);
    return 0;
  }
 
  function findDef(name) {
    const groups =
      data?.results?.stats?.opponent ||
      data?.results?.opponent ||
      data?.stats?.opponent || [];
    for (const cat of groups)
      for (const s of cat?.stats || [])
        if (s.name === name) return nflSafeNum(s.perGameValue ?? s.value);
    return 0;
  }
 
  return {
    // Offense
    passingYardsPerGame:    findOff("netPassingYardsPerGame"),
    rushingYardsPerGame:    findOff("rushingYardsPerGame"),
    passAttemptsPerGame:    findOff("passAttemptsPerGame"),
    rushAttemptsPerGame:    findOff("rushAttemptsPerGame"),
    totalPlaysPerGame:      findOff("totalOffensivePlays"),
    yardsPerPassAttempt:    findOff("yardsPerPassAttempt"),
 
    // Defense (opponent allowed)
    oppPassYardsAllowed:    findDef("netPassingYardsPerGame"),
    oppRushYardsAllowed:    findDef("rushingYardsPerGame"),
    oppYardsPerCarryAllowed:findDef("yardsPerRushAttempt"),
    oppYardsPerPassAllowed: findDef("yardsPerPassAttempt"),
    oppPointsAllowed:       findDef("totalPointsPerGame"),
    oppPassTDAllowed:       findDef("passingTouchdowns"),
    oppSacksPerGame:        findDef("sacks"),
    oppReceptionsAllowed:   findDef("receptions"),
    oppRecYardsAllowed:     findDef("receivingYards")
  };
}
 
// ---- OpponentDefenseScores por mercado ----
 
// QB: 35% YPA Allowed + 30% PassYds + 15% PassTD + 10% Sack inv + 10% Explosive
function calcOppPassDefenseScore(oppStats) {
  const leagueYPA      = 7.2;
  const leaguePassYds  = 240;
  const leaguePassTD   = 1.5;
  const leagueSacks    = 2.5;
 
  const ypa     = nflSafeNum(oppStats?.oppYardsPerPassAllowed, leagueYPA);
  const passYds = nflSafeNum(oppStats?.oppPassYardsAllowed, leaguePassYds);
  const passTD  = nflSafeNum(oppStats?.oppPassTDAllowed, leaguePassTD);
  const sacks   = nflSafeNum(oppStats?.oppSacksPerGame, leagueSacks);
 
  // Score > 1 = defensa mala (favorece al QB)
  const ypaRatio     = ypa / leagueYPA;
  const passYdsRatio = passYds / leaguePassYds;
  const passTDRatio  = passTD / leaguePassTD;
  const sackInv      = leagueSacks / Math.max(sacks, 0.5);  // inverso: menos sacks = mejor para QB
  const explosive    = ypaRatio;  // proxy: YPA alto = más explosivas
 
  const score =
    ypaRatio     * 0.35 +
    passYdsRatio * 0.30 +
    passTDRatio  * 0.15 +
    sackInv      * 0.10 +
    explosive    * 0.10;
 
  return nflClamp(score, 0.70, 1.40);
}
 
// RB Rush Defense: 30% RushYds + 25% YPC + 20% SuccessRate(proxy) + 15% EPA(proxy) + 10% Explosive
function calcOppRunDefenseScore(oppStats) {
  const leagueRushYds = 115;
  const leagueYPC     = 4.3;
 
  const rushYds = nflSafeNum(oppStats?.oppRushYardsAllowed, leagueRushYds);
  const ypc     = nflSafeNum(oppStats?.oppYardsPerCarryAllowed, leagueYPC);
 
  const rushYdsRatio = rushYds / leagueRushYds;
  const ypcRatio     = ypc / leagueYPC;
  // Proxies para success rate, EPA y explosive usando YPC y RushYds
  const successProxy  = ypcRatio;
  const epaProxy      = rushYdsRatio;
  const explosiveProxy= ypcRatio;
 
  const score =
    rushYdsRatio   * 0.30 +
    ypcRatio       * 0.25 +
    successProxy   * 0.20 +
    epaProxy       * 0.15 +
    explosiveProxy * 0.10;
 
  return nflClamp(score, 0.70, 1.35);
}
 
// WR Catch Defense: 35% RecAllowed + 25% CompPct(proxy) + 20% TargetsToPos(proxy) + 10% Slot + 10% LB
function calcOppCatchDefenseScore(oppStats) {
  const leagueRec    = 22;
  const leagueRecYds = 240;
 
  const recAllowed = nflSafeNum(oppStats?.oppReceptionsAllowed, leagueRec);
  const recYds     = nflSafeNum(oppStats?.oppRecYardsAllowed, leagueRecYds);
 
  const recRatio    = recAllowed / leagueRec;
  const recYdsRatio = recYds / leagueRecYds;
 
  const score =
    recRatio    * 0.35 +
    recYdsRatio * 0.25 +
    recRatio    * 0.20 +   // proxy targets to position
    recRatio    * 0.10 +   // slot weakness proxy
    recYdsRatio * 0.10;    // LB/Safety coverage proxy
 
  return nflClamp(score, 0.75, 1.30);
}
 
// WR Receiving Yards Defense: 30% RecYds + 20% YPR + 20% Explosive + 15% CompPct + 15% Slot/Outside
function calcOppRecYardsDefenseScore(oppStats) {
  const leagueRecYds = 240;
  const leagueYPR    = 11.0;
 
  const recYds = nflSafeNum(oppStats?.oppRecYardsAllowed, leagueRecYds);
  const ypr    = recYds / Math.max(nflSafeNum(oppStats?.oppReceptionsAllowed, 22), 1);
 
  const recYdsRatio = recYds / leagueRecYds;
  const yprRatio    = ypr / leagueYPR;
 
  const score =
    recYdsRatio * 0.30 +
    yprRatio    * 0.20 +
    recYdsRatio * 0.20 +  // explosive proxy
    recYdsRatio * 0.15 +  // comp pct proxy
    recYdsRatio * 0.15;   // slot/outside proxy
 
  return nflClamp(score, 0.75, 1.35);
}
 
// ---- GameScript y SpreadScore ----
 
// SpreadScore = spread crudo de Vegas (número directo, ej: -3.5 = favorito por 3.5)
// GameScriptScore = win probability implícita del moneyline (favorito > 0.5)
function getGameScriptFromMoneyline(moneylineOdds) {
  if (!moneylineOdds || !Number.isFinite(Number(moneylineOdds))) return 0.5;
  const ml = Number(moneylineOdds);
  return ml > 0
    ? 100 / (ml + 100)
    : Math.abs(ml) / (Math.abs(ml) + 100);
}
 
// ---- Fórmulas de proyección ----
 
// 1. QB Passing Yards
function projectQBPassingYards({
  recent5,
  seasonAvg,
  oppPassDefenseScore,
  paceScore,
  teamPassRateScore,
  gameScriptScore
}) {
  // OpponentPassDefenseScore ya viene normalizado (>1 = defensa mala)
  const oppComponent = recent5 * oppPassDefenseScore;
 
  return (
    recent5           * 0.35 +
    seasonAvg         * 0.20 +
    oppComponent      * 0.25 +
    paceScore         * 0.10 +
    teamPassRateScore * 0.05 +
    gameScriptScore   * 0.05
  );
}
 
// 2. RB Rushing Attempts
function projectRBRushingAttempts({
  recent5Carries,
  seasonCarries,
  gameScriptPositiveScore,
  spreadScore,
  backfieldShareScore,
  paceScore
}) {
  return (
    recent5Carries          * 0.35 +
    seasonCarries           * 0.20 +
    gameScriptPositiveScore * 0.15 +
    spreadScore             * 0.15 +
    backfieldShareScore     * 0.10 +
    paceScore               * 0.05
  );
}
 
// 3. WR/TE Receptions
function projectWRReceptions({
  recent5Rec,
  seasonRec,
  recentTargetsScore,
  oppCatchDefenseScore,
  teamPassRateScore,
  gameScriptScore
}) {
  const oppComponent = recent5Rec * oppCatchDefenseScore;
 
  return (
    recent5Rec        * 0.30 +
    seasonRec         * 0.15 +
    recentTargetsScore* 0.25 +
    oppComponent      * 0.15 +
    teamPassRateScore * 0.10 +
    gameScriptScore   * 0.05
  );
}
 
// 4. WR/TE Receiving Yards
function projectWRReceivingYards({
  recent5Yds,
  seasonYds,
  recentTargetsScore,
  oppRecYardsDefenseScore,
  coverageMatchupScore,
  airYardsScore,
  paceScore
}) {
  const oppComponent = recent5Yds * oppRecYardsDefenseScore;
 
  return (
    recent5Yds             * 0.30 +
    seasonYds              * 0.15 +
    recentTargetsScore     * 0.20 +
    oppComponent           * 0.15 +
    coverageMatchupScore   * 0.10 +
    airYardsScore          * 0.05 +
    paceScore              * 0.05
  );
}
 
// 5. RB Rushing Yards
function projectRBRushingYards({
  recent5Yds,
  seasonYds,
  recentCarriesScore,
  oppRunDefenseScore,
  gameScriptPositiveScore,
  paceScore
}) {
  const oppComponent = recent5Yds * oppRunDefenseScore;
 
  return (
    recent5Yds              * 0.30 +
    seasonYds               * 0.15 +
    recentCarriesScore      * 0.20 +
    oppComponent            * 0.20 +
    gameScriptPositiveScore * 0.10 +
    paceScore               * 0.05
  );
}
 
// ---- Handler NFL Player Props ----
 
async function handleNFLPlayerProps(req, res) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  const NFL_SEASON   = 2025;
 
  // 1. Eventos NFL
  const eventsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events?apiKey=${ODDS_API_KEY}`
  );
  const events = await eventsRes.json();
 
  if (!events?.length) {
    return res.status(200).json({
      ok: true, mode: "nfl-player-props", noPlay: true,
      reason: "No hay eventos NFL disponibles"
    });
  }
 
  const selectedEventId = req.query.eventId || req.body?.eventId || null;
  const force = req.query.force === "true" || req.body?.force === true;
 
  const selectedEvent = selectedEventId
    ? events.find(e => e.id === selectedEventId)
    : events[0];
 
  if (!selectedEvent?.id) {
    return res.status(200).json({
      ok: true, mode: "nfl-player-props", noPlay: true,
      reason: "Evento no encontrado"
    });
  }
 
  const today = new Date().toISOString().split("T")[0];
 
  // Cache
  if (!force) {
    const { data: cached } = await supabaseAdmin
      .from("player_props_cache")
      .select("analysis_json")
      .eq("sport", "nfl")
      .eq("event_id", selectedEvent.id)
      .eq("game_date", today)
      .maybeSingle();
 
    if (cached?.analysis_json) {
      return res.status(200).json({ ...cached.analysis_json, cached: true });
    }
  }
 
  // 2. Player props de The Odds API
  const propsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${selectedEvent.id}/odds` +
    `?apiKey=${ODDS_API_KEY}&regions=us` +
    `&markets=player_pass_yds,player_rush_yds,player_rush_attempts,player_receptions,player_reception_yds` +
    `&oddsFormat=decimal`
  );
  const oddsData = await propsRes.json();
 
  // Obtener moneyline para GameScriptScore
  const mlRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${selectedEvent.id}/odds` +
    `?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads&oddsFormat=american`
  );
  const mlData = await mlRes.json();
 
  // Extraer spread y moneyline del primer bookmaker disponible
  let awayMoneyline = null, homeMoneyline = null;
  let awaySpread = null, homeSpread = null;
 
  for (const bk of mlData?.bookmakers || []) {
    for (const mkt of bk?.markets || []) {
      if (mkt.key === "h2h") {
        for (const o of mkt?.outcomes || []) {
          if (o.name === selectedEvent.away_team) awayMoneyline = Number(o.price);
          if (o.name === selectedEvent.home_team) homeMoneyline = Number(o.price);
        }
      }
      if (mkt.key === "spreads") {
        for (const o of mkt?.outcomes || []) {
          if (o.name === selectedEvent.away_team) awaySpread = Number(o.point);
          if (o.name === selectedEvent.home_team) homeSpread = Number(o.point);
        }
      }
    }
    if (awayMoneyline && homeMoneyline) break;
  }
 
  // Win probabilities implícitas
  const awayWinProb = getGameScriptFromMoneyline(awayMoneyline);
  const homeWinProb = getGameScriptFromMoneyline(homeMoneyline);
 
  // 3. Extraer props — solo OVER, solo líneas >= mínimo
  const bookPriority = ["DraftKings","FanDuel","BetMGM","Caesars","Bovada","BetRivers"];
  const rawProps = [];
 
  for (const bk of oddsData?.bookmakers || []) {
    for (const mkt of bk?.markets || []) {
      if (!NFL_MIN_LINES[mkt.key]) continue;
      for (const o of mkt?.outcomes || []) {
        if (String(o.name || "").toUpperCase() !== "OVER") continue;
        const line = nflSafeNum(o.point);
        if (line < NFL_MIN_LINES[mkt.key]) continue;
        rawProps.push({
          player:    o.description,
          market:    mkt.key,
          side:      "OVER",
          line,
          odds:      o.price,
          bookmaker: bk.title
        });
      }
    }
  }
 
  // Deduplicar por jugador+mercado+línea, priorizar bookmaker
  const uniqueMap = new Map();
  for (const prop of rawProps) {
    const key = `${prop.player}|${prop.market}|${prop.line}`;
    const cur = uniqueMap.get(key);
    if (!cur) { uniqueMap.set(key, prop); continue; }
    const curR = bookPriority.indexOf(cur.bookmaker);
    const newR = bookPriority.indexOf(prop.bookmaker);
    if ((newR === -1 ? 999 : newR) < (curR === -1 ? 999 : curR)) uniqueMap.set(key, prop);
  }
 
  const uniqueProps = Array.from(uniqueMap.values()).slice(0, 100);
 
  if (!uniqueProps.length) {
    return res.status(200).json({
      ok: true, mode: "nfl-player-props", noPlay: true,
      reason: "No hay player props NFL disponibles aún. Aparecen ~1-2 semanas antes del juego.",
      game: `${selectedEvent.away_team} @ ${selectedEvent.home_team}`,
      gameDate: today
    });
  }
 
  // 4. ESPN IDs y stats de temporada
  const awayESPNId = findESPNTeamId(selectedEvent.away_team);
  const homeESPNId = findESPNTeamId(selectedEvent.home_team);
 
  const [awayTeamStats, homeTeamStats] = await Promise.all([
    awayESPNId ? getNFLTeamSeasonStats(awayESPNId, NFL_SEASON).catch(() => null) : Promise.resolve(null),
    homeESPNId ? getNFLTeamSeasonStats(homeESPNId, NFL_SEASON).catch(() => null) : Promise.resolve(null)
  ]);
 
  // 5. Últimos 5 game IDs por equipo
  const [awayGameIds, homeGameIds] = await Promise.all([
    awayESPNId ? getNFLTeamRecentGameIds(awayESPNId, NFL_SEASON, 5).catch(() => []) : Promise.resolve([]),
    homeESPNId ? getNFLTeamRecentGameIds(homeESPNId, NFL_SEASON, 5).catch(() => []) : Promise.resolve([])
  ]);
 
  // Cache de boxscores
  const boxCache = new Map();
  async function getBoxscore(gameId, playerName) {
    const k = `${gameId}|${playerName}`;
    if (boxCache.has(k)) return boxCache.get(k);
    try {
      const r = await getNFLPlayerStatsFromBoxscore(gameId, playerName);
      boxCache.set(k, r);
      return r;
    } catch { return null; }
  }
 
  // 6. Analizar cada prop
  const analyzedProps = [];
 
  for (const prop of uniqueProps) {
    const { player, market, line } = prop;
 
    // Intentar away primero, luego home
    let gameIds    = awayGameIds;
    let teamStats  = awayTeamStats;
    let oppStats   = homeTeamStats;
    let winProb    = awayWinProb;
    let spreadVal  = nflSafeNum(awaySpread, 0);
 
    const playerGameStats = [];
    for (const gid of gameIds.slice(0, 5)) {
      const s = await getBoxscore(gid, player);
      if (s?.found) playerGameStats.push(s);
    }
 
    // Si no encontró datos en away, intentar home
    if (!playerGameStats.length && homeGameIds.length) {
      gameIds   = homeGameIds;
      teamStats = homeTeamStats;
      oppStats  = awayTeamStats;
      winProb   = homeWinProb;
      spreadVal = nflSafeNum(homeSpread, 0);
 
      for (const gid of gameIds.slice(0, 5)) {
        const s = await getBoxscore(gid, player);
        if (s?.found) playerGameStats.push(s);
      }
    }
 
    if (!playerGameStats.length) continue;
 
    // Promedios recientes
    const avgStat = (key) => {
      const vals = playerGameStats.map(s => nflSafeNum(s[key]));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
 
    const recent5PassYds = avgStat("passingYards");
    const recent5RushYds = avgStat("rushingYards");
    const recent5Carries = avgStat("rushingCarries");
    const recent5RecYds  = avgStat("receivingYards");
    const recent5Rec     = avgStat("receptions");
    const recent5Targets = avgStat("targets");
    const avgTotalPlays  = avgStat("totalPlays");
 
    // Scores de contexto
    const leaguePlays   = 62;
    const paceScore     = (avgTotalPlays > 0 ? avgTotalPlays : nflSafeNum(teamStats?.totalPlaysPerGame, leaguePlays)) / leaguePlays;
 
    const passAttempts  = nflSafeNum(teamStats?.passAttemptsPerGame, 35);
    const totalPlays    = nflSafeNum(teamStats?.totalPlaysPerGame, leaguePlays);
    const teamPassRate  = totalPlays > 0 ? passAttempts / totalPlays : 0.56;
    const teamPassRateScore = teamPassRate / 0.56; // normalizado vs liga
 
    // GameScript = win probability (fuente: moneyline)
    const gameScriptScore = winProb;
 
    // GameScriptPositive para RB (favorito = más carries)
    // favorable cuando winProb > 0.5
    const gameScriptPositiveScore = winProb > 0.5
      ? recent5Carries * (1 + (winProb - 0.5) * 0.4)
      : recent5Carries * (1 - (0.5 - winProb) * 0.3);
 
    // SpreadScore para RB (fuente: spread crudo Vegas, distinto de moneyline)
    // favorito = spread negativo → más carries
    const spreadScore = spreadVal < 0
      ? recent5Carries * (1 + Math.abs(spreadVal) * 0.02)
      : recent5Carries * (1 - spreadVal * 0.015);
 
    // BackfieldShare proxy (sin datos de roster, usamos carries vs team avg)
    const teamCarriesAvg = nflSafeNum(teamStats?.rushAttemptsPerGame, 25);
    const backfieldShareScore = teamCarriesAvg > 0
      ? (recent5Carries / teamCarriesAvg) * recent5Carries
      : recent5Carries;
 
    // Scores defensivos del rival
    const oppPassDefScore    = calcOppPassDefenseScore(oppStats);
    const oppRunDefScore     = calcOppRunDefenseScore(oppStats);
    const oppCatchDefScore   = calcOppCatchDefenseScore(oppStats);
    const oppRecYardsDefScore= calcOppRecYardsDefenseScore(oppStats);
 
    // Season averages
    const seasonPassYds = nflSafeNum(teamStats?.passingYardsPerGame, recent5PassYds);
    const seasonRushYds = nflSafeNum(teamStats?.rushingYardsPerGame, recent5RushYds);
    const seasonCarries = nflSafeNum(teamStats?.rushAttemptsPerGame, recent5Carries);
    // Para WR usamos proporcional: passing yards * share estimada
    const seasonRecYds  = seasonPassYds * 0.22;
    const seasonRec     = passAttempts * 0.18;
 
    let projection = 0;
 
    if (market === "player_pass_yds") {
      if (recent5PassYds <= 0) continue;
      projection = projectQBPassingYards({
        recent5:           recent5PassYds,
        seasonAvg:         seasonPassYds,
        oppPassDefenseScore: oppPassDefScore,
        paceScore:         paceScore * leaguePlays,  // en yardas equivalentes
        teamPassRateScore: teamPassRateScore * recent5PassYds,
        gameScriptScore:   gameScriptScore * recent5PassYds
      });
    }
 
    else if (market === "player_rush_yds") {
      if (recent5RushYds <= 0 && recent5Carries <= 0) continue;
      projection = projectRBRushingYards({
        recent5Yds:              recent5RushYds,
        seasonYds:               seasonRushYds,
        recentCarriesScore:      recent5Carries * 4.2,  // YPC promedio liga
        oppRunDefenseScore:      oppRunDefScore,
        gameScriptPositiveScore: gameScriptPositiveScore * 4.2,
        paceScore:               paceScore * recent5RushYds
      });
    }
 
    else if (market === "player_rush_attempts") {
      if (recent5Carries <= 0) continue;
      projection = projectRBRushingAttempts({
        recent5Carries,
        seasonCarries,
        gameScriptPositiveScore,
        spreadScore,
        backfieldShareScore,
        paceScore: paceScore * recent5Carries
      });
    }
 
    else if (market === "player_receptions") {
      if (recent5Rec <= 0 && recent5Targets <= 0) continue;
      projection = projectWRReceptions({
        recent5Rec,
        seasonRec,
        recentTargetsScore:  recent5Targets * 0.68, // catch rate liga ~68%
        oppCatchDefenseScore: oppCatchDefScore,
        teamPassRateScore:   teamPassRateScore * recent5Rec,
        gameScriptScore:     gameScriptScore * recent5Rec
      });
    }
 
    else if (market === "player_reception_yds") {
      if (recent5RecYds <= 0) continue;
      const ypr = recent5Rec > 0 ? recent5RecYds / recent5Rec : 11;
      projection = projectWRReceivingYards({
        recent5Yds:              recent5RecYds,
        seasonYds:               seasonRecYds,
        recentTargetsScore:      recent5Targets * ypr * 0.68,
        oppRecYardsDefenseScore: oppRecYardsDefScore,
        coverageMatchupScore:    recent5RecYds * oppRecYardsDefScore,
        airYardsScore:           ypr * recent5Targets * 0.10,
        paceScore:               paceScore * recent5RecYds
      });
    }
 
    if (!projection || projection <= 0) continue;
 
    projection = Number(projection.toFixed(1));
    const edge       = Number((projection - line).toFixed(2));
    const confidence = calculateNFLConfidence(market, edge);
 
    if (confidence <= 0) continue;
 
    analyzedProps.push({
      player,
      market,
      side: "OVER",
      line,
      odds:       prop.odds,
      bookmaker:  prop.bookmaker,
      projection,
      edge,
      confidence,
      isPremium:  confidence >= 75
    });
  }
 
  analyzedProps.sort((a, b) => b.confidence - a.confidence);
 
  const finalResponse = {
    ok:                  true,
    mode:                "nfl-player-props",
    cached:              false,
    eventId:             selectedEvent.id,
    game:                `${selectedEvent.away_team} @ ${selectedEvent.home_team}`,
    gameDate:            today,
    generatedAt:         new Date().toISOString(),
    totalRawProps:       rawProps.length,
    totalAnalyzedProps:  analyzedProps.length,
    props:               analyzedProps.slice(0, 3),
    lockedProps:         analyzedProps.slice(3, 40)
  };
 
  // Guardar cache
  await supabaseAdmin
    .from("player_props_cache")
    .upsert({
      sport:      "nfl",
      event_id:   selectedEvent.id,
      game:       finalResponse.game,
      game_date:  today,
      analysis_json: finalResponse,
      updated_at: new Date().toISOString()
    }, { onConflict: "sport,event_id,game_date" });
 
  return res.status(200).json(finalResponse);
}
 
// ============================================================
// FIN BLOQUE NFL PLAYER PROPS
// ============================================================
 function getDayStart() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const get = t => Number(parts.find(p => p.type === t).value);
  const msIntoDay = (get("hour") % 24) * 3600000 + get("minute") * 60000 + get("second") * 1000;

  return new Date(Date.now() - msIntoDay).toISOString();
}

async function checkFreeAnalysisLimit(userId, isUnlimited) {
  if (isUnlimited) return { allowed: true, remaining: null };

  const { count, error } = await supabaseAdmin
    .from("analysis_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", getDayStart());

  if (error) return { allowed: true, remaining: null };

  const used = count || 0;

  if (used >= 5) {
    return {
      allowed: false,
      remaining: 0,
      message: "You've used today's 5 free analyses. More free analyses will be available tomorrow."
    };
  }

  return { allowed: true, remaining: 5 - used };
}

async function recordFreeAnalysis(userId, isUnlimited, endpoint) {
  if (isUnlimited) return;
  if (!userId || userId === "null" || userId === "undefined" || userId === "guest") return;

  const { error } = await supabaseAdmin
    .from("analysis_usage")
    .insert({ user_id: userId, endpoint });

  if (error) console.log("recordFreeAnalysis error:", error.message);
}
module.exports = async function handler(req, res) {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  console.log("FOOTBALL REQUEST:", {
  method: req.method,
  query: req.query,
  headers: req.headers,
  url: req.url
});
  try {
     const mode = req.query.mode || req.body?.mode;
  if (mode === "nfl-player-props") {
    return await handleNFLPlayerProps(req, res);
  }
    const { type = "nfl", teamA, teamB, season } = req.query;

    if (!teamA || !teamB) {
      return res.status(400).json({
        error: "Faltan teamA y teamB",
        example: "/api/football-data?type=nfl&teamA=KC&teamB=PHI&season=2024"
      });
    }

    if (!SPORT_PATHS[type]) {
      return res.status(400).json({
        error: "type inválido. Usa nfl o ncaaf"
      });
    }

    let isPremiumUser = false;
let authUserId = null;

try {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return res.status(401).json({
      error: "Debes iniciar sesión para analizar."
    });
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.getUser(token);

  if (authError || !authData?.user) {
    return res.status(401).json({
      error: "Sesión inválida. Inicia sesión otra vez."
    });
  }

  authUserId = authData.user.id;

  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("is_premium, subscription_status, email")
    .or(`id.eq.${authData.user.id},email.eq.${authData.user.email}`)
    .maybeSingle();

  isPremiumUser =
    profile?.is_premium === true ||
    profile?.subscription_status === "active" ||
    profile?.subscription_status === "trialing" ||
    authData.user.email === ADMIN_EMAIL;

// SOLO FREE PASA POR EL LÍMITE
  if (!isPremiumUser) {
    const usageCheck = await checkFreeAnalysisLimit(authUserId, false);

    if (!usageCheck.allowed) {
      return res.status(429).json({
        error: usageCheck.message,
        limitReached: true,
        upgradeRequired: true
      });
    }
  }
} catch (error) {
  console.log("No se pudo validar usuario football:", error.message);
  return res.status(401).json({
    error: "No se pudo validar tu sesión."
  });
}
// ===== CACHE DE ANÁLISIS (TTL dinámico) =====
    try {
      const cacheTeamsSorted = [teamA, teamB].map(t => String(t).trim()).sort();
      const cacheIdSuffix = `-${cacheTeamsSorted.join("-")}`;

      const { data: cachedRows } = await supabaseAdmin
        .from("daily_picks")
        .select("game_id, analysis_json, updated_at, game_time")
        .eq("sport", type)
        .like("game_id", `${type}-%${cacheIdSuffix}`)
        .order("game_date", { ascending: true })
        .limit(3);

      const cached = (cachedRows || []).find(r =>
        r.analysis_json?.fullResponse &&
        (!r.game_time || new Date(r.game_time).getTime() > Date.now())
      );

      if (cached) {
        const ageMin = (Date.now() - new Date(cached.updated_at).getTime()) / 60000;
        const hoursToKickoff = cached.game_time
          ? (new Date(cached.game_time).getTime() - Date.now()) / 3600000
          : 99;
        const ttlMin = hoursToKickoff < 3 ? 15 : 45;

        if (ageMin < ttlMin) {
          const full = cached.analysis_json.fullResponse;
           const cachedIsPremium =
            full.picks?.spreadPick?.isPremium === true ||
            full.picks?.totalPick?.isPremium === true;

          if (!isPremiumUser && !cachedIsPremium) {
            await recordFreeAnalysis(authUserId, false, "analyze-football");
          }
          return res.status(200).json({
            ...full,
            isPremiumUser,
            picks: sanitizePicksForPublic(full.picks, isPremiumUser)
          });
        }
      }
    } catch {}
    // ===== FIN CACHE =====
    const selectedSeason = Number(season) || getDefaultSeason();
    const alpha = Number(req.query.alpha ?? SOS_ALPHA);   // temporal, para calibrar
    const beta  = Number(req.query.beta  ?? CONSENSUS_BETA);

   const teamARef = normalizeTeam(teamA);
    const teamBRef = normalizeTeam(teamB);
    
 const previousSeason = selectedSeason - 1;

const [
  currentSeasonAllGames,
  previousSeasonAllGames
] = await Promise.all([
  getSeasonGames(type, selectedSeason),
  getSeasonGames(type, previousSeason)
]);

const currentTeamAGames =
  buildTeamGamesFromSeason(
    currentSeasonAllGames,
    teamARef
  );

const previousTeamAGames =
  buildTeamGamesFromSeason(
    previousSeasonAllGames,
    teamARef
  );

const currentTeamBGames =
  buildTeamGamesFromSeason(
    currentSeasonAllGames,
    teamBRef
  );

const previousTeamBGames =
  buildTeamGamesFromSeason(
    previousSeasonAllGames,
    teamBRef
  );

const teamAGames =
  blendFootballSeasonGames(
    currentTeamAGames,
    previousTeamAGames
  );

const teamBGames =
  blendFootballSeasonGames(
    currentTeamBGames,
    previousTeamBGames
  );

/*
  allGames también se usa después para:
  - promedio general de la liga
  - resolver IDs
  - cálculos relacionados con FPI

  Antes del cuarto partido combinamos ambas temporadas.
  Desde el cuarto usamos solamente la actual.
*/
const enoughCurrentSeasonData =
  currentTeamAGames.length >= 4 &&
  currentTeamBGames.length >= 4;

const allGames = enoughCurrentSeasonData
  ? currentSeasonAllGames
  : [
      ...currentSeasonAllGames,
      ...previousSeasonAllGames
    ];
// ===== GUARD: insufficient data =====
    const MIN_GAMES_REQUIRED = 3;

    if (teamAGames.length < MIN_GAMES_REQUIRED || teamBGames.length < MIN_GAMES_REQUIRED) {
      console.log("INSUFFICIENT DATA:", {
        type,
        [teamA]: teamAGames.length,
        [teamB]: teamBGames.length
      });
      return res.status(200).json({
        sport: type,
        error: "Insufficient data",
        detail: `${teamA}: ${teamAGames.length} games · ${teamB}: ${teamBGames.length} games`,
        picks: {
          available: false,
          message: "Not enough data to analyze this game."
        }
      });
    }
   const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    // ===== CALENDARIO VÍA FPI =====
    const leagueAvg = computeLeagueBaseline(allGames);
    let fpiAdj = { active: false, reason: "no aplica (solo ncaaf)" };
    let teamAProjection, teamBProjection, teamAAdj, teamBAdj;

    if (type === "ncaaf") {
      const fpiMap = await getFPIMap(selectedSeason) || await getFPIMap(selectedSeason - 1);
      const idA = resolveTeamIdFromGames(allGames, teamARef);
      const idB = resolveTeamIdFromGames(allGames, teamBRef);
      const fA = fpiMap?.[String(idA)];
      const fB = fpiMap?.[String(idB)];
      const baseA = fpiMap ? getScheduleBaseline(teamAGames, fpiMap) : null;
      const baseB = fpiMap ? getScheduleBaseline(teamBGames, fpiMap) : null;

      if (!fpiMap)               fpiAdj = { active: false, reason: "FPI no disponible" };
      else if (!fA || !fB)       fpiAdj = { active: false, reason: "equipo sin FPI", idA, idB };
      else if (!baseA || !baseB) fpiAdj = { active: false, reason: "sin rivales con FPI" };
      else {
        teamAAdj = buildFPIProfile(teamAEdges, fA, baseA, leagueAvg);
        teamBAdj = buildFPIProfile(teamBEdges, fB, baseB, leagueAvg);
        fpiAdj = {
          active: true,
          leagueAvg,
          [teamA]: { fpi: fA, baseline: baseA, perfil: teamAAdj },
          [teamB]: { fpi: fB, baseline: baseB, perfil: teamBAdj }
        };
      }
    }

    if (fpiAdj.active) {
      teamAProjection = projectFootballTeamFPI(teamAAdj, teamBAdj, alpha, beta);
      teamBProjection = projectFootballTeamFPI(teamBAdj, teamAAdj, alpha, beta);
    } else {
      // Fallback: NFL, o NCAAF sin FPI
      teamAAdj = teamAEdges;
      teamBAdj = teamBEdges;
      teamAProjection = projectFootballTeam(teamAAdj, teamBAdj, alpha, beta);
      teamBProjection = projectFootballTeam(teamBAdj, teamAAdj, alpha, beta);
    }
    
const projectedTeamA = teamAProjection.finalProjection;
const projectedTeamB = teamBProjection.finalProjection;

   // Comparativo: modelo viejo (sin FPI, sin ajustes)
    const rawA = projectFootballTeam(teamAEdges, teamBEdges, 0, 0).finalProjection;
    const rawB = projectFootballTeam(teamBEdges, teamAEdges, 0, 0).finalProjection;
    
  
    
// Ajuste por lesiones (modo sombra si NFL_INJURY_ACTIVE = false)
const [teamAInjuries, teamBInjuries] = await Promise.all([
 getInjuryAdjustmentNFL(teamA, teamARef, type, selectedSeason),
    getInjuryAdjustmentNFL(teamB, teamBRef, type, selectedSeason)
]);

const injuryAdjA = NFL_INJURY_ACTIVE ? teamAInjuries.pointsImpact : 0;
const injuryAdjB = NFL_INJURY_ACTIVE ? teamBInjuries.pointsImpact : 0;

const projectedTeamAInj = round(projectedTeamA + injuryAdjA);
const projectedTeamBInj = round(projectedTeamB + injuryAdjB);
const [teamAProfile, teamBProfile] = await Promise.all([
  getTeamStatsProfile(type, teamARef, selectedSeason),
  getTeamStatsProfile(type, teamBRef, selectedSeason)
]);

const paceModule = calculatePaceEfficiencyAdjustment({
  type,
  projectedTotal: round(projectedTeamAInj + projectedTeamBInj),
  teamAProfile,
  teamBProfile
});
console.log("PACE MODULE:", {
  adjustment: paceModule.adjustment,
  gameEdge: paceModule.gameEdge,
  teamAOffenseScore: paceModule.teamAOffenseScore,
  teamBOffenseScore: paceModule.teamBOffenseScore,
  teamAProfile,
  teamBProfile
});
// Aplicar la mitad del ajuste a cada equipo
const halfAdj = paceModule.adjustment / 2;
const projectedTeamAFinal = round(projectedTeamAInj + halfAdj);
const projectedTeamBFinal = round(projectedTeamBInj + halfAdj);

const baseProjectedTotal = round(projectedTeamA + projectedTeamB);
const projectedTotal = round(projectedTeamAFinal + projectedTeamBFinal);
const projectedSpread = round(projectedTeamAFinal - projectedTeamBFinal);

const odds = await getFootballOdds(type, teamARef, teamBRef);

    const rawPicks = buildFootballPicks({
      teamA,
      teamB,
      projectedSpread,
      projectedTotal,
      odds,
      type
    });

const picks = sanitizePicksForPublic(rawPicks, isPremiumUser);

const bestPick = [
  rawPicks?.spreadPick,
  rawPicks?.totalPick
]
  .filter(Boolean)
  .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;

const isPremiumPick = bestPick?.isPremium === true;
const gameDate = odds?.commenceTime 
  ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(odds.commenceTime))
  : new Date().toISOString().split("T")[0];
const teamsSorted = [teamA, teamB]
  .map(t => String(t).trim())
  .sort();

const gameId = `${type}-${gameDate}-${teamsSorted.join("-")}`;
const fullResponse = {
    sport: type,
    odds,
    picks: rawPicks || picks,
    publicConfidence: bestPick ? Number(bestPick.confidence || 0) : 0,
    projectedScore: {
      [teamA]: projectedTeamAFinal,
      [teamB]: projectedTeamBFinal
    },
    baseProjectedTotal,
  fpiAdjustment: fpiAdj,
    sinAjuste: { [teamA]: rawA, [teamB]: rawB },
    paceEfficiencyAdjustment: paceModule,
    injuryImpact: {
      active: NFL_INJURY_ACTIVE,
      [teamA]: teamAInjuries,
      [teamB]: teamBInjuries
    },
    projectedTotal,
    projectedSpread
  };
const analysisJson = {
  locked: false,
  isPremiumPick,
  noPlay: !bestPick,
  public: {
    confidence: Number(bestPick?.confidence || 0),
    hasPremium: isPremiumPick,
    projectedTotal,
    projectedSpread
  },
 premium: bestPick
    ? {
        pick: bestPick.pick,
        confidence: Number(bestPick.confidence || 0),
        mainEdge: Number(bestPick.edge || 0),
        odds_american: Number(bestPick.odds_american ?? -110),
        projectedTotal,
        projectedSpread,
        projectedScore: {
         [teamA]: projectedTeamAFinal,
[teamB]: projectedTeamBFinal
        },
        odds,
        spreadPick: rawPicks?.spreadPick || null,
        totalPick: rawPicks?.totalPick || null
      }
    : null
};

await supabaseAdmin
  .from("daily_picks")
  .upsert(
    {
      sport: type,
      game_id: gameId,
      away_team: teamA,
      home_team: teamB,
     analysis_json: { ...analysisJson, fullResponse },
      updated_at: new Date().toISOString(),
      game_date: gameDate,
      game_time: odds?.commenceTime || null
    },
    {
      onConflict: "sport,game_id"
    }
  );

const gameNotStarted = !odds?.commenceTime || new Date(odds.commenceTime).getTime() > Date.now();
  if (isPremiumPick && bestPick && gameNotStarted) {
  const normalizedPick = String(bestPick.pick || "").toLowerCase();

  let pickType = "spread";
  let pickTeam = null;
  let pickDirection = null;
  let pickLine = null;

  if (normalizedPick.includes("over")) {
    pickType = "total";
    pickDirection = "OVER";
    pickLine = Number(odds?.total || odds?.totalLine || projectedTotal || 0);
  } else if (normalizedPick.includes("under")) {
    pickType = "total";
    pickDirection = "UNDER";
    pickLine = Number(odds?.total || odds?.totalLine || projectedTotal || 0);
  } else {
    pickType = "spread";
    pickDirection = null;

    if (bestPick.pick.includes(teamA)) {
      pickTeam = teamA;
      pickLine = Number(odds?.teamASpread || odds?.awaySpread || 0);
    } else if (bestPick.pick.includes(teamB)) {
      pickTeam = teamB;
      pickLine = Number(odds?.teamBSpread || odds?.homeSpread || 0);
    }
  }

  await supabaseAdmin
    .from("picks_history")
    .delete()
    .eq("sport", type)
    .eq("game_id", gameId)
    .eq("result", "pending");

  await supabaseAdmin
    .from("picks_history")
    .insert({
      game_id: gameId,
      sport: type,
      away_team: teamA,
      home_team: teamB,
      game_date: gameDate,
      pick: bestPick.pick,
      confidence: Number(bestPick.confidence || 0),
      result: "pending",
      is_premium: true,
      pick_type: pickType,
      pick_team: pickTeam,
      pick_direction: pickDirection,
      line: pickLine
    });
}
if (!isPremiumPick) {
  await recordFreeAnalysis(authUserId, isPremiumUser, "analyze-football");
}

return res.status(200).json({
  ...fullResponse,
  isPremiumUser,
  picks
});
  } catch (error) {
    console.error("ERROR FOOTBALL DATA:", error);

    return res.status(500).json({
      error: "Error loading football data",
      details: error.message
    });
  }
};

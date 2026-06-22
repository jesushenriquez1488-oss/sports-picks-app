// ============================================================
// api/injuries.js — VERSIÓN CORREGIDA
// Usa sports.core.api.espn.com (la fuente real que SÍ devuelve datos)
// Cubre: NBA, NFL, NCAAF
// ============================================================
 
const NBA_ESPN_IDS = {
  "atlanta hawks": "1",
  "boston celtics": "2",
  "brooklyn nets": "17",
  "charlotte hornets": "30",
  "chicago bulls": "4",
  "cleveland cavaliers": "5",
  "dallas mavericks": "6",
  "denver nuggets": "7",
  "detroit pistons": "8",
  "golden state warriors": "9",
  "houston rockets": "10",
  "indiana pacers": "11",
  "los angeles clippers": "12",
  "los angeles lakers": "13",
  "memphis grizzlies": "29",
  "miami heat": "14",
  "milwaukee bucks": "15",
  "minnesota timberwolves": "16",
  "new orleans pelicans": "3",
  "new york knicks": "18",
  "oklahoma city thunder": "25",
  "orlando magic": "19",
  "philadelphia 76ers": "20",
  "phoenix suns": "21",
  "portland trail blazers": "22",
  "sacramento kings": "23",
  "san antonio spurs": "24",
  "toronto raptors": "28",
  "utah jazz": "26",
  "washington wizards": "27"
};
 
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
 
// Cache en memoria para NCAAF (centenares de equipos, resolución dinámica)
const dynamicIdCache = global.__INJURIES_TEAM_ID_CACHE__ || {};
global.__INJURIES_TEAM_ID_CACHE__ = dynamicIdCache;
 
function cleanTeamName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
 
// Resolución dinámica de ID vía ESPN site API — usado solo para NCAAF
async function findNCAAFTeamId(teamName) {
  const cacheKey = cleanTeamName(teamName);
 
  if (dynamicIdCache[cacheKey]) {
    return dynamicIdCache[cacheKey];
  }
 
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=500`;
    const res = await fetch(url);
    if (!res.ok) return null;
 
    const data = await res.json();
    const groups = data?.sports?.[0]?.leagues?.[0]?.teams || [];
 
    const clean = cleanTeamName(teamName);
 
    const match = groups.find(t => {
      const team = t.team || {};
      const displayName = cleanTeamName(team.displayName);
      const shortName = cleanTeamName(team.shortDisplayName);
      const location = cleanTeamName(team.location);
      const nickname = cleanTeamName(team.name);
 
      return (
        displayName === clean ||
        shortName === clean ||
        clean === location ||
        (clean.includes(location) && location.length > 2) ||
        (clean.includes(nickname) && nickname.length > 2) ||
        displayName.includes(clean)
      );
    });
 
    const id = match?.team?.id || null;
 
    if (id) {
      dynamicIdCache[cacheKey] = id;
    }
 
    return id;
  } catch {
    return null;
  }
}
 
function resolveStaticTeamId(sport, teamName) {
  const clean = cleanTeamName(teamName);
 
  if (sport === "nba") {
    return NBA_ESPN_IDS[clean] || null;
  }
 
  if (sport === "nfl") {
    return NFL_ESPN_IDS[clean] || null;
  }
 
  return null;
}
 
const SPORT_CONFIG = {
  nba:   { sport: "basketball", league: "nba",              dynamic: false },
  nfl:   { sport: "football",   league: "nfl",              dynamic: false },
  ncaaf: { sport: "football",   league: "college-football", dynamic: true  }
};
 
// Resuelve un $ref de athlete a su nombre
async function resolveAthleteName(athleteRef) {
  try {
    const res = await fetch(athleteRef);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data?.displayName || data?.fullName || null,
      position: data?.position?.abbreviation || data?.position?.displayName || null
    };
  } catch {
    return null;
  }
}
 
// Resuelve un $ref de detalle de lesión completo
async function resolveInjuryDetail(injuryRef) {
  try {
    const res = await fetch(injuryRef);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
 
async function getTeamInjuries(sport, league, teamId) {
  const listUrl = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/teams/${teamId}/injuries`;
 
  const listRes = await fetch(listUrl);
  if (!listRes.ok) return [];
 
  const listData = await listRes.json();
  const refs = (listData?.items || []).map(item => item?.$ref).filter(Boolean);
 
  if (!refs.length) return [];
 
  const injuries = [];
 
  for (const ref of refs) {
    const detail = await resolveInjuryDetail(ref);
    if (!detail) continue;
 
   let athleteInfo = null;
    const athleteRef = detail?.athlete?.$ref;

    if (athleteRef) {
      athleteInfo = await resolveAthleteName(athleteRef);
    }

    // Extraer athleteId numérico del $ref (ej: .../athletes/3945274?lang=en)
    let athleteId = null;
    if (athleteRef) {
      const match = athleteRef.match(/athletes\/(\d+)/);
      if (match) athleteId = match[1];
    }

    const status = detail?.status || detail?.type?.description || "Unknown";
    const detailType = detail?.details?.type || "";
    const location = detail?.details?.location || "";

    injuries.push({
      name: athleteInfo?.name || "Unknown player",
      position: athleteInfo?.position || "",
      athleteId,
      status,
      startDate: detail?.date || null,
      returnDate: detail?.details?.returnDate || null,
      notes: detail?.shortComment || detail?.longComment || `${detailType} ${location}`.trim()
    });
  }
 
  return injuries;
}
 
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
 
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
 // AUTH CHECK
const authHeader = req.headers.authorization || "";
const token = authHeader.replace("Bearer ", "");

if (token && token !== "null" && token !== "undefined") {
  const { createClient } = require("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return res.status(401).json({ error: "Sesión inválida" });
  }
}
  try {
    const { team, sport = "nba" } = req.query;
 
    if (!team) {
      return res.status(400).json({ error: "Missing team parameter" });
    }
 
    const normalizedSport = String(sport).toLowerCase();
    const config = SPORT_CONFIG[normalizedSport];
 
    if (!config) {
      return res.status(400).json({
        error: "Sport inválido. Usa nba, nfl o ncaaf"
      });
    }
 
    let teamId = config.dynamic
      ? null
      : resolveStaticTeamId(normalizedSport, team);
 
    if (!teamId && config.dynamic) {
      teamId = await findNCAAFTeamId(team);
    }
 
    if (!teamId) {
      return res.status(200).json({
        team,
        sport: normalizedSport,
        count: 0,
        injuries: [],
        source: "espn-core",
        warning: "No se encontró el ID del equipo en ESPN"
      });
    }
 
    const injuries = await getTeamInjuries(config.sport, config.league, teamId);
 
    return res.status(200).json({
      team,
      sport: normalizedSport,
      count: injuries.length,
      injuries,
      source: "espn-core"
    });
 
  } catch (error) {
    return res.status(200).json({
      team: req.query.team,
      count: 0,
      injuries: [],
      source: "espn-core",
      error: error.message
    });
  }
};
 

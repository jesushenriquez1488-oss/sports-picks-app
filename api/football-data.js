const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

const TEAM_MAP = {
  kc: { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },
  chiefs: { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },
  "kansas city chiefs": { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },

  phi: { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },
  eagles: { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },
  "philadelphia eagles": { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },

  dal: { id: "6", keys: ["dal", "cowboys", "dallas cowboys", "dallas"] },
  cowboys: { id: "6", keys: ["dal", "cowboys", "dallas cowboys", "dallas"] },

  buf: { id: "2", keys: ["buf", "bills", "buffalo bills", "buffalo"] },
  bills: { id: "2", keys: ["buf", "bills", "buffalo bills", "buffalo"] },

  bal: { id: "33", keys: ["bal", "ravens", "baltimore ravens", "baltimore"] },
  ravens: { id: "33", keys: ["bal", "ravens", "baltimore ravens", "baltimore"] },

  cin: { id: "4", keys: ["cin", "bengals", "cincinnati bengals", "cincinnati"] },
  bengals: { id: "4", keys: ["cin", "bengals", "cincinnati bengals", "cincinnati"] },

  sf: { id: "25", keys: ["sf", "49ers", "san francisco 49ers", "san francisco"] },
  "49ers": { id: "25", keys: ["sf", "49ers", "san francisco 49ers", "san francisco"] },

  det: { id: "8", keys: ["det", "lions", "detroit lions", "detroit"] },
  lions: { id: "8", keys: ["det", "lions", "detroit lions", "detroit"] },

  clemson: { id: "228", keys: ["clemson", "clemson tigers", "tigers"] },
  "clemson tigers": { id: "228", keys: ["clemson", "clemson tigers", "tigers"] },

  unc: { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north carolina": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north-carolina": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },
  "north carolina tar heels": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels", "carolina"] },

  alabama: { id: "333", keys: ["alabama", "alabama crimson tide", "crimson tide"] },
  georgia: { id: "61", keys: ["georgia", "georgia bulldogs", "bulldogs"] },
  "ohio state": { id: "194", keys: ["ohio state", "ohio state buckeyes", "osu", "buckeyes"] },
  texas: { id: "251", keys: ["texas", "texas longhorns", "longhorns"] },
  oregon: { id: "2483", keys: ["oregon", "oregon ducks", "ducks"] },
  michigan: { id: "130", keys: ["michigan", "michigan wolverines", "wolverines"] },
  fsu: { id: "52", keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] },
  "florida state": { id: "52", keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] }
};

function cleanText(value) {
  return String(value || "")
    .toLowerCase()
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

function normalizeTeam(team) {
  const key = cleanText(team);
  const mapped = TEAM_MAP[key];

  if (mapped) return mapped;

  return {
    id: key,
    keys: [key]
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

function getConfidenceFromEdge(edge) {
  const e = Math.abs(Number(edge || 0));

  if (!Number.isFinite(e)) return 0;

  if (e < 13) {
    return round(Math.min(74, Math.max(50, 50 + e * 1.5)));
  }

  if (e >= 25) return 99;

  const confidence = 75 + ((e - 13) / 12) * 24;

  return round(confidence);
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

  if (teamRef.id && String(teamRef.id) === id) return true;

  return teamRef.keys.some((key) => {
    const cleanKey = cleanText(key);

    return (
      abbreviation === cleanKey ||
      displayName === cleanKey ||
      shortName === cleanKey ||
      location === cleanKey ||
      name === cleanKey ||
      displayName.includes(cleanKey) ||
      cleanKey.includes(displayName) ||
      location.includes(cleanKey) ||
      cleanKey.includes(location) ||
      name.includes(cleanKey) ||
      cleanKey.includes(name)
    );
  });
}

async function getSeasonGames(type, season) {
  const sportPath = SPORT_PATHS[type];
  const weeks = MAX_WEEKS[type];

  const allGames = [];

  for (let week = 1; week <= weeks; week++) {
    const groupParam = type === "ncaaf" ? "&groups=80" : "";

    const url =
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${season}&seasontype=2&week=${week}${groupParam}`;

    try {
      const data = await fetchJson(url);
      const events = data.events || [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];

        if (competitors.length !== 2) continue;
        if (!isCompletedGame(event, comp)) continue;

        const c1 = competitors[0];
        const c2 = competitors[1];

        const score1 = Number(c1.score);
        const score2 = Number(c2.score);

        if (!Number.isFinite(score1) || !Number.isFinite(score2)) continue;

        allGames.push({
          id: event.id,
          date: event.date,
          week,

          team1Id: String(c1.team?.id || ""),
          team1Abbr: c1.team?.abbreviation || "",
          team1Name: c1.team?.displayName || "",
          team1ShortName: c1.team?.shortDisplayName || "",
          team1Location: c1.team?.location || "",
          team1Mascot: c1.team?.name || "",
          team1Score: score1,

          team2Id: String(c2.team?.id || ""),
          team2Abbr: c2.team?.abbreviation || "",
          team2Name: c2.team?.displayName || "",
          team2ShortName: c2.team?.shortDisplayName || "",
          team2Location: c2.team?.location || "",
          team2Mascot: c2.team?.name || "",
          team2Score: score2
        });
      }
    } catch (err) {
      console.log(`No se pudo cargar ${type} week ${week}:`, err.message);
    }
  }

  return allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
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
      teamPoints: game.teamPoints,
      pointsAllowed: game.pointsAllowed,
      opponentAvgPointsAllowed: opponentAvg.opponentAvgPointsAllowed,
      opponentAvgPointsScored: opponentAvg.opponentAvgPointsScored,
      opponentGamesUsed: opponentAvg.gamesUsedForOpponent
    };
  });
}

function calculateFootballEdges(games = []) {
  const recentGames = games.slice(
    0,
    Math.min(MAX_GAMES_USED, games.length)
  );

  const usableGames = recentGames.filter(
    (game) => Number(game.opponentGamesUsed) > 0
  );

  const gamesForCalc = usableGames.length ? usableGames : recentGames;

  const offensiveEdges = gamesForCalc.map((game) => {
    return Number(game.teamPoints) - Number(game.opponentAvgPointsAllowed);
  });

  const defensiveEdges = gamesForCalc.map((game) => {
    return Number(game.opponentAvgPointsScored) - Number(game.pointsAllowed);
  });

  return {
    gamesUsed: gamesForCalc.length,
    avgPointsScored: round(average(gamesForCalc.map((g) => g.teamPoints))),
    avgPointsAllowed: round(average(gamesForCalc.map((g) => g.pointsAllowed))),
    avgOffensiveEdge: round(average(offensiveEdges)),
    avgDefensiveEdge: round(average(defensiveEdges))
  };
}

function projectFootballTeam(team, opponent) {
  const projectionFromOffense =
    opponent.avgPointsAllowed + team.avgOffensiveEdge;

  const projectionFromOpponentDefense =
    team.avgPointsScored + opponent.avgDefensiveEdge;

  const finalProjection =
    (projectionFromOffense + projectionFromOpponentDefense) / 2;

  return {
    finalProjection: round(finalProjection)
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

    for (const bookmaker of game.bookmakers || []) {
      const spreadMarket = bookmaker.markets?.find((m) => m.key === "spreads");
      const totalMarket = bookmaker.markets?.find((m) => m.key === "totals");

      if (spreadMarket) {
        for (const outcome of spreadMarket.outcomes || []) {
          if (oddsTeamMatches(outcome.name, teamARef)) {
            spreadLineA = Number(outcome.point);
          }

          if (oddsTeamMatches(outcome.name, teamBRef)) {
            spreadLineB = Number(outcome.point);
          }
        }
      }

      if (totalMarket) {
        const over = totalMarket.outcomes?.find(
          (o) => cleanText(o.name) === "over"
        );

        if (over) {
          totalLine = Number(over.point);
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
      totalLine
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
        return Number(stat.perGameValue ?? stat.value ?? 0);
      }
    }
  }

  return 0;
}

async function getTeamStatsProfile(type, teamRef, season) {
  const sportPath = SPORT_PATHS[type];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamRef.id}/statistics?season=${season}`;

  const data = await fetchJson(url);

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
  odds
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
    const confidence = getConfidenceFromEdge(edge);

    spreadPick = {
      type: "spread",
      side: chosenSide,
      pick: `${chosenSide} ${chosenLine > 0 ? "+" : ""}${chosenLine}`,
      edge,
      confidence,
      isPremium: edge >= 13 && confidence >= 75
    };
  }

  let totalPick = null;

  if (Number.isFinite(odds.totalLine)) {
    const rawEdge = projectedTotal - odds.totalLine;
    const edge = round(Math.abs(rawEdge));

    if (edge > 0) {
      const confidence = getConfidenceFromEdge(edge);

      totalPick = {
        type: "total",
        pick: rawEdge >= 0 ? `OVER ${odds.totalLine}` : `UNDER ${odds.totalLine}`,
        edge,
        confidence,
        isPremium: edge >= 13 && confidence >= 75
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
      confidence: pick.confidence,
      edge: pick.edge,
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
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

    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");

      if (token) {
        const { data: authData } = await supabaseAdmin.auth.getUser(token);

        if (authData?.user) {
          const { data: profile } = await supabaseAdmin
            .from("users")
            .select("is_premium")
            .eq("id", authData.user.id)
            .single();

          isPremiumUser = profile?.is_premium === true;
        }
      }
    } catch (error) {
      console.log("No se pudo validar premium football:", error.message);
    }

    const selectedSeason = Number(season) || getDefaultSeason();

    const teamARef = normalizeTeam(teamA);
    const teamBRef = normalizeTeam(teamB);

    const allGames = await getSeasonGames(type, selectedSeason);

    const teamAGames = buildTeamGamesFromSeason(allGames, teamARef);
    const teamBGames = buildTeamGamesFromSeason(allGames, teamBRef);

    const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    const baseProjectedTotal = round(projectedTeamA + projectedTeamB);
const projectedSpread = round(projectedTeamA - projectedTeamB);

const [teamAProfile, teamBProfile] = await Promise.all([
  getTeamStatsProfile(type, teamARef, selectedSeason),
  getTeamStatsProfile(type, teamBRef, selectedSeason)
]);

const paceModule = calculatePaceEfficiencyAdjustment({
  type,
  projectedTotal: baseProjectedTotal,
  teamAProfile,
  teamBProfile
});

const projectedTotal = round(baseProjectedTotal + paceModule.adjustment);
    const odds = await getFootballOdds(type, teamARef, teamBRef);

    const rawPicks = buildFootballPicks({
      teamA,
      teamB,
      projectedSpread,
      projectedTotal,
      odds
    });

    const picks = sanitizePicksForPublic(rawPicks, isPremiumUser);

    return res.status(200).json({
      sport: type,
      isPremiumUser,
      odds,
      picks,
      projectedScore: {
        [teamA]: projectedTeamA,
        [teamB]: projectedTeamB
      },
      baseProjectedTotal,
paceEfficiencyAdjustment: paceModule,
      projectedTotal,
      projectedSpread
    });
  } catch (error) {
    console.error("ERROR FOOTBALL DATA:", error);

    return res.status(500).json({
      error: "Error cargando data real football",
      details: error.message
    });
  }
};

const MAX_GAMES_USED = 7;

const SPORT_PATHS = {
  nfl: "football/nfl",
  ncaaf: "football/college-football"
};

const TEAM_ALIASES = {
  // NFL
  chiefs: "kc",
  "kansas city chiefs": "kc",
  kc: "kc",

  eagles: "phi",
  "philadelphia eagles": "phi",
  phi: "phi",

  cowboys: "dal",
  "dallas cowboys": "dal",
  dal: "dal",

  bills: "buf",
  "buffalo bills": "buf",
  buf: "buf",

  ravens: "bal",
  "baltimore ravens": "bal",
  bal: "bal",

  bengals: "cin",
  "cincinnati bengals": "cin",
  cin: "cin",

  lions: "det",
  "detroit lions": "det",
  det: "det",

  niners: "sf",
  "49ers": "sf",
  "san francisco 49ers": "sf",
  sf: "sf",

  // NCAAF
  clemson: "clemson-tigers",

  "north carolina": "north-carolina-tar-heels",
  unc: "north-carolina-tar-heels",
  "north-carolina": "north-carolina-tar-heels",
  "north-carolina-tar-heels": "north-carolina-tar-heels",

  alabama: "alabama-crimson-tide",
  georgia: "georgia-bulldogs",

  "ohio state": "ohio-state-buckeyes",
  ohio: "ohio-state-buckeyes",
  "ohio-state": "ohio-state-buckeyes",

  texas: "texas-longhorns",
  oregon: "oregon-ducks",
  michigan: "michigan-wolverines",

  "florida state": "florida-state-seminoles",
  fsu: "florida-state-seminoles",
  "florida-state": "florida-state-seminoles"
};

function normalizeTeam(team) {
  if (!team) return "";
  const key = String(team).trim().toLowerCase();
  return TEAM_ALIASES[key] || key.replaceAll(" ", "-");
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

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ESPN error ${response.status}: ${url}`);
  }

  return response.json();
}

function getCompetitorMatch(competitors, teamSlug) {
  const cleanSlug = String(teamSlug).toLowerCase();

  return competitors.find((c) => {
    const abbr = c.team?.abbreviation?.toLowerCase();
    const slug = c.team?.slug?.toLowerCase();
    const name = c.team?.displayName?.toLowerCase()?.replaceAll(" ", "-");
    const shortName = c.team?.shortDisplayName?.toLowerCase()?.replaceAll(" ", "-");

    return (
      abbr === cleanSlug ||
      slug === cleanSlug ||
      name === cleanSlug ||
      shortName === cleanSlug
    );
  });
}

async function getTeamSchedule(type, teamSlug) {
  const sportPath = SPORT_PATHS[type];

  const url =
    `https://site.web.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamSlug}/schedule`;

  const data = await fetchJson(url);

  const events = data.events || data.team?.events || [];

  return events
    .filter((event) => event.competitions?.[0]?.competitors?.length === 2)
    .map((event) => {
      const comp = event.competitions[0];
      const competitors = comp.competitors;

      const team = getCompetitorMatch(competitors, teamSlug);
      const opponent = competitors.find((c) => c !== team);

      if (!team || !opponent) return null;

      const teamScore = Number(team.score);
      const opponentScore = Number(opponent.score);

      if (!Number.isFinite(teamScore) || !Number.isFinite(opponentScore)) {
        return null;
      }

      return {
        date: event.date,
        teamPoints: teamScore,
        pointsAllowed: opponentScore,
        opponentSlug:
          opponent.team?.slug ||
          opponent.team?.abbreviation?.toLowerCase() ||
          opponent.team?.displayName?.toLowerCase().replaceAll(" ", "-"),
        opponentName: opponent.team?.displayName || "Opponent"
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getOpponentAverages(type, opponentSlug, beforeDate) {
  const games = await getTeamSchedule(type, opponentSlug);

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

async function buildTeamGames(type, teamSlug) {
  const schedule = await getTeamSchedule(type, teamSlug);

  const recentGames = schedule.slice(
    0,
    Math.min(MAX_GAMES_USED, schedule.length)
  );

  const games = [];

  for (const game of recentGames) {
    const opponentAvg = await getOpponentAverages(
      type,
      game.opponentSlug,
      game.date
    );

    games.push({
      date: game.date,
      opponent: game.opponentName,
      teamPoints: game.teamPoints,
      pointsAllowed: game.pointsAllowed,
      opponentAvgPointsAllowed: opponentAvg.opponentAvgPointsAllowed,
      opponentAvgPointsScored: opponentAvg.opponentAvgPointsScored,
      opponentGamesUsed: opponentAvg.gamesUsedForOpponent
    });
  }

  return games;
}

function calculateFootballEdges(games = []) {
  const recentGames = games.slice(
    0,
    Math.min(MAX_GAMES_USED, games.length)
  );

  const offensiveEdges = recentGames.map((game) => {
    return Number(game.teamPoints) - Number(game.opponentAvgPointsAllowed);
  });

  const defensiveEdges = recentGames.map((game) => {
    return Number(game.opponentAvgPointsScored) - Number(game.pointsAllowed);
  });

  return {
    gamesUsed: recentGames.length,
    avgPointsScored: round(average(recentGames.map((g) => g.teamPoints))),
    avgPointsAllowed: round(average(recentGames.map((g) => g.pointsAllowed))),
    avgOffensiveEdge: round(average(offensiveEdges)),
    avgDefensiveEdge: round(average(defensiveEdges)),
    offensiveEdges: offensiveEdges.map((n) => round(n)),
    defensiveEdges: defensiveEdges.map((n) => round(n)),
    games: recentGames
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
    projectionFromOffense: round(projectionFromOffense),
    projectionFromOpponentDefense: round(projectionFromOpponentDefense),
    finalProjection: round(finalProjection)
  };
}

module.exports = async function handler(req, res) {
  try {
    const { type = "nfl", teamA, teamB } = req.query;

    if (!teamA || !teamB) {
      return res.status(400).json({
        error: "Faltan teamA y teamB",
        example: "/api/football-data?type=nfl&teamA=KC&teamB=PHI"
      });
    }

    if (!SPORT_PATHS[type]) {
      return res.status(400).json({
        error: "type inválido. Usa nfl o ncaaf"
      });
    }

    const teamASlug = normalizeTeam(teamA);
    const teamBSlug = normalizeTeam(teamB);

    const [teamAGames, teamBGames] = await Promise.all([
      buildTeamGames(type, teamASlug),
      buildTeamGames(type, teamBSlug)
    ]);

    const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    return res.status(200).json({
      sport: type,
      teamA: {
        name: teamA,
        slug: teamASlug,
        ...teamAEdges,
        projection: teamAProjection
      },
      teamB: {
        name: teamB,
        slug: teamBSlug,
        ...teamBEdges,
        projection: teamBProjection
      },
      projectedScore: {
        [teamA]: projectedTeamA,
        [teamB]: projectedTeamB
      },
      projectedTotal: round(projectedTeamA + projectedTeamB),
      projectedSpread: round(projectedTeamA - projectedTeamB)
    });
  } catch (error) {
    console.error("ERROR FOOTBALL DATA:", error);

    return res.status(500).json({
      error: "Error cargando data real football",
      details: error.message
    });
  }
};

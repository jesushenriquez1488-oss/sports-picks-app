const MAX_GAMES_USED = 7;

const SPORT_PATHS = {
  nfl: "football/nfl",
  ncaaf: "football/college-football"
};

const TEAM_IDS = {
  // NFL
  kc: "12",
  chiefs: "12",
  "kansas city chiefs": "12",

  phi: "21",
  eagles: "21",
  "philadelphia eagles": "21",

  dal: "6",
  cowboys: "6",
  "dallas cowboys": "6",

  buf: "2",
  bills: "2",
  "buffalo bills": "2",

  bal: "33",
  ravens: "33",
  "baltimore ravens": "33",

  cin: "4",
  bengals: "4",
  "cincinnati bengals": "4",

  sf: "25",
  "49ers": "25",
  "san francisco 49ers": "25",

  det: "8",
  lions: "8",
  "detroit lions": "8",

  // NCAAF
  clemson: "228",
  "clemson tigers": "228",

  unc: "153",
  "north carolina": "153",
  "north-carolina": "153",
  "north carolina tar heels": "153",

  alabama: "333",
  "alabama crimson tide": "333",

  georgia: "61",
  "georgia bulldogs": "61",

  "ohio state": "194",
  "ohio-state": "194",
  "ohio state buckeyes": "194",

  texas: "251",
  "texas longhorns": "251",

  oregon: "2483",
  "oregon ducks": "2483",

  michigan: "130",
  "michigan wolverines": "130",

  fsu: "52",
  "florida state": "52",
  "florida-state": "52",
  "florida state seminoles": "52"
};

function getDefaultSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 8 ? year : year - 1;
}

function normalizeTeamId(team) {
  const key = String(team || "").trim().toLowerCase();
  return TEAM_IDS[key] || key;
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

async function getTeamSchedule(type, teamId, season) {
  const sportPath = SPORT_PATHS[type];

  const urls = [
    `https://site.web.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/schedule?season=${season}&seasontype=2`,
    `https://site.web.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/schedule?season=${season}&seasontype=3`
  ];

  let allEvents = [];

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const events = data.events || data.team?.events || [];
      allEvents = allEvents.concat(events);
    } catch (err) {
      console.log("Schedule fetch falló:", url);
    }
  }

  return allEvents
    .filter((event) => event.competitions?.[0]?.competitors?.length === 2)
    .map((event) => {
      const comp = event.competitions[0];
      const competitors = comp.competitors;

      const team = competitors.find((c) => String(c.team?.id) === String(teamId));
      const opponent = competitors.find((c) => String(c.team?.id) !== String(teamId));

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
        opponentId: opponent.team?.id,
        opponentName: opponent.team?.displayName || "Opponent"
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getOpponentAverages(type, opponentId, beforeDate, season) {
  const games = await getTeamSchedule(type, opponentId, season);

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

async function buildTeamGames(type, teamId, season) {
  const schedule = await getTeamSchedule(type, teamId, season);

  const recentGames = schedule.slice(
    0,
    Math.min(MAX_GAMES_USED, schedule.length)
  );

  const games = [];

  for (const game of recentGames) {
    const opponentAvg = await getOpponentAverages(
      type,
      game.opponentId,
      game.date,
      season
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
  const recentGames = games.slice(0, Math.min(MAX_GAMES_USED, games.length));

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
    const { type = "nfl", teamA, teamB, season } = req.query;

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

    const selectedSeason = Number(season) || getDefaultSeason();

    const teamAId = normalizeTeamId(teamA);
    const teamBId = normalizeTeamId(teamB);

    const [teamAGames, teamBGames] = await Promise.all([
      buildTeamGames(type, teamAId, selectedSeason),
      buildTeamGames(type, teamBId, selectedSeason)
    ]);

    const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    return res.status(200).json({
      sport: type,
      season: selectedSeason,
      teamA: {
        name: teamA,
        id: teamAId,
        ...teamAEdges,
        projection: teamAProjection
      },
      teamB: {
        name: teamB,
        id: teamBId,
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

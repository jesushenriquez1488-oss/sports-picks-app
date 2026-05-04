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

  // NCAAF
  clemson: "228",
  "clemson tigers": "228",
  unc: "153",
  "north carolina": "153",
  "north-carolina": "153",
  "north carolina tar heels": "153"
};

const MAX_WEEKS = {
  nfl: 22,
  ncaaf: 16
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

async function getSeasonGames(type, season) {
  const sportPath = SPORT_PATHS[type];
  const weeks = MAX_WEEKS[type];

  const allGames = [];

  for (let week = 1; week <= weeks; week++) {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${season}&seasontype=2&week=${week}`;

    try {
      const data = await fetchJson(url);
      const events = data.events || [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];

        if (competitors.length !== 2) continue;

        const statusType = comp.status?.type || event.status?.type;
        const completed =
          statusType?.completed === true ||
          statusType?.name === "STATUS_FINAL";

        if (!completed) continue;

        const c1 = competitors[0];
        const c2 = competitors[1];

        const score1 = Number(c1.score);
        const score2 = Number(c2.score);

        if (!Number.isFinite(score1) || !Number.isFinite(score2)) continue;

        allGames.push({
          id: event.id,
          date: event.date,
          week,
          team1Id: String(c1.team?.id),
          team1Name: c1.team?.displayName,
          team1Score: score1,
          team2Id: String(c2.team?.id),
          team2Name: c2.team?.displayName,
          team2Score: score2
        });
      }
    } catch (err) {
      console.log(`No se pudo cargar ${type} week ${week}`, err.message);
    }
  }

  return allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getTeamGamesFromSeason(allGames, teamId) {
  return allGames
    .filter((game) => game.team1Id === String(teamId) || game.team2Id === String(teamId))
    .map((game) => {
      const isTeam1 = game.team1Id === String(teamId);

      return {
        date: game.date,
        week: game.week,
        teamPoints: isTeam1 ? game.team1Score : game.team2Score,
        pointsAllowed: isTeam1 ? game.team2Score : game.team1Score,
        opponentId: isTeam1 ? game.team2Id : game.team1Id,
        opponentName: isTeam1 ? game.team2Name : game.team1Name
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getOpponentAveragesFromSeason(allGames, opponentId, beforeDate) {
  const games = getTeamGamesFromSeason(allGames, opponentId);

  const previousGames = games
    .filter((game) => new Date(game.date) < new Date(beforeDate))
    .slice(0, MAX_GAMES_USED);

  return {
    opponentAvgPointsAllowed: round(average(previousGames.map((g) => g.pointsAllowed))),
    opponentAvgPointsScored: round(average(previousGames.map((g) => g.teamPoints))),
    gamesUsedForOpponent: previousGames.length
  };
}

function buildTeamGamesFromSeason(allGames, teamId) {
  const schedule = getTeamGamesFromSeason(allGames, teamId);
  const recentGames = schedule.slice(0, Math.min(MAX_GAMES_USED, schedule.length));

  return recentGames.map((game) => {
    const opponentAvg = getOpponentAveragesFromSeason(
      allGames,
      game.opponentId,
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
  const recentGames = games.slice(0, Math.min(MAX_GAMES_USED, games.length));

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
    avgDefensiveEdge: round(average(defensiveEdges)),
    offensiveEdges: offensiveEdges.map((n) => round(n)),
    defensiveEdges: defensiveEdges.map((n) => round(n)),
    games: gamesForCalc
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
        example: "/api/football-data?type=nfl&teamA=KC&teamB=PHI&season=2024"
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

    const allGames = await getSeasonGames(type, selectedSeason);

    const teamAGames = buildTeamGamesFromSeason(allGames, teamAId);
    const teamBGames = buildTeamGamesFromSeason(allGames, teamBId);

    const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    return res.status(200).json({
      sport: type,
      season: selectedSeason,
      totalSeasonGamesLoaded: allGames.length,
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

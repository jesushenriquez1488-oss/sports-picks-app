export default async function handler(req, res) {
  try {
    const { type = "nfl", teamA, teamB } = req.query;

    if (!teamA || !teamB) {
      return res.status(400).json({
        error: "Faltan teamA y teamB",
        example: "/api/football-data?type=nfl&teamA=Kansas City Chiefs&teamB=Denver Broncos"
      });
    }

    const MAX_GAMES_USED = 7;

    const average = (numbers) => {
      const valid = numbers.filter((n) => Number.isFinite(Number(n)));
      if (!valid.length) return 0;
      return valid.reduce((sum, n) => sum + Number(n), 0) / valid.length;
    };

    const round = (num, decimals = 1) => {
      if (!Number.isFinite(Number(num))) return 0;
      return Number(Number(num).toFixed(decimals));
    };

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
        defensiveEdges: defensiveEdges.map((n) => round(n))
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

    /*
      TEMPORAL:
      Esta data es de prueba para verificar que la fórmula funcione.
      Después reemplazamos esto por llamadas reales a API.
    */
    const demoData = {
      teamA: {
        name: teamA,
        games: [
          {
            teamPoints: 34,
            pointsAllowed: 20,
            opponentAvgPointsAllowed: 24,
            opponentAvgPointsScored: 26
          },
          {
            teamPoints: 28,
            pointsAllowed: 24,
            opponentAvgPointsAllowed: 21,
            opponentAvgPointsScored: 27
          }
        ]
      },
      teamB: {
        name: teamB,
        games: [
          {
            teamPoints: 21,
            pointsAllowed: 31,
            opponentAvgPointsAllowed: 25,
            opponentAvgPointsScored: 29
          },
          {
            teamPoints: 27,
            pointsAllowed: 24,
            opponentAvgPointsAllowed: 23,
            opponentAvgPointsScored: 22
          }
        ]
      }
    };

    const teamAEdges = calculateFootballEdges(demoData.teamA.games);
    const teamBEdges = calculateFootballEdges(demoData.teamB.games);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    return res.status(200).json({
      sport: type,
      teamA: {
        name: teamA,
        ...teamAEdges,
        projection: teamAProjection
      },
      teamB: {
        name: teamB,
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
      error: "Error interno en football-data",
      details: error.message
    });
  }
}

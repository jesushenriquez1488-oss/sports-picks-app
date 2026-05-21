export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  const { team, league } = req.query;
const teamKey = normalizeSportsDataTeam(team);
  if (!team || !league) {
    return res.status(400).json({ error: "Missing params" });
  }

  const API_KEY = process.env.SPORTSDATA_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "Missing SPORTSDATA_API_KEY" });
  }

  try {
    const seasons =
      league === "wnba" ? [2026, 2025] :
      league === "ncaab" ? [2026, 2025] :
      [];

    if (!seasons.length) {
      return res.status(400).json({ error: "Invalid league" });
    }

    let allGames = [];

    for (const season of seasons) {
      const url =
        league === "wnba"
          ? `https://api.sportsdata.io/v3/wnba/stats/json/Games/${season}`
          : `https://api.sportsdata.io/v3/cbb/stats/json/Games/${season}`;

      const response = await fetch(url, {
        headers: {
          "Ocp-Apim-Subscription-Key": API_KEY
        }
      });

      const data = await response.json();

      if (response.ok && Array.isArray(data)) {
        allGames = allGames.concat(data);
      }
    }

    const completedGames = allGames
      .filter(g =>
        g.HomeTeamScore !== null &&
        g.AwayTeamScore !== null &&
        g.HomeTeamScore !== undefined &&
        g.AwayTeamScore !== undefined
      )
      .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));

    function getTeamGameView(g, teamName) {
      const isHome = g.HomeTeam === teamName;

      return {
        date: g.DateTime,
        isHome,
        scored: isHome ? g.HomeTeamScore : g.AwayTeamScore,
        allowed: isHome ? g.AwayTeamScore : g.HomeTeamScore,
        opponent: isHome ? g.AwayTeam : g.HomeTeam
      };
    }

    function getOpponentLast5Averages(opponent, beforeDate) {
      const before = new Date(beforeDate);

      const previousGames = completedGames
        .filter(g =>
          (g.HomeTeam === opponent || g.AwayTeam === opponent) &&
          new Date(g.DateTime) < before
        )
        .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
        .slice(0, 3)
        .map(g => getTeamGameView(g, opponent));

      if (previousGames.length < 3) {
        return null;
      }

      const avgScored =
        previousGames.reduce((sum, g) => sum + g.scored, 0) / previousGames.length;

      const avgAllowed =
        previousGames.reduce((sum, g) => sum + g.allowed, 0) / previousGames.length;

      return {
        opponentAvgScored: avgScored,
        opponentAvgAllowed: avgAllowed
      };
    }

    const recentTeamGames = completedGames
      .filter(g => g.HomeTeam === team || g.AwayTeam === team)
      .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
      .slice(0, 20)
      .map(g => getTeamGameView(g, team));

    const finalGames = [];

    for (const game of recentTeamGames) {
      const opponentAverages = getOpponentLast5Averages(game.opponent, game.date);

      if (!opponentAverages) {

  finalGames.push({
    ...game,
    opponentAvgAllowed: game.allowed,
    opponentAvgScored: game.scored
  });

  continue;
}

      finalGames.push({
        ...game,
        opponentAvgAllowed: opponentAverages.opponentAvgAllowed,
        opponentAvgScored: opponentAverages.opponentAvgScored
      });

      if (finalGames.length >= 3) break;
    }

    if (finalGames.length < 3) {
      return res.status(404).json({
        error: `No hay suficientes juegos reales para ${team}. Equipo sin historial completo de últimos 3.`
      });
    }

    return res.status(200).json(finalGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

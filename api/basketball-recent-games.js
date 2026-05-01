export default async function handler(req, res) {
  const { team, league } = req.query;

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

    if (seasons.length === 0) {
      return res.status(400).json({ error: "Invalid league" });
    }

    let allGames = [];

    for (const season of seasons) {
      let url = "";

      if (league === "wnba") {
        url = `https://api.sportsdata.io/v3/wnba/stats/json/Games/${season}`;
      }

      if (league === "ncaab") {
        url = `https://api.sportsdata.io/v3/cbb/stats/json/Games/${season}`;
      }

      const response = await fetch(url, {
        headers: {
          "Ocp-Apim-Subscription-Key": API_KEY
        }
      });

      const data = await response.json();

      if (!response.ok) {
        continue;
      }

      if (Array.isArray(data)) {
        allGames = allGames.concat(data);
      }

      const completedForTeam = allGames.filter(g =>
        (g.HomeTeam === team || g.AwayTeam === team) &&
        g.HomeTeamScore !== null &&
        g.AwayTeamScore !== null &&
        g.HomeTeamScore !== undefined &&
        g.AwayTeamScore !== undefined
      );

      if (completedForTeam.length >= 5) {
        break;
      }
    }

    const teamGames = allGames
      .filter(g =>
        g.HomeTeam === team || g.AwayTeam === team
      )
      .filter(g =>
        g.HomeTeamScore !== null &&
        g.AwayTeamScore !== null &&
        g.HomeTeamScore !== undefined &&
        g.AwayTeamScore !== undefined
      )
      .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
      .slice(0, 10)
      .map(g => {
        const isHome = g.HomeTeam === team;

        const scored = isHome ? g.HomeTeamScore : g.AwayTeamScore;
        const allowed = isHome ? g.AwayTeamScore : g.HomeTeamScore;

        return {
          date: g.DateTime,
          isHome,
          scored,
          allowed,
          opponentAvgAllowed: allowed,
          opponentAvgScored: scored
        };
      });

    if (teamGames.length < 5) {
      return res.status(404).json({
        error: `No hay suficientes juegos recientes para ${team} en ${league}.`
      });
    }

    return res.status(200).json(teamGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

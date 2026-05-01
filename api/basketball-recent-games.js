export default async function handler(req, res) {
  const { team, league } = req.query;

  if (!team || !league) {
    return res.status(400).json({ error: "Missing params" });
  }

  const API_KEY = process.env.SPORTSDATA_API_KEY;

  try {
    let url = "";

    if (league === "wnba") {
      url = `https://api.sportsdata.io/v3/wnba/stats/json/Games/2025`;
    }

    if (league === "ncaab") {
      url = `https://api.sportsdata.io/v3/cbb/stats/json/Games/2025`;
    }

    if (!url) {
      return res.status(400).json({ error: "Invalid league" });
    }

    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": API_KEY
      }
    });

    const data = await response.json();

    const teamGames = data
      .filter(g =>
        g.HomeTeam === team || g.AwayTeam === team
      )
      .filter(g => g.HomeTeamScore && g.AwayTeamScore)
      .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
      .slice(0, 10)
      .map(g => {
        const isHome = g.HomeTeam === team;

        return {
          date: g.DateTime,
          isHome,
          scored: isHome ? g.HomeTeamScore : g.AwayTeamScore,
          allowed: isHome ? g.AwayTeamScore : g.HomeTeamScore
        };
      });

    return res.status(200).json(teamGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

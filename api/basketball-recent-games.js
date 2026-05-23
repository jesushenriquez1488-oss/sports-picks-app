export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { team, league } = req.query;

  if (!team || !league) {
    return res.status(400).json({ error: "Missing params" });
  }

  const API_KEY = process.env.SPORTSDATA_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "Missing SPORTSDATA_API_KEY" });
  }

  try {
    const teamKey = normalizeSportsDataTeam(team);
const currentYear = new Date().getFullYear();

const seasons =
  league === "wnba"
    ? [currentYear, currentYear - 1]
    : league === "ncaab"
      ? [currentYear, currentYear - 1]
      : [];

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
console.log("SEASON", season, "GAMES:", Array.isArray(data) ? data.length : data);
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
console.log("TEAM ORIGINAL:", team);
console.log("TEAM KEY:", teamKey);
console.log("LEAGUE:", league);
console.log("ALL GAMES:", allGames.length);
console.log("COMPLETED GAMES:", completedGames.length);
console.log("SAMPLE GAME:", completedGames[0]);
console.log(
  "TEAMS FOUND:",
  [...new Set(completedGames.flatMap(g => [g.HomeTeam, g.AwayTeam]))]
);
    function getTeamGameView(g, code) {
      const isHome = g.HomeTeam === code;

      return {
        date: g.DateTime,
        isHome,
        scored: isHome ? g.HomeTeamScore : g.AwayTeamScore,
        allowed: isHome ? g.AwayTeamScore : g.HomeTeamScore,
        opponent: isHome ? g.AwayTeam : g.HomeTeam
      };
    }

    function getOpponentLastAverages(opponent, beforeDate) {
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
return res.status(200).json({
  team,
  teamKey,
  league,
  allGamesCount: allGames.length,
  completedGamesCount: completedGames.length,
  sample: completedGames.slice(0, 2).map(g => ({
    DateTime: g.DateTime,
    HomeTeam: g.HomeTeam,
    AwayTeam: g.AwayTeam,
    HomeTeamScore: g.HomeTeamScore,
    AwayTeamScore: g.AwayTeamScore
  }))
});

const recentTeamGames = completedGames
    const recentTeamGames = completedGames
      .filter(g => g.HomeTeam === teamKey || g.AwayTeam === teamKey)
      .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
      .slice(0, 20)
      .map(g => getTeamGameView(g, teamKey));

    const finalGames = [];

    for (const game of recentTeamGames) {
      const opponentAverages = getOpponentLastAverages(game.opponent, game.date);

      if (!opponentAverages) {
        finalGames.push({
          ...game,
          opponentAvgAllowed: game.allowed,
          opponentAvgScored: game.scored
        });
      } else {
        finalGames.push({
          ...game,
          opponentAvgAllowed: opponentAverages.opponentAvgAllowed,
          opponentAvgScored: opponentAverages.opponentAvgScored
        });
      }

      if (finalGames.length >= 3) break;
    }

    if (finalGames.length < 3) {
      return res.status(404).json({
        error: `No hay suficientes juegos reales para ${team}.`
      });
    }

    return res.status(200).json(finalGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function normalizeSportsDataTeam(teamName) {
  const name = String(teamName || "").toLowerCase().trim();

  const map = {
    "atlanta dream": "ATL",
    "chicago sky": "CHI",
    "connecticut sun": "CON",
    "dallas wings": "DAL",
    "golden state valkyries": "GS",
    "indiana fever": "IND",
    "las vegas aces": "LV",
    "los angeles sparks": "LA",
    "minnesota lynx": "MIN",
    "new york liberty": "NY",
    "phoenix mercury": "PHO",
    "seattle storm": "SEA",
    "washington mystics": "WAS"
  };

  return map[name] || teamName;
}

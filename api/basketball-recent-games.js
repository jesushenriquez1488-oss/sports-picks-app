module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { team, league } = req.query;

  if (!team || !league) {
    return res.status(400).json({ error: "Missing params" });
  }

  try {
    if (league !== "wnba") {
      return res.status(400).json({ error: "Solo WNBA por ahora en este endpoint." });
    }

    const games = await getEspnWnbaGames();

    const completedGames = games
      .filter(g => g.completed)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const teamGames = completedGames
      .filter(g => teamMatches(g.homeTeam, team) || teamMatches(g.awayTeam, team))
      .slice(0, 10);

    const finalGames = [];

    for (const game of teamGames) {
      const isHome = teamMatches(game.homeTeam, team);
      const scored = isHome ? game.homeScore : game.awayScore;
      const allowed = isHome ? game.awayScore : game.homeScore;
      const opponent = isHome ? game.awayTeam : game.homeTeam;

      const opponentPrevious = completedGames
        .filter(g =>
          new Date(g.date) < new Date(game.date) &&
          (teamMatches(g.homeTeam, opponent) || teamMatches(g.awayTeam, opponent))
        )
        .slice(0, 3)
        .map(g => {
          const oppIsHome = teamMatches(g.homeTeam, opponent);
          return {
            scored: oppIsHome ? g.homeScore : g.awayScore,
            allowed: oppIsHome ? g.awayScore : g.homeScore
          };
        });

      let opponentAvgScored = allowed;
      let opponentAvgAllowed = scored;

      if (opponentPrevious.length > 0) {
        opponentAvgScored =
          opponentPrevious.reduce((sum, g) => sum + g.scored, 0) / opponentPrevious.length;

        opponentAvgAllowed =
          opponentPrevious.reduce((sum, g) => sum + g.allowed, 0) / opponentPrevious.length;
      }

      finalGames.push({
        date: game.date,
        isHome,
        scored,
        allowed,
        opponent,
        opponentAvgScored,
        opponentAvgAllowed
      });

      if (finalGames.length >= 3) break;
    }

    if (finalGames.length < 3) {
      return res.status(404).json({
        error: `No hay suficientes juegos reales 2026 para ${team}.`
      });
    }

    return res.status(200).json(finalGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function getEspnWnbaGames() {
  const year = new Date().getFullYear();

  const start = `${year}0501`;
  const end = `${year}1231`;

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${start}-${end}&limit=1000`;

  const response = await fetch(url);
  const data = await response.json();

  const events = data.events || [];

  return events.map(event => {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];

    const home = competitors.find(c => c.homeAway === "home");
    const away = competitors.find(c => c.homeAway === "away");

    return {
      date: event.date,
      completed: competition?.status?.type?.completed === true,
      homeTeam: getTeamNames(home),
      awayTeam: getTeamNames(away),
      homeScore: Number(home?.score || 0),
      awayScore: Number(away?.score || 0)
    };
  });
}

function getTeamNames(competitor) {
  const team = competitor?.team || {};

  return {
    displayName: team.displayName || "",
    shortDisplayName: team.shortDisplayName || "",
    name: team.name || "",
    abbreviation: team.abbreviation || ""
  };
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamMatches(teamObj, target) {
  const t = normalize(target);

  return [
    teamObj.displayName,
    teamObj.shortDisplayName,
    teamObj.name,
    teamObj.abbreviation
  ].some(name => normalize(name) === t);
}

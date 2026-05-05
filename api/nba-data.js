const cache = global.__NBA_DATA_CACHE__ || {};
global.__NBA_DATA_CACHE__ = cache;

const CACHE_TIME = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;

module.exports = async function handler(req, res) {
  try {
    const { type, teamId } = req.query;

    const API_KEY =
      process.env.SPORTSDATAIO_KEY ||
      process.env.SPORTSDATA_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: "SPORTSDATAIO_KEY no configurada en Vercel"
      });
    }

    if (!type) {
      return res.status(400).json({ error: "Falta type" });
    }

    const season = getCurrentNBASportsDataSeason();

    if (type === "teams") {
      const teamsUrl = `https://api.sportsdata.io/v3/nba/scores/json/teams`;

      const teams = await fetchSportsData(teamsUrl, API_KEY);

      const formattedTeams = teams
        .filter(team => team.Active === true)
        .map(team => ({
          id: team.TeamID,
          abbreviation: team.Key,
          city: team.City,
          name: team.Name,
          full_name: `${team.City} ${team.Name}`
        }));

      return res.status(200).json({
        data: formattedTeams
      });
    }

    if (type === "games") {
      if (!teamId) {
        return res.status(400).json({ error: "Falta teamId" });
      }

      const gamesUrl = `https://api.sportsdata.io/v3/nba/scores/json/Games/${season}`;

      const games = await fetchSportsData(gamesUrl, API_KEY);

      const filteredGames = games
        .filter(game =>
          Number(game.HomeTeamID) === Number(teamId) ||
          Number(game.AwayTeamID) === Number(teamId)
        )
        .filter(game =>
          Number(game.HomeTeamScore || 0) > 0 &&
          Number(game.AwayTeamScore || 0) > 0
        )
        .map(game => ({
          id: game.GameID,
          date: game.DateTime || game.Day,
          status: game.Status,

          home_team_score: Number(game.HomeTeamScore || 0),
          visitor_team_score: Number(game.AwayTeamScore || 0),

          home_team: {
            id: game.HomeTeamID,
            abbreviation: game.HomeTeam,
            full_name: game.HomeTeamName || game.HomeTeam
          },

          visitor_team: {
            id: game.AwayTeamID,
            abbreviation: game.AwayTeam,
            full_name: game.AwayTeamName || game.AwayTeam
          }
        }));

      return res.status(200).json({
        data: filteredGames
      });
    }

    return res.status(400).json({
      error: "Tipo inválido"
    });

  } catch (error) {
    console.error("NBA DATA ERROR:", error);

    return res.status(500).json({
      error: "Error cargando data NBA",
      details: error.message
    });
  }
};

function getCurrentNBASportsDataSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month >= 10) return year + 1;

  return year;
}

async function fetchSportsData(url, apiKey) {
  const cached = cache[url];

  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey
      },
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`SportsDataIO error ${response.status}: ${text}`);
    }

    const data = JSON.parse(text);

    cache[url] = {
      data,
      time: Date.now()
    };

    return data;

  } catch (error) {
    if (cached?.data) {
      console.warn("Usando cache viejo NBA por error API:", error.message);
      return cached.data;
    }

    if (error.name === "AbortError") {
      throw new Error("SportsDataIO tardó demasiado y fue cancelado");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

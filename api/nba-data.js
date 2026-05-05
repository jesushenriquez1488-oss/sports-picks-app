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
      const teamsUrl = "https://api.sportsdata.io/v3/nba/scores/json/teams";
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

      return res.status(200).json({ data: formattedTeams });
    }

    if (type === "games") {
      if (!teamId) {
        return res.status(400).json({ error: "Falta teamId" });
      }

      const [teams, teamStats] = await Promise.all([
        fetchSportsData("https://api.sportsdata.io/v3/nba/scores/json/teams", API_KEY),
        fetchSportsData(
          `https://api.sportsdata.io/v3/nba/stats/json/TeamGameStatsBySeason/${season}`,
          API_KEY
        )
      ]);

      const teamMap = {};
      teams
        .filter(team => team.Active === true)
        .forEach(team => {
          teamMap[team.TeamID] = {
            id: team.TeamID,
            abbreviation: team.Key,
            full_name: `${team.City} ${team.Name}`
          };
        });

      const gamesById = {};

      teamStats.forEach(row => {
        const gameId = row.GameID;
        if (!gameId) return;

        const points = getPoints(row);
        if (!Number.isFinite(points) || points <= 0) return;

        if (!gamesById[gameId]) {
          gamesById[gameId] = [];
        }

        gamesById[gameId].push(row);
      });

      const games = Object.values(gamesById)
        .filter(rows => rows.length >= 2)
        .map(rows => {
          const teamA = rows[0];
          const teamB = rows[1];

          const homeRow = isHomeTeam(teamA) ? teamA : teamB;
          const awayRow = isHomeTeam(teamA) ? teamB : teamA;

          const homeTeamInfo = teamMap[homeRow.TeamID] || {
            id: homeRow.TeamID,
            abbreviation: homeRow.Team,
            full_name: homeRow.Team
          };

          const awayTeamInfo = teamMap[awayRow.TeamID] || {
            id: awayRow.TeamID,
            abbreviation: awayRow.Team,
            full_name: awayRow.Team
          };

          return {
            id: homeRow.GameID,
            date: homeRow.Day || homeRow.DateTime || homeRow.Date,
            status: "Final",

            home_team_score: getPoints(homeRow),
            visitor_team_score: getPoints(awayRow),

            home_team: homeTeamInfo,
            visitor_team: awayTeamInfo
          };
        })
        .filter(game =>
          Number(game.home_team.id) === Number(teamId) ||
          Number(game.visitor_team.id) === Number(teamId)
        )
        .filter(game =>
          Number(game.home_team_score) > 0 &&
          Number(game.visitor_team_score) > 0
        )
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      return res.status(200).json({ data: games });
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

function getPoints(row) {
  return Number(
    row.Points ??
    row.Score ??
    row.TeamScore ??
    row.TotalPoints ??
    0
  );
}

function isHomeTeam(row) {
  const value = String(row.HomeOrAway || row.HomeAway || "").toLowerCase();

  return (
    value === "home" ||
    value === "h" ||
    row.IsHome === true
  );
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

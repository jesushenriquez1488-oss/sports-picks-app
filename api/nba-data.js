const cache = global.__NBA_DATA_CACHE__ || {};
global.__NBA_DATA_CACHE__ = cache;

const CACHE_TIME = 30 * 60 * 1000; // 30 min
const TIMEOUT_MS = 10000;
const SEASON = 2025;

module.exports = async function handler(req, res) {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
    const { type, teamId } = req.query;

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(500).json({
        error: "BALLDONTLIE_API_KEY no configurada"
      });
    }

    if (!type) {
      return res.status(400).json({ error: "Falta type" });
    }

    // =========================
    // TEAMS
    // =========================
    if (type === "teams") {
      const teams = await getTeams();

      return res.status(200).json({ data: teams });
    }

    // =========================
    // GAMES (desde cache global)
    // =========================
    if (type === "games") {
      if (!teamId) {
        return res.status(400).json({ error: "Falta teamId" });
      }

      const allGames = await getAllSeasonGames();

      const filteredGames = allGames
        .filter(game =>
          Number(game.home_team?.id) === Number(teamId) ||
          Number(game.visitor_team?.id) === Number(teamId)
        )
        .filter(game =>
          Number(game.home_team_score || 0) > 0 &&
          Number(game.visitor_team_score || 0) > 0
        )
        .sort((a, b) => new Date(b.date) - new Date(a.date));

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

// =========================
// TEAMS
// =========================
async function getTeams() {
  const key = "teams";

  if (isCacheValid(key)) {
    return cache[key].data;
  }

  const data = await fetchBalldontlie(
    "https://api.balldontlie.io/v1/teams"
  );

  const teams = (data.data || []).map(team => ({
    id: team.id,
    abbreviation: team.abbreviation,
    city: team.city,
    name: team.name,
    full_name: team.full_name
  }));

  cache[key] = {
    data: teams,
    time: Date.now()
  };

  return teams;
}

// =========================
// ALL GAMES (UNA SOLA CARGA)
// =========================
async function getAllSeasonGames() {
  const key = `games-${SEASON}`;

  if (isCacheValid(key)) {
    return cache[key].data;
  }

  let allGames = [];
  let cursor = null;
  let pageCount = 0;

  do {
    let url = `https://api.balldontlie.io/v1/games?seasons[]=${SEASON}&per_page=100`;

    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const data = await fetchBalldontlie(url);

    const games = data.data || [];
    allGames = allGames.concat(games);

    cursor = data.meta?.next_cursor || null;
    pageCount++;

    if (pageCount > 20) break;

  } while (cursor);

  cache[key] = {
    data: allGames,
    time: Date.now()
  };

  return allGames;
}

// =========================
// HELPERS
// =========================
function isCacheValid(key) {
  return (
    cache[key] &&
    cache[key].data &&
    Date.now() - cache[key].time < CACHE_TIME
  );
}

async function fetchBalldontlie(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: process.env.BALLDONTLIE_API_KEY
      },
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`BallDontLie error ${response.status}: ${text}`);
    }

    return JSON.parse(text);

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Timeout BallDontLie");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

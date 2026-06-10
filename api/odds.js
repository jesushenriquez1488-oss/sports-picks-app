const oddsCache = global.__ODDS_CACHE__ || {};
global.__ODDS_CACHE__ = oddsCache;

const ODDS_CACHE_TIME = 10 * 60 * 1000;

module.exports = async function handler(req, res) {
res.setHeader("Access-Control-Allow-Origin", "https://cashedgeapp.com");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sport } = req.query;

    if (!sport) {
      return res.status(400).json({ error: "Falta sport" });
    }

    if (!process.env.ODDS_API_KEY) {
      return res.status(500).json({ error: "ODDS_API_KEY no configurada" });
    }

    const cacheKey = `odds-${sport}`;

    if (
      oddsCache[cacheKey] &&
      Date.now() - oddsCache[cacheKey].time < ODDS_CACHE_TIME
    ) {
      return res.status(200).json(oddsCache[cacheKey].data);
    }

    const isSoccer = sport.startsWith("soccer_");

    const isFootball =
      sport === "americanfootball_nfl" ||
      sport === "americanfootball_ncaaf";

    const markets = isSoccer
      ? "h2h,totals,spreads"
      : "h2h,spreads,totals";

    const regions = isFootball ? "us" : "us,eu";

    const url =
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/` +
      `?apiKey=${process.env.ODDS_API_KEY}` +
      `&regions=${regions}` +
      `&markets=${markets}` +
      `&oddsFormat=american`;

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error cargando odds",
        details: text,
        sport,
        markets
      });
    }

    const games = JSON.parse(text);

    const cleanGames = games.filter(game => {
      if (!game.bookmakers || game.bookmakers.length === 0) return false;

      if (isFootball) {
        return game.bookmakers.some(book =>
          book.markets?.some(market =>
            market.key === "spreads" || market.key === "totals"
          )
        );
      }

      return true;
    });

    oddsCache[cacheKey] = {
      data: cleanGames,
      time: Date.now()
    };

    return res.status(200).json(cleanGames);
  } catch (error) {
    console.error("ODDS ERROR:", error);
    return res.status(500).json({
      error: "Error interno cargando odds",
      details: error.message
    });
  }
};

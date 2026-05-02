module.exports = async function handler(req, res) {
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

    const isSoccer = sport.startsWith("soccer_");

    const markets = isSoccer
      ? "h2h,totals,spreads,btts"
      : "h2h,spreads,totals";

    const url =
      `https://api.the-odds-api.com/v4/sports/${sport}/odds/` +
      `?apiKey=${process.env.ODDS_API_KEY}` +
      `&regions=us,eu` +
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

    const cleanGames = games.map(game => {
      const bookmakers = game.bookmakers?.map(book => {
        const markets = book.markets?.map(market => {
          if (isSoccer && market.key === "totals") {
            return {
              ...market,
              outcomes: market.outcomes?.filter(outcome => {
                return Number(outcome.point) >= 2.5;
              })
            };
          }

          return market;
        }).filter(market => {
          if (isSoccer && market.key === "totals") {
            return market.outcomes && market.outcomes.length > 0;
          }

          return true;
        });

        return {
          ...book,
          markets
        };
      });

      return {
        ...game,
        bookmakers
      };
    });

    return res.status(200).json(cleanGames);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

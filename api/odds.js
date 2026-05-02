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

    const url =
      `https://api.the-odds-api.com/v4/sports/${sport}/odds/` +
      `?apiKey=${process.env.ODDS_API_KEY}` +
      `&regions=us,eu&markets=h2h,spreads,totals&oddsFormat=american`;

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error cargando odds",
        details: text
      });
    }

    return res.status(200).json(JSON.parse(text));

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

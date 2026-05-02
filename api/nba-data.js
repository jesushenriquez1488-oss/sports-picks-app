module.exports = async function handler(req, res) {
  try {
    const { type, teamId, teamName, league = "nba" } = req.query;

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(500).json({ error: "BALLDONTLIE_API_KEY no configurada" });
    }

    const headers = {
      Authorization: process.env.BALLDONTLIE_API_KEY
    };

    if (type === "teams") {
      const response = await fetch("https://api.balldontlie.io/v1/teams", {
        headers
      });

      const text = await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Error cargando equipos NBA",
          details: text
        });
      }

      return res.status(200).json(JSON.parse(text));
    }

    if (type === "games") {
      if (!teamId) {
        return res.status(400).json({ error: "Falta teamId" });
      }

      const response = await fetch(
        `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&seasons[]=2025&per_page=100`,
        { headers }
      );

      const text = await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Error cargando juegos NBA",
          details: text
        });
      }

      return res.status(200).json(JSON.parse(text));
    }

    return res.status(400).json({ error: "Tipo inválido" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

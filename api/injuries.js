export default async function handler(req, res) {
  try {
    const { team } = req.query;

    if (!team) {
      return res.status(400).json({ error: "Missing team parameter" });
    }

    const API_KEY = process.env.SPORTSDATAIO_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY NOT FOUND" });
    }

    const url = `https://api.sportsdata.io/v3/nba/scores/json/Players/${team}?key=${API_KEY}`;

    const response = await fetch(url);
    const players = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error loading NBA injuries",
        details: players
      });
    }

    const injuries = players
      .filter(player => {
        const status = String(player.InjuryStatus || "").toLowerCase();

        return (
          status &&
          status !== "healthy" &&
          status !== "scrambled"
        );
      })
      .map(player => ({
        name: `${player.FirstName} ${player.LastName}`,
        position: player.Position,
        status: player.InjuryStatus,
        startDate: player.InjuryStartDate || null,
        notes: player.InjuryNotes || ""
      }));

    return res.status(200).json({
      team,
      count: injuries.length,
      injuries
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}

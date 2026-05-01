export default async function handler(req, res) {
  try {
    const { team } = req.query;

    if (!team) {
      return res.status(400).json({ error: "Missing team parameter" });
    }

    const API_KEY = process.env.SPORTSDATAIO_KEY;

    const url = `https://api.sportsdata.io/v3/nba/scores/json/Injuries/${team}?key=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    return res.status(200).json({
      team,
      injuries: data || []
    });

  } catch (error) {
    return res.status(500).json({
      error: "Error fetching injuries",
      details: error.message
    });
  }
}

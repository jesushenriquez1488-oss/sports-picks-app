export default async function handler(req, res) {
  try {
    const { team } = req.query;

    const API_KEY = process.env.SPORTSDATAIO_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: "API KEY NOT FOUND"
      });
    }

    const url = `https://api.sportsdata.io/v3/nba/scores/json/Injuries/${team}?key=${API_KEY}`;

    const response = await fetch(url);
    const text = await response.text();

    return res.status(200).json({
      url,
      status: response.status,
      data: text
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}

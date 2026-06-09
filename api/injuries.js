export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
    const { team } = req.query;
    const TEAM_KEYS = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GS",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NO",
  "New York Knicks": "NY",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHO",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SA",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS"
};

const teamKey = TEAM_KEYS[team] || team;

    if (!team) {
      return res.status(400).json({ error: "Missing team parameter" });
    }

    const API_KEY = process.env.SPORTSDATAIO_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "API KEY NOT FOUND" });
    }

   const url = `https://api.sportsdata.io/v3/nba/scores/json/Players/${teamKey}?key=${API_KEY}`;
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://cashedgeapp.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { team } = req.query;

    if (!team) {
      return res.status(400).json({ error: "Missing team parameter" });
    }

    const normalize = (value = "") =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const TEAM_SLUGS = {
      "Atlanta Hawks": "atlanta-hawks",
      "Boston Celtics": "boston-celtics",
      "Brooklyn Nets": "brooklyn-nets",
      "Charlotte Hornets": "charlotte-hornets",
      "Chicago Bulls": "chicago-bulls",
      "Cleveland Cavaliers": "cleveland-cavaliers",
      "Dallas Mavericks": "dallas-mavericks",
      "Denver Nuggets": "denver-nuggets",
      "Detroit Pistons": "detroit-pistons",
      "Golden State Warriors": "golden-state-warriors",
      "Houston Rockets": "houston-rockets",
      "Indiana Pacers": "indiana-pacers",
      "Los Angeles Clippers": "la-clippers",
      "Los Angeles Lakers": "los-angeles-lakers",
      "Memphis Grizzlies": "memphis-grizzlies",
      "Miami Heat": "miami-heat",
      "Milwaukee Bucks": "milwaukee-bucks",
      "Minnesota Timberwolves": "minnesota-timberwolves",
      "New Orleans Pelicans": "new-orleans-pelicans",
      "New York Knicks": "new-york-knicks",
      "Oklahoma City Thunder": "oklahoma-city-thunder",
      "Orlando Magic": "orlando-magic",
      "Philadelphia 76ers": "philadelphia-76ers",
      "Phoenix Suns": "phoenix-suns",
      "Portland Trail Blazers": "portland-trail-blazers",
      "Sacramento Kings": "sacramento-kings",
      "San Antonio Spurs": "san-antonio-spurs",
      "Toronto Raptors": "toronto-raptors",
      "Utah Jazz": "utah-jazz",
      "Washington Wizards": "washington-wizards"
    };

    const teamSlug =
      TEAM_SLUGS[team] ||
      String(team)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const url = `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamSlug}/injuries`;

    const response = await fetch(url);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(200).json({
        team,
        count: 0,
        injuries: [],
        source: "espn",
        warning: "ESPN injuries unavailable"
      });
    }

    const rawInjuries =
      data?.injuries ||
      data?.team?.injuries ||
      data?.athletes ||
      [];

    const injuries = [];

    for (const item of rawInjuries) {
      const athlete = item.athlete || item;
      const name =
        athlete.displayName ||
        athlete.fullName ||
        item.displayName ||
        item.name;

      const status =
        item.status ||
        item.type ||
        item.description ||
        athlete.status ||
        "";

      const details =
        item.details ||
        item.detail ||
        item.description ||
        item.shortComment ||
        "";

      const position =
        athlete.position?.abbreviation ||
        athlete.position?.displayName ||
        item.position ||
        "";

      if (!name) continue;

      const statusText = String(status || details || "").toLowerCase();

      const isInjured =
        statusText.includes("out") ||
        statusText.includes("questionable") ||
        statusText.includes("doubtful") ||
        statusText.includes("probable") ||
        statusText.includes("day") ||
        statusText.includes("injury") ||
        statusText.includes("injured");

      if (!isInjured) continue;

      injuries.push({
        name,
        position,
        status: status || details || "Injury",
        startDate: null,
        notes: details || ""
      });
    }

    return res.status(200).json({
      team,
      count: injuries.length,
      injuries,
      source: "espn",
      rawCount: rawInjuries.length
    });

  } catch (error) {
    return res.status(200).json({
      team: req.query.team,
      count: 0,
      injuries: [],
      source: "espn",
      error: error.message
    });
  }
}

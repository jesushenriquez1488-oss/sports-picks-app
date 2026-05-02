export default async function handler(req, res) {
  try {
    const { type = "nba", team, homeTeam, awayTeam } = req.query;

    if (type === "soccer") {
      if (!homeTeam || !awayTeam) {
        return res.status(400).json({ error: "Missing homeTeam or awayTeam" });
      }

      const API_KEY = process.env.SOCCER_API_KEY;

      if (!API_KEY) {
        return res.status(500).json({ error: "SOCCER_API_KEY NOT FOUND" });
      }

      const headers = {
        "x-apisports-key": API_KEY
      };

      const LEAGUE_ID = 140; // La Liga
      const SEASON = 2025;   // Temporada 2025/26

      async function getTeamId(name) {
        const url = `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(name)}`;

        const response = await fetch(url, { headers });
        const data = await response.json();

        const results = data.response || [];

        const exact =
          results.find(item =>
            String(item.team?.name || "").toLowerCase() === String(name).toLowerCase()
          ) || results[0];

        return {
          id: exact?.team?.id || null,
          name: exact?.team?.name || null,
          country: exact?.team?.country || null,
          rawCount: results.length
        };
      }

      async function getLastMatches(teamId) {
  const urls = [
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&league=140&season=2025&last=5`,
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&league=140&season=2024&last=5`,
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&season=2025&last=5`,
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&season=2024&last=5`,
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`
  ];

  for (const url of urls) {
    const response = await fetch(url, { headers });
    const data = await response.json();

   console.log("SOCCER API URL:", url);
console.log("SOCCER API DATA:", JSON.stringify(data));

const matches = data.response || [];

if (matches.length > 0) {
  return matches;
}
  }

  return [];
}
      function analyzeMatches(matches, teamId) {
        let scored = 0;
        let conceded = 0;
        let wins = 0;
        let draws = 0;
        let losses = 0;
        let btts = 0;
        let over25 = 0;

        const completedMatches = matches.filter(match => {
          return (
            match.fixture?.status?.short === "FT" ||
            match.fixture?.status?.short === "AET" ||
            match.fixture?.status?.short === "PEN"
          );
        });

        completedMatches.forEach(match => {
          const isHome = match.teams.home.id === teamId;

          const goalsFor = isHome ? match.goals.home : match.goals.away;
          const goalsAgainst = isHome ? match.goals.away : match.goals.home;

          scored += Number(goalsFor || 0);
          conceded += Number(goalsAgainst || 0);

          if (goalsFor > goalsAgainst) wins++;
          else if (goalsFor === goalsAgainst) draws++;
          else losses++;

          if (goalsFor > 0 && goalsAgainst > 0) btts++;
          if ((Number(goalsFor || 0) + Number(goalsAgainst || 0)) >= 3) over25++;
        });

        const games = completedMatches.length;

        if (games === 0) {
          return {
            games: 0,
            avgScored: 0,
            avgConceded: 0,
            form: { wins: 0, draws: 0, losses: 0 },
            bttsRate: 0,
            over25Rate: 0
          };
        }

        return {
          games,
          avgScored: scored / games,
          avgConceded: conceded / games,
          form: { wins, draws, losses },
          bttsRate: (btts / games) * 100,
          over25Rate: (over25 / games) * 100
        };
      }

      const homeInfo = await getTeamId(homeTeam);
      const awayInfo = await getTeamId(awayTeam);

      if (!homeInfo.id || !awayInfo.id) {
        return res.status(404).json({
          error: "Soccer team not found",
          homeTeam,
          awayTeam,
          debug: {
            homeInfo,
            awayInfo,
            league: LEAGUE_ID,
            season: SEASON
          }
        });
      }

      const [homeMatches, awayMatches] = await Promise.all([
        getLastMatches(homeInfo.id),
        getLastMatches(awayInfo.id)
      ]);

      return res.status(200).json({
        homeTeam,
        awayTeam,
        homeInfo,
        awayInfo,
        league: LEAGUE_ID,
        season: SEASON,
        debug: {
          homeMatchesFound: homeMatches.length,
          awayMatchesFound: awayMatches.length,
          homeStatuses: homeMatches.map(m => m.fixture?.status?.short),
          awayStatuses: awayMatches.map(m => m.fixture?.status?.short)
        },
        home: analyzeMatches(homeMatches, homeInfo.id),
        away: analyzeMatches(awayMatches, awayInfo.id)
      });
    }

    // =========================
    // NBA INJURIES ORIGINAL
    // =========================
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
        status: player.InjuryStatus
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

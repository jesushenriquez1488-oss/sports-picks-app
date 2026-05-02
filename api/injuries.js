export default async function handler(req, res) {
  try {
    const { type = "nba", team, homeTeam, awayTeam } = req.query;

    // =========================
    // SOCCER DATA
    // =========================
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

      async function getTeamId(name) {
        const url = `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(name)}`;
        const response = await fetch(url, { headers });
        const data = await response.json();

        return data.response?.[0]?.team?.id || null;
      }

      async function getLastMatches(teamId) {
        const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&league=140&season=2025&last=5`;
        const response = await fetch(url, { headers });
        const data = await response.json();

        return data.response || [];
      }

      function analyzeMatches(matches, teamId) {
        let scored = 0;
        let conceded = 0;
        let wins = 0;
        let draws = 0;
        let losses = 0;
        let btts = 0;
        let over25 = 0;

        matches.forEach(match => {
          const isHome = match.teams.home.id === teamId;

          const goalsFor = isHome ? match.goals.home : match.goals.away;
          const goalsAgainst = isHome ? match.goals.away : match.goals.home;

          scored += goalsFor || 0;
          conceded += goalsAgainst || 0;

          if (goalsFor > goalsAgainst) wins++;
          else if (goalsFor === goalsAgainst) draws++;
          else losses++;

          if (goalsFor > 0 && goalsAgainst > 0) btts++;
          if ((goalsFor + goalsAgainst) >= 3) over25++;
        });

        const games = matches.length || 1;

        return {
          games,
          avgScored: scored / games,
          avgConceded: conceded / games,
          form: { wins, draws, losses },
          bttsRate: (btts / games) * 100,
          over25Rate: (over25 / games) * 100
        };
      }

      const homeId = await getTeamId(homeTeam);
      const awayId = await getTeamId(awayTeam);

      if (!homeId || !awayId) {
        return res.status(404).json({
          error: "Soccer team not found",
          homeTeam,
          awayTeam
        });
      }

      const [homeMatches, awayMatches] = await Promise.all([
        getLastMatches(homeId),
        getLastMatches(awayId)
      ]);

      return res.status(200).json({
        homeTeam,
        awayTeam,
        home: analyzeMatches(homeMatches, homeId),
        away: analyzeMatches(awayMatches, awayId)
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

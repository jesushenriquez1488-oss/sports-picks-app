export default async function handler(req, res) {
  try {
    const { homeTeam, awayTeam } = req.query;

    const API_KEY = process.env.SOCCER_API_KEY;

    const headers = {
      "x-apisports-key": API_KEY
    };

    // =========================
    // BUSCAR TEAM ID
    // =========================
    async function getTeamId(name) {
      const r = await fetch(`https://v3.football.api-sports.io/teams?search=${encodeURIComponent(name)}`, { headers });
      const d = await r.json();
      return d.response?.[0]?.team?.id;
    }

    const homeId = await getTeamId(homeTeam);
    const awayId = await getTeamId(awayTeam);

    // =========================
    // ÚLTIMOS PARTIDOS
    // =========================
    async function getLast(teamId) {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`, { headers });
      const d = await r.json();
      return d.response || [];
    }

    const homeMatches = await getLast(homeId);
    const awayMatches = await getLast(awayId);

    function calc(matches, teamId) {
      let scored = 0;
      let conceded = 0;

      matches.forEach(m => {
        const isHome = m.teams.home.id === teamId;

        scored += isHome ? m.goals.home : m.goals.away;
        conceded += isHome ? m.goals.away : m.goals.home;
      });

      return {
        avgScored: scored / matches.length,
        avgConceded: conceded / matches.length
      };
    }

    return res.json({
      home: calc(homeMatches, homeId),
      away: calc(awayMatches, awayId)
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

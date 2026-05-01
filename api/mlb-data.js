export default async function handler(req, res) {
  try {
    const { awayTeam, homeTeam } = req.body;

    const today = new Date().toISOString().split("T")[0];

    // ===============================
    // 1. BUSCAR JUEGO
    // ===============================
    const scheduleUrl =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team`;

    const scheduleRes = await fetch(scheduleUrl);
    const scheduleData = await scheduleRes.json();

    const games = scheduleData?.dates?.[0]?.games || [];

    const game = games.find(g =>
      normalize(g.teams.away.team.name) === normalize(awayTeam) &&
      normalize(g.teams.home.team.name) === normalize(homeTeam)
    );

    if (!game) {
      return res.status(404).json({ error: "Juego no encontrado" });
    }

    const awayPitcher = game.teams.away.probablePitcher;
    const homePitcher = game.teams.home.probablePitcher;

    // ===============================
    // 2. STATS PITCHER (ÚLTIMOS JUEGOS)
    // ===============================
    async function getPitcherStats(pitcherId) {
      if (!pitcherId) return null;

      const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&season=2026`;

      const res = await fetch(url);
      const data = await res.json();

      const splits = data?.stats?.[0]?.splits || [];

      const last5 = splits.slice(-5);

      if (last5.length === 0) return null;

      let innings = 0;
      let runs = 0;
      let hits = 0;
      let walks = 0;

      last5.forEach(g => {
        innings += parseFloat(g.stat.inningsPitched || 0);
        runs += parseFloat(g.stat.runs || 0);
        hits += parseFloat(g.stat.hits || 0);
        walks += parseFloat(g.stat.baseOnBalls || 0);
      });

      const era = (runs * 9) / Math.max(innings, 1);

      return {
        era,
        runsPerInning: runs / Math.max(innings, 1),
        hitsPerInning: hits / Math.max(innings, 1),
        walksPerInning: walks / Math.max(innings, 1),
        innings: innings / last5.length
      };
    }

    const awayPitcherStats = await getPitcherStats(awayPitcher?.id);
    const homePitcherStats = await getPitcherStats(homePitcher?.id);

    // ===============================
    // RESPUESTA
    // ===============================
    return res.status(200).json({
      gamePk: game.gamePk,
      away: {
        teamName: game.teams.away.team.name,
        pitcher: awayPitcher
          ? {
              id: awayPitcher.id,
              name: awayPitcher.fullName,
              stats: awayPitcherStats
            }
          : null
      },
      home: {
        teamName: game.teams.home.team.name,
        pitcher: homePitcher
          ? {
              id: homePitcher.id,
              name: homePitcher.fullName,
              stats: homePitcherStats
            }
          : null
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

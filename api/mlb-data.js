export default async function handler(req, res) {
  try {
    const { awayTeam, homeTeam } = req.body;

    const today = new Date().toISOString().split("T")[0];

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

    async function getTeamBattingLast5(teamId) {
      if (!teamId) return null;

      const url =
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&season=2026&hydrate=linescore`;

      const res = await fetch(url);
      const data = await res.json();

      const allGames = [];

      (data?.dates || []).forEach(dateObj => {
        (dateObj.games || []).forEach(g => {
          if (g.status?.detailedState === "Final") {
            allGames.push(g);
          }
        });
      });

      const last5 = allGames.slice(-5);

      if (last5.length === 0) return null;

      let runs = 0;
      let hits = 0;
      let walks = 0;
      let strikeouts = 0;
      let atBats = 0;

      last5.forEach(g => {
        const isAway = g.teams.away.team.id === teamId;
        const side = isAway ? "away" : "home";

        runs += Number(g.teams?.[side]?.score || 0);

        const teamStats = g.linescore?.teams?.[side] || {};

        hits += Number(teamStats.hits || 0);
        walks += Number(teamStats.baseOnBalls || 0);
        strikeouts += Number(teamStats.strikeOuts || 0);
        atBats += Number(teamStats.atBats || 0);
      });

      return {
        runs: runs / last5.length,
        hits: hits / last5.length,
        walks: walks / last5.length,
        avg: atBats > 0 ? hits / atBats : 0,
        k: strikeouts / last5.length
      };
    }

    const awayPitcherStats = await getPitcherStats(awayPitcher?.id);
    const homePitcherStats = await getPitcherStats(homePitcher?.id);

    const awayBatting = await getTeamBattingLast5(game.teams.away.team.id);
    const homeBatting = await getTeamBattingLast5(game.teams.home.team.id);

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
          : null,
        battingLast5: awayBatting
      },
      home: {
        teamName: game.teams.home.team.name,
        pitcher: homePitcher
          ? {
              id: homePitcher.id,
              name: homePitcher.fullName,
              stats: homePitcherStats
            }
          : null,
        battingLast5: homeBatting
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

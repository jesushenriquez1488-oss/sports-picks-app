export default async function handler(req, res) {
  try {
    const { awayTeam, homeTeam, gameDate } = req.body;

    const today = gameDate || new Date().toISOString().split("T")[0];

    const scheduleUrl =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team`;

    const scheduleResponse = await fetch(scheduleUrl);
    const scheduleData = await scheduleResponse.json();

    const games = scheduleData?.dates?.[0]?.games || [];

    const game = games.find(g =>
      normalize(g.teams.away.team.name) === normalize(awayTeam) &&
      normalize(g.teams.home.team.name) === normalize(homeTeam)
    );

    if (!game) {
      return res.status(404).json({
        error: "No se encontró el juego MLB",
        awayTeam,
        homeTeam,
        date: today
      });
    }

    const awayPitcher = game.teams.away.probablePitcher || null;
    const homePitcher = game.teams.home.probablePitcher || null;

    return res.status(200).json({
      gamePk: game.gamePk,
      away: {
        teamId: game.teams.away.team.id,
        teamName: game.teams.away.team.name,
        pitcher: awayPitcher
          ? {
              id: awayPitcher.id,
              name: awayPitcher.fullName
            }
          : null
      },
      home: {
        teamId: game.teams.home.team.id,
        teamName: game.teams.home.team.name,
        pitcher: homePitcher
          ? {
              id: homePitcher.id,
              name: homePitcher.fullName
            }
          : null
      },
      rawGameDate: game.gameDate
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

      let innings = 0, runs = 0, hits = 0, walks = 0;

      last5.forEach(g => {
        innings += parseIP(g.stat.inningsPitched);
        runs += Number(g.stat.runs || 0);
        hits += Number(g.stat.hits || 0);
        walks += Number(g.stat.baseOnBalls || 0);
      });

      return {
        era: (runs * 9) / Math.max(innings, 1),
        runsPerInning: runs / Math.max(innings, 1),
        runsPerGame: runs / last5.length,
        hitsPerInning: hits / Math.max(innings, 1),
        walksPerInning: walks / Math.max(innings, 1),
        innings: innings / last5.length
      };
    }

    async function getTeamRecentGames(teamId) {
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

      return allGames.slice(-5);
    }

    async function getTeamBattingLast5(teamId) {
      const last5 = await getTeamRecentGames(teamId);

      if (last5.length === 0) return null;

      let runs = 0;
      let runsAllowed = 0;
      let hits = 0;
      let walks = 0;
      let strikeouts = 0;
      let atBats = 0;

      last5.forEach(g => {
        const side = g.teams.away.team.id === teamId ? "away" : "home";
        const opponentSide = side === "away" ? "home" : "away";
        const teamStats = g.linescore?.teams?.[side] || {};

        runs += Number(g.teams?.[side]?.score || 0);
        runsAllowed += Number(g.teams?.[opponentSide]?.score || 0);

        hits += Number(teamStats.hits || 0);
        walks += Number(teamStats.baseOnBalls || 0);
        strikeouts += Number(teamStats.strikeOuts || 0);
        atBats += Number(teamStats.atBats || 0);
      });

      return {
        runs: runs / last5.length,
        runsAllowed: runsAllowed / last5.length,
        hits: hits / last5.length,
        walks: walks / last5.length,
        avg: atBats > 0 ? hits / atBats : 0,
        k: strikeouts / last5.length
      };
    }

    async function getBullpenLast5(teamId) {
      const last5 = await getTeamRecentGames(teamId);

      if (last5.length === 0) return null;

      let innings = 0, runs = 0, hits = 0, walks = 0;
      let bullpenAppearances = 0;

      for (const g of last5) {
        const side = g.teams.away.team.id === teamId ? "away" : "home";

        const boxUrl = `https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`;
        const boxRes = await fetch(boxUrl);
        const box = await boxRes.json();

        const teamBox = box.teams?.[side];
        const pitcherIds = teamBox?.pitchers || [];
        const bullpenPitchers = pitcherIds.slice(1);

        bullpenPitchers.forEach(id => {
          const player = teamBox.players?.[`ID${id}`];
          const p = player?.stats?.pitching;

          if (!p) return;

          bullpenAppearances++;
          innings += parseIP(p.inningsPitched);
          runs += Number(p.runs || 0);
          hits += Number(p.hits || 0);
          walks += Number(p.baseOnBalls || 0);
        });
      }

      if (innings === 0) return null;

      return {
        era: (runs * 9) / Math.max(innings, 1),
        runsPerInning: runs / Math.max(innings, 1),
        runsPerGame: runs / last5.length,
        hitsPerInning: hits / Math.max(innings, 1),
        walksPerInning: walks / Math.max(innings, 1),
        fatigue: Math.min(10, bullpenAppearances / 2)
      };
    }

    async function getWeather(gamePk) {
      try {
        const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const res = await fetch(url);
        const data = await res.json();

        const weather = data?.gameData?.weather || {};
        const windText = weather.wind || "";
        const temp = weather.temp || null;
        const condition = weather.condition || "";

        const speedMatch = windText.match(/(\d+)/);
        const speed = speedMatch ? Number(speedMatch[1]) : 0;

        let direction = "neutral";
        const w = windText.toLowerCase();

        if (w.includes("out") || w.includes("to cf") || w.includes("to lf") || w.includes("to rf")) {
          direction = "out";
        } else if (w.includes("in") || w.includes("from cf") || w.includes("from lf") || w.includes("from rf")) {
          direction = "in";
        } else if (w.includes("cross")) {
          direction = "cross";
        }

        return {
          speed,
          direction,
          temp,
          condition,
          raw: windText
        };
      } catch {
        return {
          speed: 0,
          direction: "neutral",
          temp: null,
          condition: "No disponible",
          raw: "No disponible"
        };
      }
    }

    const awayPitcherStats = await getPitcherStats(awayPitcher?.id);
    const homePitcherStats = await getPitcherStats(homePitcher?.id);

    const awayBatting = await getTeamBattingLast5(game.teams.away.team.id);
    const homeBatting = await getTeamBattingLast5(game.teams.home.team.id);

    const awayBullpen = await getBullpenLast5(game.teams.away.team.id);
    const homeBullpen = await getBullpenLast5(game.teams.home.team.id);

    const weather = await getWeather(game.gamePk);

    return res.status(200).json({
      gamePk: game.gamePk,
      weather,
      away: {
        teamName: game.teams.away.team.name,
        pitcher: awayPitcher
          ? {
              id: awayPitcher.id,
              name: awayPitcher.fullName,
              stats: awayPitcherStats
            }
          : null,
        battingLast5: awayBatting,
        bullpen: awayBullpen
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
        battingLast5: homeBatting,
        bullpen: homeBullpen
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

function parseIP(ip) {
  if (!ip) return 0;

  const value = String(ip);

  if (!value.includes(".")) return Number(value) || 0;

  const [whole, partial] = value.split(".");
  const outs = Number(partial || 0);

  return Number(whole || 0) + outs / 3;
}

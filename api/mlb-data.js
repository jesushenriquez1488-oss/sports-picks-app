const PARK_FACTORS = {
  "Coors Field": { factor: 1.18, roof: "open" },
  "Great American Ball Park": { factor: 1.08, roof: "open" },
  "Fenway Park": { factor: 1.06, roof: "open" },
  "Yankee Stadium": { factor: 1.04, roof: "open" },
  "Citizens Bank Park": { factor: 1.04, roof: "open" },
  "Wrigley Field": { factor: 1.03, roof: "open" },
  "Globe Life Field": { factor: 1.02, roof: "retractable" },
  "Chase Field": { factor: 1.02, roof: "retractable" },
  "Minute Maid Park": { factor: 1.01, roof: "retractable" },
  "Truist Park": { factor: 1.01, roof: "open" },
  "Oriole Park at Camden Yards": { factor: 1.00, roof: "open" },
  "Kauffman Stadium": { factor: 1.00, roof: "open" },
  "Angel Stadium": { factor: 1.00, roof: "open" },
  "Comerica Park": { factor: 0.99, roof: "open" },
  "Dodger Stadium": { factor: 0.99, roof: "open" },
  "Busch Stadium": { factor: 0.98, roof: "open" },
  "Progressive Field": { factor: 0.98, roof: "open" },
  "Nationals Park": { factor: 0.98, roof: "open" },
  "Target Field": { factor: 0.97, roof: "open" },
  "American Family Field": { factor: 0.97, roof: "retractable" },
  "Rogers Centre": { factor: 0.97, roof: "retractable" },
  "LoanDepot Park": { factor: 0.96, roof: "retractable" },
  "Citi Field": { factor: 0.96, roof: "open" },
  "PNC Park": { factor: 0.96, roof: "open" },
  "Guaranteed Rate Field": { factor: 0.96, roof: "open" },
  "Rate Field": { factor: 0.96, roof: "open" },
  "Tropicana Field": { factor: 0.95, roof: "dome" },
  "Oakland Coliseum": { factor: 0.94, roof: "open" },
  "Sutter Health Park": { factor: 0.98, roof: "open" },
  "T-Mobile Park": { factor: 0.93, roof: "retractable" },
  "Oracle Park": { factor: 0.92, roof: "open" },
  "Petco Park": { factor: 0.91, roof: "open" }
};

export default async function handler(req, res) {
  try {
    const { awayTeam, homeTeam } = req.body;
    const today = new Date().toISOString().split("T")[0];

    const scheduleUrl =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,venue`;

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
    const venueName = game.venue?.name || "Unknown Stadium";
    const parkInfo = PARK_FACTORS[venueName] || { factor: 1.00, roof: "unknown" };

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
        games: last5.length,
        era: (runs * 9) / Math.max(innings, 1),
        runsPerInning: runs / Math.max(innings, 1),
        runsPerGame: runs / last5.length,
        hitsPerInning: hits / Math.max(innings, 1),
        walksPerInning: walks / Math.max(innings, 1),
        innings: innings / last5.length
      };
    }

    async function getTeamRecentGames(teamId, limit = 7) {
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

      return allGames.slice(-limit);
    }

    async function getTeamBattingLast7(teamId) {
      const last7 = await getTeamRecentGames(teamId, 7);

      if (last7.length === 0) return null;

      let runs = 0, runsAllowed = 0, hits = 0, walks = 0, strikeouts = 0, atBats = 0;

      last7.forEach(g => {
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
        games: last7.length,
        runs: runs / last7.length,
        runsAllowed: runsAllowed / last7.length,
        hits: hits / last7.length,
        walks: walks / last7.length,
        avg: atBats > 0 ? hits / atBats : 0,
        k: strikeouts / last7.length
      };
    }

    async function getBullpenLast7(teamId) {
      const last7 = await getTeamRecentGames(teamId, 7);

      if (last7.length === 0) return null;

      let innings = 0, runs = 0, hits = 0, walks = 0;
      let bullpenAppearances = 0;

      for (const g of last7) {
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
        games: last7.length,
        era: (runs * 9) / Math.max(innings, 1),
        runsPerInning: runs / Math.max(innings, 1),
        runsPerGame: runs / last7.length,
        hitsPerInning: hits / Math.max(innings, 1),
        walksPerInning: walks / Math.max(innings, 1),
        fatigue: Math.min(10, bullpenAppearances / 2)
      };
    }

    async function getWeather(gamePk, roofType) {
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

        const weatherActive = roofType !== "dome";

        return {
          speed: weatherActive ? speed : 0,
          direction: weatherActive ? direction : "neutral",
          temp: temp ? Number(temp) : null,
          condition,
          raw: roofType === "dome" ? "Dome / clima neutralizado" : windText,
          active: weatherActive
        };
      } catch {
        return {
          speed: 0,
          direction: "neutral",
          temp: null,
          condition: "No disponible",
          raw: "No disponible",
          active: false
        };
      }
    }

    const awayPitcherStats = await getPitcherStats(awayPitcher?.id);
    const homePitcherStats = await getPitcherStats(homePitcher?.id);

    const awayBatting = await getTeamBattingLast7(game.teams.away.team.id);
    const homeBatting = await getTeamBattingLast7(game.teams.home.team.id);

    const awayBullpen = await getBullpenLast7(game.teams.away.team.id);
    const homeBullpen = await getBullpenLast7(game.teams.home.team.id);

    const weather = await getWeather(game.gamePk, parkInfo.roof);

    return res.status(200).json({
      gamePk: game.gamePk,
      venue: {
        name: venueName,
        parkFactor: parkInfo.factor,
        roof: parkInfo.roof
      },
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
        battingLast7: awayBatting,
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
        battingLast7: homeBatting,
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

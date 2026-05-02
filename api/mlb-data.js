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

   const game = games.find(g => {
  const awayName = normalize(g.teams.away.team.name);
  const homeName = normalize(g.teams.home.team.name);

  const inputAway = normalize(awayTeam);
  const inputHome = normalize(homeTeam);

  return (
    (awayName.includes(inputAway) || inputAway.includes(awayName)) &&
    (homeName.includes(inputHome) || inputHome.includes(homeName))
  );
});

  if (!game) {
  console.log("❌ GAME NOT FOUND:", awayTeam, "vs", homeTeam);

  return res.status(404).json({
    error: "Juego no encontrado",
    debug: {
      input: { awayTeam, homeTeam },
      availableGames: games.map(g => ({
        away: g.teams.away.team.name,
        home: g.teams.home.team.name
      }))
    }
  });
}

    const awayPitcher = game.teams.away.probablePitcher;
    const homePitcher = game.teams.home.probablePitcher;

    const venueName = game.venue?.name || "Unknown Stadium";
    const parkInfo = PARK_FACTORS[venueName] || { factor: 1.00, roof: "unknown" };

    async function getPitcherStats(pitcherId) {
      if (!pitcherId) return null;

      const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&season=2026`;
      const response = await fetch(url);
      const data = await response.json();

      const splits = data?.stats?.[0]?.splits || [];
      const last5 = splits.slice(-5);

      if (last5.length === 0) return null;

      let innings = 0;
      let runs = 0;
      let earnedRuns = 0;
      let hits = 0;
      let walks = 0;
      let strikeouts = 0;
      let homeRuns = 0;

      last5.forEach(g => {
        const stat = g.stat || {};

        innings += parseIP(stat.inningsPitched);
        runs += Number(stat.runs || 0);
        earnedRuns += Number(stat.earnedRuns || stat.runs || 0);
        hits += Number(stat.hits || 0);
        walks += Number(stat.baseOnBalls || 0);
        strikeouts += Number(stat.strikeOuts || 0);
        homeRuns += Number(stat.homeRuns || 0);
      });

      const safeInnings = Math.max(innings, 1);
      const games = last5.length;

      return {
        games,
        innings: innings / games,
        totalInnings: innings,
        runs,
        hits,
        walks,
        strikeouts,
        homeRuns,
        era: (earnedRuns * 9) / safeInnings,
        runsPerInning: runs / safeInnings,
        runsPerGame: runs / games,
        hitsPerInning: hits / safeInnings,
        walksPerInning: walks / safeInnings,
        strikeoutsPerInning: strikeouts / safeInnings,
        homeRunsPerInning: homeRuns / safeInnings,
        whip: (hits + walks) / safeInnings
      };
    }

    async function getTeamRecentGames(teamId, limit = 10) {
      const url =
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&season=2026&hydrate=linescore`;

      const response = await fetch(url);
      const data = await response.json();

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

    function summarizeTeamGames(games, teamId) {
      if (!games || games.length === 0) return null;

      let runs = 0;
      let runsAllowed = 0;
      let hits = 0;
      let walks = 0;
      let strikeouts = 0;
      let atBats = 0;

      games.forEach(g => {
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
        games: games.length,
        runs: runs / games.length,
        runsAllowed: runsAllowed / games.length,
        hits: hits / games.length,
        walks: walks / games.length,
        k: strikeouts / games.length,
        avg: atBats > 0 ? hits / atBats : 0
      };
    }

    async function getTeamBattingProfile(teamId, expectedSide) {
      const last10 = await getTeamRecentGames(teamId, 10);

      if (last10.length === 0) return null;

      const last7 = last10.slice(-7);
      const last5 = last10.slice(-5);
      const last3 = last10.slice(-3);

      const sideGames = last10.filter(g => {
        const side = g.teams.away.team.id === teamId ? "away" : "home";
        return side === expectedSide;
      }).slice(-5);

      const profile = summarizeTeamGames(last7, teamId);
      const profile5 = summarizeTeamGames(last5, teamId);
      const profile3 = summarizeTeamGames(last3, teamId);
      const splitProfile = summarizeTeamGames(sideGames, teamId);

      if (!profile) return null;

      return {
        ...profile,
        last5: profile5,
        last3: profile3,
        split: splitProfile,
        expectedSide,
        weightedRuns:
          (profile3?.runs || profile.runs) * 0.45 +
          (profile5?.runs || profile.runs) * 0.30 +
          profile.runs * 0.25,
        weightedRunsAllowed:
          (profile3?.runsAllowed || profile.runsAllowed) * 0.45 +
          (profile5?.runsAllowed || profile.runsAllowed) * 0.30 +
          profile.runsAllowed * 0.25,
        splitRuns: splitProfile?.runs || profile.runs,
        splitRunsAllowed: splitProfile?.runsAllowed || profile.runsAllowed
      };
    }

    async function getBullpenProfile(teamId) {
      const last10 = await getTeamRecentGames(teamId, 10);

      if (last10.length === 0) return null;

      const last7 = last10.slice(-7);
      const last3 = last10.slice(-3);

      async function summarizeBullpen(games) {
        let innings = 0;
        let runs = 0;
        let hits = 0;
        let walks = 0;
        let strikeouts = 0;
        let appearances = 0;

        for (const g of games) {
          const side = g.teams.away.team.id === teamId ? "away" : "home";

          const boxUrl = `https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`;
          const boxResponse = await fetch(boxUrl);
          const box = await boxResponse.json();

          const teamBox = box.teams?.[side];
          const pitcherIds = teamBox?.pitchers || [];

          const bullpenPitchers = pitcherIds.slice(1);

          bullpenPitchers.forEach(id => {
            const player = teamBox.players?.[`ID${id}`];
            const pitching = player?.stats?.pitching;

            if (!pitching) return;

            appearances++;
            innings += parseIP(pitching.inningsPitched);
            runs += Number(pitching.runs || 0);
            hits += Number(pitching.hits || 0);
            walks += Number(pitching.baseOnBalls || 0);
            strikeouts += Number(pitching.strikeOuts || 0);
          });
        }

        if (innings === 0) return null;

        return {
          games: games.length,
          innings,
          runs,
          hits,
          walks,
          strikeouts,
          appearances,
          era: (runs * 9) / Math.max(innings, 1),
          runsPerInning: runs / Math.max(innings, 1),
          runsPerGame: runs / games.length,
          hitsPerInning: hits / Math.max(innings, 1),
          walksPerInning: walks / Math.max(innings, 1),
          strikeoutsPerInning: strikeouts / Math.max(innings, 1),
          whip: (hits + walks) / Math.max(innings, 1)
        };
      }

      const bullpen7 = await summarizeBullpen(last7);
      const bullpen3 = await summarizeBullpen(last3);

      if (!bullpen7 && !bullpen3) return null;

      const recent = bullpen3 || bullpen7;
      const base = bullpen7 || bullpen3;

      const fatigue =
        Math.min(
          10,
          (recent.appearances || 0) * 0.9 +
          (recent.innings || 0) * 0.65 +
          (recent.walks || 0) * 0.25
        );

      return {
        games: base.games,
        era: base.era,
        runsPerInning: base.runsPerInning,
        runsPerGame: base.runsPerGame,
        hitsPerInning: base.hitsPerInning,
        walksPerInning: base.walksPerInning,
        strikeoutsPerInning: base.strikeoutsPerInning,
        whip: base.whip,
        fatigue,
        last3: bullpen3,
        last7: bullpen7
      };
    }

    async function getWeather(gamePk, roofType) {
      try {
        const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const response = await fetch(url);
        const data = await response.json();

        const weather = data?.gameData?.weather || {};
        const windText = weather.wind || "";
        const temp = weather.temp || null;
        const condition = weather.condition || "";

        const speedMatch = windText.match(/(\d+)/);
        const speed = speedMatch ? Number(speedMatch[1]) : 0;

        let direction = "neutral";
        const wind = windText.toLowerCase();

        if (
          wind.includes("out") ||
          wind.includes("to cf") ||
          wind.includes("to lf") ||
          wind.includes("to rf")
        ) {
          direction = "out";
        } else if (
          wind.includes("in") ||
          wind.includes("from cf") ||
          wind.includes("from lf") ||
          wind.includes("from rf")
        ) {
          direction = "in";
        } else if (wind.includes("cross")) {
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

    const awayBatting = await getTeamBattingProfile(
      game.teams.away.team.id,
      "away"
    );

    const homeBatting = await getTeamBattingProfile(
      game.teams.home.team.id,
      "home"
    );

    const awayBullpen = await getBullpenProfile(game.teams.away.team.id);
    const homeBullpen = await getBullpenProfile(game.teams.home.team.id);

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
        battingLast5: awayBatting?.last5 || awayBatting,
        battingLast7: awayBatting,
        battingProfile: awayBatting,
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
        battingLast5: homeBatting?.last5 || homeBatting,
        battingLast7: homeBatting,
        battingProfile: homeBatting,
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

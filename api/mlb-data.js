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
  "loanDepot park": { factor: 0.96, roof: "retractable" },
  "Citi Field": { factor: 0.96, roof: "open" },
  "PNC Park": { factor: 0.96, roof: "open" },
  "Guaranteed Rate Field": { factor: 0.96, roof: "open" },
  "Rate Field": { factor: 0.96, roof: "open" },
  "Tropicana Field": { factor: 0.95, roof: "dome" },
  "Oakland Coliseum": { factor: 0.94, roof: "open" },
  "Sutter Health Park": { factor: 0.98, roof: "open" },
  "T-Mobile Park": { factor: 0.93, roof: "retractable" },
  "Oracle Park": { factor: 0.92, roof: "open" },
  "Petco Park": { factor: 0.91, roof: "open" },
  "Las Vegas Ballpark": { factor: 1.08, roof: "open" },
};
const STADIUM_COORDS = {
  "Coors Field": { lat: 39.7559, lon: -104.9942 },
  "Great American Ball Park": { lat: 39.0974, lon: -84.5066 },
  "Fenway Park": { lat: 42.3467, lon: -71.0972 },
  "Yankee Stadium": { lat: 40.8296, lon: -73.9262 },
  "Citizens Bank Park": { lat: 39.9061, lon: -75.1665 },
  "Wrigley Field": { lat: 41.9484, lon: -87.6553 },
  "Globe Life Field": { lat: 32.7473, lon: -97.0842 },
  "Chase Field": { lat: 33.4455, lon: -112.0667 },
  "Minute Maid Park": { lat: 29.7573, lon: -95.3555 },
  "Truist Park": { lat: 33.8908, lon: -84.4678 },
  "Oriole Park at Camden Yards": { lat: 39.2840, lon: -76.6217 },
  "Kauffman Stadium": { lat: 39.0517, lon: -94.4803 },
  "Angel Stadium": { lat: 33.8003, lon: -117.8827 },
  "Comerica Park": { lat: 42.3390, lon: -83.0485 },
  "Dodger Stadium": { lat: 34.0739, lon: -118.2400 },
  "Busch Stadium": { lat: 38.6226, lon: -90.1928 },
  "Progressive Field": { lat: 41.4962, lon: -81.6852 },
  "Nationals Park": { lat: 38.8730, lon: -77.0074 },
  "Target Field": { lat: 44.9817, lon: -93.2776 },
  "American Family Field": { lat: 43.0280, lon: -87.9712 },
  "Rogers Centre": { lat: 43.6414, lon: -79.3894 },
  "loanDepot park": { lat: 25.7781, lon: -80.2197 },
  "Citi Field": { lat: 40.7571, lon: -73.8458 },
  "PNC Park": { lat: 40.4469, lon: -80.0057 },
  "Guaranteed Rate Field": { lat: 41.8300, lon: -87.6339 },
  "Rate Field": { lat: 41.8300, lon: -87.6339 },
  "Tropicana Field": { lat: 27.7682, lon: -82.6534 },
  "Sutter Health Park": { lat: 38.5804, lon: -121.5133 },
  "T-Mobile Park": { lat: 47.5914, lon: -122.3325 },
  "Oracle Park": { lat: 37.7786, lon: -122.3893 },
  "Petco Park": { lat: 32.7073, lon: -117.1573 },
  "Las Vegas Ballpark": { lat: 36.1597, lon: -115.3200 },
};
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
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
const gameStatus = String(
  game?.status?.detailedState || ""
).toLowerCase();

const isPregame =
  gameStatus.includes("scheduled") ||
  gameStatus.includes("pre-game") ||
  gameStatus.includes("preview");

if (!isPregame) {
  return res.status(400).json({
    error: "Juego ya iniciado o no disponible para pregame",
    gameStatus
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
        runsPerGame: (runs * 9) / safeInnings,
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
          ra9: (runs * 9) / Math.max(innings, 1),
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

      const recentInnings = Number(recent.innings || 0);
const recentAppearances = Number(recent.appearances || 0);
const recentWalks = Number(recent.walks || 0);
const recentRuns = Number(recent.runs || 0);

let fatigue =
  recentInnings * 1.00 +
  recentAppearances * 0.25;

// Penaliza bullpens muy usados en los últimos 3 juegos
if (recentInnings >= 12) fatigue += 2.0;
else if (recentInnings >= 10) fatigue += 1.4;
else if (recentInnings >= 8) fatigue += 0.8;

// Penaliza demasiadas apariciones
if (recentAppearances >= 12) fatigue += 1.2;
else if (recentAppearances >= 9) fatigue += 0.7;

// Bullpen fresco
if (recentInnings <= 5 && recentAppearances <= 7) fatigue -= 1.0;
if (recentInnings <= 3.5) fatigue -= 0.8;

fatigue = Math.max(0, Number(fatigue.toFixed(2)));
const bullpenLast7RunsPerGame = Number(base.runsPerGame || 0);
const bullpenLast7RA9 = Number(base.ra9 || base.era || 0);
const bullpenLast3RA9 = Number(recent.ra9 || recent.era || bullpenLast7RA9);

let bullpenScore =
  bullpenLast7RunsPerGame * 0.45 +
  bullpenLast7RA9 * 0.30 +
  bullpenLast3RA9 * 0.25;

bullpenScore = Math.max(2.0, Math.min(7.5, bullpenScore));
     return {
  games: base.games,
  era: base.era,
  ra9: base.ra9,
  runsPerInning: base.runsPerInning,
  runsPerGame: bullpenScore,
  rawRunsPerGame: base.runsPerGame,
  hitsPerInning: base.hitsPerInning,
  walksPerInning: base.walksPerInning,
  strikeoutsPerInning: base.strikeoutsPerInning,
  whip: base.whip,
  fatigue,
  last3: bullpen3,
  last7: bullpen7
};
    }
async function getWeather(venueName, roofType, gameDate) {
  try {
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;

    if (!apiKey) {
      return {
        speed: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        condition: "API key no configurada",
        raw: "VISUAL_CROSSING_API_KEY missing",
        active: false,
        source: "visual_crossing"
      };
    }

    if (roofType === "dome") {
      return {
        speed: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        condition: "Dome",
        raw: "Dome / clima neutralizado",
        active: false,
        source: "visual_crossing"
      };
    }

    const coords = STADIUM_COORDS[venueName];

    if (!coords) {
      return {
        speed: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        condition: "Coordenadas no encontradas",
        raw: `No coords for ${venueName}`,
        active: false,
        source: "visual_crossing"
      };
    }

    const date = gameDate || new Date().toISOString().split("T")[0];

    const url =
      `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/` +
      `${coords.lat},${coords.lon}/${date}?unitGroup=us&include=hours,current&key=${apiKey}&contentType=json`;

    const response = await fetch(url);
    const data = await response.json();

    const current = data?.currentConditions || {};
    const day = data?.days?.[0] || {};
    const hours = day?.hours || [];

    const targetHour =
      hours.find(h => Number(h.datetime?.split(":")?.[0]) >= 18) ||
      hours.find(h => Number(h.datetime?.split(":")?.[0]) >= 15) ||
      current ||
      day;

    const windSpeed = Number(targetHour?.windspeed || current?.windspeed || day?.windspeed || 0);
    const windDir = Number(targetHour?.winddir || current?.winddir || day?.winddir || 0);
    const temp = Number(targetHour?.temp || current?.temp || day?.temp || 0);
    const humidity = Number(targetHour?.humidity || current?.humidity || day?.humidity || 0);
    const condition = targetHour?.conditions || current?.conditions || day?.conditions || "No disponible";

  const direction = classifyWindDirectionForStadium(venueName, windDir);
    const roofClosedLikely =
      roofType === "retractable" &&
      (
        temp >= 90 ||
        temp <= 45 ||
        String(condition).toLowerCase().includes("rain") ||
        String(condition).toLowerCase().includes("storm")
      );

    return {
  venue: venueName,
  gameDate: date,
  gameTime: gameDate,
  coordinates: coords,
  speed: roofClosedLikely ? 0 : windSpeed,
  direction: roofClosedLikely ? "neutral" : direction,
  degrees: windDir,
  temp,
  humidity,
  condition,
  rawHour: targetHour?.datetime || null,
  raw: roofClosedLikely
    ? `Retractable roof likely closed: ${condition}, ${temp}F`
    : `${windSpeed} mph, ${windDir} degrees, ${condition}`,
  active: !roofClosedLikely,
  source: "visual_crossing",
  weatherSource: "Visual Crossing"
};
  } catch (error) {
    return {
      speed: 0,
      direction: "neutral",
      temp: null,
      humidity: null,
      condition: "No disponible",
      raw: error.message,
      active: false,
      source: "visual_crossing"
    };
  }
}
const STADIUM_AZIMUTH = {
  "Oakland Coliseum": 55,
  "PNC Park": 116,
  "Petco Park": 0,
  "T-Mobile Park": 49,
  "Oracle Park": 25,
  "Busch Stadium": 62,
  "Tropicana Field": 359,
  "Globe Life Field": 30,
  "Rogers Centre": 345,
  "Target Field": 129,
  "Citizens Bank Park": 9,
  "Truist Park": 145,
  "Guaranteed Rate Field": 127,
  "loanDepot park": 128,
  "Yankee Stadium": 75,
  "American Family Field": 129,
  "Angel Stadium": 43.61,
  "Chase Field": 0,
  "Oriole Park at Camden Yards": 31,
  "Fenway Park": 45,
  "Wrigley Field": 37,
  "Great American Ball Park": 122,
  "Progressive Field": 0,
  "Coors Field": 4,
  "Comerica Park": 150,
  "Minute Maid Park": 343,
  "Kauffman Stadium": 46,
  "Dodger Stadium": 26,
  "Nationals Park": 28,
  "Citi Field": 13,
 "Las Vegas Ballpark": 39,
};
function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function classifyWindDirectionForStadium(venueName, degrees) {
  if (
    degrees === null ||
    degrees === undefined ||
    Number.isNaN(Number(degrees))
  ) {
    return "neutral";
  }

  const stadiumAzimuth = STADIUM_AZIMUTH[venueName];

  if (stadiumAzimuth === null || stadiumAzimuth === undefined) {
    return "neutral";
  }

  const windFrom = Number(degrees);

  // Visual Crossing = de donde viene el viento
  const windTo = (windFrom + 180) % 360;

  const outDiff = angleDiff(windTo, stadiumAzimuth);
  const inDiff = angleDiff(windTo, (stadiumAzimuth + 180) % 360);

  if (outDiff <= 45) return "out";
  if (inDiff <= 45) return "in";

  return "cross";
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

    const weather = await getWeather(venueName, parkInfo.roof, game.gameDate);
    console.log("🌦️ MLB WEATHER DEBUG", {
  game: `${game.teams.away.team.name} @ ${game.teams.home.team.name}`,
  venueName,
  gameDate: game.gameDate,
  parkFactor: parkInfo.factor,
  roof: parkInfo.roof,
  weather
});
    return res.status(200).json({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
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

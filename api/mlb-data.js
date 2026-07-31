const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        }
      )
    : null;

const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;

function buildWeatherCacheKey(venueName, gameDate) {
  const parsedDate = new Date(gameDate);

  const gameTime = Number.isNaN(parsedDate.getTime())
    ? String(gameDate || "")
    : parsedDate.toISOString();

  return `${String(venueName || "").trim().toLowerCase()}|${gameTime}`;
}

async function readWeatherCache(cacheKey, allowExpired = false) {
  if (!supabaseAdmin) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from("mlb_weather_cache")
      .select("weather, fetched_at, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error) {
      console.warn("WEATHER CACHE READ ERROR:", error.message);
      return null;
    }

    if (!data?.weather) return null;

    const isExpired =
      new Date(data.expires_at).getTime() <= Date.now();

    if (isExpired && !allowExpired) {
      return null;
    }

    return {
      ...data.weather,
      cacheStatus: isExpired ? "stale" : "fresh",
      cacheFetchedAt: data.fetched_at
    };

  } catch (error) {
    console.warn("WEATHER CACHE READ FAILED:", error.message);
    return null;
  }
}

async function saveWeatherCache(
  cacheKey,
  venueName,
  gameDate,
  weather
) {
  if (!supabaseAdmin || !weather) return;

  try {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + WEATHER_CACHE_TTL_MS
    );

    const parsedGameDate = new Date(gameDate);

    const gameTime = Number.isNaN(parsedGameDate.getTime())
      ? now.toISOString()
      : parsedGameDate.toISOString();

    const { error } = await supabaseAdmin
      .from("mlb_weather_cache")
      .upsert(
        {
          cache_key: cacheKey,
          venue_name: venueName,
          game_time: gameTime,
          weather,
          fetched_at: now.toISOString(),
          expires_at: expiresAt.toISOString()
        },
        {
          onConflict: "cache_key"
        }
      );

    if (error) {
      console.warn("WEATHER CACHE SAVE ERROR:", error.message);
    }

  } catch (error) {
    console.warn("WEATHER CACHE SAVE FAILED:", error.message);
  }
}

const PARK_FACTORS = {
  "Coors Field": {
    factor: 1.33,
    roof: "open"
  },

  "Great American Ball Park": {
    factor: 1.09,
    roof: "open"
  },

  "Fenway Park": {
    factor: 1.09,
    roof: "open"
  },

  "Yankee Stadium": {
    factor: 1.04,
    roof: "open"
  },

  "Citizens Bank Park": {
    factor: 1.05,
    roof: "open"
  },

  "Wrigley Field": {
    factor: 0.94,
    roof: "open"
  },

  "Globe Life Field": {
    factor: 0.93,
    roof: "retractable"
  },

  "Chase Field": {
    factor: 1.02,
    roof: "retractable"
  },

  /*
   * Es el mismo estadio.
   * Se incluyen ambos nombres por compatibilidad.
   */
  "Daikin Park": {
    factor: 0.95,
    roof: "retractable"
  },

  "Minute Maid Park": {
    factor: 0.95,
    roof: "retractable"
  },
  
"Daikin Park": {
  factor: 0.95,
  roof: "retractable"
},
  "Truist Park": {
    factor: 0.97,
    roof: "open"
  },

  "Oriole Park at Camden Yards": {
    factor: 1.05,
    roof: "open"
  },

  "Oriole Park": {
    factor: 1.05,
    roof: "open"
  },

  "Kauffman Stadium": {
    factor: 1.00,
    roof: "open"
  },

  /*
   *varió entre -4% y +2%.
   * Usamos -4%, que apareció más veces.
   */
  "Angel Stadium": {
    factor: 0.96,
    roof: "open"
  },

  "Comerica Park": {
    factor: 0.99,
    roof: "open"
  },

  "Dodger Stadium": {
    factor: 1.00,
    roof: "open"
  },

  "UNIQLO Field at Dodger Stadium": {
    factor: 1.00,
    roof: "open"
  },

  /*
   * Las capturas variaron entre -6% y -7%.
   * Usamos -6%, que fue el más repetido.
   */
  "Busch Stadium": {
    factor: 0.94,
    roof: "open"
  },

  "Progressive Field": {
    factor: 0.99,
    roof: "open"
  },

  "Nationals Park": {
    factor: 1.03,
    roof: "open"
  },

  "Target Field": {
    factor: 1.00,
    roof: "open"
  },

  "American Family Field": {
    factor: 0.97,
    roof: "retractable"
  },

  "Rogers Centre": {
    factor: 0.98,
    roof: "retractable"
  },

  /*
   * Las capturas variaron entre -4% y -5%.
   * Usamos -5% como base conservadora.
   */
  "loanDepot park": {
    factor: 0.95,
    roof: "retractable"
  },

  "Citi Field": {
    factor: 0.92,
    roof: "open"
  },

  "PNC Park": {
    factor: 0.99,
    roof: "open"
  },

  /*
   *varió entre aproximadamente
   * -3%, 0% y +1%. Usamos el centro: neutral.
   */
  "Guaranteed Rate Field": {
    factor: 1.00,
    roof: "open"
  },

  "Rate Field": {
    factor: 1.00,
    roof: "open"
  },

  "Tropicana Field": {
    factor: 0.94,
    roof: "dome"
  },

  /*
   * No apareció en las nuevas capturas.
   * Se conserva el valor existente.
   */
  "Oakland Coliseum": {
    factor: 0.94,
    roof: "open"
  },

  /*
   * Las capturas mostraron +20% y +21%.
   * El valor central actualizado es +21%.
   */
  "Sutter Health Park": {
    factor: 1.21,
    roof: "open"
  },

  "T-Mobile Park": {
    factor: 0.92,
    roof: "retractable"
  },

  /*
   *varió entre -1% y +2%.
   * Se utiliza neutral como base estable.
   */
  "Oracle Park": {
    factor: 1.00,
    roof: "open"
  },

  /*
   * Las capturas mostraron principalmente -8%,
   * con alguna aparición de -7%.
   */
  "Petco Park": {
    factor: 0.92,
    roof: "open"
  },

  /*
   * No apareció en las nuevas capturas.
   * Se conserva el valor existente.
   */
  "Las Vegas Ballpark": {
    factor: 1.08,
    roof: "open"
  }
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
  "Daikin Park": {lat: 29.7573, lon: -95.3555},
  "Truist Park": { lat: 33.8908, lon: -84.4678 },
  "Oriole Park at Camden Yards": { lat: 39.2840, lon: -76.6217 },
  "Kauffman Stadium": { lat: 39.0517, lon: -94.4803 },
  "Angel Stadium": { lat: 33.8003, lon: -117.8827 },
  "Comerica Park": { lat: 42.3390, lon: -83.0485 },
  "Dodger Stadium": { lat: 34.0739, lon: -118.2400 },
  "UNIQLO Field at Dodger Stadium": { lat: 34.0739, lon: -118.2400 },
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
module.exports = async function handler(req, res) {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
const { awayTeam, homeTeam, gameTime, eventId } = req.body;
const gameDate = gameTime ? new Date(gameTime) : new Date();
const todayUTC = gameDate.toISOString().split("T")[0];
const todayLocal = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric", month: "2-digit", day: "2-digit"
}).format(gameDate);

const today = todayLocal;
   const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayUTC}&hydrate=probablePitcher,team,venue`;
const scheduleUrl2 = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayLocal}&hydrate=probablePitcher,team,venue`;

const [scheduleRes, scheduleRes2] = await Promise.all([fetch(scheduleUrl), fetch(scheduleUrl2)]);
const [scheduleData, scheduleData2] = await Promise.all([scheduleRes.json(), scheduleRes2.json()]);

const gamesUTC = scheduleData?.dates?.[0]?.games || [];
const gamesLocal = scheduleData2?.dates?.[0]?.games || [];

// Combinar sin duplicados — priorizar la fecha del gameTime
const allGames = [...gamesLocal, ...gamesUTC];
const seen = new Set();
const games = allGames.filter(g => {
  // gamePk es único por juego — los dos del doubleheader tienen gamePk distinto
  const key = g.gamePk;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
console.log("AVAILABLE GAMES:", games.map(g => ({
  away: g.teams.away.team.name,
  home: g.teams.home.team.name
})));
console.log("LOOKING FOR:", { awayTeam, homeTeam });
  const nameMatches = g => {
     const awayName = normalize(g.teams.away.team.name);
     const homeName = normalize(g.teams.home.team.name);
     const inputAway = normalize(awayTeam);
     const inputHome = normalize(homeTeam);
     return (
       (awayName.includes(inputAway) || inputAway.includes(awayName)) &&
       (homeName.includes(inputHome) || inputHome.includes(homeName))
     );
   };

   const matchingGames = games.filter(nameMatches);

   let game;
   if (matchingGames.length <= 1) {
     game = matchingGames[0];
   } else {
     // Doubleheader: desempatar por hora de inicio (The Odds API da commence_time por juego)
     const targetTime = gameTime ? new Date(gameTime).getTime() : null;

     if (targetTime) {
       game = matchingGames.reduce((best, g) => {
         const gTime = new Date(g.gameDate).getTime();
         const bestTime = new Date(best.gameDate).getTime();
         return Math.abs(gTime - targetTime) < Math.abs(bestTime - targetTime) ? g : best;
       });
     } else {
       // Sin hora: preferir el que aún no ha empezado
       game = matchingGames.find(g => {
         const st = String(g.status?.detailedState || "").toLowerCase();
         return st.includes("scheduled") || st.includes("pre-game") || st.includes("preview") || st.includes("warmup");
       }) || matchingGames[0];
     }
   }

  if (!game) {
  console.log("❌ GAME NOT FOUND:", awayTeam, "vs", homeTeam);

  return res.status(200).json({
    noPlay: true,
    reason: "Game not available yet",
    public: {
      message: "Este juego aún no está disponible para análisis. Intenta más tarde cuando MLB confirme los datos del partido."
    }
  });
}
    
const gameStatus = String(
  game?.status?.detailedState || ""
).toLowerCase();
console.log("GAME STATUS:", { gameStatus });
const isPregame =
  gameStatus.includes("scheduled") ||
  gameStatus.includes("pre-game") ||
  gameStatus.includes("preview") ||
  gameStatus.includes("warmup");

if (!isPregame) {
  return res.status(400).json({
  error: `Estado detectado: ${gameStatus}`,
  gameStatus
});
}
    const awayPitcher = game.teams.away.probablePitcher;
    const homePitcher = game.teams.home.probablePitcher;
console.log("PITCHERS:", { away: awayPitcher, home: homePitcher, gameStatus });
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
const STADIUM_AZIMUTH = {
  "Oakland Coliseum": 55,
  "PNC Park": 116,
  "Petco Park": 0,
  "T-Mobile Park": 49,
  "Oracle Park": 85,
  "Busch Stadium": 62,
  "Tropicana Field": 359,
  "Globe Life Field": 30,
  "Rogers Centre": 345,
  "Target Field": 129,
  "Citizens Bank Park": 9,
  "Truist Park": 145,
  "Guaranteed Rate Field": 127,
  "Rate Field": 127,
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
  "Daikin Park": 343,
  "Kauffman Stadium": 46,
  "Dodger Stadium": 26,
  "UNIQLO Field at Dodger Stadium": 26,
  "Nationals Park": 28,
  "Citi Field": 13,
  "Sutter Health Park": 39,
  "Las Vegas Ballpark": 39
};

function normalizeDegrees(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  return ((number % 360) + 360) % 360;
}

function signedAngleDifference(a, b) {
  const angleA = normalizeDegrees(a);
  const angleB = normalizeDegrees(b);

  if (angleA === null || angleB === null) {
    return null;
  }

  return ((angleA - angleB + 540) % 360) - 180;
}

function getWindComponentsForStadium(
  venueName,
  windFromDegrees,
  windSpeedMph
) {
  const stadiumAzimuth = Number(
    STADIUM_AZIMUTH[venueName]
  );

  const windFrom = normalizeDegrees(
    windFromDegrees
  );

  const speed = Number(windSpeedMph);

  if (
    !Number.isFinite(stadiumAzimuth) ||
    windFrom === null ||
    !Number.isFinite(speed)
  ) {
    return {
      signedWindMph: 0,
      crossWindMph: 0,
      windToDegrees: null
    };
  }

  /*
   * Visual Crossing informa desde dónde viene el viento.
   * Sumamos 180 grados para saber hacia dónde sopla.
   */
  const windToDegrees =
    normalizeDegrees(windFrom + 180);

  const difference =
    signedAngleDifference(
      windToDegrees,
      stadiumAzimuth
    );

  const radians =
    difference * Math.PI / 180;

  return {
    /*
     * Positivo = hacia los jardines.
     * Negativo = hacia home.
     */
    signedWindMph:
      speed * Math.cos(radians),

    /*
     * Componente lateral del viento.
     */
    crossWindMph:
      speed * Math.sin(radians),

    windToDegrees
  };
}

function classifySignedWind(
  signedWindMph,
  crossWindMph
) {
  const signed = Number(signedWindMph);
  const cross = Number(crossWindMph);

  if (!Number.isFinite(signed)) {
    return "neutral";
  }

  if (signed >= 1.5) {
    return "out";
  }

  if (signed <= -1.5) {
    return "in";
  }

  if (
    Number.isFinite(cross) &&
    Math.abs(cross) >= 1.5
  ) {
    return "cross";
  }

  return "neutral";
}

async function getWeather(
  venueName,
  roofType,
  gameDate
) {
  try {
        const cacheKey = buildWeatherCacheKey(
      venueName,
      gameDate
    );

    if (roofType !== "dome") {
      const cachedWeather = await readWeatherCache(
        cacheKey,
        false
      );

      if (cachedWeather) {
        console.log("✅ WEATHER CACHE HIT:", {
          venueName,
          gameDate,
          cacheStatus: cachedWeather.cacheStatus
        });

        return cachedWeather;
      }
    }

    console.log("🌦️ WEATHER CACHE MISS:", {
      venueName,
      gameDate
    });
    const apiKey =
      process.env.VISUAL_CROSSING_API_KEY;

    if (!apiKey) {
      return {
        venue: venueName,
        speed: 0,
        signedWindMph: 0,
        crossWindMph: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        pressure: null,
        dew: null,
        precipprob: null,
        precip: null,
        cloudcover: null,
        condition: "API key no configurada",
        raw: "VISUAL_CROSSING_API_KEY missing",
        active: false,
        source: "visual_crossing",
        forecastType:
          "pregame_3_hour_estimate"
      };
    }

    if (roofType === "dome") {
      return {
        venue: venueName,
        speed: 0,
        signedWindMph: 0,
        crossWindMph: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        pressure: null,
        dew: null,
        precipprob: null,
        precip: null,
        cloudcover: null,
        condition: "Dome",
        raw: "Dome / clima neutralizado",
        active: false,
        roofClosedLikely: true,
        source: "visual_crossing",
        forecastType:
          "pregame_3_hour_estimate"
      };
    }

    const coords =
      STADIUM_COORDS[venueName];

    if (!coords) {
      return {
        venue: venueName,
        speed: 0,
        signedWindMph: 0,
        crossWindMph: 0,
        direction: "neutral",
        temp: null,
        humidity: null,
        pressure: null,
        dew: null,
        precipprob: null,
        precip: null,
        cloudcover: null,
        condition:
          "Coordenadas no encontradas",
        raw: `No coords for ${venueName}`,
        active: false,
        source: "visual_crossing",
        forecastType:
          "pregame_3_hour_estimate"
      };
    }

    const gameDateObj =
      new Date(gameDate);

    if (
      Number.isNaN(gameDateObj.getTime())
    ) {
      throw new Error(
        `gameDate inválido: ${gameDate}`
      );
    }

    /*
     * Pedimos el día anterior y posterior
     * para cubrir cambios de fecha y zona horaria.
     */
    const startDate = new Date(
      gameDateObj.getTime() -
        24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);

    const endDate = new Date(
      gameDateObj.getTime() +
        24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);

    const url =
      `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/` +
      `${coords.lat},${coords.lon}/${startDate}/${endDate}` +
      `?unitGroup=us&include=hours,current&key=${apiKey}&contentType=json`;

    const response = await fetch(url);
    const rawResponse =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `Visual Crossing ${response.status}: ` +
        rawResponse.slice(0, 250)
      );
    }

    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch {
      throw new Error(
        `Visual Crossing devolvió texto inválido: ` +
        rawResponse.slice(0, 250)
      );
    }

    const current =
      data?.currentConditions || {};

    /*
     * Unimos todas las horas de los días
     * solicitados en una sola lista.
     */
    const allHours =
      (data?.days || []).flatMap(day =>
        (day?.hours || []).map(hour => ({
          ...hour,
          localDate: day.datetime
        }))
      );

    if (!allHours.length) {
      throw new Error(
        "Visual Crossing no devolvió datos por hora"
      );
    }

    /*
     * CashEdge estima una duración de tres horas.
     * No se actualiza durante el juego.
     */
    const EXPECTED_GAME_DURATION_MINUTES =
      180;

    const gameStartMs =
      gameDateObj.getTime();

    const gameEndMs =
      gameStartMs +
      EXPECTED_GAME_DURATION_MINUTES *
        60 *
        1000;

    /*
     * Seleccionamos todas las horas que coincidan
     * realmente con la ventana del partido.
     *
     * Ejemplo para un juego a las 7:40:
     *
     * 7:00–8:00 = 20 minutos
     * 8:00–9:00 = 60 minutos
     * 9:00–10:00 = 60 minutos
     * 10:00–11:00 = 40 minutos
     */
    const validHours = allHours
      .map(hour => {
        const hourEpoch =
          Number(hour?.datetimeEpoch);

        if (
          !Number.isFinite(hourEpoch)
        ) {
          return null;
        }

        const hourStartMs =
          hourEpoch * 1000;

        const hourEndMs =
          hourStartMs +
          60 * 60 * 1000;

        const overlapStartMs =
          Math.max(
            gameStartMs,
            hourStartMs
          );

        const overlapEndMs =
          Math.min(
            gameEndMs,
            hourEndMs
          );

        const overlapMinutes =
          Math.max(
            0,
            (
              overlapEndMs -
              overlapStartMs
            ) /
            60000
          );

        if (overlapMinutes <= 0) {
          return null;
        }

        return {
          ...hour,
          overlapMinutes
        };
      })
      .filter(Boolean);

    if (!validHours.length) {
      throw new Error(
        "No se encontraron horas coincidentes con el horario del juego"
      );
    }

    /*
     * Promedio ponderado por minutos reales.
     */
    const weightedValue = callback => {
      let total = 0;
      let minutesUsed = 0;

      validHours.forEach(hour => {
        const value =
          Number(callback(hour));

        const minutes =
          Number(hour.overlapMinutes);

        if (
          Number.isFinite(value) &&
          Number.isFinite(minutes) &&
          minutes > 0
        ) {
          total += value * minutes;
          minutesUsed += minutes;
        }
      });

      return minutesUsed > 0
        ? total / minutesUsed
        : null;
    };

    const temp =
      weightedValue(hour => hour.temp);

    const humidity =
      weightedValue(
        hour => hour.humidity
      );

    const pressure =
      weightedValue(
        hour => hour.pressure
      );

    const dew =
      weightedValue(hour => hour.dew);

    const precipprob =
      weightedValue(
        hour => hour.precipprob
      );

    const precip =
      weightedValue(
        hour => hour.precip
      );

    const cloudcover =
      weightedValue(
        hour => hour.cloudcover
      );

    const averageWindSpeedMph =
      weightedValue(
        hour => hour.windspeed
      );

    /*
     * Calculamos el viento real hacia afuera
     * o hacia dentro en cada hora.
     */
    const signedWindMph =
      weightedValue(hour =>
        getWindComponentsForStadium(
          venueName,
          hour.winddir,
          hour.windspeed
        ).signedWindMph
      );

    const crossWindMph =
      weightedValue(hour =>
        getWindComponentsForStadium(
          venueName,
          hour.winddir,
          hour.windspeed
        ).crossWindMph
      );

    /*
     * Promedio vectorial de dirección.
     * No se promedian los grados directamente.
     */
    const averageWindX =
      weightedValue(hour => {
        const windFrom =
          normalizeDegrees(hour.winddir);

        const speed =
          Number(hour.windspeed);

        if (
          windFrom === null ||
          !Number.isFinite(speed)
        ) {
          return null;
        }

        const windTo =
          normalizeDegrees(
            windFrom + 180
          );

        const radians =
          windTo * Math.PI / 180;

        return speed *
          Math.sin(radians);
      });

    const averageWindY =
      weightedValue(hour => {
        const windFrom =
          normalizeDegrees(hour.winddir);

        const speed =
          Number(hour.windspeed);

        if (
          windFrom === null ||
          !Number.isFinite(speed)
        ) {
          return null;
        }

        const windTo =
          normalizeDegrees(
            windFrom + 180
          );

        const radians =
          windTo * Math.PI / 180;

        return speed *
          Math.cos(radians);
      });

    let averageWindFromDegrees = null;

    if (
      Number.isFinite(averageWindX) &&
      Number.isFinite(averageWindY)
    ) {
      const averageWindToDegrees =
        normalizeDegrees(
          Math.atan2(
            averageWindX,
            averageWindY
          ) *
          180 /
          Math.PI
        );

      averageWindFromDegrees =
        normalizeDegrees(
          averageWindToDegrees + 180
        );
    }

    /*
     * Utilizamos la condición que cubra
     * más minutos del partido.
     */
    const conditionMinutes =
      new Map();

    validHours.forEach(hour => {
      const label =
        String(
          hour.conditions || ""
        ).trim();

      if (!label) return;

      conditionMinutes.set(
        label,
        (
          conditionMinutes.get(label) ||
          0
        ) +
        Number(
          hour.overlapMinutes || 0
        )
      );
    });

    const condition =
      [...conditionMinutes.entries()]
        .sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0] ||
      current?.conditions ||
      "No disponible";

    const conditionLower =
      String(condition).toLowerCase();

    /*
     * Estimación del techo retráctil.
     * No es una confirmación oficial.
     */
    const roofClosedLikely =
      roofType === "retractable" &&
      (
        Number(temp) >= 90 ||
        Number(temp) <= 45 ||
        Number(precipprob) >= 45 ||
        conditionLower.includes("rain") ||
        conditionLower.includes("storm")
      );

    const effectiveSignedWind =
      roofClosedLikely
        ? 0
        : Number(signedWindMph || 0);

    const effectiveCrossWind =
      roofClosedLikely
        ? 0
        : Number(crossWindMph || 0);

    const direction =
      roofClosedLikely
        ? "neutral"
        : classifySignedWind(
            effectiveSignedWind,
            effectiveCrossWind
          );

    /*
     * Velocidad que se muestra junto a
     * OUT, IN o CROSS.
     */
    let displayWindSpeed = 0;

    if (
      direction === "out" ||
      direction === "in"
    ) {
      displayWindSpeed =
        Math.abs(
          effectiveSignedWind
        );
    } else if (
      direction === "cross"
    ) {
      displayWindSpeed =
        Math.abs(
          effectiveCrossWind
        );
    } else {
      displayWindSpeed =
        Math.hypot(
          effectiveSignedWind,
          effectiveCrossWind
        );
    }

    console.log(
      "WEATHER PREGAME WINDOW:",
      {
        venue: venueName,
        gameTimeUTC:
          gameDateObj.toISOString(),

        forecastEndUTC:
          new Date(
            gameEndMs
          ).toISOString(),

        timezone:
          data?.timezone,

        hoursUsed:
          validHours.map(hour => {
            const components =
              getWindComponentsForStadium(
                venueName,
                hour.winddir,
                hour.windspeed
              );

            return {
              date: hour.localDate,
              time: hour.datetime,

              overlapMinutes:
                Number(
                  hour
                    .overlapMinutes
                    .toFixed(1)
                ),

              temp: hour.temp,
              humidity: hour.humidity,
              pressure: hour.pressure,
              dew: hour.dew,
              windspeed:
                hour.windspeed,
              winddir:
                hour.winddir,

              signedWindMph:
                Number(
                  components
                    .signedWindMph
                    .toFixed(2)
                ),

              crossWindMph:
                Number(
                  components
                    .crossWindMph
                    .toFixed(2)
                )
            };
          }),

        estimated: {
          temp,
          humidity,
          pressure,
          dew,
          precipprob,
          averageWindSpeedMph,
          signedWindMph:
            effectiveSignedWind,
          crossWindMph:
            effectiveCrossWind,
          direction
        }
      }
    );

   const weatherResult = {
      venue: venueName,

      gameDate:
        gameDateObj.toISOString(),

      gameTime:
        gameDateObj.toISOString(),

      forecastWindowStart:
        gameDateObj.toISOString(),

      forecastWindowEnd:
        new Date(
          gameEndMs
        ).toISOString(),

      forecastDurationMinutes:
        EXPECTED_GAME_DURATION_MINUTES,

      coordinates: coords,

      speed:
        roofClosedLikely
          ? 0
          : displayWindSpeed,

      averageWindSpeedMph:
        roofClosedLikely
          ? 0
          : Number(
              averageWindSpeedMph || 0
            ),

      direction,

      degrees:
        roofClosedLikely
          ? null
          : averageWindFromDegrees,

      signedWindMph:
        effectiveSignedWind,

      crossWindMph:
        effectiveCrossWind,

      temp,
      humidity,
      pressure,
      dew,
      precipprob,
      precip,
      cloudcover,
      condition,

      hoursUsed:
        validHours.map(hour => ({
          date: hour.localDate,
          time: hour.datetime,

          datetimeEpoch:
            hour.datetimeEpoch,

          overlapMinutes:
            Number(
              hour
                .overlapMinutes
                .toFixed(1)
            ),

          temp: hour.temp,
          humidity: hour.humidity,
          pressure: hour.pressure,
          dew: hour.dew,
          precipprob:
            hour.precipprob,
          precip: hour.precip,
          windspeed:
            hour.windspeed,
          winddir: hour.winddir
        })),

      rawHour:
        validHours[0]
          ? `${validHours[0].localDate} ${validHours[0].datetime}`
          : null,

      raw:
        roofClosedLikely
          ? `Retractable roof likely closed: ${condition}, ${Math.round(temp)}F`
          : `${Math.round(displayWindSpeed)} mph, ` +
            `${Math.round(averageWindFromDegrees || 0)}°, ` +
            `${condition}`,

      active: !roofClosedLikely,
      roofClosedLikely,
      source: "visual_crossing",
      weatherSource: "Visual Crossing",

      forecastType:
        "pregame_3_hour_estimate"
    };
    await saveWeatherCache(
  cacheKey,
  venueName,
  gameDate,
  weatherResult
);

console.log("💾 WEATHER CACHE SAVED:", {
  venueName,
  gameDate
});

return weatherResult;
  } catch (error) {
    console.error(
      "MLB WEATHER ERROR:",
      error
    );
const fallbackCacheKey = buildWeatherCacheKey(
  venueName,
  gameDate
);

const staleWeather = await readWeatherCache(
  fallbackCacheKey,
  true
);

if (staleWeather) {
  console.warn("⚠️ USING STALE WEATHER CACHE:", {
    venueName,
    gameDate,
    cacheFetchedAt: staleWeather.cacheFetchedAt
  });

  return {
    ...staleWeather,
    cacheStatus: "stale",
    weatherSource: "Visual Crossing cached"
  };
}
    return {
      venue: venueName,
      speed: 0,
      signedWindMph: 0,
      crossWindMph: 0,
      direction: "neutral",
      temp: null,
      humidity: null,
      pressure: null,
      dew: null,
      precipprob: null,
      precip: null,
      cloudcover: null,
      condition: "No disponible",
      raw: error.message,
      active: false,
      source: "visual_crossing",

      forecastType:
        "pregame_3_hour_estimate"
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

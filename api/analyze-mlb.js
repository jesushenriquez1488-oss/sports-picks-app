const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      userId,
      awayTeam,
      homeTeam,
      awaySpread,
      homeSpread,
      outcomes,
      totalLine = 8
    } = req.body || {};

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("is_premium")
      .eq("id", userId)
      .single();

    const isPremiumUser = profile?.is_premium === true;

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const dataResponse = await fetch(`${origin}/api/mlb-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ awayTeam, homeTeam })
    });

    const mlbData = await dataResponse.json();

    if (!dataResponse.ok) {
      throw new Error(mlbData.error || "No se pudo cargar data MLB");
    }

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const safeNumber = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const americanToProb = (odds) => {
      if (!odds) return 0.5;
      return odds > 0
        ? 100 / (odds + 100)
        : Math.abs(odds) / (Math.abs(odds) + 100);
    };

    function erf(x) {
      const sign = x >= 0 ? 1 : -1;
      x = Math.abs(x);
      const a1 = 0.254829592;
      const a2 = -0.284496736;
      const a3 = 1.421413741;
      const a4 = -1.453152027;
      const a5 = 1.061405429;
      const p = 0.3275911;

      const t = 1 / (1 + p * x);
      const y =
        1 -
        (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
          t *
          Math.exp(-x * x));

      return sign * y;
    }

    function normalCDF(x, mean, stdDev) {
      return 0.5 * (1 + erf((x - mean) / (stdDev * Math.sqrt(2))));
    }

    function getWeatherRunFactor(weather, venue) {
      if (!weather || weather.active === false) return 1;

      let factor = 1;
      const windSpeed = safeNumber(weather.speed, 0);
      const temp = weather.temp ? Number(weather.temp) : null;

      if (weather.direction === "out") factor += Math.min(0.08, windSpeed * 0.004);
      if (weather.direction === "in") factor -= Math.min(0.08, windSpeed * 0.004);

      if (temp !== null) {
        if (temp >= 85) factor += 0.03;
        else if (temp <= 50) factor -= 0.025;
      }

      return clamp(factor, 0.9, 1.1);
    }

    // 🔥 NUEVO AJUSTE REALISTA

    function adjustOffense(batting) {
      if (!batting) return 4.55;

      const leagueAvg = 4.55;

      const base = batting.runs || leagueAvg;
      const weighted = batting.weightedRuns || base;
      const split = batting.splitRuns || base;

      let score =
        base * 0.5 +
        weighted * 0.3 +
        split * 0.2;

      if (batting.last3?.runs >= 5) score *= 1.03;
      if (batting.last3?.runs <= 3) score *= 0.97;

      score = score * 0.78 + leagueAvg * 0.22;

      return Math.max(3.5, Math.min(score, 6.2));
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return 4.55;

      const leagueAvg = 4.55;

      let score = bullpen.runsPerGame || leagueAvg;

      score = score * 0.6 + leagueAvg * 0.4;

      if (bullpen.fatigue >= 8) score *= 1.04;
      if (bullpen.fatigue <= 2) score *= 0.97;

      return Math.max(3.6, Math.min(score, 5.6));
    }

    function adjustPitcher(stats) {
      if (!stats) return 4.55;

      const leagueAvg = 4.55;

      if (stats.innings < 3) {
        return 5.2;
      }

      let score = stats.runsPerGame || leagueAvg;

      score = score * 0.72 + leagueAvg * 0.28;

      const whip = stats.whip || 1.3;

      if (whip >= 1.5) score *= 1.04;
      if (whip <= 1.1) score *= 0.96;

      return Math.max(3.1, Math.min(score, 6.3));
    }

    const leagueAvgRuns = 4.55;

    const venue = mlbData.venue || { parkFactor: 1 };
    const parkFactor = safeNumber(venue.parkFactor, 1);
    const weatherFactor = getWeatherRunFactor(mlbData.weather, venue);

    const awayBatting = mlbData.away.battingProfile || {};
    const homeBatting = mlbData.home.battingProfile || {};

    const awayOffense = adjustOffense(awayBatting);
    const homeOffense = adjustOffense(homeBatting);

    const awayPitcher = adjustPitcher(mlbData.away.pitcher?.stats);
    const homePitcher = adjustPitcher(mlbData.home.pitcher?.stats);

    const awayBullpen = adjustBullpen(mlbData.away.bullpen);
    const homeBullpen = adjustBullpen(mlbData.home.bullpen);

    let expectedRunsA =
      awayOffense * 0.55 + (homePitcher * 0.3 + homeBullpen * 0.15);

    let expectedRunsB =
      homeOffense * 0.55 + (awayPitcher * 0.3 + awayBullpen * 0.15);

    expectedRunsA *= parkFactor * weatherFactor;
    expectedRunsB *= parkFactor * weatherFactor;

    // 🔥 REGRESIÓN FINAL
    expectedRunsA = expectedRunsA * 0.80 + leagueAvgRuns * 0.20;
    expectedRunsB = expectedRunsB * 0.80 + leagueAvgRuns * 0.20;

    expectedRunsA = clamp(expectedRunsA, 2.5, 9.5);
    expectedRunsB = clamp(expectedRunsB, 2.5, 9.5);

    const projectedTotal = expectedRunsA + expectedRunsB;
    const runDiff = expectedRunsA - expectedRunsB;

    const modelProbA = clamp(0.5 + runDiff * 0.08, 0.1, 0.9);
    const modelProbB = 1 - modelProbA;

    let marketProbA = 0.5;
    let marketProbB = 0.5;

    if (outcomes?.length) {
      const awayOdds = outcomes.find(o => o.name === awayTeam)?.price;
      const homeOdds = outcomes.find(o => o.name === homeTeam)?.price;

      marketProbA = americanToProb(awayOdds);
      marketProbB = americanToProb(homeOdds);
    }

    const edgeA = (modelProbA - marketProbA) * 100;
    const edgeB = (modelProbB - marketProbB) * 100;

    const valueTeam = edgeA > edgeB ? awayTeam : homeTeam;
    const valueEdge = Math.max(edgeA, edgeB);
    const valueSpread = edgeA > edgeB ? awaySpread : homeSpread;

    const totalStdDev = 2.6;

    const overProb =
      (1 - normalCDF(totalLine + 0.05, projectedTotal, totalStdDev)) * 100;

    const underProb =
      normalCDF(totalLine - 0.05, projectedTotal, totalStdDev) * 100;

    const totalPick = overProb >= underProb ? "OVER" : "UNDER";
    const totalProb = Math.max(overProb, underProb);

    let recommendedPlay = "";
    let recommendedProb = 0;

    if (valueEdge >= 7) {
      if (valueSpread > 0 && valueEdge >= 10) {
        recommendedPlay = `${valueTeam} +${valueSpread}`;
        recommendedProb = 55 + valueEdge * 1.5;
      } else if (valueSpread <= 0) {
        recommendedPlay = `${valueTeam} ML`;
        recommendedProb = 54 + valueEdge * 2;
      }
    }

    // 🔥 LIMITADOR REAL
    recommendedProb = clamp(recommendedProb, 0, 72);

    const recommendedCards = [];

    if (recommendedPlay) {
      recommendedCards.push({
        title: "Jugada Premium",
        play: recommendedPlay,
        percentage: recommendedProb
      });
    }

    if (
      totalProb >= 64 &&
      (totalPick === "OVER" || (totalPick === "UNDER" && totalProb >= 65))
    ) {
      recommendedCards.push({
        title: "Total Premium",
        play: `${totalPick} ${totalLine}`,
        percentage: clamp(totalProb, 0, 72)
      });
    }

    recommendedCards.sort((a, b) => b.percentage - a.percentage);

    const locked = recommendedCards.length > 0 && !isPremiumUser;

    return res.status(200).json({
      locked,
      isPremiumPick: recommendedCards.length > 0,
      public: {
        awayTeam,
        homeTeam,
        totalLine
      },
           premium: locked
        ? null
        : {
            recommendedCards,
            favoriteToWin: modelProbA > modelProbB ? awayTeam : homeTeam,
            favoriteProb: Math.max(modelProbA, modelProbB) * 100,

            expectedRunsA,
            expectedRunsB,
            projectedTotal,
            totalLine,
            totalDiff: projectedTotal - totalLine,

            overProbability: overProb,
            underProbability: underProb,
            totalPick,
            totalEdge: Math.abs(projectedTotal - totalLine),

            venue: mlbData.venue || {
              name: "Unknown Stadium",
              parkFactor: 1,
              roof: "unknown"
            },

            weather: mlbData.weather || {
              raw: "No disponible",
              direction: "neutral",
              speed: 0,
              temp: null,
              active: false
            },

            weatherFactor,

            awayOffense,
            homeOffense,

            awayTeamAllowed: awayBatting?.runsAllowed || 4.55,
            homeTeamAllowed: homeBatting?.runsAllowed || 4.55,

            awayPitcherAllowed: awayPitcher,
            homePitcherAllowed: homePitcher,

            awayBullpenAllowed: awayBullpen,
            homeBullpenAllowed: homeBullpen,

            awayPitcherName: mlbData.away?.pitcher?.name || "No disponible",
            homePitcherName: mlbData.home?.pitcher?.name || "No disponible",

            awayPitcherInnings: mlbData.away?.pitcher?.stats?.innings || 0,
            homePitcherInnings: mlbData.home?.pitcher?.stats?.innings || 0,

            awayBullpenFatigue: mlbData.away?.bullpen?.fatigue || 0,
            homeBullpenFatigue: mlbData.home?.bullpen?.fatigue || 0,

            awayBullpenFatigueFactor: 1,
            homeBullpenFatigueFactor: 1,

            awayRunEnvironment: expectedRunsA,
            homeRunEnvironment: expectedRunsB
          }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

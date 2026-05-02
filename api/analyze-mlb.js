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
      return Number.isFinite(num) && num > 0 ? num : fallback;
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
      if (weather.direction === "cross") factor += Math.min(0.02, windSpeed * 0.001);

      if (temp !== null) {
        if (temp >= 85) factor += 0.03;
        else if (temp >= 75) factor += 0.015;
        else if (temp <= 50) factor -= 0.025;
        else if (temp <= 60) factor -= 0.01;
      }

      if (venue?.roof === "retractable" && weather.direction !== "neutral") {
        factor = 1 + (factor - 1) * 0.65;
      }

      return clamp(factor, 0.88, 1.12);
    }

    function getBullpenFatigueFactor(bullpen) {
      const fatigue = safeNumber(bullpen?.fatigue, 5);
      if (fatigue >= 8) return 1.06;
      if (fatigue >= 6) return 1.03;
      if (fatigue <= 2) return 0.98;
      return 1;
    }

    function adjustPitcher(stats) {
      if (!stats) return 4.55;

      let score = safeNumber(stats.runsPerGame, 4.55);
      const whip = safeNumber(stats.whip, 1.3);

      if (whip >= 1.6) score *= 1.15;
      else if (whip >= 1.4) score *= 1.08;
      else if (whip <= 1.1) score *= 0.92;

      return clamp(score, 1.5, 8.5);
    }

    function adjustOffense(batting) {
      if (!batting) return 4.55;

      let score = safeNumber(batting.weightedRuns || batting.runs, 4.55);

      if (batting.splitRuns) {
        score = score * 0.7 + batting.splitRuns * 0.3;
      }

      if (batting.last3?.runs >= 5) score *= 1.08;
      if (batting.last3?.runs <= 3) score *= 0.92;

      if (batting.avg >= 0.280) score *= 1.05;
      if (batting.avg <= 0.230) score *= 0.94;

      return clamp(score, 2.0, 8.5);
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return 4.55;

      let score = safeNumber(bullpen.runsPerGame, 4.55);
      const whip = safeNumber(bullpen.whip, 1.3);

      if (bullpen.fatigue >= 8) score *= 1.12;
      else if (bullpen.fatigue >= 6) score *= 1.06;
      else if (bullpen.fatigue <= 2) score *= 0.94;

      if (whip >= 1.5) score *= 1.08;
      if (whip <= 1.2) score *= 0.95;

      return clamp(score, 1.5, 8.5);
    }

    const leagueAvgRuns = 4.55;

    const venue = mlbData.venue || {
      name: "Unknown Stadium",
      parkFactor: 1,
      roof: "unknown"
    };

    const parkFactor = safeNumber(venue.parkFactor, 1);
    const weatherFactor = getWeatherRunFactor(mlbData.weather, venue);

    const awayBatting =
      mlbData.away.battingProfile ||
      mlbData.away.battingLast7 ||
      {};

    const homeBatting =
      mlbData.home.battingProfile ||
      mlbData.home.battingLast7 ||
      {};

    const awayOffense = adjustOffense(awayBatting);
    const homeOffense = adjustOffense(homeBatting);

    const awayTeamAllowed = safeNumber(
      awayBatting.weightedRunsAllowed ||
      awayBatting.runsAllowed ||
      awayBatting.splitRunsAllowed,
      leagueAvgRuns
    );

    const homeTeamAllowed = safeNumber(
      homeBatting.weightedRunsAllowed ||
      homeBatting.runsAllowed ||
      homeBatting.splitRunsAllowed,
      leagueAvgRuns
    );

    const awayPitcherAllowed = adjustPitcher(mlbData.away.pitcher?.stats);
    const homePitcherAllowed = adjustPitcher(mlbData.home.pitcher?.stats);

    const awayPitcherInnings = safeNumber(
      mlbData.away.pitcher?.stats?.innings,
      5
    );

    const homePitcherInnings = safeNumber(
      mlbData.home.pitcher?.stats?.innings,
      5
    );

    const awayBullpenAllowed = adjustBullpen(mlbData.away.bullpen);
    const homeBullpenAllowed = adjustBullpen(mlbData.home.bullpen);

    const awayBullpenFatigueFactor = getBullpenFatigueFactor(
      mlbData.away.bullpen
    );

    const homeBullpenFatigueFactor = getBullpenFatigueFactor(
      mlbData.home.bullpen
    );

    const awayStarterWeight = clamp(awayPitcherInnings / 7, 0.45, 0.75);
    const homeStarterWeight = clamp(homePitcherInnings / 7, 0.45, 0.75);

    const awayRunEnvironment =
      homeTeamAllowed * 0.20 +
      homePitcherAllowed * homeStarterWeight * 0.55 +
      homeBullpenAllowed *
        homeBullpenFatigueFactor *
        (1 - homeStarterWeight) *
        0.55 +
      leagueAvgRuns * 0.25;

    const homeRunEnvironment =
      awayTeamAllowed * 0.20 +
      awayPitcherAllowed * awayStarterWeight * 0.55 +
      awayBullpenAllowed *
        awayBullpenFatigueFactor *
        (1 - awayStarterWeight) *
        0.55 +
      leagueAvgRuns * 0.25;

    let expectedRunsA = awayOffense * 0.52 + awayRunEnvironment * 0.48;
    let expectedRunsB = homeOffense * 0.52 + homeRunEnvironment * 0.48;

    expectedRunsA *= parkFactor * weatherFactor;
    expectedRunsB *= parkFactor * weatherFactor;

    expectedRunsA = clamp(expectedRunsA, 1.8, 10.5);
    expectedRunsB = clamp(expectedRunsB, 1.8, 10.5);

    const projectedTotal = expectedRunsA + expectedRunsB;
    const runDiff = expectedRunsA - expectedRunsB;

    const modelProbA = clamp(0.5 + runDiff * 0.11, 0.05, 0.95);
    const modelProbB = 1 - modelProbA;

    let marketProbA = 0.5;
    let marketProbB = 0.5;

    if (outcomes && outcomes.length) {
      const awayOdds = outcomes.find((o) => o.name === awayTeam)?.price;
      const homeOdds = outcomes.find((o) => o.name === homeTeam)?.price;

      marketProbA = americanToProb(awayOdds);
      marketProbB = americanToProb(homeOdds);
    }

    const edgeA = (modelProbA - marketProbA) * 100;
    const edgeB = (modelProbB - marketProbB) * 100;

    const valueTeam = edgeA > edgeB ? awayTeam : homeTeam;
    const valueEdge = Math.max(edgeA, edgeB);
    const valueSpread = edgeA > edgeB ? awaySpread : homeSpread;

    const favoriteToWin = modelProbA > modelProbB ? awayTeam : homeTeam;
    const favoriteProb = Math.max(modelProbA, modelProbB) * 100;

    const totalDiff = projectedTotal - totalLine;
    const totalEdge = Math.abs(totalDiff);

    const totalStdDev = 2.6;

    const overProbability =
      (1 - normalCDF(totalLine + 0.05, projectedTotal, totalStdDev)) * 100;

    const underProbability =
      normalCDF(totalLine - 0.05, projectedTotal, totalStdDev) * 100;

    const totalPick = overProbability >= underProbability ? "OVER" : "UNDER";
    const totalProbability = Math.max(overProbability, underProbability);

    let recommendedPlay = "";
    let recommendedProb = 0;

    if (valueEdge >= 7) {
      if (valueSpread > 0) {
        if (valueEdge >= 9.5) {
          recommendedPlay = `${valueTeam} +${valueSpread}`;
          recommendedProb = Math.min(88, 52 + valueEdge * 2.2);
        }
      } else {
        if (favoriteProb >= 58 || valueEdge >= 8) {
          recommendedPlay = `${valueTeam} ML`;
          recommendedProb = Math.min(90, 54 + valueEdge * 2.5);
        }
      }
    }

    recommendedProb = clamp(recommendedProb, 0, 92);

    const recommendedCards = [];

    if (recommendedPlay) {
      recommendedCards.push({
        title: "Jugada Premium",
        play: recommendedPlay,
        percentage: recommendedProb
      });
    }

    if (
      totalProbability >= 68 &&
      totalEdge >= 1.0 &&
      (
        totalPick === "OVER" ||
        (totalPick === "UNDER" && totalEdge >= 1.35 && totalProbability >= 70)
      )
    ) {
      recommendedCards.push({
        title: "Total Premium",
        play: `${totalPick} ${totalLine}`,
        percentage: clamp(totalProbability, 0, 92)
      });
    }

    recommendedCards.sort((a, b) => b.percentage - a.percentage);

    const isPremiumPick = recommendedCards.length > 0;
    const locked = isPremiumPick && !isPremiumUser;

    return res.status(200).json({
      locked,
      isPremiumPick,
      public: {
        awayTeam,
        homeTeam,
        totalLine,
        hasPremium: isPremiumPick,
        factors: [
          "Pitcher probable",
          "Bullpen",
          "Park factor",
          "Clima",
          "Ofensiva reciente",
          "Home/Away split",
          "Mercado ML / total"
        ]
      },
      premium: locked
        ? null
        : {
            recommendedCards,
            favoriteToWin,
            favoriteProb,
            expectedRunsA,
            expectedRunsB,
            projectedTotal,
            totalLine,
            totalDiff,
            overProbability,
            underProbability,
            totalPick,
            totalEdge,
            venue,
            weather: mlbData.weather,
            weatherFactor,
            awayOffense,
            homeOffense,
            awayTeamAllowed,
            homeTeamAllowed,
            awayPitcherAllowed,
            homePitcherAllowed,
            awayBullpenAllowed,
            homeBullpenAllowed,
            awayPitcherName: mlbData.away.pitcher?.name || "No disponible",
            homePitcherName: mlbData.home.pitcher?.name || "No disponible",
            awayPitcherInnings,
            homePitcherInnings,
            awayBullpenFatigue: safeNumber(mlbData.away.bullpen?.fatigue, 0),
            homeBullpenFatigue: safeNumber(mlbData.home.bullpen?.fatigue, 0),
            awayBullpenFatigueFactor,
            homeBullpenFatigueFactor,
            awayRunEnvironment,
            homeRunEnvironment
          }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

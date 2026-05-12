const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    let isPremiumUser = false;

    if (userId && userId !== "null" && userId !== "undefined" && userId !== "guest") {
      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("is_premium")
        .eq("id", userId)
        .maybeSingle();

      isPremiumUser = profile?.is_premium === true;
    }

    const origin = "https://www.cashedgeapp.com";

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

    const safeNumber = (value, fallback = null) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const avgValid = (...values) => {
      const nums = values
        .map(v => Number(v))
        .filter(v => Number.isFinite(v));

      if (!nums.length) return null;

      return nums.reduce((a, b) => a + b, 0) / nums.length;
    };

    const fillMissing = (value, fallback) => {
      const num = Number(value);
      if (Number.isFinite(num)) return num;

      const fb = Number(fallback);
      return Number.isFinite(fb) ? fb : 0;
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

    function getWeatherRunFactor(weather) {
      if (!weather || weather.active === false) return 1;

      let factor = 1;

      const windSpeed = safeNumber(weather.speed, 0);
      const temp = weather.temp ? Number(weather.temp) : null;

      if (weather.direction === "out") {
        factor += Math.min(0.18, windSpeed * 0.008);
      }

      if (weather.direction === "in") {
        factor -= Math.min(0.18, windSpeed * 0.008);
      }

      if (temp !== null) {
        if (temp >= 90) factor += 0.05;
        else if (temp >= 85) factor += 0.04;
        else if (temp <= 45) factor -= 0.04;
        else if (temp <= 50) factor -= 0.03;
      }

      return clamp(factor, 0.82, 1.22);
    }

    function adjustOffense(batting) {
      if (!batting) return null;

      const base = safeNumber(batting.runs);
      const weighted = safeNumber(batting.weightedRuns);
      const split = safeNumber(batting.splitRuns);

      const fallback = avgValid(base, weighted, split);
      if (fallback === null) return null;

      let score =
        fillMissing(base, fallback) * 0.45 +
        fillMissing(weighted, fallback) * 0.35 +
        fillMissing(split, fallback) * 0.20;

      const last3Runs = safeNumber(batting.last3?.runs);

      if (last3Runs !== null) {
        if (last3Runs >= 7) score *= 1.08;
        else if (last3Runs >= 5.5) score *= 1.045;

        if (last3Runs <= 2.5) score *= 0.91;
        else if (last3Runs <= 3.2) score *= 0.955;
      }

      return clamp(score, 1.2, 10.5);
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return null;

      let score = safeNumber(bullpen.runsPerGame);
      if (score === null) return null;

      const whip = safeNumber(bullpen.whip);
      const fatigue = safeNumber(bullpen.fatigue, 0);

      if (fatigue >= 9) score *= 1.10;
      else if (fatigue >= 7) score *= 1.06;
      else if (fatigue <= 2) score *= 0.96;

      if (whip !== null) {
        if (whip >= 1.65) score *= 1.08;
        else if (whip >= 1.5) score *= 1.045;

        if (whip <= 1.05) score *= 0.94;
        else if (whip <= 1.15) score *= 0.97;
      }

      return clamp(score, 1.2, 10.5);
    }

    function adjustPitcher(stats) {
      if (!stats) return null;

      const innings = safeNumber(stats.innings, 0);
      let score = safeNumber(stats.runsPerGame);

      if (score === null) return null;

      if (innings > 0 && innings < 3) {
        score *= 1.08;
      }

      const whip = safeNumber(stats.whip);
      const homeRunsPerInning = safeNumber(stats.homeRunsPerInning);
      const walksPerInning = safeNumber(stats.walksPerInning);

      if (whip !== null) {
        if (whip >= 1.65) score *= 1.10;
        else if (whip >= 1.5) score *= 1.06;

        if (whip <= 1.0) score *= 0.91;
        else if (whip <= 1.1) score *= 0.95;
      }

      if (homeRunsPerInning !== null) {
        if (homeRunsPerInning >= 0.22) score *= 1.07;
        else if (homeRunsPerInning >= 0.18) score *= 1.04;
      }

      if (walksPerInning !== null) {
        if (walksPerInning >= 0.5) score *= 1.06;
        else if (walksPerInning >= 0.45) score *= 1.035;
      }

      return clamp(score, 1.2, 10.5);
    }

    function getTeamTrendScore(batting) {
      if (!batting) return 50;

      const offense = avgValid(
        batting.runs,
        batting.weightedRuns,
        batting.splitRuns
      );

      const allowed = avgValid(
        batting.runsAllowed,
        batting.weightedRunsAllowed,
        batting.splitRunsAllowed
      );

      if (offense === null && allowed === null) return 50;

      let score = 50;

      if (offense !== null && allowed !== null) {
        score += (offense - allowed) * 7;
      } else if (offense !== null) {
        score += offense * 2;
      } else if (allowed !== null) {
        score -= allowed * 2;
      }

      return clamp(score, 20, 80);
    }

    const venue = mlbData.venue || { parkFactor: 1 };
    const parkFactor = safeNumber(venue.parkFactor, 1);
    const weatherFactor = getWeatherRunFactor(mlbData.weather);
    const runEnvironmentFactor = parkFactor * weatherFactor;

    const awayBatting = mlbData.away?.battingProfile || {};
    const homeBatting = mlbData.home?.battingProfile || {};

    const awayOffenseRaw = adjustOffense(awayBatting);
    const homeOffenseRaw = adjustOffense(homeBatting);

    const awayPitcherRaw = adjustPitcher(mlbData.away?.pitcher?.stats);
    const homePitcherRaw = adjustPitcher(mlbData.home?.pitcher?.stats);

    const awayBullpenRaw = adjustBullpen(mlbData.away?.bullpen);
    const homeBullpenRaw = adjustBullpen(mlbData.home?.bullpen);

    const fallbackA = avgValid(awayOffenseRaw, homePitcherRaw, homeBullpenRaw, safeNumber(totalLine) / 2);
    const fallbackB = avgValid(homeOffenseRaw, awayPitcherRaw, awayBullpenRaw, safeNumber(totalLine) / 2);

    const awayOffense = fillMissing(awayOffenseRaw, fallbackA);
    const homePitcher = fillMissing(homePitcherRaw, fallbackA);
    const homeBullpen = fillMissing(homeBullpenRaw, fallbackA);

    const homeOffense = fillMissing(homeOffenseRaw, fallbackB);
    const awayPitcher = fillMissing(awayPitcherRaw, fallbackB);
    const awayBullpen = fillMissing(awayBullpenRaw, fallbackB);

    let expectedRunsA =
      awayOffense * 0.50 +
      homePitcher * 0.35 +
      homeBullpen * 0.15;

    let expectedRunsB =
      homeOffense * 0.50 +
      awayPitcher * 0.35 +
      awayBullpen * 0.15;

    expectedRunsA *= runEnvironmentFactor;
    expectedRunsB *= runEnvironmentFactor;

    expectedRunsA = clamp(expectedRunsA, 0.8, 12.5);
    expectedRunsB = clamp(expectedRunsB, 0.8, 12.5);

    const projectedTotal = expectedRunsA + expectedRunsB;
    const runDiff = expectedRunsA - expectedRunsB;

    const awayTrendScore = getTeamTrendScore(awayBatting);
    const homeTrendScore = getTeamTrendScore(homeBatting);

    const pitcherAdvAway = awayPitcher - homePitcher;
    const bullpenAdvAway = awayBullpen - homeBullpen;
    const offenseAdvAway = awayOffense - homeOffense;
    const trendAdvAway = awayTrendScore - homeTrendScore;

    const rawAwayWin =
      0.5 +
      runDiff * 0.075 +
      offenseAdvAway * 0.018 -
      pitcherAdvAway * 0.022 -
      bullpenAdvAway * 0.016 +
      trendAdvAway * 0.0015;

    const modelProbA = clamp(rawAwayWin, 0.18, 0.82);
    const modelProbB = 1 - modelProbA;

    let awayOdds = null;
    let homeOdds = null;

    if (outcomes?.length) {
      awayOdds = outcomes.find(o => o.name === awayTeam)?.price;
      homeOdds = outcomes.find(o => o.name === homeTeam)?.price;
    }

    const marketProbA = americanToProb(awayOdds);
    const marketProbB = americanToProb(homeOdds);

    const totalStdDev = 2.75;

    const overProb =
      (1 - normalCDF(totalLine + 0.05, projectedTotal, totalStdDev)) * 100;

    const underProb =
      normalCDF(totalLine - 0.05, projectedTotal, totalStdDev) * 100;

    const totalPick = overProb >= underProb ? "OVER" : "UNDER";
    const totalEdge = Math.abs(projectedTotal - totalLine);

    function getSupportForSide(side) {
      const isAway = side === "away";

      const teamName = isAway ? awayTeam : homeTeam;

      const teamExpected = isAway ? expectedRunsA : expectedRunsB;
      const opponentExpected = isAway ? expectedRunsB : expectedRunsA;

      const teamOffense = isAway ? awayOffense : homeOffense;
      const opponentOffense = isAway ? homeOffense : awayOffense;

      const teamPitcherAllowed = isAway ? awayPitcher : homePitcher;
      const opponentPitcherAllowed = isAway ? homePitcher : awayPitcher;

      const teamBullpenAllowed = isAway ? awayBullpen : homeBullpen;
      const opponentBullpenAllowed = isAway ? homeBullpen : awayBullpen;

      const teamTrend = isAway ? awayTrendScore : homeTrendScore;
      const opponentTrend = isAway ? homeTrendScore : awayTrendScore;

      const modelProb = isAway ? modelProbA : modelProbB;
      const marketProb = isAway ? marketProbA : marketProbB;
      const edge = (modelProb - marketProb) * 100;

      const projectedMargin = teamExpected - opponentExpected;

      let support = 50;

      support += projectedMargin * 9;
      support += (teamOffense - opponentOffense) * 4;
      support += (opponentPitcherAllowed - teamPitcherAllowed) * 4;
      support += (opponentBullpenAllowed - teamBullpenAllowed) * 3;
      support += (teamTrend - opponentTrend) * 0.25;
      support += edge * 1.15;

      if (!isAway) support += 1.5;

      support = clamp(support, 0, 100);

      return {
        teamName,
        support,
        modelProb,
        marketProb,
        edge,
        projectedMargin,
        teamExpected,
        opponentExpected,
        teamOffense,
        opponentOffense,
        teamPitcherAllowed,
        opponentPitcherAllowed,
        teamBullpenAllowed,
        opponentBullpenAllowed,
        teamTrend,
        opponentTrend
      };
    }

    function estimateRunlineProb(side, spread) {
      const isAway = side === "away";
      const meanMargin = isAway ? runDiff : -runDiff;
      const spreadNumber = safeNumber(spread, 0);
      const marginStdDev = 3.15;

      return (1 - normalCDF(-spreadNumber, meanMargin, marginStdDev)) * 100;
    }

    function buildSideCandidate(side, marketType, spread = null) {
      const supportData = getSupportForSide(side);
      const isRunline = marketType === "RUNLINE";

      let confidence;

      if (marketType === "ML") {
        confidence =
          supportData.modelProb * 100 * 0.72 +
          supportData.support * 0.28;
      } else {
        const runlineProb = estimateRunlineProb(side, spread);

        confidence =
          runlineProb * 0.74 +
          supportData.support * 0.26;
      }

      const safety =
        Math.abs(supportData.projectedMargin) >= 1.2 ? 4 :
        Math.abs(supportData.projectedMargin) >= 0.8 ? 2 :
        0;

      confidence += safety;
      confidence = clamp(confidence, 0, 86);

      const label =
        marketType === "ML"
          ? `${supportData.teamName} ML`
          : `${supportData.teamName} ${spread > 0 ? "+" : ""}${spread}`;

      const title =
        marketType === "ML"
          ? "Jugada Premium ML"
          : "Jugada Premium Runline";

      return {
        title,
        play: label,
        percentage: Number(confidence.toFixed(1)),
        type: marketType,
        team: supportData.teamName,
        supportScore: Number(supportData.support.toFixed(1)),
        modelProbability: Number((supportData.modelProb * 100).toFixed(1)),
        marketProbability: Number((supportData.marketProb * 100).toFixed(1)),
        edge: Number(supportData.edge.toFixed(1)),
        projectedMargin: Number(supportData.projectedMargin.toFixed(2)),
        isPremium:
          confidence >= 75 &&
          supportData.support >= 55 &&
          (
            supportData.modelProb >= 0.56 ||
            isRunline
          )
      };
    }

    function buildTotalCandidate(direction) {
      const isOver = direction === "OVER";
      const probability = isOver ? overProb : underProb;
      const diff = projectedTotal - totalLine;

      const offensePressure = awayOffense + homeOffense;
      const pitchingPressure = awayPitcher + homePitcher;
      const bullpenPressure = awayBullpen + homeBullpen;

      const expectedPressure = projectedTotal;

      let support = 50;

      if (isOver) {
        support += diff * 11;
        support += (runEnvironmentFactor - 1) * 100;
        support += (offensePressure - expectedPressure) * 1.5;
        support += (pitchingPressure - expectedPressure) * 1.2;
        support += (bullpenPressure - expectedPressure) * 1.1;
      } else {
        support += -diff * 11;
        support += (1 - runEnvironmentFactor) * 100;
        support += (expectedPressure - offensePressure) * 1.5;
        support += (expectedPressure - pitchingPressure) * 1.2;
        support += (expectedPressure - bullpenPressure) * 1.1;
      }

      support = clamp(support, 0, 100);

      let confidence = probability * 0.72 + support * 0.28;

      if (totalEdge >= 1.25) confidence += 3;
      if (totalEdge >= 1.75) confidence += 3;

      confidence = clamp(confidence, 0, 86);

      return {
        title: "Total Premium",
        play: `${direction} ${totalLine}`,
        percentage: Number(confidence.toFixed(1)),
        type: direction,
        supportScore: Number(support.toFixed(1)),
        totalProbability: Number(probability.toFixed(1)),
        totalEdge: Number(totalEdge.toFixed(2)),
        projectedTotal: Number(projectedTotal.toFixed(2)),
        isPremium:
          confidence >= 75 &&
          support >= 56 &&
          totalEdge >= 0.75
      };
    }

    const candidates = [];

    candidates.push(buildSideCandidate("away", "ML"));
    candidates.push(buildSideCandidate("home", "ML"));

    if (awaySpread !== undefined && awaySpread !== null) {
      candidates.push(buildSideCandidate("away", "RUNLINE", Number(awaySpread)));
    }

    if (homeSpread !== undefined && homeSpread !== null) {
      candidates.push(buildSideCandidate("home", "RUNLINE", Number(homeSpread)));
    }

    candidates.push(buildTotalCandidate("OVER"));
    candidates.push(buildTotalCandidate("UNDER"));

    const premiumCandidates = candidates
      .filter(c => c.isPremium)
      .sort((a, b) => b.percentage - a.percentage);

    const recommendedCards = [];

    const bestSidePlay = premiumCandidates.find(c =>
      c.type === "ML" || c.type === "RUNLINE"
    );

    const bestTotalPlay = premiumCandidates.find(c =>
      c.type === "OVER" || c.type === "UNDER"
    );

    if (bestSidePlay) recommendedCards.push(bestSidePlay);
    if (bestTotalPlay) recommendedCards.push(bestTotalPlay);

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
            totalEdge,

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

            awayTeamAllowed: awayBatting?.runsAllowed ?? null,
            homeTeamAllowed: homeBatting?.runsAllowed ?? null,

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

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(

  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const ADMIN_EMAIL = "jesushenriquez1488@gmail.com";

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
let isAdmin = false;
let profile = null;

if (userId && userId !== "null" && userId !== "undefined" && userId !== "guest") {
  const { data } = await supabaseAdmin
    .from("users")
    .select("is_premium, email")
    .eq("id", userId)
    .maybeSingle();

  profile = data;
  isPremiumUser = profile?.is_premium === true;
  isAdmin = profile?.email === ADMIN_EMAIL;
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

  const raw = String(weather.raw || "").trim();

  const hasRealWeather =
    raw.length > 0 ||
    weather.temp !== null ||
    Number(weather.speed) > 0;

  if (!hasRealWeather) return 1;

  let factor = 1;

  const windSpeed = safeNumber(weather.speed, 0);
  const temp = weather.temp ? Number(weather.temp) : null;

  // =========================
  // WIND DIRECTION IMPACT
  // =========================

  if (weather.direction === "out") {
    if (windSpeed >= 18) factor += 0.18;
    else if (windSpeed >= 14) factor += 0.14;
    else if (windSpeed >= 10) factor += 0.10;
    else if (windSpeed >= 6) factor += 0.06;
  }

  if (weather.direction === "in") {
    if (windSpeed >= 18) factor -= 0.16;
    else if (windSpeed >= 14) factor -= 0.13;
    else if (windSpeed >= 10) factor -= 0.09;
    else if (windSpeed >= 6) factor -= 0.05;
  }

  if (weather.direction === "cross") {
    if (windSpeed >= 18) factor += 0.05;
    else if (windSpeed >= 14) factor += 0.04;
    else if (windSpeed >= 10) factor += 0.03;
  }

  // =========================
  // TEMPERATURE IMPACT
  // =========================

  if (temp !== null) {

    // HOT WEATHER BOOST
    if (temp >= 100) factor += 0.11;
    else if (temp >= 95) factor += 0.09;
    else if (temp >= 90) factor += 0.07;
    else if (temp >= 84) factor += 0.05;
    else if (temp >= 78) factor += 0.03;

    // COLD WEATHER SUPPRESSION
    else if (temp <= 38) factor -= 0.11;
    else if (temp <= 45) factor -= 0.08;
    else if (temp <= 52) factor -= 0.05;
    else if (temp <= 58) factor -= 0.03;
  }

  // =========================
  // HUMIDITY
  // =========================

  const humidity = safeNumber(weather.humidity);

  if (humidity !== null) {
    if (humidity >= 80 && temp >= 85) {
      factor += 0.03;
    }

    if (humidity <= 30 && temp <= 60) {
      factor -= 0.02;
    }
  }

  // =========================
  // STORM / RAIN EFFECTS
  // =========================

  const condition = String(weather.condition || "").toLowerCase();

  if (
    condition.includes("storm") ||
    condition.includes("heavy rain")
  ) {
    factor -= 0.04;
  }

  // =========================
  // FINAL CLAMP
  // =========================

  return clamp(factor, 0.82, 1.38);
}
    function adjustOffense(batting) {
      if (!batting) return null;

      const last7Runs = safeNumber(batting.runs);
      const splitRuns = safeNumber(batting.splitRuns);

      const last7Allowed = safeNumber(batting.runsAllowed);
      const splitAllowed = safeNumber(batting.splitRunsAllowed);

      const fallbackRuns = avgValid(last7Runs, splitRuns, batting.weightedRuns);
      const fallbackAllowed = avgValid(last7Allowed, splitAllowed, batting.weightedRunsAllowed);

      if (fallbackRuns === null || fallbackAllowed === null) return null;

      let offense =
        fillMissing(last7Runs, fallbackRuns) * 0.60 +
        fillMissing(splitRuns, fallbackRuns) * 0.40;

      let defense =
        fillMissing(last7Allowed, fallbackAllowed) * 0.60 +
        fillMissing(splitAllowed, fallbackAllowed) * 0.40;

      const last3Runs = safeNumber(batting.last3?.runs);
      const last3Allowed = safeNumber(batting.last3?.runsAllowed);

      if (last3Runs !== null) {
        if (last3Runs >= 7.5) offense *= 1.12;
        else if (last3Runs >= 6.5) offense *= 1.08;
        else if (last3Runs >= 5.5) offense *= 1.04;

        if (last3Runs <= 2.5) offense *= 0.88;
        else if (last3Runs <= 3.2) offense *= 0.93;
      }

      if (last3Allowed !== null) {
        if (last3Allowed >= 7.5) defense *= 1.10;
        else if (last3Allowed >= 6.5) defense *= 1.06;
        else if (last3Allowed >= 5.5) defense *= 1.03;

        if (last3Allowed <= 2.5) defense *= 0.90;
        else if (last3Allowed <= 3.2) defense *= 0.95;
      }

      return {
        offense: clamp(offense, 1.2, 12.5),
        defense: clamp(defense, 1.2, 12.5)
      };
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return null;

      const last7 = bullpen.last7 || null;
      const last3 = bullpen.last3 || null;

      const baseRuns = safeNumber(bullpen.runsPerGame);
      const last7Runs = safeNumber(last7?.runsPerGame);
      const last3Runs = safeNumber(last3?.runsPerGame);

      const fallback = avgValid(baseRuns, last7Runs, last3Runs);
      if (fallback === null) return null;

      let score =
        fillMissing(last7Runs, fallback) * 0.55 +
        fillMissing(last3Runs, fallback) * 0.45;

      const whip = safeNumber(bullpen.whip);
      const last3Whip = safeNumber(last3?.whip);
      const fatigue = safeNumber(bullpen.fatigue, 0);

      const fatigueFactor = getBullpenFatigueFactor(bullpen);
score *= fatigueFactor;

      const bullpenWhip = avgValid(whip, last3Whip);

      if (bullpenWhip !== null) {
        if (bullpenWhip >= 1.70) score *= 1.14;
        else if (bullpenWhip >= 1.55) score *= 1.08;
        else if (bullpenWhip >= 1.40) score *= 1.04;

        if (bullpenWhip <= 1.05) score *= 0.92;
        else if (bullpenWhip <= 1.15) score *= 0.96;
      }

      return clamp(score, 1.0, 12.5);
    }

    function adjustPitcher(stats, sideStats = null) {
      if (!stats) return null;

      const recentRuns = safeNumber(stats.runsPerGame);
      const sideRuns = safeNumber(sideStats?.runsPerGame);
      const innings = safeNumber(stats.innings, 0);

      if (recentRuns === null) return null;

      let score =
        sideRuns !== null
          ? recentRuns * 0.60 + sideRuns * 0.40
          : recentRuns;

      const whip = safeNumber(stats.whip);
      const homeRunsPerInning = safeNumber(stats.homeRunsPerInning);
      const walksPerInning = safeNumber(stats.walksPerInning);
if (innings < 2) {
  score *= 2.10;
} else if (innings < 3) {
  score *= 1.70;
} else if (innings < 4) {
  score *= 1.35;
} else if (innings >= 6) {
  score *= 0.96;
}
      if (whip !== null) {
        if (whip >= 1.65) score *= 1.12;
        else if (whip >= 1.50) score *= 1.08;
        else if (whip >= 1.35) score *= 1.04;

        if (whip <= 1.00) score *= 0.92;
        else if (whip <= 1.10) score *= 0.96;
      }

      if (homeRunsPerInning !== null) {
        if (homeRunsPerInning >= 0.24) score *= 1.10;
        else if (homeRunsPerInning >= 0.18) score *= 1.05;
      }

      if (walksPerInning !== null) {
        if (walksPerInning >= 0.55) score *= 1.08;
        else if (walksPerInning >= 0.45) score *= 1.04;
      }

      return clamp(score, 1.0, 12.5);
    }

    function getTeamTrendScore(batting) {
      if (!batting) return 50;

      const offense = avgValid(
        batting.runs,
        batting.splitRuns
      );

      const allowed = avgValid(
        batting.runsAllowed,
        batting.splitRunsAllowed
      );

      if (offense === null && allowed === null) return 50;

      let score = 50;

      if (offense !== null && allowed !== null) {
        score += (offense - allowed) * 8;
      } else if (offense !== null) {
        score += offense * 2;
      } else if (allowed !== null) {
        score -= allowed * 2;
      }

      return clamp(score, 10, 90);
    }

    const venue = mlbData.venue || { parkFactor: 1 };
    const parkFactor = safeNumber(venue.parkFactor, 1);
    const weatherFactor = getWeatherRunFactor(mlbData.weather);
    const runEnvironmentFactor = parkFactor * weatherFactor;

    const awayBatting = mlbData.away?.battingProfile || {};
    const homeBatting = mlbData.home?.battingProfile || {};

    const awayOffenseData = adjustOffense(awayBatting);
    const homeOffenseData = adjustOffense(homeBatting);

    const awayOffenseRaw = awayOffenseData?.offense;
    const homeOffenseRaw = homeOffenseData?.offense;

    const awayDefenseRaw = awayOffenseData?.defense;
    const homeDefenseRaw = homeOffenseData?.defense;

    const awayPitcherStats = mlbData.away?.pitcher?.stats || null;
    const homePitcherStats = mlbData.home?.pitcher?.stats || null;

    const awayPitcherRaw = adjustPitcher(awayPitcherStats);
    const homePitcherRaw = adjustPitcher(homePitcherStats);

    const awayPitcherInnings = safeNumber(awayPitcherStats?.innings, 0);
    const homePitcherInnings = safeNumber(homePitcherStats?.innings, 0);

    const awayBullpenRaw = adjustBullpen(mlbData.away?.bullpen);
    const homeBullpenRaw = adjustBullpen(mlbData.home?.bullpen);

    const fallbackA = avgValid(
      awayOffenseRaw,
      homePitcherRaw,
      homeBullpenRaw,
      safeNumber(totalLine) / 2
    );

    const fallbackB = avgValid(
      homeOffenseRaw,
      awayPitcherRaw,
      awayBullpenRaw,
      safeNumber(totalLine) / 2
    );

    const awayOffense = fillMissing(awayOffenseRaw, fallbackA);
    const homePitcher = fillMissing(homePitcherRaw, fallbackA);
    const homeBullpen = fillMissing(homeBullpenRaw, fallbackA);

    const homeOffense = fillMissing(homeOffenseRaw, fallbackB);
    const awayPitcher = fillMissing(awayPitcherRaw, fallbackB);
    const awayBullpen = fillMissing(awayBullpenRaw, fallbackB);

    const awayTeamAllowed = fillMissing(awayDefenseRaw, awayPitcher);
    const homeTeamAllowed = fillMissing(homeDefenseRaw, homePitcher);

    const homeStarterShort =
      homePitcherInnings > 0 && homePitcherInnings < 4;

    const awayStarterShort =
      awayPitcherInnings > 0 && awayPitcherInnings < 4;

    const awayVsHomeStarterWeight = homeStarterShort ? 0.20 : 0.30;
    const awayVsHomeBullpenWeight = homeStarterShort ? 0.38 : 0.25;
    const awayVsHomeDefenseWeight = homeStarterShort ? 0.17 : 0.15;
    const awayOffenseWeight = homeStarterShort ? 0.25 : 0.55;

    const homeVsAwayStarterWeight = awayStarterShort ? 0.20 : 0.30;
    const homeVsAwayBullpenWeight = awayStarterShort ? 0.38 : 0.25;
    const homeVsAwayDefenseWeight = awayStarterShort ? 0.17 : 0.15;
    const homeOffenseWeight = awayStarterShort ? 0.25 : 0.55;

    let expectedRunsA =
      awayOffense * awayOffenseWeight +
      homePitcher * awayVsHomeStarterWeight +
      homeTeamAllowed * awayVsHomeDefenseWeight +
      homeBullpen * awayVsHomeBullpenWeight;

    let expectedRunsB =
      homeOffense * homeOffenseWeight +
      awayPitcher * homeVsAwayStarterWeight +
      awayTeamAllowed * homeVsAwayDefenseWeight +
      awayBullpen * homeVsAwayBullpenWeight;

    if (homeStarterShort) expectedRunsA += 0.35;
    if (awayStarterShort) expectedRunsB += 0.35;

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
    const defenseAdvAway = homeTeamAllowed - awayTeamAllowed;
    const trendAdvAway = awayTrendScore - homeTrendScore;

    const rawAwayWin =
  0.5 +
  runDiff * 0.060 +
  offenseAdvAway * 0.014 -
  pitcherAdvAway * 0.017 -
  bullpenAdvAway * 0.016 +
  defenseAdvAway * 0.010 +
  trendAdvAway * 0.0012;

    const modelProbA = clamp(rawAwayWin, 0.10, 0.90);
    const modelProbB = 1 - modelProbA;

    let awayOdds = null;
    let homeOdds = null;

    if (outcomes?.length) {
      awayOdds = outcomes.find(o => o.name === awayTeam)?.price;
      homeOdds = outcomes.find(o => o.name === homeTeam)?.price;
    }

    const marketProbA = americanToProb(awayOdds);
    const marketProbB = americanToProb(homeOdds);

    const totalStdDev = 2.65;

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

      const teamDefenseAllowed = isAway ? awayTeamAllowed : homeTeamAllowed;
      const opponentDefenseAllowed = isAway ? homeTeamAllowed : awayTeamAllowed;

      const teamTrend = isAway ? awayTrendScore : homeTrendScore;
      const opponentTrend = isAway ? homeTrendScore : awayTrendScore;

      const modelProb = isAway ? modelProbA : modelProbB;
      const marketProb = isAway ? marketProbA : marketProbB;
      const edge = (modelProb - marketProb) * 100;

      const projectedMargin = teamExpected - opponentExpected;

      let support = 50;

      support += projectedMargin * 10;
      support += (teamOffense - opponentOffense) * 4.5;
      support += (opponentPitcherAllowed - teamPitcherAllowed) * 4.2;
      support += (opponentBullpenAllowed - teamBullpenAllowed) * 4.0;
      support += (opponentDefenseAllowed - teamDefenseAllowed) * 2.2;
      support += (teamTrend - opponentTrend) * 0.30;
      support += edge * 1.05;

      if (!isAway) support += 1.2;

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
        teamDefenseAllowed,
        opponentDefenseAllowed,
        teamTrend,
        opponentTrend
      };
    }

    function estimateRunlineProb(side, spread) {
      const isAway = side === "away";
      const meanMargin = isAway ? runDiff : -runDiff;
      const spreadNumber = safeNumber(spread, 0);
      const marginStdDev = 2.15;

      return (1 - normalCDF(-spreadNumber, meanMargin, marginStdDev)) * 100;
    }

    function buildSideCandidate(side, marketType, spread = null) {
      const supportData = getSupportForSide(side);
      const isRunline = marketType === "RUNLINE";

      let confidence;
      let runlineProb = null;

     if (marketType === "ML") {
  const margin = Math.abs(supportData.projectedMargin);

  confidence = edgeToPercent(margin, 2.0, 5.5);

  if (supportData.modelProb < 0.55) confidence = 0;

} else {
  runlineProb = estimateRunlineProb(side, spread);

  const spreadNumber = Number(spread || 0);
  const protectedEdgeForPercent = supportData.projectedMargin + spreadNumber;

 if (spreadNumber > 0) {
  // RL +1.5 debe valer más que ML porque tiene protección extra
  const baseRlConfidence = edgeToPercent(protectedEdgeForPercent, 3.0, 6.0);

  const protectionBonus = Math.min(10, spreadNumber * 6);

  confidence = clamp(baseRlConfidence + protectionBonus, 0, 99);

} else {
  // RL -1.5 es más difícil que ML
  confidence = edgeToPercent(protectedEdgeForPercent, 2.0, 5.5);
}
  if (runlineProb < 65) confidence = 0;
}

      const isPositiveRunline = isRunline && Number(spread) > 0;
      const isNegativeRunline = isRunline && Number(spread) < 0;

      const protectedEdge =
        isRunline ? supportData.projectedMargin + Number(spread || 0) : null;

     
     if (isNegativeRunline) {
  if (supportData.projectedMargin >= 3.5) confidence += 3;
  else if (supportData.projectedMargin >= 2.8) confidence += 1.5;
}

if (isPositiveRunline) {
  if (protectedEdge >= 4.5) confidence += 2;
  else if (protectedEdge >= 3.8) confidence += 1;
  else confidence -= 4;
}

      confidence = clamp(confidence, 0, 99);

      const label =
        marketType === "ML"
          ? `${supportData.teamName} ML`
          : `${supportData.teamName} ${spread > 0 ? "+" : ""}${spread}`;

      const title =
        marketType === "ML"
          ? "Jugada Premium ML"
          : "Jugada Premium Runline";

      const premiumRule =
  marketType === "ML"
    ? Math.abs(supportData.projectedMargin) >= 2.0
    : (
        Number(spread) > 0
          ? protectedEdge >= 3.0
          : protectedEdge >= 2.0
      );

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
        protectedEdge: protectedEdge === null ? null : Number(protectedEdge.toFixed(2)),
        runlineProbability: runlineProb === null ? null : Number(runlineProb.toFixed(1)),
        isPremium:
          confidence >= 75 &&
          supportData.support >= 55 &&
          premiumRule
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
        support += (bullpenPressure - expectedPressure) * 1.4;
      } else {
        support += -diff * 11;
        support += (1 - runEnvironmentFactor) * 100;
        support += (expectedPressure - offensePressure) * 1.5;
        support += (expectedPressure - pitchingPressure) * 1.2;
        support += (expectedPressure - bullpenPressure) * 1.4;
      }

      support = clamp(support, 0, 100);

     let confidence = isOver
  ? edgeToPercent(totalEdge, 2.0, 5.5)
: edgeToPercent(totalEdge, 2.5, 6.0);

if (probability < 62) confidence = 0;

confidence = clamp(confidence, 0, 99);

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
  (
    isOver
      ? totalEdge >= 2.0
      : totalEdge >= 2.5
  )
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

    const recommendedCards = premiumCandidates.slice(0, 2);

    const locked = recommendedCards.length > 0 && !isPremiumUser;
function edgeToPercent(edge, minEdge, eliteEdge) {
  const e = Math.abs(Number(edge));

  if (!Number.isFinite(e) || e < minEdge) return 0;

  const progress = Math.max(
    0,
    Math.min(
      1,
      (e - minEdge) / (eliteEdge - minEdge)
    )
  );

  return Number((75 + progress * 24).toFixed(1));
}

function getBullpenFatigueFactor(bullpen) {
  if (!bullpen) return 1;

  const fatigue = Number(bullpen.fatigue);

  if (!Number.isFinite(fatigue)) return 1;

  if (fatigue >= 28) return 1.34;
  if (fatigue >= 24) return 1.28;
  if (fatigue >= 20) return 1.23;
  if (fatigue >= 16) return 1.18;
  if (fatigue >= 12) return 1.12;
  if (fatigue >= 8) return 1.07;
  if (fatigue >= 5) return 1.03;

  if (fatigue <= 2.5) return 0.93;
  if (fatigue <= 4) return 0.97;

  return 1;
}
    const fullMlbAnalysis = {
  locked: false,
  isPremiumPick: recommendedCards.length > 0,
  noPlay: recommendedCards.length === 0,
  public: {
    awayTeam,
    homeTeam,
    totalLine
  },
  premium: {
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

    weatherFactor
  }
};

await supabaseAdmin.from("daily_picks").upsert({
  sport: "mlb",
  game_id: `${awayTeam}-${homeTeam}`,
  away_team: awayTeam,
  home_team: homeTeam,
  analysis_json: fullMlbAnalysis,
 updated_at: new Date().toISOString(),
game_date: new Date().toISOString().split("T")[0]
});
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

            awayTeamAllowed,
            homeTeamAllowed,

            awayPitcherAllowed: awayPitcher,
            homePitcherAllowed: homePitcher,

            awayBullpenAllowed: awayBullpen,
            homeBullpenAllowed: homeBullpen,

            awayPitcherName: mlbData.away?.pitcher?.name || "No disponible",
            homePitcherName: mlbData.home?.pitcher?.name || "No disponible",

            awayPitcherInnings,
            homePitcherInnings,

            awayBullpenFatigue: mlbData.away?.bullpen?.fatigue || 0,
            homeBullpenFatigue: mlbData.home?.bullpen?.fatigue || 0,

            awayBullpenFatigueFactor: getBullpenFatigueFactor(mlbData.away?.bullpen),
homeBullpenFatigueFactor: getBullpenFatigueFactor(mlbData.home?.bullpen),

            awayRunEnvironment: expectedRunsA,
            homeRunEnvironment: expectedRunsB,

            runEnvironmentFactor,
            parkFactor
          }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

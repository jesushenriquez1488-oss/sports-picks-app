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

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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

    // 🔥 PRO FUNCTIONS

    function adjustPitcher(stats) {
      if (!stats) return 4.55;

      let score = stats.runsPerGame || 4.55;
      const whip = stats.whip || 1.3;

      if (whip >= 1.6) score *= 1.15;
      else if (whip >= 1.4) score *= 1.08;
      else if (whip <= 1.1) score *= 0.92;

      return score;
    }

    function adjustOffense(batting) {
      if (!batting) return 4.55;

      let score = batting.weightedRuns || batting.runs || 4.55;

      if (batting.splitRuns) {
        score = score * 0.7 + batting.splitRuns * 0.3;
      }

      if (batting.last3?.runs >= 5) score *= 1.08;
      if (batting.last3?.runs <= 3) score *= 0.92;

      if (batting.avg >= 0.280) score *= 1.05;
      if (batting.avg <= 0.230) score *= 0.94;

      return score;
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return 4.55;

      let score = bullpen.runsPerGame || 4.55;
      const whip = bullpen.whip || 1.3;

      if (bullpen.fatigue >= 8) score *= 1.12;
      else if (bullpen.fatigue >= 6) score *= 1.06;
      else if (bullpen.fatigue <= 2) score *= 0.94;

      if (whip >= 1.5) score *= 1.08;
      if (whip <= 1.2) score *= 0.95;

      return score;
    }

    function weatherImpact(weather) {
      if (!weather || !weather.active) return 1;

      let f = 1;

      if (weather.direction === "out") f += 0.06;
      if (weather.direction === "in") f -= 0.05;

      if (weather.temp >= 85) f += 0.03;
      if (weather.temp <= 55) f -= 0.02;

      return clamp(f, 0.9, 1.12);
    }

    const leagueAvg = 4.55;

    const parkFactor = mlbData.venue?.parkFactor || 1;
    const weatherFactor = weatherImpact(mlbData.weather);

    // 🔥 USANDO DATA PRO

    const awayOffense = adjustOffense(mlbData.away.battingProfile);
    const homeOffense = adjustOffense(mlbData.home.battingProfile);

    const awayPitcher = adjustPitcher(mlbData.away.pitcher?.stats);
    const homePitcher = adjustPitcher(mlbData.home.pitcher?.stats);

    const awayBullpen = adjustBullpen(mlbData.away.bullpen);
    const homeBullpen = adjustBullpen(mlbData.home.bullpen);

    const awayRuns =
      awayOffense * 0.55 +
      (homePitcher * 0.30 + homeBullpen * 0.15);

    const homeRuns =
      homeOffense * 0.55 +
      (awayPitcher * 0.30 + awayBullpen * 0.15);

    let expectedRunsA = awayRuns * parkFactor * weatherFactor;
    let expectedRunsB = homeRuns * parkFactor * weatherFactor;

    expectedRunsA = clamp(expectedRunsA, 1.5, 10.5);
    expectedRunsB = clamp(expectedRunsB, 1.5, 10.5);

    const projectedTotal = expectedRunsA + expectedRunsB;

    const runDiff = expectedRunsA - expectedRunsB;

    const modelProbA = clamp(0.5 + runDiff * 0.11, 0.05, 0.95);
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

    let play = "";
    let prob = 0;

    if (valueEdge >= 7) {
      if (valueSpread > 0 && valueEdge >= 9.5) {
        play = `${valueTeam} +${valueSpread}`;
        prob = 55 + valueEdge * 2;
      } else if (valueSpread <= 0) {
        play = `${valueTeam} ML`;
        prob = 54 + valueEdge * 2.5;
      }
    }

    const cards = [];

    if (play) {
      cards.push({
        title: "Jugada Premium",
        play,
        percentage: prob
      });
    }

    if (
      totalProb >= 68 &&
      (
        totalPick === "OVER" ||
        (totalPick === "UNDER" && totalProb >= 70)
      )
    ) {
      cards.push({
        title: "Total Premium",
        play: `${totalPick} ${totalLine}`,
        percentage: totalProb
      });
    }

    cards.sort((a, b) => b.percentage - a.percentage);

    const locked = cards.length > 0 && !isPremiumUser;

    return res.status(200).json({
      locked,
      isPremiumPick: cards.length > 0,
      public: {
        awayTeam,
        homeTeam,
        totalLine
      },
      premium: locked ? null : {
        recommendedCards: cards,
        expectedRunsA,
        expectedRunsB,
        projectedTotal
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

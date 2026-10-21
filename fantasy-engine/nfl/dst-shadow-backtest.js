
"use strict";

/**
 * CashEdge Fantasy Edge
 * NFL DST Distribution Backtest V2
 *
 * Evalua la distribucion real de errores.
 * Conserva el modelo 65/35 sin modificarlo.
 *
 * SHADOW ONLY.
 * No escribe en Supabase.
 * No modifica produccion.
 */

const fs = require("fs");
const path = require("path");

const { scoreNFLDST } = require("./dst-scoring");
const { projectNFLDST } = require("./dst-projection");

const FILE = path.resolve(
  process.cwd(),
  "dst-history-shadow.json"
);

const PLATFORMS = ["draftkings", "fanduel"];
const MAX_GAMES = 8;
const MIN_GAMES = 3;

function round(n) {
  return Math.round(n * 100) / 100;
}

function avg(values) {
  return values.reduce((a, b) => a + b, 0)
    / values.length;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);

  return sorted[low] +
    (sorted[high] - sorted[low]) * (index - low);
}

function pct(count, total) {
  return `${round(count * 100 / total)}%`;
}

function historicalBaseline(history, platform) {
  const valid = [...history]
    .sort(
      (a, b) =>
        Date.parse(b.gameDate) - Date.parse(a.gameDate)
    )
    .slice(0, MAX_GAMES);

  if (valid.length < MIN_GAMES) {
    return null;
  }

  let total = 0;
  let weightTotal = 0;

  for (let i = 0; i < valid.length; i++) {
    const score = scoreNFLDST(
      valid[i].stats,
      platform
    );

    if (!score.complete) return null;

    const weight = valid.length - i;
    total += score.points * weight;
    weightTotal += weight;
  }

  return total / weightTotal;
}

function report(platform, results, skipped) {
  if (!results.length) {
    throw new Error(
      `No valid evaluations for ${platform}`
    );
  }

  const n = results.length;
  const errors = results.map(r => r.absError);

  const mae = avg(errors);
  const baselineMAE = avg(
    results.map(r => Math.abs(r.baseline - r.actual))
  );

  const bias = avg(results.map(r => r.error));
  const rmse = Math.sqrt(
    avg(results.map(r => r.error ** 2))
  );

  const bands = [
    ["0-2 points", e => e <= 2],
    [">2-5 points", e => e > 2 && e <= 5],
    [">5-8 points", e => e > 5 && e <= 8],
    [">8-10 points", e => e > 8 && e <= 10],
    [">10 points", e => e > 10]
  ];

  console.log(
    `\n===== ${platform.toUpperCase()} =====`
  );

  console.log("Games evaluated:", n);
  console.log("Skipped:", JSON.stringify(skipped));
  console.log("CashEdge MAE:", round(mae));
  console.log("Historical baseline MAE:", round(baselineMAE));
  console.log("Bias:", round(bias));
  console.log("RMSE:", round(rmse));

  console.log(
    "Model better than baseline:",
    mae < baselineMAE
  );

  console.log("\n===== ERROR DISTRIBUTION =====");

  for (const [label, test] of bands) {
    const count = errors.filter(test).length;
    console.log(
      `${label}: ${count}/${n} (${pct(count, n)})`
    );
  }

  const within5 = errors.filter(e => e <= 5).length;
  const within10 = errors.filter(e => e <= 10).length;

  console.log("\n===== ACCURACY SUMMARY =====");

  console.log(
    "Within +/-5:",
    pct(within5, n)
  );

  console.log(
    "Within +/-10:",
    pct(within10, n)
  );

  console.log(
    "Median absolute error:",
    round(percentile(errors, 0.5))
  );

  console.log(
    "90th percentile error:",
    round(percentile(errors, 0.9))
  );

  console.log(
    "Overestimated:",
    results.filter(r => r.error > 0).length
  );

  console.log(
    "Underestimated:",
    results.filter(r => r.error < 0).length
  );

  console.log("\n===== PROJECTED SCORE GROUPS =====");

  const groups = [
    ["Below 5", r => r.projected < 5],
    ["5 to <10", r =>
      r.projected >= 5 && r.projected < 10
    ],
    ["10 or more", r => r.projected >= 10]
  ];

  for (const [label, test] of groups) {
    const group = results.filter(test);

    if (!group.length) {
      console.log(`${label}: no observations`);
      continue;
    }

    console.log(
      `${label}: games=${group.length}, ` +
      `MAE=${round(avg(group.map(r => r.absError)))}, ` +
      `Bias=${round(avg(group.map(r => r.error)))}`
    );
  }

  console.log("\n===== EXTREME ERRORS =====");

  const extreme = results
    .filter(r => r.absError > 10)
    .sort((a, b) => b.absError - a.absError);

  console.log(
    "Errors above 10 points:",
    extreme.length
  );

  for (const r of extreme.slice(0, 10)) {
    console.log(
      `${r.gameId} | ${r.team} | ` +
      `Projected=${r.projected} | ` +
      `Actual=${r.actual} | ` +
      `AbsoluteError=${round(r.absError)}`
    );
  }
}

function main() {
  if (!fs.existsSync(FILE)) {
    throw new Error(
      "Missing dst-history-shadow.json"
    );
  }

  const data = JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

  if (
    data.mode !== "SHADOW" ||
    data.readyForOptimization !== false ||
    data.readyForPublication !== false
  ) {
    throw new Error("SHADOW protection failed");
  }

  const records = data.records || [];

  const targets = records.filter(
    r => r.season === 2026 && r.complete === true
  );

  console.log("\n===== CASHEDGE DST ANALYSIS =====");
  console.log("Historical records:", records.length);
  console.log("2026 targets:", targets.length);
  console.log("Mode: SHADOW");

  for (const platform of PLATFORMS) {
    const results = [];
    const skipped = {};

    for (const target of targets) {
      const cutoff =
        target.gameDate.slice(0, 10) +
        "T00:00:00Z";

      const cutoffTime = Date.parse(cutoff);

      // No usar resultados del partido objetivo
      // ni de partidos posteriores.

      const previous = records.filter(r =>
        r.complete === true &&
        Number.isFinite(Date.parse(r.gameDate)) &&
        Date.parse(r.gameDate) < cutoffTime
      );

      const defenseGames = previous.filter(
        r => r.team === target.team
      );

      const opponentGames = previous.filter(
        r => r.opponent === target.opponent
      );

      const projection = projectNFLDST({
        platform,
        team: target.team,
        opponent: target.opponent,
        kickoff: cutoff,
        defenseGames,
        opponentGames
      });

      if (!Number.isFinite(projection.projectedPoints)) {
        const reason = projection.status || "unknown";
        skipped[reason] = (skipped[reason] || 0) + 1;
        continue;
      }

      const actual = scoreNFLDST(
        target.stats,
        platform
      );

      const baseline = historicalBaseline(
        defenseGames,
        platform
      );

      if (!actual.complete || !Number.isFinite(baseline)) {
        skipped.invalid_score =
          (skipped.invalid_score || 0) + 1;
        continue;
      }

      const predicted = projection.projectedPoints;
      const error = predicted - actual.points;

      results.push({
        gameId: target.gameId,
        team: target.team,
        opponent: target.opponent,
        projected: predicted,
        actual: actual.points,
        baseline,
        error,
        absError: Math.abs(error)
      });
    }

    report(platform, results, skipped);
  }

  console.log("\nDISTRIBUTION BACKTEST COMPLETE");
  console.log("Scoring still requires external validation");
  console.log("Optimization remains BLOCKED");
  console.log("No production changes");
}

main();

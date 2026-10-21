
"use strict";

/**
 * CashEdge Fantasy Edge
 * NFL DST Historical Backtest
 *
 * Evalua partidos NFL 2026 utilizando
 * exclusivamente historiales anteriores.
 *
 * Compara:
 * 1. Modelo CashEdge 65/35
 * 2. Baseline historico de la defensa
 *
 * No modifica Supabase.
 * No publica recomendaciones.
 * No permite optimizacion.
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

function avg(values) {
  if (!values.length) return null;

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function historicalBaseline(history, platform, cutoff) {
  const valid = history
    .filter(game =>
      game.complete === true &&
      Date.parse(game.gameDate) < Date.parse(cutoff)
    )
    .sort(
      (a, b) =>
        Date.parse(b.gameDate) -
        Date.parse(a.gameDate)
    )
    .slice(0, MAX_GAMES);

  if (valid.length < MIN_GAMES) {
    return null;
  }

  let total = 0;
  let totalWeight = 0;

  valid.forEach((game, index) => {
    const score = scoreNFLDST(game.stats, platform);

    if (!score.complete) return;

    const weight = valid.length - index;

    total += score.points * weight;
    totalWeight += weight;
  });

  return totalWeight > 0
    ? total / totalWeight
    : null;
}

function main() {
  if (!fs.existsSync(FILE)) {
    throw new Error(
      "Falta dst-history-shadow.json. " +
      "Ejecuta primero dst-stats-bridge.py"
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
    throw new Error(
      "El historial no esta protegido en SHADOW"
    );
  }

  const records = data.records || [];

  const targets = records.filter(
    record =>
      record.season === 2026 &&
      record.complete === true
  );

  console.log("\n===== NFL DST BACKTEST =====");
  console.log("Historical records:", records.length);
  console.log("2026 targets:", targets.length);
  console.log("Mode: SHADOW");

  for (const platform of PLATFORMS) {
    const results = [];
    const skipped = {};

    for (const target of targets) {
      // Excluye por completo los partidos
      // jugados el mismo dia del encuentro.
      const cutoff =
        target.gameDate.slice(0, 10) +
        "T00:00:00Z";

      const defenseGames = records.filter(
        record => record.team === target.team
      );

      // Partidos anteriores de defensas que
      // enfrentaron a la ofensiva del rival.
      const opponentGames = records.filter(
        record =>
          record.opponent === target.opponent
      );

      const projection = projectNFLDST({
        platform,
        team: target.team,
        opponent: target.opponent,
        kickoff: cutoff,
        defenseGames,
        opponentGames
      });

      if (
        !Number.isFinite(
          projection.projectedPoints
        )
      ) {
        const reason =
          projection.status || "unknown";

        skipped[reason] =
          (skipped[reason] || 0) + 1;

        continue;
      }

      const actual = scoreNFLDST(
        target.stats,
        platform
      );

      if (!actual.complete) {
        skipped.invalid_actual =
          (skipped.invalid_actual || 0) + 1;
        continue;
      }

      const baseline = historicalBaseline(
        defenseGames,
        platform,
        cutoff
      );

      if (!Number.isFinite(baseline)) {
        skipped.invalid_baseline =
          (skipped.invalid_baseline || 0) + 1;
        continue;
      }

      results.push({
        gameId: target.gameId,
        team: target.team,
        opponent: target.opponent,
        projected: projection.projectedPoints,
        baseline: round(baseline),
        actual: actual.points,
        error: round(
          projection.projectedPoints -
          actual.points
        )
      });
    }

    if (!results.length) {
      throw new Error(
        `No hay evaluaciones validas: ${platform}`
      );
    }

    const modelMAE = avg(
      results.map(
        row => Math.abs(row.error)
      )
    );

    const baselineMAE = avg(
      results.map(
        row => Math.abs(
          row.baseline - row.actual
        )
      )
    );

    const bias = avg(
      results.map(row => row.error)
    );

    const rmse = Math.sqrt(
      avg(
        results.map(
          row => row.error ** 2
        )
      )
    );

    console.log(
      `\n===== ${platform.toUpperCase()} =====`
    );

    console.log(
      "Games evaluated:", results.length
    );

    console.log(
      "Skipped:", JSON.stringify(skipped)
    );

    console.log(
      "CashEdge MAE:", round(modelMAE)
    );

    console.log(
      "Historical baseline MAE:",
      round(baselineMAE)
    );

    console.log(
      "Bias:", round(bias)
    );

    console.log(
      "RMSE:", round(rmse)
    );

    console.log(
      "Model better than baseline:",
      modelMAE < baselineMAE
    );

    console.log("\nLargest errors:");

    const worst = [...results]
      .sort(
        (a, b) =>
          Math.abs(b.error) -
          Math.abs(a.error)
      )
      .slice(0, 5);

    for (const row of worst) {
      console.log(
        `${row.gameId} | ${row.team} | ` +
        `Predicted: ${row.projected} | ` +
        `Actual: ${row.actual} | ` +
        `Error: ${row.error}`
      );
    }
  }

  console.log("\nBACKTEST EXECUTED");
  console.log("Results remain experimental");
  console.log("Optimization remains BLOCKED");
}

main();

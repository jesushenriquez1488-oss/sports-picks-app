
"use strict";

// CASHEDGE FANTASY NBA — MINUTES BACKTEST V1
// Solo lee el historial SHADOW de Fantasy.
// No toca Supabase, BALLDONTLIE, Premium Picks o Player Props.
// Backtest condicional a que el jugador realmente participo.

const fs = require("node:fs");
const path = require("node:path");

const DIR = path.resolve("fantasy-shadow-input");
const INPUT = path.join(DIR, "nba-fantasy-history.json");
const OUTPUT = path.join(DIR, "nba-minutes-backtest.json");

const id = x => String(x ?? "").trim();
const round = x => Math.round(x * 100) / 100;
const mean = a =>
  a.reduce((s, x) => s + x, 0) / a.length;

function median(a) {
  const sorted = [...a].sort((x, y) => x - y);
  const center = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[center]
    : (sorted[center - 1] + sorted[center]) / 2;
}

function exponentialMean(a, decay) {
  let total = 0;
  let weights = 0;

  a.forEach((value, i) => {
    const w = Math.pow(decay, i);
    total += value * w;
    weights += w;
  });

  return total / weights;
}

function minutes(x) {
  if (
    x === null ||
    x === undefined ||
    x === ""
  ) {
    return null;
  }

  const n = Number(x);

  return Number.isFinite(n) &&
    n > 0 &&
    n <= 60
    ? n
    : null;
}

function timestamp(x) {
  const n = Date.parse(x || "");

  return Number.isFinite(n) ? n : null;
}

// Reproduce el calculo inicial SHADOW
// para poder medirlo contra alternativas.

function existingShadowV1(prior, targetTeam) {
  const current = prior
    .filter(g =>
      g.season === 2026 &&
      g.teamId === targetTeam
    )
    .slice(0, 10)
    .map(g => g.minutes);

  const previous = prior
    .filter(g =>
      g.season === 2025 &&
      g.teamId === targetTeam
    )
    .slice(0, 12)
    .map(g => g.minutes);

  const currentMean = current.length
    ? exponentialMean(current, 0.94)
    : null;

  const previousMean = previous.length
    ? exponentialMean(previous, 0.94)
    : null;

  const shift =
    current.length >= 3 &&
    previous.length >= 5 &&
    Math.abs(currentMean - previousMean) >= 6;

  if (
    currentMean !== null &&
    (
      previousMean === null ||
      shift
    )
  ) {
    return currentMean;
  }

  if (
    currentMean !== null &&
    previousMean !== null
  ) {
    const w = current.length /
      (current.length + 5);

    return currentMean * w +
      previousMean * (1 - w);
  }

  return previousMean;
}

function modelPredictions(prior, targetTeam) {
  // Partidos anteriores ordenados
  // del mas reciente al mas antiguo.

  const all = prior.map(g => g.minutes);

  const same = prior
    .filter(g => g.teamId === targetTeam)
    .map(g => g.minutes);

  return {
    EXISTING_SHADOW_V1:
      existingShadowV1(prior, targetTeam),

    LAST5_ALL:
      all.length >= 3
        ? mean(all.slice(0, 5))
        : null,

    LAST10_ALL:
      all.length >= 5
        ? mean(all.slice(0, 10))
        : null,

    MEDIAN10_ALL:
      all.length >= 5
        ? median(all.slice(0, 10))
        : null,

    EWMA10_ALL:
      all.length >= 5
        ? exponentialMean(
            all.slice(0, 10),
            0.9
          )
        : null,

    LAST10_SAME_TEAM:
      same.length >= 5
        ? mean(same.slice(0, 10))
        : null,

    BLEND_SAME_TEAM:
      same.length >= 3
        ? (() => {
            const recent = mean(
              same.slice(0, 5)
            );

            const long = mean(
              same.slice(0, 20)
            );

            const n = Math.min(
              same.length,
              5
            );

            const w = n / (n + 5);

            return w * recent +
              (1 - w) * long;
          })()
        : null
  };
}

function score(observations) {
  const errors = observations.map(
    o => o.pred - o.actual
  );

  if (!errors.length) {
    return {
      n: 0,
      mae: null,
      rmse: null,
      bias: null,
      within3: null,
      within5: null
    };
  }

  return {
    n: errors.length,

    mae: round(
      mean(errors.map(Math.abs))
    ),

    rmse: round(
      Math.sqrt(
        mean(errors.map(e => e * e))
      )
    ),

    bias: round(mean(errors)),

    within3: round(
      100 * errors.filter(
        e => Math.abs(e) <= 3
      ).length / errors.length
    ),

    within5: round(
      100 * errors.filter(
        e => Math.abs(e) <= 5
      ).length / errors.length
    )
  };
}

function main() {
  const source = JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

  if (
    source.mode !== "shadow" ||
    source.module !== "fantasy_nba" ||
    !Array.isArray(source.players)
  ) {
    throw new Error(
      "Invalid Fantasy history report"
    );
  }

  const models = [
    "EXISTING_SHADOW_V1",
    "LAST5_ALL",
    "LAST10_ALL",
    "MEDIAN10_ALL",
    "EWMA10_ALL",
    "LAST10_SAME_TEAM",
    "BLEND_SAME_TEAM"
  ];

  const rows = [];
  const seen = new Set();

  let noHistory = 0;
  let invalidMinutes = 0;
  let skippedSameUtcDay = 0;

  for (const player of source.players) {
    if (
      !player.shadowEligible ||
      !player.nbaPlayerId
    ) {
      continue;
    }

    const original = Array.isArray(
      player.historicalGames
    )
      ? player.historicalGames
      : [];

    const games = [];

    for (const game of original) {
      const t = timestamp(
        game.gameDate
      );

      const m = minutes(
        game.minutes
      );

      const gameId = id(
        game.gameId
      );

      if (m === null) {
        invalidMinutes++;
        continue;
      }

      if (
        t === null ||
        !gameId ||
        !id(game.teamId)
      ) {
        continue;
      }

      const key = [
        id(player.nbaPlayerId),
        id(game.season),
        gameId
      ].join(":");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      games.push({
        gameId,
        gameDate: game.gameDate,

        day: new Date(t)
          .toISOString()
          .slice(0, 10),

        t,
        season: Number(game.season),
        teamId: id(game.teamId),
        minutes: m
      });
    }

    // Orden cronologico.
    // El partido futuro nunca entra
    // al historial que genera su prediccion.

    games.sort(
      (a, b) =>
        a.t - b.t ||
        a.gameId.localeCompare(b.gameId)
    );

    if (games.length < 4) {
      noHistory++;
      continue;
    }

    for (
      let i = 0;
      i < games.length;
      i++
    ) {
      const target = games[i];

      // Prohibido consultar partidos
      // del mismo dia UTC del partido objetivo.

      const prior = games
        .slice(0, i)
        .filter(g =>
          g.day < target.day
        )
        .reverse();

      if (prior.length !== i) {
        skippedSameUtcDay +=
          i - prior.length;
      }

      if (prior.length < 3) {
        continue;
      }

      const candidates =
        modelPredictions(
          prior,
          target.teamId
        );

      const priorSame = prior.filter(
        g => g.teamId === target.teamId
      );

      const previousTeam =
        prior[0]?.teamId ?? null;

      const switchedTeam =
        previousTeam !== null &&
        previousTeam !== target.teamId;

      const recent3 = prior
        .slice(0, 3)
        .map(g => g.minutes);

      const older5 = prior
        .slice(3, 8)
        .map(g => g.minutes);

      const roleShiftSignal =
        older5.length >= 5 &&
        Math.abs(
          mean(recent3) -
          mean(older5)
        ) >= 6;

      rows.push({
        espnPlayerId:
          id(player.espnPlayerId),

        nbaPlayerId:
          id(player.nbaPlayerId),

        player: player.espnName,

        season: target.season,
        date: target.day,
        gameId: target.gameId,
        targetTeam: target.teamId,

        priorGames: prior.length,

        sameTeamPriorGames:
          priorSame.length,

        switchedTeam,
        roleShiftSignal,

        actual: target.minutes,
        predictions: candidates
      });
    }
  }

  function byModel(subset) {
    return Object.fromEntries(
      models.map(name => [
        name,

        score(
          subset
            .filter(r =>
              r.predictions[name] !== null
            )
            .map(r => ({
              actual: r.actual,
              pred: r.predictions[name]
            }))
        )
      ])
    );
  }

  // Comparacion justa:
  // mismos partidos para todos los metodos.

  const commonRows = rows.filter(
    row => models.every(
      name =>
        row.predictions[name] !== null
    )
  );

  const breakdown = {
    allEligible: byModel(rows),

    sharedSampleAllModels:
      byModel(commonRows),

    season2025: byModel(
      rows.filter(
        r => r.season === 2025
      )
    ),

    season2026: byModel(
      rows.filter(
        r => r.season === 2026
      )
    ),

    teamSwitch: byModel(
      rows.filter(
        r => r.switchedTeam
      )
    ),

    recentRoleShiftSignal: byModel(
      rows.filter(
        r => r.roleShiftSignal
      )
    )
  };

  const worst = rows
    .filter(
      r => r.predictions.LAST10_ALL !== null
    )
    .map(r => ({
      player: r.player,
      date: r.date,
      season: r.season,
      actual: round(r.actual),

      last10: round(
        r.predictions.LAST10_ALL
      ),

      absError: round(
        Math.abs(
          r.predictions.LAST10_ALL -
          r.actual
        )
      ),

      priorGames: r.priorGames,
      switchedTeam: r.switchedTeam
    }))
    .sort(
      (a, b) =>
        b.absError - a.absError
    )
    .slice(0, 15);

  const report = {
    mode: "shadow",
    module: "fantasy_nba",

    generatedAt:
      new Date().toISOString(),

    inputCutoff: source.asOfDate,

    limitations: [
      "Backtest retrospective",
      "Uses current ESPN player cohort",
      "No historical ESPN depth-chart snapshots",
      "No historical injury reconstruction",
      "Measures minutes conditional on playing",
      "Does not predict participation probability",
      "Not prospectively validated"
    ],

    summary: {
      evaluatedPlayerGames:
        rows.length,

      sharedSampleAllModels:
        commonRows.length,

      withoutEnoughHistoryPlayers:
        noHistory,

      invalidOrZeroMinuteRows:
        invalidMinutes,

      sameUtcDayPriorPairsExcluded:
        skippedSameUtcDay
    },

    breakdown,

    worstLast10Misses: worst,

    readyForProduction: false,
    usedHistoricalEspnRoles: false
  };

  fs.mkdirSync(
    DIR,
    { recursive: true }
  );

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(
    "===== FANTASY NBA MINUTES BACKTEST ====="
  );

  console.log(
    "MODE: SHADOW / READ ONLY"
  );

  console.log(
    "SUMMARY:",
    JSON.stringify(
      report.summary,
      null,
      2
    )
  );

  console.log(
    "SEASON 2026:",
    JSON.stringify(
      breakdown.season2026,
      null,
      2
    )
  );

  console.log(
    "SAME-SAMPLE COMPARISON:",
    JSON.stringify(
      breakdown.sharedSampleAllModels,
      null,
      2
    )
  );

  console.log(
    "FULL REPORT:",
    OUTPUT
  );

  console.log(
    "NO DATABASE WRITES | NO PRODUCTION CHANGES"
  );
}

try {
  main();
} catch (error) {
  console.error(
    "FANTASY_MINUTES_BACKTEST_ERROR:",
    error.stack || error.message
  );

  process.exitCode = 1;
}

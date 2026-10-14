
"use strict";

// =========================================
// CASHEDGE NFL PLAYER PROPS V2
// ROLE AND OPPORTUNITY ANALYZER
// =========================================

function finiteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function avg(values) {
  const valid = values.filter(
    v => finiteNumber(v) !== null
  );

  return valid.length
    ? valid.reduce(
        (sum, v) => sum + v,
        0
      ) / valid.length
    : null;
}

function median(values) {
  const sorted = values
    .filter(v => finiteNumber(v) !== null)
    .sort((a, b) => a - b);

  if (!sorted.length) {
    return null;
  }

  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[mid]
    : (
        sorted[mid - 1] +
        sorted[mid]
      ) / 2;
}

// =========================================
// OPPORTUNITY METRICS
// =========================================

function measure(history, area, field) {

  const sample = history.map(
    game => finiteNumber(
      game?.[area]?.[field]
    )
  );

  const last7 = sample.slice(-7);
  const last3 = sample.slice(-3);

  const average3 = avg(last3);
  const average7 = avg(last7);

  return {
    gamesInRecentWindow:
      last7.filter(
        value => value !== null
      ).length,

    last3Average: average3,
    last7Average: average7,
    last7Median: median(last7),

    // Señal preliminar de volumen.
    // No es Confidence ni probabilidad.
    candidate:
      average3 !== null &&
      average7 !== null
        ? (
            0.6 * average3 +
            0.4 * average7
          )
        : null
  };
}

// =========================================
// PLAYER ROLE EVALUATION
// =========================================

function evaluateNFLV2Role({
  playerGames,
  position,
  verifiedRole = null
} = {}) {

  const history = (
    Array.isArray(playerGames)
      ? playerGames
      : []
  )
    .filter(
      game =>
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(game?.gameDate || "")
        )
    )
    .sort(
      (a, b) =>
        a.gameDate.localeCompare(b.gameDate)
    );

  const pos = String(
    position || ""
  ).toUpperCase();

  if (
    !["QB", "RB", "FB", "WR", "TE"]
      .includes(pos)
  ) {
    throw new Error(
      "Verified QB/RB/FB/WR/TE position required"
    );
  }

  // No eliminamos partidos por tener
  // pocos targets, acarreos o yardas.

  const opportunities = {

    passAttempts: measure(
      history,
      "passing",
      "attempts"
    ),

    rushAttempts: measure(
      history,
      "rushing",
      "attempts"
    ),

    targets: measure(
      history,
      "receiving",
      "targets"
    ),

    receptions: measure(
      history,
      "receiving",
      "receptions"
    )
  };

  // Mercado principal según posición.
  const main =
    pos === "QB"
      ? opportunities.passAttempts
      : ["RB", "FB"].includes(pos)
        ? opportunities.rushAttempts
        : opportunities.targets;

  // Estas verificaciones se conectarán
  // a los snaps, rosters y lesiones
  // que CashEdge ya tiene almacenados.

  const inactive =
    verifiedRole?.inactive === true;

  const starterConfirmed =
    verifiedRole?.starterConfirmed === true;

  const snapEvidenceConfirmed =
    verifiedRole?.snapEvidenceConfirmed === true;

  const comparableGames =
    Number(verifiedRole?.comparableGames);

  const gameSamples = history.length;

  // No validar un rol por una aparición
  // aislada o por una titularidad supuesta.

  const canEvaluateForTesting =
    !inactive &&
    starterConfirmed &&
    snapEvidenceConfirmed &&
    Number.isInteger(comparableGames) &&
    comparableGames >= 3 &&
    gameSamples >= 3 &&
    main.gamesInRecentWindow >= 3;

  let roleStatus = "role_not_verified";

  if (inactive) {
    roleStatus = "inactive";
  } else if (canEvaluateForTesting) {
    roleStatus = "verified_for_research";
  }

  return {
    position: pos,

    samplesFromBoxscores: gameSamples,

    roleStatus,

    opportunities,

    canEvaluateForTesting,

    // Nunca habilitar Premium
    // directamente desde este módulo.
    canPublishPremium: false,

    // El Confidence original
    // permanece completamente intacto.
    confidence: null,

    notes: [
      "Boxscore history is not a complete snap log.",

      "Low-volume games are retained.",

      "Missing games cannot be treated as zero opportunities.",

      "Role and injury evidence must be verified.",

      "Candidate opportunities are not predictive probabilities."
    ]
  };
}

module.exports = {
  evaluateNFLV2Role
};


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


// ==========================================
// NFL V2 — HISTORICAL ROLE SIGNALS
// ==========================================

function nflV2Mean(values) {
  const numbers = values.filter(
    value =>
      typeof value === "number" &&
      Number.isFinite(value)
  );

  return numbers.length
    ? numbers.reduce(
        (sum, value) => sum + value,
        0
      ) / numbers.length
    : null;
}

function analyzeNFLV2RoleSignals({
  playerGames,
  participation,
  position,
  season
} = {}) {

  const pos = String(
    position || ""
  ).toUpperCase();

  const positions = [
    ...new Set(
      (
        participation?.positionsFromNFLverse ||
        []
      )
        .map(p =>
          String(p || "").toUpperCase()
        )
        .filter(Boolean)
    )
  ];

  const positionMatched =
    positions.length === 1 &&
    positions[0] === pos;

  // Relacionar únicamente partidos
  // con ID, fecha y equipo validados.
  const snapsByGame = new Map(
    (participation?.games || [])
      .filter(
        game =>
          game.match ===
          "verified_id_date_team"
      )
      .map(game => [
        `${game.espnGameId}|${game.date}`,
        game
      ])
  );

  const records = (
    Array.isArray(playerGames)
      ? playerGames
      : []
  )
    .filter(
      game =>
        Number(game.season) ===
        Number(season)
    )
    .sort((a, b) =>
      a.gameDate.localeCompare(b.gameDate)
    )
    .map(game => {
      const snap = snapsByGame.get(
        `${game.gameId}|${game.gameDate}`
      );

      const validSnap =
        snap?.played === true &&
        Number.isFinite(
          snap.offenseSnaps
        );

      return {
        date: game.gameDate,
        team: game.teamAbbreviation,

        snapped: validSnap,

        snaps: validSnap
          ? snap.offenseSnaps
          : null,

        passAttempts:
          game.passing?.attempts ?? null,

        rushAttempts:
          game.rushing?.attempts ?? null,

        targets:
          game.receiving?.targets ?? null
      };
    });

  // Separar equipos si un jugador
  // fue transferido durante la temporada.
  const currentTeam =
    records.at(-1)?.team || null;

  const teamRecords = records.filter(
    game => game.team === currentTeam
  );

  const observed = teamRecords.filter(
    game => game.snapped
  );

  const recent7 = observed.slice(-7);
  const recent3 = recent7.slice(-3);
  const prior3 = recent7.slice(-6, -3);

  const mainOpportunity = game => {
    if (pos === "QB") {
      return game.passAttempts;
    }

    if (
      pos === "RB" ||
      pos === "FB"
    ) {
      return game.rushAttempts;
    }

    return game.targets;
  };

  // Comparabilidad histórica.
  // Estos límites NO son filtros para
  // eliminar partidos del promedio.
  const comparable = game => {
    if (
      !Number.isFinite(game.snaps) ||
      game.snaps <= 0
    ) return false;

    if (pos === "QB") {
      return (
        game.snaps >= 30 &&
        game.passAttempts >= 15
      );
    }

    if (
      pos === "RB" ||
      pos === "FB"
    ) {
      return game.snaps >= 15;
    }

    if (
      pos === "WR" ||
      pos === "TE"
    ) {
      return game.snaps >= 25;
    }

    return false;
  };

  const last3Snaps = nflV2Mean(
    recent3.map(game => game.snaps)
  );

  const prior3Snaps = nflV2Mean(
    prior3.map(game => game.snaps)
  );

  const snapChange =
    last3Snaps !== null &&
    prior3Snaps !== null
      ? last3Snaps - prior3Snaps
      : null;

  let workloadTrend =
    "insufficient_history";

  if (
    recent3.length === 3 &&
    prior3.length === 3
  ) {
    // Señales preliminares.
    // El umbral deberá calibrarse
    // durante el backtest.
    if (snapChange >= 10) {
      workloadTrend =
        "possible_increase";
    } else if (snapChange <= -10) {
      workloadTrend =
        "possible_decrease";
    } else {
      workloadTrend =
        "relatively_stable";
    }
  }

  const comparableRecent7 =
    recent7.filter(comparable).length;

  const comparableRecent3 =
    recent3.filter(comparable).length;

  const roleEvidenceEnough =
    positionMatched &&
    teamRecords.every(
      game => game.snapped
    ) &&
    comparableRecent7 >= 3 &&
    comparableRecent3 >= 2;

  return {
    season: Number(season),

    positionRequested: pos,
    positionsFromNFLverse: positions,
    positionMatched,

    currentTeamFromLastBoxscore:
      currentTeam,

    teamBoxscoreGames:
      teamRecords.length,

    teamGamesWithVerifiedSnaps:
      observed.length,

    comparableRecent7,
    comparableRecent3,

    averageSnapsLast3:
      last3Snaps,

    averageSnapsPrior3:
      prior3Snaps,

    recentOpportunityAverage:
      nflV2Mean(
        recent3.map(mainOpportunity)
      ),

    workloadTrend,
    roleEvidenceEnough,

    // No se confirma titularidad
    // ni disponibilidad actual
    // mediante estadísticas pasadas.
    starterConfirmed: false,
    injuryStatusVerified: false,

    canPublishPremium: false,

    explanation:
      "Historical participation evidence only. " +
      "Role thresholds are preliminary. " +
      "Starter status and injuries are not verified. " +
      "Low-volume games remain in historical averages."
  };
}

module.exports = {
  evaluateNFLV2Role,
  analyzeNFLV2RoleSignals
};

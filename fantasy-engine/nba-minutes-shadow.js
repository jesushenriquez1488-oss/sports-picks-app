
"use strict";

// CASHEDGE FANTASY NBA — MINUTES BASELINE V1
//
// SHADOW ONLY.
// Consume reportes JSON exclusivos de Fantasy.
// No escribe en Supabase.
// No importa ni modifica motores de produccion.
//
// Depth Chart NO confirma titulares ni minutos.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("fantasy-shadow-input");

const HISTORY_PATH = path.join(
  ROOT,
  "nba-fantasy-history.json"
);

const ROTATION_PATH = path.join(
  ROOT,
  "nba-rotation-context.json"
);

const OUTPUT_PATH = path.join(
  ROOT,
  "nba-minutes-shadow.json"
);

function requireDate(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(
      `${value}T00:00:00.000Z`
    ).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(
      `Invalid ${field}: ${value}`
    );
  }

  return value;
}

function nextUtcDate(value) {
  const next = new Date(
    `${value}T00:00:00.000Z`
  );

  next.setUTCDate(
    next.getUTCDate() + 1
  );

  return next.toISOString().slice(0, 10);
}

function id(value) {
  return String(value ?? "").trim();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function numberMinutes(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) &&
    n >= 0 &&
    n <= 60
    ? n
    : null;
}

function weightedMean(values) {
  if (!values.length) {
    return null;
  }

  let total = 0;
  let weights = 0;

  values.forEach((value, index) => {
    const weight = Math.pow(0.94, index);

    total += value * weight;
    weights += weight;
  });

  return total / weights;
}

function empiricalPercentile(values, p) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const index = (sorted.length - 1) * p;

  const low = Math.floor(index);
  const high = Math.ceil(index);

  return round(
    sorted[low] +
    (sorted[high] - sorted[low]) *
      (index - low)
  );
}

function describe(player, rotation, cutoffMs) {
  const expectedTeamId = id(
    rotation.nbaTeamId
  );

  const verified = Boolean(
    player.identityVerified &&
    rotation.identityVerified
  );

  const provisional = Boolean(
    player.provisionalIdentity &&
    rotation.identityStatus ===
      "STRONG_CANDIDATE"
  );

  const idMatches = Boolean(
    id(player.nbaPlayerId) &&
    id(player.nbaPlayerId) === id(
      rotation.nbaPlayerId ||
      rotation.candidateNbaPlayerId
    )
  );

  if (
    !idMatches ||
    !(verified || provisional)
  ) {
    return {
      espnPlayerId: player.espnPlayerId,
      player: player.espnName,
      team: player.espnTeam,
      quality: "UNRESOLVED_IDENTITY",
      estimatedMinutes: null,
      readyForSimulation: false
    };
  }

  const games = (
    Array.isArray(player.historicalGames)
      ? player.historicalGames
      : []
  )
    .filter(game => {
      const date = Date.parse(
        game.gameDate
      );

      return Number.isFinite(date) &&
        date < cutoffMs;
    })
    .sort(
      (a, b) =>
        Date.parse(b.gameDate) -
        Date.parse(a.gameDate)
    );

  // Excluimos registros sin minutos validos
  // y partidos con cero minutos jugados.
  // Esto mide minutos CON participacion.
  // No mide probabilidad de jugar.

  const played = games
    .map(game => ({
      ...game,
      minutes: numberMinutes(
        game.minutes
      )
    }))
    .filter(
      game =>
        game.minutes !== null &&
        game.minutes > 0
    );

  const currentSeason = played.filter(
    game => Number(game.season) === 2026
  );

  const previousSeason = played.filter(
    game => Number(game.season) === 2025
  );

  const currentTeamGames = expectedTeamId
    ? currentSeason.filter(
        game =>
          id(game.teamId) ===
          expectedTeamId
      )
    : [];

  const previousSameTeamGames =
    expectedTeamId
      ? previousSeason.filter(
          game =>
            id(game.teamId) ===
            expectedTeamId
        )
      : [];

  const latestCurrentTeam =
    currentSeason[0]
      ? id(currentSeason[0].teamId)
      : null;

  const latestPreviousTeam =
    previousSeason[0]
      ? id(previousSeason[0].teamId)
      : null;

  const teamChanged = Boolean(
    expectedTeamId &&
    latestPreviousTeam &&
    latestPreviousTeam !== expectedTeamId
  );

  const currentTeamConflict = Boolean(
    expectedTeamId &&
    latestCurrentTeam &&
    latestCurrentTeam !== expectedTeamId
  );

  const currentMinutes = currentTeamGames
    .slice(0, 10)
    .map(game => game.minutes);

  const previousMinutes =
    previousSameTeamGames
      .slice(0, 12)
      .map(game => game.minutes);

  const currentMean = weightedMean(
    currentMinutes
  );

  const previousMean = weightedMean(
    previousMinutes
  );

  // Detecta diferencias importantes entre
  // el rol reciente y el anterior.
  // No presupone la causa de ese cambio.

  const recentRoleShift =
    currentMinutes.length >= 3 &&
    previousMinutes.length >= 5 &&
    Math.abs(
      currentMean - previousMean
    ) >= 6;

  let estimate = null;
  let method = "NO_RELEVANT_TEAM_GAMES";

  if (
    currentMean !== null &&
    (
      previousMean === null ||
      recentRoleShift
    )
  ) {
    estimate = currentMean;

    method = recentRoleShift
      ? "CURRENT_ROLE_SHIFT"
      : "CURRENT_TEAM_ONLY";

  } else if (
    currentMean !== null &&
    previousMean !== null
  ) {
    // Regularizacion provisional:
    // evita que un solo partido actual
    // desplace toda la muestra anterior.
    //
    // El parametro 5 debe calibrarse
    // con resultados fuera de muestra.

    const currentWeight =
      currentMinutes.length /
      (currentMinutes.length + 5);

    estimate =
      currentMean * currentWeight +
      previousMean * (1 - currentWeight);

    method =
      "CURRENT_PREVIOUS_SAME_TEAM_BLEND";

  } else if (previousMean !== null) {
    estimate = previousMean;

    method = "PREVIOUS_SAME_TEAM_ONLY";
  }

  // Es un filtro preliminar de calidad.
  // NO representa una probabilidad
  // predictiva validada.

  const enoughEvidence =
    currentMinutes.length >= 5 ||
    (
      currentMinutes.length >= 3 &&
      previousMinutes.length >= 8 &&
      !recentRoleShift
    );

  const quality = currentTeamConflict
    ? "REVIEW_TEAM_CONFLICT"
    : estimate === null
      ? "NO_RELEVANT_SAMPLE"
      : enoughEvidence
        ? "PRELIMINARY"
        : "LOW_SAMPLE";

  const empirical = [
    ...currentMinutes,
    ...previousMinutes
  ];

  return {
    espnPlayerId: id(
      player.espnPlayerId
    ),

    nbaPlayerId: id(
      player.nbaPlayerId
    ),

    player: player.espnName,
    team: player.espnTeam,

    expectedTeamId:
      expectedTeamId || null,

    identityStatus: verified
      ? "VERIFIED"
      : "PROVISIONAL_SHADOW",

    depthChart: {
      positions: rotation.positions,

      firstListedPositions:
        rotation.firstListedPositions,

      confirmedStarter: false
    },

    history: {
      currentTeamGames2026:
        currentTeamGames.length,

      previousSameTeamGames2025:
        previousSameTeamGames.length,

      latest2026Team:
        latestCurrentTeam,

      latest2025Team:
        latestPreviousTeam,

      teamChanged,
      currentTeamConflict,
      recentRoleShift,

      currentMean:
        currentMean === null
          ? null
          : round(currentMean),

      previousMean:
        previousMean === null
          ? null
          : round(previousMean)
    },

    estimatedMinutes:
      currentTeamConflict ||
      estimate === null
        ? null
        : round(estimate),

    // Intervalo descriptivo HISTORICO.
    // No es un intervalo predictivo
    // calibrado para el proximo juego.

    historicalRange: {
      sampleGames: empirical.length,

      p20: empiricalPercentile(
        empirical,
        0.2
      ),

      p80: empiricalPercentile(
        empirical,
        0.8
      )
    },

    method,
    quality,

    readyForSimulation: false,
    readyForPublication: false
  };
}

function main() {
  const history = JSON.parse(
    fs.readFileSync(
      HISTORY_PATH,
      "utf8"
    )
  );

  const rotation = JSON.parse(
    fs.readFileSync(
      ROTATION_PATH,
      "utf8"
    )
  );

  if (
    history.mode !== "shadow" ||
    history.module !== "fantasy_nba" ||
    rotation.mode !== "shadow" ||
    rotation.sport !== "nba" ||
    !Array.isArray(history.players) ||
    !Array.isArray(rotation.players)
  ) {
    throw new Error(
      "Invalid Fantasy shadow inputs"
    );
  }

  const cutoff = requireDate(
    history.asOfDate,
    "history.asOfDate"
  );

  const targetDate = requireDate(
    process.env.FANTASY_TARGET_DATE ||
      nextUtcDate(cutoff),
    "FANTASY_TARGET_DATE"
  );

  if (targetDate < nextUtcDate(cutoff)) {
    throw new Error(
      "Target date must be after cutoff"
    );
  }

  const snapshotTime = Date.parse(
    rotation.sourceReportAt
  );

  const targetStart = Date.parse(
    `${targetDate}T00:00:00.000Z`
  );

  // Impide usar un Depth Chart capturado
  // despues de la fecha proyectada.

  if (
    !Number.isFinite(snapshotTime) ||
    snapshotTime >= targetStart
  ) {
    throw new Error(
      "Depth Chart snapshot is not pregame"
    );
  }

  const rotationByEspn = new Map();

  for (const player of rotation.players) {
    const key =
      `${id(player.espnTeamId)}:` +
      `${id(player.espnPlayerId)}`;

    if (rotationByEspn.has(key)) {
      throw new Error(
        "Duplicate rotation: " + key
      );
    }

    rotationByEspn.set(
      key,
      player
    );
  }

  const cutoffMs = Date.parse(
    `${cutoff}T00:00:00.000Z`
  );

  const players = [];

  for (const player of history.players) {
    if (!player.shadowEligible) {
      continue;
    }

    const key =
      `${id(player.espnTeamId)}:` +
      `${id(player.espnPlayerId)}`;

    const rotationPlayer =
      rotationByEspn.get(key);

    if (!rotationPlayer) {
      throw new Error(
        "Missing rotation for " + key
      );
    }

    players.push(
      describe(
        player,
        rotationPlayer,
        cutoffMs
      )
    );
  }

  const byQuality = {};

  for (const player of players) {
    const key = player.quality;

    byQuality[key] =
      (byQuality[key] || 0) + 1;
  }

  const report = {
    module: "fantasy_nba",
    mode: "shadow",

    generatedAt:
      new Date().toISOString(),

    historicalCutoffExclusive:
      cutoff,

    targetDate,

    snapshotAt:
      rotation.sourceReportAt,

    summary: {
      analyzed: players.length,

      withEstimate:
        players.filter(
          p => p.estimatedMinutes !== null
        ).length,

      preliminary:
        players.filter(
          p => p.quality === "PRELIMINARY"
        ).length,

      lowSample:
        players.filter(
          p => p.quality === "LOW_SAMPLE"
        ).length,

      missingRelevantTeamSample:
        players.filter(
          p => p.quality ===
            "NO_RELEVANT_SAMPLE"
        ).length,

      teamConflicts:
        players.filter(
          p => p.quality ===
            "REVIEW_TEAM_CONFLICT"
        ).length,

      byQuality
    },

    limitations: [
      "Depth Chart does not confirm starters",
      "No injury redistribution yet",
      "No opponent adjustment yet",
      "Minutes parameters require backtesting",
      "Not ready for lineup optimization"
    ],

    readyForSimulation: false,
    readyForPublication: false,

    players
  };

  fs.mkdirSync(
    path.dirname(OUTPUT_PATH),
    { recursive: true }
  );

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(
    "===== FANTASY NBA MINUTES BASELINE ====="
  );

  console.log(
    "MODE: SHADOW ONLY"
  );

  console.log(
    "NO DATABASE WRITES"
  );

  console.log(
    "CUTOFF:",
    cutoff
  );

  console.log(
    "TARGET:",
    targetDate
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
    "OUTPUT:",
    OUTPUT_PATH
  );

  console.log(
    "NO PRODUCTION FORMULA CHANGES"
  );
}

try {
  main();
} catch (error) {
  console.error(
    "FANTASY_MINUTES_ERROR:",
    error.stack || error.message
  );

  process.exitCode = 1;
}

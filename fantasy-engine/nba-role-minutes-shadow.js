
"use strict";

// CASHEDGE FANTASY NBA
// ROLE-AWARE MINUTES V1
//
// EXCLUSIVO DE FANTASY.
// SHADOW ONLY.
//
// Lee los reportes existentes.
// No conecta a Supabase.
// No modifica BALLDONTLIE.
// No modifica NBA Premium, Props o crons.
// No publica recomendaciones.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("fantasy-shadow-input");

const INPUTS = {
  history: path.join(ROOT, "nba-fantasy-history.json"),
  rotation: path.join(ROOT, "nba-rotation-context.json"),
  previous: path.join(ROOT, "nba-minutes-shadow.json")
};

const OUTPUT = path.join(
  ROOT,
  "nba-role-minutes-shadow.json"
);

const id = value => String(value ?? "").trim();

const round = value =>
  Math.round(value * 100) / 100;

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

function load(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function readableMinutes(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return (
    Number.isFinite(number) &&
    number > 0 &&
    number <= 60
  )
    ? number
    : null;
}

function beforeCutoff(game, cutoff) {
  const stamp = Date.parse(
    game.gameDate || ""
  );

  return (
    Number.isFinite(stamp) &&
    stamp < cutoff
  );
}

// Clasificacion del Depth Chart.
//
// Estos son valores iniciales de investigacion,
// NO minutos definitivos ni calibrados.
//
// El rango limita la influencia excesiva
// de estadisticas de un rol anterior.

function getRole(positions) {
  const entries = (
    Array.isArray(positions)
      ? positions
      : []
  )
    .filter(position =>
      Number.isInteger(
        Number(position.depthRank)
      ) &&
      Number(position.depthRank) >= 1
    )
    .sort(
      (a, b) =>
        Number(a.depthRank) -
        Number(b.depthRank)
    );

  const rank = entries.length
    ? Number(entries[0].depthRank)
    : null;

  if (rank === null) {
    return null;
  }

  if (rank === 1) {
    return {
      rank,
      type: "FIRST_LISTED",
      prior: 30,
      lower: 18,
      upper: 39
    };
  }

  if (rank === 2) {
    return {
      rank,
      type: "SECOND_LISTED",
      prior: 19,
      lower: 7,
      upper: 30
    };
  }

  if (rank === 3) {
    return {
      rank,
      type: "THIRD_LISTED",
      prior: 9,
      lower: 0,
      upper: 19
    };
  }

  if (rank === 4) {
    return {
      rank,
      type: "FOURTH_LISTED",
      prior: 5,
      lower: 0,
      upper: 13
    };
  }

  return {
    rank,
    type: "DEEP_RESERVE",
    prior: 2.5,
    lower: 0,
    upper: 10
  };
}

function weightedRecent(games, limit) {
  const list = games.slice(0, limit);

  if (!list.length) {
    return null;
  }

  let numerator = 0;
  let denominator = 0;

  list.forEach((game, index) => {
    const weight = Math.pow(0.9, index);

    numerator += game.minutes * weight;
    denominator += weight;
  });

  return numerator / denominator;
}

function roleProjection(
  history,
  chart,
  previousEstimate,
  cutoff
) {
  const role = getRole(chart.positions);

  const chartPlayerId = id(
    chart.nbaPlayerId ||
    chart.candidateNbaPlayerId
  );

  const validId = Boolean(
    id(history.nbaPlayerId) &&
    id(history.nbaPlayerId) === chartPlayerId
  );

  const verified = (
    history.identityVerified === true &&
    chart.identityVerified === true
  );

  const provisional = (
    history.provisionalIdentity === true &&
    chart.identityStatus === "STRONG_CANDIDATE"
  );

  const valid = (
    validId &&
    (verified || provisional) &&
    history.shadowEligible === true
  );

  const result = {
    player: history.espnName,

    espnPlayerId: id(
      history.espnPlayerId
    ),

    nbaPlayerId: valid
      ? id(history.nbaPlayerId)
      : null,

    team: history.espnTeam,

    nbaTeamId:
      id(chart.nbaTeamId) || null,

    identity: verified
      ? "VERIFIED"
      : valid
        ? "PROVISIONAL_SHADOW"
        : "NOT_ELIGIBLE",

    depthRank: role?.rank ?? null,

    depthCategory:
      role?.type ?? "UNKNOWN",

    positions: chart.positions || [],

    firstListedIsNotConfirmedStarter: true,

    injuriesVerified: false,
    injuryMinutesAdjustment: 0,

    historicalEstimate:
      previousEstimate?.estimatedMinutes ?? null,

    estimatedMinutes: null,

    estimatedMinutesConditionalOnPlaying: null,

    limits: role
      ? {
          exploratoryLower: role.lower,
          exploratoryUpper: role.upper
        }
      : null,

    sample: {
      currentTeam2026: 0,
      previousSameTeam2025: 0
    },

    flags: [],

    readyForOptimization: false,
    readyForPublication: false
  };

  if (!role) {
    result.flags.push("NO_DEPTH_RANK");
    return result;
  }

  if (!valid) {
    result.flags.push(
      "UNVERIFIED_OR_UNMATCHED_ID"
    );

    return result;
  }

  if (
    id(history.expectedCurrentTeamId) !==
      id(chart.nbaTeamId) ||
    !chart.nbaTeamId
  ) {
    result.flags.push(
      "TEAM_MAPPING_NOT_CONFIRMED"
    );

    return result;
  }

  // Leer unicamente partidos anteriores
  // a la fecha de corte.

  const games = (
    Array.isArray(history.historicalGames)
      ? history.historicalGames
      : []
  )
    .filter(game =>
      beforeCutoff(game, cutoff)
    )
    .map(game => ({
      ...game,
      minutes: readableMinutes(
        game.minutes
      )
    }))
    .filter(game =>
      game.minutes !== null
    )
    .sort(
      (a, b) =>
        Date.parse(b.gameDate) -
        Date.parse(a.gameDate)
    );

  const current = games.filter(game =>
    Number(game.season) === 2026 &&
    id(game.teamId) === id(chart.nbaTeamId)
  );

  const previous = games.filter(game =>
    Number(game.season) === 2025 &&
    id(game.teamId) === id(chart.nbaTeamId)
  );

  result.sample = {
    currentTeam2026: current.length,
    previousSameTeam2025: previous.length
  };

  const currentMean = weightedRecent(
    current,
    8
  );

  const previousMean = weightedRecent(
    previous,
    12
  );

  // El rol actual inicia la estimacion.
  // El historial anterior no puede
  // devolver automaticamente a un suplente
  // profundo sus minutos de titular.

  let baseline = role.prior;

  // Solo rangos 1 y 2 reciben influencia
  // de minutos de la temporada anterior.
  // Esta influencia tambien esta limitada.

  if (
    role.rank <= 2 &&
    previousMean !== null
  ) {
    const strength =
      role.rank === 1 ? 0.4 : 0.22;

    baseline =
      role.prior * (1 - strength) +
      clamp(
        previousMean,
        role.lower,
        role.upper
      ) * strength;
  }

  let estimate = baseline;

  if (currentMean !== null) {
    // Mas partidos actuales = mas peso
    // de la rotacion observada.
    //
    // Los parametros son provisionales.
    // Se calibraran fuera de muestra.

    const pseudoGames =
      role.rank >= 3 ? 3 : 5;

    const weight =
      current.length /
      (current.length + pseudoGames);

    estimate =
      baseline * (1 - weight) +
      currentMean * weight;
  }

  // Si un jugador aparece como reserva
  // profunda pero realmente esta jugando
  // muchos minutos, no inventamos la causa.
  // Marcamos el desacuerdo para investigarlo.

  if (
    role.rank >= 3 &&
    current.length >= 3 &&
    currentMean > role.upper + 5
  ) {
    result.flags.push(
      "RECENT_MINUTES_CONFLICT_WITH_DEPTH_CHART"
    );
  }

  if (
    role.rank >= 3 &&
    previousMean !== null &&
    previousMean > role.upper + 5
  ) {
    result.flags.push(
      "PREVIOUS_ROLE_NOT_COMPARABLE"
    );
  }

  if (current.length < 3) {
    result.flags.push(
      "LOW_CURRENT_SEASON_SAMPLE"
    );
  }

  if (current.length === 0) {
    result.flags.push(
      "NO_CURRENT_TEAM_GAMES"
    );
  }

  // Limites exploratorios del rol.
  // NO son una distribucion probabilistica.

  estimate = clamp(
    estimate,
    role.lower,
    role.upper
  );

  result.estimatedMinutes = round(estimate);

  result.estimatedMinutesConditionalOnPlaying =
    round(estimate);

  result.quality = (
    current.length >= 5 &&
    !result.flags.includes(
      "RECENT_MINUTES_CONFLICT_WITH_DEPTH_CHART"
    )
  )
    ? "EXPERIMENTAL_SAMPLE"
    : "EXPERIMENTAL_LOW_SAMPLE";

  result.flags.push(
    "NO_CONFIRMED_GAME_DAY_AVAILABILITY"
  );

  result.flags.push(
    "NO_HISTORICAL_DEPTH_CHART_BACKTEST"
  );

  return result;
}

function main() {
  const history = load(INPUTS.history);
  const rotation = load(INPUTS.rotation);
  const previous = load(INPUTS.previous);

  if (
    history.module !== "fantasy_nba" ||
    history.mode !== "shadow" ||
    rotation.mode !== "shadow" ||
    rotation.sport !== "nba" ||
    previous.mode !== "shadow"
  ) {
    throw new Error(
      "Unexpected Fantasy shadow input"
    );
  }

  if (
    !Array.isArray(history.players) ||
    !Array.isArray(rotation.players) ||
    !Array.isArray(previous.players)
  ) {
    throw new Error(
      "Invalid Fantasy player arrays"
    );
  }

  const cutoffDay = history.asOfDate;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDay)
  ) {
    throw new Error(
      "Invalid historical cutoff"
    );
  }

  const targetDate = previous.targetDate;

  const snapshotTime = Date.parse(
    rotation.sourceReportAt
  );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
    !Number.isFinite(snapshotTime) ||
    snapshotTime >= Date.parse(
      `${targetDate}T00:00:00Z`
    )
  ) {
    throw new Error(
      "Rotation snapshot is not pregame"
    );
  }

  if (
    previous.historicalCutoffExclusive !==
    cutoffDay
  ) {
    throw new Error(
      "History and minutes cutoffs differ"
    );
  }

  const cutoff = Date.parse(
    `${cutoffDay}T00:00:00Z`
  );

  // Cruce por ESPN ID y equipo.
  // No modifica ninguna identidad.

  const rotationByPlayer = new Map();

  for (const player of rotation.players) {
    const key = [
      id(player.espnTeamId),
      id(player.espnPlayerId)
    ].join(":");

    if (rotationByPlayer.has(key)) {
      throw new Error(
        "Duplicate ESPN rotation: " + key
      );
    }

    rotationByPlayer.set(
      key,
      player
    );
  }

  const oldEstimates = new Map(
    previous.players.map(player => [
      [
        id(player.team),
        id(player.espnPlayerId)
      ].join(":"),

      player
    ])
  );

  const projections = history.players.map(
    player => {
      const key = [
        id(player.espnTeamId),
        id(player.espnPlayerId)
      ].join(":");

      const chart = rotationByPlayer.get(key);

      if (!chart) {
        throw new Error(
          "Missing ESPN rotation: " + key
        );
      }

      const oldKey = [
        id(player.espnTeam),
        id(player.espnPlayerId)
      ].join(":");

      return roleProjection(
        player,
        chart,
        oldEstimates.get(oldKey),
        cutoff
      );
    }
  );

  // Auditoria de minutos por equipo.
  // Todavia NO forzamos 240 minutos:
  // faltan identidades y disponibilidad.
  // Hacerlo ahora ocultaria errores.

  const totals = new Map();

  for (const player of projections) {
    if (!totals.has(player.team)) {
      totals.set(player.team, {
        team: player.team,
        players: 0,
        withEstimates: 0,
        partialMinutesSum: 0,
        missing: 0
      });
    }

    const team = totals.get(player.team);

    team.players++;

    if (player.estimatedMinutes === null) {
      team.missing++;
    } else {
      team.withEstimates++;

      team.partialMinutesSum +=
        player.estimatedMinutes;
    }
  }

  const teamDiagnostics = [
    ...totals.values()
  ].map(team => ({
    ...team,

    partialMinutesSum: round(
      team.partialMinutesSum
    ),

    notBalancedTo240: true,

    warning:
      team.partialMinutesSum > 240
        ? "PROVISIONAL_SUM_ABOVE_240"
        : team.missing
          ? "INCOMPLETE_PLAYER_COVERAGE"
          : "UNKNOWN_AVAILABILITY"
  }));

  const exampleNames = [
    "Jericho Sims",
    "AJ Green",
    "Trae Young"
  ];

  const examples = projections.filter(
    player =>
      exampleNames.includes(player.player)
  );

  const summary = {
    players: projections.length,

    withRole: projections.filter(
      player => player.depthRank !== null
    ).length,

    eligibleForShadow: projections.filter(
      player => player.estimatedMinutes !== null
    ).length,

    blocked: projections.filter(
      player => player.estimatedMinutes === null
    ).length,

    thirdOrDeeper: projections.filter(
      player =>
        player.depthRank >= 3 &&
        player.estimatedMinutes !== null
    ).length,

    teamsOver240: teamDiagnostics.filter(
      team => team.partialMinutesSum > 240
    ).length
  };

  const output = {
    module: "fantasy_nba",
    mode: "shadow",

    version: "role-aware-v1-experimental",

    generatedAt: new Date().toISOString(),

    cutoffDay,
    targetDate,

    depthChartCapturedAt:
      rotation.sourceReportAt,

    summary,
    examples,
    teamDiagnostics,

    limitations: [
      "Depth Chart ranks are not confirmed starters",
      "Missing verified injury and game-day availability",
      "Minutes conditional on playing",
      "Role priors and limits are not calibrated",
      "Unresolved ESPN-to-stats identities",
      "No historical depth-chart backtest",
      "Team allocations not yet balanced to 240"
    ],

    readyForOptimization: false,
    readyForPublication: false,

    players: projections
  };

  fs.mkdirSync(ROOT, {
    recursive: true
  });

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "===== CASHEDGE FANTASY ROLE MINUTES SHADOW ====="
  );

  console.log(
    "SUMMARY:",
    JSON.stringify(summary, null, 2)
  );

  console.log(
    "EXAMPLES:",
    JSON.stringify(
      examples.map(player => ({
        player: player.player,
        depthRank: player.depthRank,
        old: player.historicalEstimate,
        new: player.estimatedMinutes,
        flags: player.flags
      })),
      null,
      2
    )
  );

  console.log(
    "TEAMS WITH PARTIAL SUM > 240:",
    teamDiagnostics
      .filter(team =>
        team.partialMinutesSum > 240
      )
      .map(team => ({
        team: team.team,
        sum: team.partialMinutesSum
      }))
  );

  console.log(
    "NO DATABASE WRITES | NO PRODUCTION CHANGES"
  );
}

main();

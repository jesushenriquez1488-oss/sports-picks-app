
"use strict";

// CASHEDGE FANTASY EDGE
// NBA TEAMMATE ABSENCE IMPACT V2
//
// DraftKings y FanDuel.
//
// Calcula diferencias historicas con/sin
// un companero usando partidos reales.
//
// NO consulta APIs.
// NO escribe en Supabase.
// NO modifica proyecciones directamente.
// NO supone que ausencia = lesion.
// NO inventa minutos ni roles.
//
// Conserva los pesos y condiciones
// historicas originales.

const {
  scoreNBA
} = require("./scoring");

const MIN_SAMPLE_GAMES = 4;
const MAX_HISTORY_GAMES = 60;

const SUPPORTED_PLATFORMS = new Set([
  "draftkings",
  "fanduel"
]);

const REQUIRED_STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

const round = value =>
  Math.round(value * 100) / 100;

const num = value => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
};

const id = value =>
  value === null || value === undefined
    ? ""
    : String(value).trim();

function sampleWeight(games) {
  if (games < 4) return 0;
  if (games <= 6) return 0.25;
  if (games <= 9) return 0.50;
  if (games <= 14) return 0.75;
  return 1;
}

function validGame(row, cutoffAt) {
  if (!row || typeof row !== "object") {
    return false;
  }

  const minutes = num(row.minutes);

  if (
    minutes === null ||
    minutes < 5 ||
    !row.game_id ||
    !row.game_date ||
    !id(row.player_id) ||
    !id(row.team_id)
  ) {
    return false;
  }

  const date = Date.parse(row.game_date);
  const cutoff = Date.parse(cutoffAt);

  if (
    !Number.isFinite(date) ||
    !Number.isFinite(cutoff) ||
    date >= cutoff ||
    String(row.game_date).slice(0, 10) ===
      String(cutoffAt).slice(0, 10)
  ) {
    return false;
  }

  return REQUIRED_STATS.every(field => {
    const value = num(row[field]);

    return value !== null && value >= 0;
  });
}

function fantasyField(platform) {
  if (platform === "draftkings") {
    return "fantasyDK";
  }

  if (platform === "fanduel") {
    return "fantasyFD";
  }

  throw new Error(
    "NBA teammate impact: invalid platform"
  );
}

function average(
  rows,
  platform = "draftkings"
) {
  if (!rows.length) return null;

  const field = fantasyField(platform);

  const result = {
    games: rows.length,
    minutes: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    [field]: 0
  };

  for (const row of rows) {
    const fantasy = scoreNBA(
      row,
      platform
    );

    if (
      !fantasy.complete ||
      !Number.isFinite(fantasy.points)
    ) {
      throw new Error(
        "Incomplete historical Fantasy stats"
      );
    }

    result.minutes += Number(row.minutes);
    result.points += Number(row.points);
    result.rebounds += Number(row.rebounds);
    result.assists += Number(row.assists);

    result[field] += fantasy.points;
  }

  for (const name of [
    "minutes",
    "points",
    "rebounds",
    "assists",
    field
  ]) {
    result[name] = round(
      result[name] / rows.length
    );
  }

  return result;
}

function dedupeGames(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = id(row.game_id);

    if (!key) continue;

    if (map.has(key)) {
      throw new Error(
        "Duplicate historical game: " + key
      );
    }

    map.set(key, row);
  }

  return map;
}

/**
 * Evalua el impacto historico de que
 * un companero no participe.
 *
 * targetGames:
 *   Partidos historicos del jugador.
 *
 * teammateGames:
 *   Partidos historicos del companero.
 *
 * teamGames:
 *   Partidos con cobertura verificada.
 *
 * La ausencia historica no significa
 * necesariamente que hubiera una lesion.
 *
 * El resultado es solo una señal.
 * Este modulo no aplica ajustes.
 */
function evaluateTeammateImpact({
  playerId,
  teammateId,
  teamId,
  targetGames,
  teammateGames,
  teamGames,
  cutoffAt,
  platform = "draftkings"
} = {}) {

  if (
    !id(playerId) ||
    !id(teammateId) ||
    !id(teamId) ||
    id(playerId) === id(teammateId)
  ) {
    throw new Error(
      "Player, teammate and team IDs invalid"
    );
  }

  if (
    !Number.isFinite(Date.parse(cutoffAt)) ||
    !Array.isArray(targetGames) ||
    !Array.isArray(teammateGames) ||
    !Array.isArray(teamGames)
  ) {
    throw new Error(
      "Historical impact inputs invalid"
    );
  }

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(
      "NBA teammate impact: invalid platform"
    );
  }

  const field = fantasyField(platform);

  const eligibleTeamGames = new Map();

  for (const game of teamGames) {
    const gameId = id(game.gameId);
    const gameTeamId = id(game.teamId);

    if (
      !gameId ||
      gameTeamId !== id(teamId) ||
      !Number.isInteger(game.playersRecorded) ||
      game.playersRecorded < 8
    ) {
      continue;
    }

    eligibleTeamGames.set(gameId, game);
  }

  const cleanTarget = targetGames
    .filter(row =>
      id(row.player_id) === id(playerId) &&
      id(row.team_id) === id(teamId) &&
      eligibleTeamGames.has(id(row.game_id)) &&
      validGame(row, cutoffAt)
    )
    .sort(
      (a, b) =>
        Date.parse(b.game_date) -
        Date.parse(a.game_date)
    )
    .slice(0, MAX_HISTORY_GAMES);

  const cleanTeammate = teammateGames.filter(
    row =>
      id(row.player_id) === id(teammateId) &&
      id(row.team_id) === id(teamId) &&
      validGame(row, cutoffAt)
  );

  const teammateByGame = dedupeGames(
    cleanTeammate
  );

  const withTeammate = [];
  const withoutTeammate = [];

  for (const game of cleanTarget) {
    if (
      teammateByGame.has(id(game.game_id))
    ) {
      withTeammate.push(game);
    } else {
      withoutTeammate.push(game);
    }
  }

  const withStats = average(
    withTeammate,
    platform
  );

  const withoutStats = average(
    withoutTeammate,
    platform
  );

  const weight = sampleWeight(
    withoutTeammate.length
  );

  const sufficient = (
    weight > 0 &&
    withTeammate.length >= MIN_SAMPLE_GAMES
  );

  const base = {
    playerId: id(playerId),
    teammateId: id(teammateId),
    teamId: id(teamId),
    cutoffAt,
    mode: "shadow",
    withTeammate: withStats,
    withoutTeammate: withoutStats,
    historicalGames: cleanTarget.length,
    sampleWeight: weight,
    evidenceSufficient: sufficient,
    confirmsInjury: false,
    appliedAutomatically: false
  };

  if (!sufficient) {
    return {
      ...base,
      status: "insufficient_comparison",
      rawDifference: null,
      suggestedAdjustment: 0,
      reason:
        "At least 4 games in each situation required"
    };
  }

  const rawDifference = {
    minutes: round(
      withoutStats.minutes -
      withStats.minutes
    ),
    points: round(
      withoutStats.points -
      withStats.points
    ),
    rebounds: round(
      withoutStats.rebounds -
      withStats.rebounds
    ),
    assists: round(
      withoutStats.assists -
      withStats.assists
    ),
    [field]: round(
      withoutStats[field] -
      withStats[field]
    )
  };

  // Comparacion contra el promedio ponderado
  // de los ultimos 20 juegos.
  //
  // Mantiene la ponderacion historica V2.
  // Usa scoreNBA con la plataforma correcta.

  const baseline = cleanTarget.slice(
    0,
    20
  );

  let numerator = 0;
  let denominator = 0;

  baseline.forEach((row, index) => {
    const weightRecent =
      Math.pow(0.91, index);

    const fantasy = scoreNBA(
      row,
      platform
    );

    if (
      !fantasy.complete ||
      !Number.isFinite(fantasy.points)
    ) {
      throw new Error(
        "Incomplete historical baseline stats"
      );
    }

    numerator +=
      fantasy.points * weightRecent;

    denominator += weightRecent;
  });

  const weightedBaseline =
    denominator > 0
      ? numerator / denominator
      : null;

  const suggestedAdjustment =
    weightedBaseline === null
      ? 0
      : round(
          (
            withoutStats[field] -
            weightedBaseline
          ) * weight
        );

  return {
    ...base,
    status: "historical_signal",
    rawDifference,
    weightedHistoricalBaseline:
      weightedBaseline === null
        ? null
        : round(weightedBaseline),
    suggestedAdjustment,
    reason:
      "Historical participation signal; requires confirmed current absence and further validation"
  };
}

module.exports = {
  evaluateTeammateImpact,
  sampleWeight
};


"use strict";

/**
 * CashEdge Fantasy Edge
 * NFL DST Projection V1 - SHADOW
 *
 * Usa historiales reales normalizados:
 *
 * defenseGames: rendimiento de la DST.
 * opponentGames: puntos DST concedidos por
 * la ofensiva del próximo rival.
 *
 * No descarga datos.
 * No escribe en Supabase.
 * No autoriza publicación u optimización.
 */

const { scoreNFLDST } = require("./dst-scoring");

const MIN_GAMES = 3;
const MAX_GAMES = 8;

const DEFENSE_WEIGHT = 0.65;
const OPPONENT_WEIGHT = 0.35;

function round(value) {
  return Math.round(value * 100) / 100;
}

function prepareHistory(games, platform, kickoff) {
  if (!Array.isArray(games)) {
    return [];
  }

  const cutoff = Date.parse(kickoff);

  if (!Number.isFinite(cutoff)) {
    throw new Error("Kickoff invalido");
  }

  const seen = new Set();

 
  return games
    .filter(game => {
      if (
        !game ||
        game.complete !== true ||
        !game.gameId ||
        !game.gameDate
      ) {
        return false;
      }


      const date = Date.parse(game.gameDate);

      return (
        Number.isFinite(date) &&
        date < cutoff &&
        !game.isFuture &&
        !game.isIncomplete
      );
    })
    .sort(
      (a, b) =>
        Date.parse(b.gameDate) -
        Date.parse(a.gameDate)
    )
    .filter(game => {
      const id = String(game.gameId);

      if (seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    })
    .map(game => {
      const scoring = scoreNFLDST(
        game.stats,
        platform
      );

      if (!scoring.complete) {
        return null;
      }

      return {
        gameId: game.gameId,
        date: game.gameDate,
        points: scoring.points,
        breakdown: scoring.breakdown
      };
    })
    .filter(Boolean)
    .slice(0, MAX_GAMES);
}

function weightedAverage(games, field) {
  if (!games.length) {
    return null;
  }

  let numerator = 0;
  let denominator = 0;

  games.forEach((game, index) => {
    const weight = games.length - index;

    const value = field === "points"
      ? game.points
      : game.breakdown[field];

    numerator += value * weight;
    denominator += weight;
  });

  return numerator / denominator;
}

function projectNFLDST(input) {
  const {
    platform,
    team,
    opponent,
    kickoff,
    defenseGames,
    opponentGames
  } = input || {};

  if (!["draftkings", "fanduel"].includes(platform)) {
    throw new Error("Plataforma no admitida");
  }

  if (!team || !opponent || !kickoff) {
    throw new Error("Faltan datos del partido");
  }

  const defense = prepareHistory(
    defenseGames,
    platform,
    kickoff
  );

  const opposingOffense = prepareHistory(
    opponentGames,
    platform,
    kickoff
  );

  const sufficient =
    defense.length >= MIN_GAMES &&
    opposingOffense.length >= MIN_GAMES;

  if (!sufficient) {
    return {
      team,
      opponent,
      platform,
      mode: "SHADOW",
      projectedPoints: null,
      status: "insufficient_dst_history",
      sample: {
        defense: defense.length,
        opponent: opposingOffense.length
      },
      readyForOptimization: false,
      readyForPublication: false
    };
  }

  const fields = [
    "sacks",
    "interceptions",
    "fumbleRecoveries",
    "defensiveTouchdowns",
    "specialTeamsTouchdowns",
    "safeties",
    "blockedKicks",
    "twoPointReturns",
    "pointsAllowed"
  ];

  const breakdown = {};

  for (const field of fields) {
    const defenseAverage = weightedAverage(
      defense,
      field
    );

    const opponentAverage = weightedAverage(
      opposingOffense,
      field
    );

    breakdown[field] = round(
      defenseAverage * DEFENSE_WEIGHT +
      opponentAverage * OPPONENT_WEIGHT
    );
  }

  const defenseBaseline = weightedAverage(
    defense,
    "points"
  );

  const opponentBaseline = weightedAverage(
    opposingOffense,
    "points"
  );

  const projectedPoints = round(
    defenseBaseline * DEFENSE_WEIGHT +
    opponentBaseline * OPPONENT_WEIGHT
  );

  return {
    team,
    opponent,
    platform,
    kickoff,
    mode: "SHADOW",
    status: "experimental_projection",
    projectedPoints,
    breakdown,
    sample: {
      defense: defense.length,
      opponent: opposingOffense.length
    },
    methodology: {
      defenseWeight: DEFENSE_WEIGHT,
      opponentWeight: OPPONENT_WEIGHT,
      maxGames: MAX_GAMES,
      calibrated: false
    },
    readyForOptimization: false,
    readyForPublication: false
  };
}

module.exports = {
  projectNFLDST
};


"use strict";

// CASHEDGE FANTASY EDGE
// NFL FANTASY POINTS BRIDGE — SHADOW
//
// No escribe en Supabase.
// No consulta APIs.
// No modifica Player Props, Premium Picks ni NBA.
// Usa el motor de proyecciones NFL existente.

const {
  projectNFLPlayer
} = require("./projection");

const RARE_FIELDS = [
  "fumbles_lost",
  "two_point_conversions",
  "return_tds",
  "offensive_fumble_recovery_tds"
];

function numeric(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function recentGames(games, playerId, cutoffAt) {
  if (!Array.isArray(games)) {
    return [];
  }

  const cutoffDay = cutoffAt.slice(0, 10);

  return games
    .filter(game =>
      String(game.player_id) ===
      String(playerId)
    )
    .filter(game => {
      const day = String(
        game.game_date || ""
      ).slice(0, 10);

      return (
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        day < cutoffDay
      );
    })
    .sort((a, b) =>
      String(b.game_date).localeCompare(
        String(a.game_date)
      )
    )
    .slice(0, 16);
}

function weightedAverage(games, field) {
  let numerator = 0;
  let denominator = 0;
  let used = 0;

  games.forEach((game, index) => {
    const value = numeric(game[field]);

    if (value === null || value < 0) {
      return;
    }

    const weight = Math.pow(0.88, index);

    numerator += value * weight;
    denominator += weight;
    used++;
  });

  return {
    value:
      denominator > 0
        ? numerator / denominator
        : null,
    gamesUsed: used
  };
}

function bonusChance(
  games,
  field,
  threshold
) {
  let numerator = 0;
  let denominator = 0;

  games.forEach((game, index) => {
    const value = numeric(game[field]);

    if (value === null) {
      return;
    }

    const weight = Math.pow(0.88, index);

    numerator +=
      (value >= threshold ? 1 : 0) *
      weight;

    denominator += weight;
  });

  return denominator > 0
    ? numerator / denominator
    : null;
}

function unavailable(playerId, status, extra = {}) {
  return {
    playerId: String(playerId),
    sport: "nfl",
    mode: "shadow",
    status,

    projectedPoints: null,
    fantasyPoints: null,

    readyForOptimization: false,
    readyForPublication: false,

    ...extra
  };
}

function projectNFLFantasyPoints({
  playerId,
  position,
  games,
  cutoffAt,
  context = {}
} = {}) {

  // Existing NFL projection engine.
  const projection = projectNFLPlayer({
    playerId,
    position,
    games,
    cutoffAt,
    context
  });

  if (!projection.stats) {
    return unavailable(
      playerId,
      projection.status,
      {
        position,
        gamesAvailable:
          projection.gamesAvailable || 0,
        availabilityStatus:
          projection.availabilityStatus ||
          "unverified"
      }
    );
  }

  const history = recentGames(
    games,
    playerId,
    cutoffAt
  );

  const rare = {};
  const observations = {};
  const missing = [];

  // Rare scoring events from NFLverse.
  for (const field of RARE_FIELDS) {
    const sample = weightedAverage(
      history,
      field
    );

    rare[field] = sample.value;
    observations[field] = sample.gamesUsed;

    if (sample.gamesUsed < 6) {
      missing.push(field);
    }
  }

  const stats = projection.stats;

  const requiredStats = [
    "passing_yards",
    "passing_tds",
    "passing_interceptions",
    "rushing_yards",
    "rushing_tds",
    "receptions",
    "receiving_yards",
    "receiving_tds"
  ];

  for (const field of requiredStats) {
    if (numeric(stats[field]) === null) {
      missing.push(field);
    }
  }

  if (missing.length) {
    return unavailable(
      playerId,
      "missing_scoring_data",
      {
        position,
        gamesAvailable:
          projection.gamesAvailable,
        missing,
        eventObservations: observations
      }
    );
  }

  // Estimate bonuses from prior games.
  // A projection of 300 passing yards does
  // not automatically guarantee a DK bonus.

  const passing300 = bonusChance(
    history,
    "passing_yards",
    300
  );

  const rushing100 = bonusChance(
    history,
    "rushing_yards",
    100
  );

  const receiving100 = bonusChance(
    history,
    "receiving_yards",
    100
  );

  if (
    [passing300, rushing100, receiving100]
      .some(value => value === null)
  ) {
    return unavailable(
      playerId,
      "missing_bonus_history",
      {
        position,
        gamesAvailable:
          projection.gamesAvailable
      }
    );
  }

  // Points shared by DraftKings and FanDuel.
  const common =
    stats.passing_yards * 0.04 +
    stats.passing_tds * 4 -
    stats.passing_interceptions +

    stats.rushing_yards * 0.1 +
    stats.rushing_tds * 6 +

    stats.receiving_yards * 0.1 +
    stats.receiving_tds * 6 +

    rare.two_point_conversions * 2 +
    rare.return_tds * 6 +
    rare.offensive_fumble_recovery_tds * 6;

  const expectedDKBonuses =
    3 * (
      passing300 +
      rushing100 +
      receiving100
    );

  // DraftKings: full PPR, -1 lost fumble,
  // expected yardage bonuses.
  const draftkings = round(
    common +
    stats.receptions -
    rare.fumbles_lost +
    expectedDKBonuses
  );

  // FanDuel: half PPR, -2 lost fumble,
  // no yardage bonuses.
  const fanduel = round(
    common +
    stats.receptions * 0.5 -
    rare.fumbles_lost * 2
  );

  return {
    sport: "nfl",
    mode: "shadow",

    playerId: String(playerId),
    position: String(
      position || ""
    ).toUpperCase(),

    cutoffAt,
    status: projection.status,

    availabilityStatus:
      projection.availabilityStatus,

    gamesAvailable:
      projection.gamesAvailable,

    projectedStats: stats,

    expectedRareStats: {
      fumbles_lost: round(
        rare.fumbles_lost
      ),
      two_point_conversions: round(
        rare.two_point_conversions
      ),
      return_tds: round(
        rare.return_tds
      ),
      offensive_fumble_recovery_tds:
        round(
          rare.offensive_fumble_recovery_tds
        )
    },

    dkBonusProbabilities: {
      passing300: round(passing300),
      rushing100: round(rushing100),
      receiving100: round(receiving100)
    },

    expectedDKBonuses:
      round(expectedDKBonuses),

    eventObservations: observations,

    fantasyPoints: {
      draftkings,
      fanduel
    },

    // Only validated slate players may
    // enter the optimizer.
    readyForOptimization: false,
    readyForPublication: false,

    limitations: [
      "Bonos basados en frecuencia historica, pendientes de calibracion",
      "Identidad DFS, rol y lesiones requieren verificacion pregame",
      "Los touchdowns de recuperacion no clasificados se excluyen de su media",
      "Pendiente validar el slate y los salarios reales"
    ]
  };
}

module.exports = {
  projectNFLFantasyPoints
};

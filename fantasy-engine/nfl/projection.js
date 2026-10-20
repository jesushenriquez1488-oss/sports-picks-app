
"use strict";

// CASHEDGE FANTASY EDGE — NFL PROJECTION
// Primera version experimental SHADOW.
// No modifica Player Props ni Premium Picks.
// No consulta APIs ni escribe en Supabase.

const POSITIONS = new Set([
  "QB", "RB", "WR", "TE"
]);

const INPUT_FIELDS = [
  "passing_attempts",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "rushing_attempts",
  "rushing_yards",
  "rushing_tds",
  "targets",
  "receptions",
  "receiving_yards",
  "receiving_tds"
];

const VOLUMES = [
  "passing_attempts",
  "rushing_attempts",
  "targets"
];

const OUTPUT_FIELDS = [
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "receiving_yards",
  "receiving_tds"
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

function clamp(n, low, high) {
  return Math.max(low, Math.min(high, n));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function validSnapshot(snapshot, cutoffAt, name) {
  const timestamp = Date.parse(
    snapshot?.observedAt || ""
  );

  if (
    !snapshot?.source ||
    !Number.isFinite(timestamp) ||
    timestamp >= Date.parse(cutoffAt)
  ) {
    throw new Error(
      `${name}: falta fuente o timestamp pregame`
    );
  }
}

function validatedFactors(
  snapshot,
  fields,
  cutoffAt,
  name
) {
  if (!snapshot) return {};

  validSnapshot(snapshot, cutoffAt, name);

  if (
    !snapshot.factors ||
    typeof snapshot.factors !== "object"
  ) {
    throw new Error(`${name}: faltan factores`);
  }

  const result = {};

  for (
    const [field, factor]
    of Object.entries(snapshot.factors)
  ) {
    if (
      !fields.includes(field) ||
      numeric(factor) === null ||
      numeric(factor) < 0.7 ||
      numeric(factor) > 1.3
    ) {
      throw new Error(
        `${name}: factor invalido ${field}`
      );
    }

    result[field] = numeric(factor);
  }

  return result;
}

function weightedMean(games, field) {
  let total = 0;
  let weights = 0;

  games.forEach((game, i) => {
    const weight = Math.pow(0.88, i);

    total += numeric(game[field]) * weight;
    weights += weight;
  });

  return weights > 0 ? total / weights : 0;
}

function weightedRate(
  games,
  numerator,
  denominator
) {
  let a = 0;
  let b = 0;

  games.forEach((game, i) => {
    const weight = Math.pow(0.88, i);

    a += numeric(game[numerator]) * weight;
    b += numeric(game[denominator]) * weight;
  });

  return b > 0 ? a / b : 0;
}

function projectNFLPlayer({
  playerId,
  position,
  games,
  cutoffAt,
  context = {}
} = {}) {

  position = String(
    position || ""
  ).toUpperCase();

  if (
    !playerId ||
    !POSITIONS.has(position) ||
    !Array.isArray(games)
  ) {
    throw new Error(
      "Jugador, posicion o historial NFL invalidos"
    );
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
      cutoffAt || ""
    ) ||
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
    throw new Error(
      "cutoffAt requiere ISO con zona horaria"
    );
  }

  // ===========================================
  // DISPONIBILIDAD DEL JUGADOR
  // ===========================================

  let availabilityStatus = "unverified";

  if (context.availability) {
    validSnapshot(
      context.availability,
      cutoffAt,
      "availability"
    );

    availabilityStatus = String(
      context.availability.status || ""
    ).toLowerCase();

    const validStatuses = [
      "active",
      "questionable",
      "doubtful",
      "out",
      "inactive",
      "ir",
      "suspended"
    ];

    if (!validStatuses.includes(availabilityStatus)) {
      throw new Error(
        "availability: estado no reconocido"
      );
    }

    if (
      ["out", "inactive", "ir", "suspended"]
        .includes(availabilityStatus)
    ) {
      return {
        playerId: String(playerId),
        position,
        cutoffAt,
        status: "unavailable",
        availabilityStatus,
        stats: null,
        readyForOptimization: false
      };
    }
  }

  // ===========================================
  // HISTORIAL ANTERIOR AL PARTIDO
  // ===========================================

  const history = games
    .filter(game => {
      if (
        String(game.player_id) !== String(playerId)
      ) {
        return false;
      }

      const date = Date.parse(
        game.game_date || ""
      );

      if (
        !Number.isFinite(date) ||
        date >= Date.parse(cutoffAt) ||
        String(game.game_date).slice(0, 10) ===
          cutoffAt.slice(0, 10)
      ) {
        return false;
      }

      return INPUT_FIELDS.every(field => {
        const value = numeric(game[field]);

        if (value === null) {
          return false;
        }

        if (
          field === "rushing_yards" ||
          field === "receiving_yards"
        ) {
          return true;
        }

        return value >= 0;
      });

    })
    .sort(
      (a, b) =>
        Date.parse(b.game_date) -
        Date.parse(a.game_date)
    )
    .slice(0, 16);

  if (history.length < 6) {
    return {
      playerId: String(playerId),
      position,
      cutoffAt,
      status: "insufficient_history",
      gamesAvailable: history.length,
      stats: null,
      readyForOptimization: false
    };
  }

  const lastPlayedDays = Math.floor(
    (
      Date.parse(cutoffAt) -
      Date.parse(history[0].game_date)
    ) / 86400000
  );

  if (lastPlayedDays > 45) {
    return {
      playerId: String(playerId),
      position,
      cutoffAt,
      status: "stale_history",
      lastPlayedDays,
      gamesAvailable: history.length,
      stats: null,
      readyForOptimization: false
    };
  }

  // ===========================================
  // VOLUMEN ESPERADO DE OPORTUNIDADES
  // ===========================================

  const volume = {
    passing_attempts:
      weightedMean(history, "passing_attempts"),

    rushing_attempts:
      weightedMean(history, "rushing_attempts"),

    targets:
      weightedMean(history, "targets")
  };

  const sources = [];

  // Rol verificado: titular, suplente,
  // oportunidades esperadas, cambios de uso.

  if (context.role) {
    validSnapshot(
      context.role,
      cutoffAt,
      "role"
    );

    if (
      !context.role.volumes ||
      typeof context.role.volumes !== "object"
    ) {
      throw new Error(
        "role: faltan volumenes verificables"
      );
    }

    for (
      const [field, value]
      of Object.entries(context.role.volumes)
    ) {
      if (
        !VOLUMES.includes(field) ||
        numeric(value) === null ||
        numeric(value) < 0
      ) {
        throw new Error(
          `role: volumen invalido ${field}`
        );
      }

      volume[field] = numeric(value);
    }

    sources.push(
      `role:${context.role.source}`
    );
  }

  // ===========================================
  // GAME SCRIPT
  // ===========================================

  const gameScript = validatedFactors(
    context.gameScript,
    VOLUMES,
    cutoffAt,
    "gameScript"
  );

  const limits = {
    passing_attempts: 70,
    rushing_attempts: 45,
    targets: 25
  };

  for (const field of VOLUMES) {
    volume[field] = clamp(
      volume[field] *
        (gameScript[field] || 1),
      0,
      limits[field]
    );
  }

  if (context.gameScript) {
    sources.push(
      `gameScript:${context.gameScript.source}`
    );
  }

  // ===========================================
  // DEFENSA RIVAL
  // ===========================================

  const opponent = validatedFactors(
    context.opponentDefense,
    OUTPUT_FIELDS,
    cutoffAt,
    "opponentDefense"
  );

  if (context.opponentDefense) {
    if (
      !Number.isInteger(
        context.opponentDefense.sampleGames
      ) ||
      context.opponentDefense.sampleGames < 4
    ) {
      throw new Error(
        "opponentDefense requiere 4+ juegos anteriores"
      );
    }

    sources.push(
      `opponentDefense:${context.opponentDefense.source}`
    );
  }

  // ===========================================
  // CLIMA
  // ===========================================

  const weather = validatedFactors(
    context.weather,
    [
      "passing_yards",
      "receiving_yards",
      "rushing_yards"
    ],
    cutoffAt,
    "weather"
  );

  if (context.weather) {
    sources.push(
      `weather:${context.weather.source}`
    );
  }

  // ===========================================
  // PRODUCCION POR OPORTUNIDAD
  // ===========================================

  const rates = {
    passing_yards:
      weightedRate(
        history,
        "passing_yards",
        "passing_attempts"
      ),

    passing_tds:
      weightedRate(
        history,
        "passing_tds",
        "passing_attempts"
      ),

    passing_interceptions:
      weightedRate(
        history,
        "passing_interceptions",
        "passing_attempts"
      ),

    rushing_yards:
      weightedRate(
        history,
        "rushing_yards",
        "rushing_attempts"
      ),

    rushing_tds:
      weightedRate(
        history,
        "rushing_tds",
        "rushing_attempts"
      ),

    receptions:
      weightedRate(
        history,
        "receptions",
        "targets"
      ),

    receiving_yards:
      weightedRate(
        history,
        "receiving_yards",
        "targets"
      ),

    receiving_tds:
      weightedRate(
        history,
        "receiving_tds",
        "targets"
      )
  };

  const opportunity = {
    passing_yards: "passing_attempts",
    passing_tds: "passing_attempts",
    passing_interceptions: "passing_attempts",
    rushing_yards: "rushing_attempts",
    rushing_tds: "rushing_attempts",
    receptions: "targets",
    receiving_yards: "targets",
    receiving_tds: "targets"
  };

  // ===========================================
  // PROYECCION ESTADISTICA FINAL
  // ===========================================

  const stats = {};

  for (const field of OUTPUT_FIELDS) {
    stats[field] = round(
      Math.max(
        0,
        rates[field] *
          volume[opportunity[field]] *
          (opponent[field] || 1) *
          (weather[field] || 1)
      )
    );
  }

  stats.passing_attempts =
    round(volume.passing_attempts);

  stats.rushing_attempts =
    round(volume.rushing_attempts);

  stats.targets =
    round(volume.targets);

  // ===========================================
  // RESULTADO SHADOW
  // ===========================================

  return {
    playerId: String(playerId),
    position,
    cutoffAt,

    status:
      availabilityStatus === "questionable" ||
      availabilityStatus === "doubtful"
        ? "injury_unresolved"
        : context.role
          ? "baseline_shadow"
          : "role_unverified",

    availabilityStatus,
    readyForOptimization: false,

    gamesAvailable: history.length,
    lastPlayedDays,

    stats,
    contextApplied: sources,

    // Todavia no tenemos todas las
    // estadisticas para puntuacion exacta.

    missingScoringStats: [
      "fumbles_lost",
      "two_point_conversions",
      "return_tds",
      "offensive_fumble_recovery_tds"
    ],

    fantasyPoints: null,

    limitations: [
      "Parametros iniciales sin calibracion prospectiva",
      "Faltan eventos raros y puntos de defensa DST",
      "La proyeccion del rol debe validarse antes de recomendar alineaciones"
    ]
  };
}

module.exports = {
  projectNFLPlayer
};

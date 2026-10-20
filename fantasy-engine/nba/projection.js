
"use strict";

// CASHEDGE FANTASY EDGE — NBA PROJECTION
// Primera version experimental SHADOW.
// No modifica Player Props ni Premium Picks.
// No consulta APIs ni escribe en Supabase.

const FIELDS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

const number = value => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : null;
};

const round = value =>
  Math.round(value * 100) / 100;

const clamp = (value, low, high) =>
  Math.min(high, Math.max(low, value));

function weightedMean(rows, getValue, decay) {
  let numerator = 0;
  let denominator = 0;

  rows.forEach((row, index) => {
    const weight = Math.pow(decay, index);

    numerator += getValue(row) * weight;
    denominator += weight;
  });

  return numerator / denominator;
}

function validateHistoricalContext(
  context,
  cutoffAt
) {
  const observed = Date.parse(
    context?.observedAt || ""
  );

  if (
    !context?.source ||
    !Number.isFinite(observed) ||
    observed >= Date.parse(cutoffAt)
  ) {
    throw new Error(
      "Contexto sin fuente y timestamp anterior al cutoff"
    );
  }
}

function projectNBAPlayer({
  playerId,
  games,
  cutoffAt,
  context = {}
} = {}) {

  if (
    !playerId ||
    !Array.isArray(games)
  ) {
    throw new Error(
      "Faltan jugador o historiales NBA"
    );
  }

  if (
    typeof cutoffAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoffAt) ||
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
    throw new Error(
      "cutoffAt debe ser fecha ISO con zona horaria"
    );
  }

  // Solo historiales previos a la prediccion.
  // Excluimos el dia completo del cutoff
  // para evitar filtraciones de resultados.

  const history = games
    .filter(
      row =>
        String(row.player_id) === String(playerId)
    )
    .filter(
      row =>
        typeof row.game_date === "string" &&
        row.game_date.slice(0, 10) !==
          cutoffAt.slice(0, 10) &&
        Number.isFinite(
          Date.parse(row.game_date)
        ) &&
        Date.parse(row.game_date) <
          Date.parse(cutoffAt)
    )
    .filter(row => {
      const minutes = number(row.minutes);

      return (
        minutes !== null &&
        minutes >= 5 &&
        FIELDS.every(field => {
          const value = number(row[field]);

          return (
            value !== null &&
            value >= 0
          );
        })
      );
    })
    .sort(
      (a, b) =>
        String(b.game_date).localeCompare(
          String(a.game_date)
        )
    )
    .slice(0, 30);

  if (history.length < 8) {
    return {
      playerId: String(playerId),
      cutoffAt,
      status: "insufficient_history",
      gamesAvailable: history.length,
      stats: null,
      readyForOptimization: false
    };
  }

  // Los minutos recientes reciben mayor peso.

  const recentMinutes = history.slice(0, 7);

  let expectedMinutes = weightedMean(
    recentMinutes,
    row => number(row.minutes),
    0.82
  );

  const usedContext = [];

  // Ajuste de minutos por rol o lesiones.
  // Solo si otra fuente ha verificado el dato.

  if (context.minutesProjection) {
    const override = context.minutesProjection;

    validateHistoricalContext(
      override,
      cutoffAt
    );

    if (
      !override.source ||
      number(override.value) === null ||
      number(override.value) < 0 ||
      number(override.value) > 48
    ) {
      throw new Error(
        "Proyeccion de minutos sin valor/fuente validos"
      );
    }

    expectedMinutes = number(override.value);

    usedContext.push(
      "minutesProjection:" + override.source
    );
  }

  // Ajuste por ritmo real del enfrentamiento.

  let paceFactor = 1;

  if (context.pace) {
    validateHistoricalContext(
      context.pace,
      cutoffAt
    );

    const {
      team,
      opponent,
      league
    } = context.pace;

    if (
      [team, opponent, league].some(
        value =>
          number(value) === null ||
          number(value) <= 0
      )
    ) {
      throw new Error(
        "Datos de pace invalidos"
      );
    }

    paceFactor = clamp(
      (
        (number(team) + number(opponent)) / 2
      ) / number(league),
      0.85,
      1.15
    );

    usedContext.push("pace");
  }

  // Ajustes defensivos por estadistica.
  // Deben provenir de datos historicos reales.

  const defense = context.opponentDefense;

  if (defense) {
    validateHistoricalContext(
      defense,
      cutoffAt
    );

    if (
      !Number.isInteger(defense.sampleGames) ||
      defense.sampleGames < 10 ||
      !defense.factors ||
      typeof defense.factors !== "object"
    ) {
      throw new Error(
        "Defensa rival requiere factores historicos y 10+ partidos"
      );
    }

    for (
      const [field, factor]
      of Object.entries(defense.factors)
    ) {
      if (
        !FIELDS.includes(field) ||
        number(factor) === null ||
        number(factor) <= 0
      ) {
        throw new Error(
          "Factor defensivo invalido: " + field
        );
      }
    }

    usedContext.push("opponentDefense");
  }

  const sample = history.slice(0, 20);

  const stats = {};

  for (const field of FIELDS) {
    let weightedStat = 0;
    let weightedMinutes = 0;

    sample.forEach((row, index) => {
      const weight = Math.pow(0.91, index);

      weightedStat +=
        number(row[field]) * weight;

      weightedMinutes +=
        number(row.minutes) * weight;
    });

    // Produccion estadistica por minuto.

    const perMinute =
      weightedStat / weightedMinutes;

    const defenseFactor =
      defense?.factors?.[field] === undefined
        ? 1
        : clamp(
            number(defense.factors[field]),
            0.75,
            1.25
          );

    stats[field] = round(
      Math.max(
        0,
        perMinute *
          expectedMinutes *
          paceFactor *
          defenseFactor
      )
    );
  }

  // Puntos de base por plataforma.
  // NO se agregan aqui bonos probabilisticos.
  // Los dobles-dobles y triples-dobles
  // se evaluaran en las simulaciones.

  const draftKingsBase =
    stats.points +
    stats.rebounds * 1.25 +
    stats.assists * 1.5 +
    stats.steals * 2 +
    stats.blocks * 2 -
    stats.turnovers * 0.5 +
    stats.three_pointers_made * 0.5;

  const fanDuelBase =
    stats.points +
    stats.rebounds * 1.2 +
    stats.assists * 1.5 +
    stats.steals * 3 +
    stats.blocks * 3 -
    stats.turnovers;

  return {
    playerId: String(playerId),
    cutoffAt,

    status: "baseline_shadow",
    readyForOptimization: false,

    gamesAvailable: history.length,
    expectedMinutes: round(expectedMinutes),

    paceFactor: round(paceFactor),
    contextApplied: usedContext,

    stats,

    fantasyBasePoints: {
      draftkings: round(draftKingsBase),
      fanduel: round(fanDuelBase)
    },

    limitations: [
      "Modelo inicial sin calibracion prospectiva",
      "Bonos de DraftKings pendientes de simulacion",
      "Lesiones y rol requieren contexto verificado"
    ]
  };
}


function projectNBASlatePlayers({
  platform,
  slateId,
  players,
  historicalGames,
  identityLinks,
  cutoffAt,
  contextByPlayer = {}
} = {}) {
  if (!["draftkings", "fanduel"].includes(platform)) {
    throw new Error("Plataforma Fantasy invalida");
  }

  if (
    !slateId ||
    !Array.isArray(players) ||
    !Array.isArray(historicalGames) ||
    !Array.isArray(identityLinks)
  ) {
    throw new Error(
      "Faltan datos del slate, historiales o identidades"
    );
  }

  const links = new Map();

  // No inferir identidades por nombre.
  // Requerir una correspondencia verificada.

  for (const link of identityLinks) {
    if (
      link.platform !== platform ||
      link.verified !== true ||
      !link.source ||
      !link.dfsPlayerId ||
      !link.historicalPlayerId
    ) {
      continue;
    }

    const key = String(link.dfsPlayerId);

    if (links.has(key)) {
      throw new Error(
        "Identidad DFS duplicada: " + key
      );
    }

    links.set(key, link);
  }

  const results = [];
  const excluded = [];

  const unavailable = new Set([
    "out",
    "o",
    "inactive",
    "suspended",
    "doubtful",
    "d"
  ]);

  const seenPlayers = new Set();

  for (const player of players) {
    const dfsId = String(player.playerId || "");

    if (!dfsId || seenPlayers.has(dfsId)) {
      excluded.push({
        playerId: dfsId || null,
        name: player.name || null,
        reason: "missing_or_duplicate_dfs_id"
      });
      continue;
    }

    seenPlayers.add(dfsId);

    const salary = number(player.salary);

    const status = String(
      player.status ?? ""
    ).trim().toLowerCase();

    if (
      salary === null ||
      salary <= 0 ||
      unavailable.has(status)
    ) {
      excluded.push({
        playerId: dfsId,
        name: player.name || null,
        reason: "unavailable_or_invalid_salary"
      });
      continue;
    }

    const link = links.get(dfsId);

    if (!link) {
      excluded.push({
        playerId: dfsId,
        name: player.name || null,
        reason: "identity_not_verified"
      });
      continue;
    }

    // Si los dos registros identifican equipo,
    // una discrepancia bloquea la proyeccion.

    if (
      link.teamId != null &&
      player.teamId != null &&
      String(link.teamId) !==
        String(player.teamId)
    ) {
      excluded.push({
        playerId: dfsId,
        name: player.name || null,
        reason: "team_identity_mismatch"
      });
      continue;
    }

    const historicalId = String(
      link.historicalPlayerId
    );

    const projection = projectNBAPlayer({
      playerId: historicalId,
      games: historicalGames,
      cutoffAt,
      context: contextByPlayer[historicalId] || {}
    });

    if (
      projection.status !== "baseline_shadow" ||
      !projection.fantasyBasePoints ||
      number(
        projection.fantasyBasePoints[platform]
      ) === null
    ) {
      excluded.push({
        playerId: dfsId,
        name: player.name || null,
        reason: projection.status
      });
      continue;
    }

    results.push({
      playerId: dfsId,
      historicalPlayerId: historicalId,
      name: player.name || null,
      teamId: player.teamId ?? null,
      team: player.team ?? null,
      gameId: player.gameId ?? null,
      salary,
      positions: Array.isArray(player.positions)
        ? player.positions
        : [],
      rosterSlotIds: Array.isArray(
        player.rosterSlotIds
      )
        ? player.rosterSlotIds
        : [],
      projectedPoints:
        projection.fantasyBasePoints[platform],
      expectedMinutes: projection.expectedMinutes,
      gamesAvailable: projection.gamesAvailable,
      identitySource: link.source,
      projectionStatus: "baseline_shadow",
      readyForOptimization: false
    });
  }

  return {
    sport: "nba",
    platform,
    slateId: String(slateId),
    cutoffAt,
    playersReceived: players.length,
    projectedCount: results.length,
    excludedCount: excluded.length,
    players: results,
    excluded,
    readyForOptimization: false,
    limitations: [
      "Identidades historicas requieren verificacion",
      "Proyecciones todavia no calibradas",
      "Bonos probabilisticos pendientes",
      "Slate y posiciones requieren validacion final"
    ]
  };
}

module.exports = {
  projectNBAPlayer,
  projectNBASlatePlayers
};


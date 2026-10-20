
"use strict";

// Fantasy Edge: simulador compartido NBA / NFL.
// No inventa proyecciones: exige un generador
// deportivo de estadisticas por escenario.

function seededRandom(seed) {
  let state = 2166136261;

  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;

  const mean =
    values.reduce((sum, n) => sum + n, 0) / count;

  const variance =
    values.reduce(
      (sum, n) => sum + (n - mean) ** 2,
      0
    ) / count;

  const quantile = fraction => {
    const position = fraction * (count - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);

    return sorted[low] +
      (sorted[high] - sorted[low]) *
      (position - low);
  };

  const round = n =>
    Math.round(n * 100) / 100;

  return {
    expected: round(mean),
    standardDeviation: round(Math.sqrt(variance)),
    p10: round(quantile(0.10)),
    p25: round(quantile(0.25)),
    p50: round(quantile(0.50)),
    p75: round(quantile(0.75)),
    p90: round(quantile(0.90)),
    p95: round(quantile(0.95))
  };
}

function simulateFantasySlate({
  players,
  platform,
  generateScenario,
  scoreStats,
  lineups = [],
  iterations = 10000,
  seed = "cashedge-shadow-v1"
}) {
  if (!["draftkings", "fanduel"].includes(platform)) {
    throw new Error("Plataforma Fantasy invalida");
  }

  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 10000
  ) {
    throw new Error(
      "iterations debe estar entre 1 y 10000"
    );
  }

  if (
    !Array.isArray(players) ||
    !players.length ||
    players.length > 300
  ) {
    throw new Error(
      "Se requieren entre 1 y 300 jugadores"
    );
  }

  if (
    typeof generateScenario !== "function" ||
    typeof scoreStats !== "function"
  ) {
    throw new Error(
      "Faltan el generador deportivo o la funcion de puntuacion"
    );
  }

  if (
    !Array.isArray(lineups) ||
    lineups.length > 100
  ) {
    throw new Error(
      "Se admiten hasta 100 alineaciones"
    );
  }

  const ids = players.map(
    player => String(player?.id ?? "")
  );

  if (
    ids.some(id => !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(
      "IDs de jugadores invalidos o duplicados"
    );
  }

  const playerIndex = new Map(
    ids.map((id, index) => [id, index])
  );

  const checkedLineups = lineups.map(
    (lineup, index) => {
      const lineupIds =
        (lineup?.playerIds || []).map(String);

      if (
        !lineupIds.length ||
        new Set(lineupIds).size !== lineupIds.length ||
        lineupIds.some(id => !playerIndex.has(id))
      ) {
        throw new Error(
          `Alineacion invalida en indice ${index}`
        );
      }

      return {
        id: String(lineup.id ?? index),
        playerIds: lineupIds
      };
    }
  );

  const playerSamples = ids.map(
    () => new Float64Array(iterations)
  );

  const lineupSamples = checkedLineups.map(
    () => new Float64Array(iterations)
  );

  const random = seededRandom(seed);

  const normal = () => {
    const u = Math.max(
      random(),
      Number.MIN_VALUE
    );

    const v = random();

    return Math.sqrt(-2 * Math.log(u)) *
      Math.cos(2 * Math.PI * v);
  };

  for (let i = 0; i < iterations; i++) {

    // Un mismo escenario para todos los
    // jugadores; permite conservar correlaciones.

    const scenario = generateScenario({
      players,
      random,
      normal,
      iteration: i
    });

    if (
      !scenario ||
      typeof scenario !== "object"
    ) {
      throw new Error(
        `Escenario vacio: ${i}`
      );
    }

    const scenarioScores = new Map();

    for (let j = 0; j < players.length; j++) {
      const stats = scenario[ids[j]];

      const scored = stats == null
        ? null
        : scoreStats(stats, platform);

      if (
        !scored ||
        scored.complete !== true ||
        !Number.isFinite(scored.points)
      ) {
        throw new Error(
          `Estadisticas incompletas: jugador ${ids[j]}, escenario ${i}`
        );
      }

      playerSamples[j][i] = scored.points;
      scenarioScores.set(ids[j], scored.points);
    }

    checkedLineups.forEach((lineup, index) => {
      lineupSamples[index][i] =
        lineup.playerIds.reduce(
          (total, id) =>
            total + scenarioScores.get(id),
          0
        );
    });
  }

  return {
    platform,
    iterations,
    seed: String(seed),

    players: ids.map(
      (id, index) => ({
        id,
        ...summarize(playerSamples[index])
      })
    ),

    lineups: checkedLineups.map(
      (lineup, index) => ({
        id: lineup.id,
        ...summarize(lineupSamples[index])
      })
    )
  };
}

module.exports = {
  simulateFantasySlate
};

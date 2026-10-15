
"use strict";

// ==========================================
// CASHEDGE NFL V2 — OPPONENT DEFENSE
// ==========================================
// Usa boxscores ya almacenados.
//
// NO consulta ESPN ni API-Sports.
// NO modifica Confidence.
// NO utiliza líneas de sportsbooks.
// NO escribe en Supabase.
//
// Factores provisionales sujetos
// a validación histórica.
// ==========================================

function number(value) {
  return typeof value === "number" &&
    Number.isFinite(value)
      ? value
      : 0;
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const k = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[k]
    : (sorted[k - 1] + sorted[k]) / 2;
}

// ==========================================
// 1. PRODUCCION OFENSIVA POR EQUIPO
// ==========================================

function aggregate(team) {
  const sum = {
    passYards: 0,
    passAttempts: 0,
    rushYards: 0,
    rushAttempts: 0,
    recYards: 0,
    targets: 0,
    receptions: 0
  };

  for (const p of team.players || []) {
    sum.passYards += number(
      p?.passing?.yards
    );

    sum.passAttempts += number(
      p?.passing?.attempts
    );

    sum.rushYards += number(
      p?.rushing?.yards
    );

    sum.rushAttempts += number(
      p?.rushing?.attempts
    );

    sum.recYards += number(
      p?.receiving?.yards
    );

    sum.targets += number(
      p?.receiving?.targets
    );

    sum.receptions += number(
      p?.receiving?.receptions
    );
  }

  return sum;
}

// ==========================================
// 2. REUTILIZAR BOXSCORES EXISTENTES
// ==========================================

function extractGames(
  boxscores,
  season,
  beforeDate
) {
  const output = [];
  const seen = new Set();

  for (const box of boxscores || []) {
    const date = String(
      box.game_date || ""
    ).slice(0, 10);

    const year = Number(box.season);

    // Evitar utilizar el partido
    // que se intenta predecir.
    if (
      date >= beforeDate ||
      ![season, season - 1].includes(year)
    ) {
      continue;
    }

    const teams = Object.values(
      box.stats_json?.teams || {}
    );

    if (teams.length !== 2) continue;

    for (const team of teams) {
      const id = String(team?.id || "");

      const opponentId = String(
        team?.opponentId || ""
      );

      if (
        !id ||
        !opponentId ||
        !teams.some(
          t => String(t.id) === opponentId
        ) ||
        !Array.isArray(team.players) ||
        team.players.length < 10
      ) {
        continue;
      }

      const key = `${box.game_id}:${id}`;

      if (seen.has(key)) continue;
      seen.add(key);

      output.push({
        gameId: String(box.game_id),
        date,
        season: year,
        teamId: id,
        opponentId,
        ...aggregate(team)
      });
    }
  }

  return output;
}

// ==========================================
// 3. METRICAS ESPECIFICAS
// ==========================================

const METRICS = {
  passYPA: [
    "passYards",
    "passAttempts"
  ],

  rushYPC: [
    "rushYards",
    "rushAttempts"
  ],

  recYPT: [
    "recYards",
    "targets"
  ],

  catchRate: [
    "receptions",
    "targets"
  ]
};

function rate(game, metric) {
  const [a, b] = METRICS[metric];

  return game[b] > 0
    ? game[a] / game[b]
    : null;
}

function pooledRate(games, metric) {
  const [a, b] = METRICS[metric];

  const n = games.reduce(
    (s, g) => s + g[a],
    0
  );

  const d = games.reduce(
    (s, g) => s + g[b],
    0
  );

  return d > 0 ? n / d : null;
}

// ==========================================
// 4. DEFENSA AJUSTADA POR RIVALES
// ==========================================

function estimateDefense({
  boxscores,
  opponentTeamId,
  season,
  beforeDate
} = {}) {

  const opponentId = String(
    opponentTeamId || ""
  ).trim();

  if (
    !opponentId ||
    !Number.isInteger(season) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      String(beforeDate || "")
    )
  ) {
    throw new Error(
      "Opponent ESPN team ID, season " +
      "and beforeDate are required"
    );
  }

  const rows = extractGames(
    boxscores,
    season,
    beforeDate
  );

  // Partidos contra esta defensa.
  const current = rows
    .filter(g =>
      g.opponentId === opponentId &&
      g.season === season
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    );

  const previous = rows
    .filter(g =>
      g.opponentId === opponentId &&
      g.season === season - 1
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    );

  // Prioridad a la temporada actual.
  // Temporada anterior: apoyo
  // cuando todavía hay pocos partidos.
  const selected = [
    ...current.slice(0, 8),

    ...previous.slice(
      0,
      Math.max(
        0,
        6 - Math.min(current.length, 8)
      )
    )
  ];

  const metrics = {};

  for (const metric of Object.keys(METRICS)) {

    const league =
      pooledRate(
        rows.filter(
          g => g.season === season
        ),
        metric
      ) ??
      pooledRate(rows, metric);

    if (league === null || league <= 0) {
      metrics[metric] = {
        factor: 1,
        games: 0,
        status: "no_league_reference"
      };

      continue;
    }

    const ratios = [];

    for (const game of selected) {
      const observed = rate(
        game,
        metric
      );

      if (observed === null) continue;

      // Qué producía esta ofensiva
      // contra OTRAS defensas antes
      // de enfrentar a este rival.
      const otherGames = rows
        .filter(x =>
          x.teamId === game.teamId &&
          x.gameId !== game.gameId &&
          x.date < game.date
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date)
        )
        .slice(0, 8);

      const offenseRef = pooledRate(
        otherGames,
        metric
      );

      const n = otherGames.length;

      // Con poca evidencia, acercar
      // la referencia al promedio NFL.
      const reference =
        offenseRef === null
          ? league
          : (
              n * offenseRef +
              4 * league
            ) / (n + 4);

      if (reference <= 0) continue;

      // Limitar la influencia de
      // un partido extremadamente raro.
      const ratio = Math.min(
        1.6,
        Math.max(
          0.4,
          observed / reference
        )
      );

      ratios.push(ratio);
    }

    // La mediana protege contra
    // una actuación excepcional.
    const typical = median(ratios);

    // Con poca muestra, reducir
    // la fuerza del ajuste.
    const reliability =
      ratios.length /
      (ratios.length + 5);

    const factor = typical === null
      ? 1
      : 1 +
        (typical - 1) * reliability;

    metrics[metric] = {
      factor: Number(
        factor.toFixed(4)
      ),

      games: ratios.length,

      medianRelativeToOpponent:
        typical === null
          ? null
          : Number(
              typical.toFixed(4)
            ),

      reliability: Number(
        reliability.toFixed(3)
      ),

      status:
        ratios.length < 3
          ? "limited_sample"
          : "research_only"
    };
  }

  return {
    opponentTeamId: opponentId,
    season,
    beforeDate,

    gamesThisSeason: current.length,
    gamesSelected: selected.length,

    metrics,

    publishable: false,

    note:
      "Experimental defensive factors. " +
      "No sportsbook input. " +
      "Requires historical calibration."
  };
}


// ==========================================
// NFL V2 — RELATIVE DEFENSIVE STRENGTH
// ==========================================
//
// Compara la defensa futura contra
// las defensas de los partidos usados
// para construir la proyección base.
//
// Los datos deben existir antes
// de la fecha de la predicción.
//
// NO recalcula la proyección del jugador.
// NO utiliza líneas de sportsbooks.
// ==========================================

function estimateRelativeDefense({
  boxscores,
  opponentTeamId,
  season,
  beforeDate,
  sampleGames
} = {}) {

  if (!Array.isArray(sampleGames)) {
    throw new Error(
      "NFL V2 sampleGames required"
    );
  }

  // Cada combinación equipo-fecha
  // se evalúa una sola vez.
  const defensiveCache = new Map();

  function getDefense(teamId, date) {
    const id = String(teamId || "").trim();

    if (
      !/^\d+$/.test(id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        String(date || "")
      )
    ) {
      return null;
    }

    const key = `${id}|${date}`;

    if (!defensiveCache.has(key)) {
      defensiveCache.set(
        key,
        estimateDefense({
          boxscores,
          opponentTeamId: id,
          season,
          beforeDate: date
        })
      );
    }

    return defensiveCache.get(key);
  }

  const next = getDefense(
    opponentTeamId,
    beforeDate
  );

  if (!next) {
    throw new Error(
      "Valid opponent and date required"
    );
  }

  // Cada mercado utiliza las
  // oportunidades correspondientes.
  const exposureFields = {
    passYPA: "passAttempts",
    rushYPC: "rushAttempts",
    recYPT: "targets",
    catchRate: "targets"
  };

  const metrics = {};

  for (
    const [metric, exposureField]
    of Object.entries(exposureFields)
  ) {

    const nextMetric =
      next.metrics?.[metric];

    let totalWeight = 0;
    let coveredWeight = 0;
    let weightedHistory = 0;
    let gamesWithReference = 0;

    for (const game of sampleGames) {

      const exposure = Number(
        game?.[exposureField]
      );

      const recencyWeight = Number(
        game?.recencyWeight
      );

      if (
        !Number.isFinite(exposure) ||
        exposure <= 0 ||
        !Number.isFinite(recencyWeight) ||
        recencyWeight <= 0
      ) {
        continue;
      }

      const weight =
        exposure * recencyWeight;

      totalWeight += weight;

      const historicalDefense =
        getDefense(
          game.opponentTeamId,
          game.gameDate
        );

      const historicalMetric =
        historicalDefense
          ?.metrics?.[metric];

      // Una defensa sin muestra
      // suficiente NO se interpreta
      // automáticamente como débil.
      if (
        historicalMetric?.status !==
          "research_only" ||
        !Number.isFinite(
          historicalMetric.factor
        ) ||
        historicalMetric.factor <= 0
      ) {
        continue;
      }

      weightedHistory +=
        weight * historicalMetric.factor;

      coveredWeight += weight;
      gamesWithReference++;
    }

    const historicalFactor =
      coveredWeight > 0
        ? weightedHistory / coveredWeight
        : null;

    const coverage =
      totalWeight > 0
        ? coveredWeight / totalWeight
        : 0;

    const nextFactor =
      nextMetric?.factor;

    // Si falta información suficiente
    // de alguna parte de la comparación,
    // el ajuste permanece neutral.
    const usable =
      nextMetric?.status ===
        "research_only" &&
      Number.isFinite(nextFactor) &&
      nextFactor > 0 &&
      historicalFactor !== null &&
      historicalFactor > 0 &&
      coverage >= 0.5;

    const relativeFactor = usable
      ? nextFactor / historicalFactor
      : 1;

    metrics[metric] = {
      factor:
        Number(relativeFactor.toFixed(4)),

      status: usable
        ? "research_only"
        : "limited_comparison",

      nextDefenseFactor:
        Number.isFinite(nextFactor)
          ? Number(nextFactor.toFixed(4))
          : null,

      historicalDefenseFactor:
        historicalFactor === null
          ? null
          : Number(
              historicalFactor.toFixed(4)
            ),

      historicalCoverage:
        Number(coverage.toFixed(3)),

      historicalGamesCompared:
        gamesWithReference,

      games:
        nextMetric?.games || 0,

      reliability:
        nextMetric?.reliability || 0
    };
  }

  return {
    opponentTeamId:
      String(opponentTeamId),

    season,
    beforeDate,

    gamesThisSeason:
      next.gamesThisSeason,

    gamesSelected:
      next.gamesSelected,

    comparison:
      "next_defense_vs_historical_opponents",

    metrics,

    publishable: false,

    note:
      "Relative defensive factors. " +
      "Historical defenses evaluated " +
      "using data available before " +
      "each historical game. " +
      "No sportsbook inputs. " +
      "Backtest calibration required."
  };
}

module.exports = {
  estimateDefense,
  estimateRelativeDefense
};

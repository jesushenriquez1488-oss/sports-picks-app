
"use strict";

// CASHEDGE FANTASY EDGE
// NBA INJURY SLATE BRIDGE V2
//
// Solo lectura de Supabase.
// No altera la formula base de NBA.
// No modifica Player Props ni Premium Picks.
// No escribe en Supabase.
// No publica recomendaciones.
//
// V2:
// - Ajustes basados en produccion por minuto.
// - Conserva los minutos esperados del modelo.
// - Descuenta el efecto ya incluido en la base.
// - Minimo 4 juegos por situacion.
// - Evita sumar impactos simultaneos.
// - Rechaza senales contradictorias.
// - Excluye jugadores confirmados OUT.
// - Mantiene todo en modo SHADOW.

const {
  projectRealNBASlate
} = require("./slate-history");

const {
  buildNBAInjuryContext
} = require("./injury-context");

const {
  evaluateTeammateImpact
} = require("./teammate-impact");

const STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

const HISTORY_FIELDS = [
  "game_id",
  "season",
  "game_date",
  "team_id",
  "player_id",
  "player_name",
  "minutes",
  ...STATS
].join(",");

const PAGE_SIZE = 1000;
const MIN_GAMES = 4;
const MAX_GAMES = 60;
const BASELINE_GAMES = 20;

const asId = value =>
  value === null || value === undefined
    ? ""
    : String(value).trim();

const round = value =>
  Math.round(value * 100) / 100;

const validDate = value =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value));

function getSeasons(cutoffAt) {
  const date = new Date(cutoffAt);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const current = month >= 9
    ? year
    : year - 1;

  return [
    current,
    current - 1
  ];
}

function baseFantasyPoints(row) {
  return (
    Number(row.points) +
    Number(row.rebounds) * 1.25 +
    Number(row.assists) * 1.5 +
    Number(row.steals) * 2 +
    Number(row.blocks) * 2 -
    Number(row.turnovers) * 0.5 +
    Number(row.three_pointers_made) * 0.5
  );
}

function validHistory(row, cutoffAt) {
  if (
    !row ||
    !validDate(row.game_date) ||
    !asId(row.game_id) ||
    !asId(row.player_id) ||
    !asId(row.team_id)
  ) {
    return false;
  }

  if (
    Date.parse(row.game_date) >=
    Date.parse(cutoffAt)
  ) {
    return false;
  }

  // No incluir el dia del cutoff:
  // evita utilizar estadisticas posteriores
  // dentro de una prediccion pregame.
  if (
    row.game_date.slice(0, 10) ===
    cutoffAt.slice(0, 10)
  ) {
    return false;
  }

  const minutes = Number(row.minutes);

  if (
    row.minutes === null ||
    !Number.isFinite(minutes) ||
    minutes < 5 ||
    minutes > 48
  ) {
    return false;
  }

  return STATS.every(field =>
    row[field] !== null &&
    row[field] !== undefined &&
    row[field] !== "" &&
    Number.isFinite(Number(row[field])) &&
    Number(row[field]) >= 0
  );
}

function sortRecent(rows) {
  return [...rows].sort((a, b) => {
    const dateDiff =
      Date.parse(b.game_date) -
      Date.parse(a.game_date);

    if (dateDiff !== 0) {
      return dateDiff;
    }

    return String(b.game_id)
      .localeCompare(String(a.game_id));
  });
}

// Produccion Fantasy por minuto.
//
// No estimamos un nuevo rol.
// No aumentamos artificialmente minutos.
//
// Solo comparamos eficiencia historica.

function fantasyRate(rows, weighted = false) {
  if (!rows.length) {
    return null;
  }

  let weightedPoints = 0;
  let weightedMinutes = 0;

  rows.forEach((row, index) => {
    const weight = weighted
      ? Math.pow(0.91, index)
      : 1;

    weightedPoints +=
      baseFantasyPoints(row) * weight;

    weightedMinutes +=
      Number(row.minutes) * weight;
  });

  if (weightedMinutes <= 0) {
    return null;
  }

  return weightedPoints / weightedMinutes;
}

function buildHistoryIndexes(rows) {
  const byPlayer = new Map();
  const teamGames = new Map();

  for (const row of rows) {
    const playerId = asId(row.player_id);
    const gameId = asId(row.game_id);

    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, []);
    }

    byPlayer.get(playerId).push(row);

    if (!teamGames.has(gameId)) {
      teamGames.set(gameId, new Set());
    }

    teamGames.get(gameId).add(playerId);
  }

  for (const [playerId, games] of byPlayer) {
    byPlayer.set(
      playerId,
      sortRecent(games)
    );
  }

  return {
    byPlayer,
    teamGames
  };
}

async function loadTeamHistory(
  db,
  teamId,
  cutoffAt
) {
  const all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from("nba_player_game_stats")
      .select(HISTORY_FIELDS)
      .eq("team_id", Number(teamId))
      .in("season", getSeasons(cutoffAt))
      .lt(
        "game_date",
        cutoffAt.slice(0, 10)
      )
      .order("game_date", {
        ascending: false
      })
      .order("game_id", {
        ascending: false
      })
      .range(
        offset,
        offset + PAGE_SIZE - 1
      );

    if (error) {
      throw new Error(
        "NBA team history: " +
        error.message
      );
    }

    const rows = data || [];

    all.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return all;
}

async function loadInjurySnapshots(
  db,
  cutoffAt
) {
  const { data, error } = await db
    .from("nba_live_injury_state")
    .select(
      "game_id,away_team_id,home_team_id," +
      "game_time,injuries,provider,checked_at"
    )
    .lte("checked_at", cutoffAt)
    .gt("game_time", cutoffAt)
    .order("checked_at", {
      ascending: false
    });

  if (error) {
    throw new Error(
      "NBA injury snapshots: " +
      error.message
    );
  }

  return data || [];
}

function matchSnapshots(slate, snapshots) {
  const teamsByGame = new Map();

  for (const player of slate.players) {
    const gameId = asId(player.gameId);
    const teamId = asId(player.teamId);

    if (!gameId || !teamId) {
      continue;
    }

    if (!teamsByGame.has(gameId)) {
      teamsByGame.set(gameId, new Set());
    }

    teamsByGame.get(gameId).add(teamId);
  }

  const result = new Map();

  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot.injuries)) {
      continue;
    }

    const snapshotTeams = new Set([
      asId(snapshot.away_team_id),
      asId(snapshot.home_team_id)
    ]);

    if (
      snapshotTeams.size !== 2 ||
      snapshotTeams.has("")
    ) {
      continue;
    }

    for (const [gameId, teams] of teamsByGame) {
      if (
        teams.size !== 2 ||
        result.has(gameId)
      ) {
        continue;
      }

      const matches = [...teams].every(
        team => snapshotTeams.has(team)
      );

      if (matches) {
        result.set(gameId, snapshot);
      }
    }
  }

  return result;
}

// Calcula un impacto individual.
//
// Formula:
//
// Proyeccion base *
// (tasa sin companero / tasa reciente - 1)
// * peso de muestra
//
// La tasa reciente contiene la mezcla
// real de partidos con y sin el companero.
//
// Asi evitamos sumar de nuevo toda la
// diferencia historica con/sin.

function calculateIndividualSignal({
  player,
  teammateId,
  teamId,
  indexes,
  cutoffAt
}) {
  const playerId = asId(player.playerId);

  const targetGames =
    indexes.byPlayer.get(playerId) || [];

  const teammateGames =
    indexes.byPlayer.get(teammateId) || [];

  if (
    !targetGames.length ||
    !teammateGames.length
  ) {
    return null;
  }

  const coverage = [
    ...indexes.teamGames.entries()
  ].map(([gameId, players]) => ({
    gameId,
    teamId,
    playersRecorded: players.size
  }));

  const impact = evaluateTeammateImpact({
    playerId,
    teammateId,
    teamId,
    targetGames,
    teammateGames,
    teamGames: coverage,
    cutoffAt,
    platform: "draftkings"
  });

  if (!impact.evidenceSufficient) {
    return null;
  }

  const validTeamGames = new Set(
    coverage
      .filter(game =>
        game.playersRecorded >= 8
      )
      .map(game => asId(game.gameId))
  );

  const recentTarget = sortRecent(
    targetGames.filter(row =>
      asId(row.team_id) === teamId &&
      validTeamGames.has(
        asId(row.game_id)
      ) &&
      validHistory(row, cutoffAt)
    )
  ).slice(0, MAX_GAMES);

  const playedTogether = new Set(
    teammateGames
      .filter(row =>
        asId(row.team_id) === teamId &&
        validHistory(row, cutoffAt)
      )
      .map(row => asId(row.game_id))
  );

  const without = recentTarget.filter(
    row =>
      !playedTogether.has(
        asId(row.game_id)
      )
  );

  const withTeammate = recentTarget.filter(
    row =>
      playedTogether.has(
        asId(row.game_id)
      )
  );

  if (
    withTeammate.length < MIN_GAMES ||
    without.length < MIN_GAMES
  ) {
    return null;
  }

  const recentBaseline = recentTarget.slice(
    0,
    BASELINE_GAMES
  );

  const baselineRate = fantasyRate(
    recentBaseline,
    true
  );

  const absenceRate = fantasyRate(
    without
  );

  const withRate = fantasyRate(
    withTeammate
  );

  if (
    baselineRate === null ||
    baselineRate <= 0 ||
    absenceRate === null ||
    withRate === null
  ) {
    return null;
  }

  const basePoints =
    Number(player.projectedPoints);

  if (
    !Number.isFinite(basePoints) ||
    basePoints < 0
  ) {
    return null;
  }

  const expectedMinutes =
    Number(player.expectedMinutes);

  if (
    !Number.isFinite(expectedMinutes) ||
    expectedMinutes <= 0
  ) {
    return null;
  }

  const weight = impact.sampleWeight;

  const rateRatio =
    absenceRate / baselineRate;

  const adjustment = round(
    basePoints *
    (rateRatio - 1) *
    weight
  );

  return {
    absentPlayerId: teammateId,
    gamesWith: withTeammate.length,
    gamesWithout: without.length,
    sampleWeight: weight,

    expectedMinutes:
      player.expectedMinutes,

    baselineFantasyPerMinute:
      round(baselineRate),

    withFantasyPerMinute:
      round(withRate),

    withoutFantasyPerMinute:
      round(absenceRate),

    rateRatio:
      round(rateRatio),

    adjustment,

    source:
      "nba_player_game_stats",

    method:
      "per_minute_baseline_relative",

    confirmedCurrentAbsence: true
  };
}

// Cuando faltan varios companeros:
//
// - Nunca se suman los impactos.
// - Si hay senales positivas y negativas,
//   no suponemos cual domina.
// - Si todas coinciden en direccion,
//   usamos el promedio ponderado.
//
// No seleccionamos el valor mas extremo.

function combineSignals(signals) {
  const valid = signals.filter(
    signal =>
      Number.isFinite(signal.adjustment) &&
      signal.adjustment !== 0
  );

  if (!valid.length) {
    return {
      adjustment: 0,
      status: "no_measurable_impact",
      selectedSignals: []
    };
  }

  const positive = valid.some(
    signal => signal.adjustment > 0
  );

  const negative = valid.some(
    signal => signal.adjustment < 0
  );

  if (positive && negative) {
    return {
      adjustment: 0,
      status: "conflicting_historical_signals",
      selectedSignals: valid
    };
  }

  if (valid.length === 1) {
    return {
      adjustment:
        valid[0].adjustment,
      status:
        "single_historical_signal_shadow",
      selectedSignals: valid
    };
  }

  let weightedTotal = 0;
  let totalWeight = 0;

  for (const signal of valid) {
    const evidenceWeight =
      signal.sampleWeight *
      Math.min(
        signal.gamesWith,
        signal.gamesWithout
      );

    weightedTotal +=
      signal.adjustment *
      evidenceWeight;

    totalWeight += evidenceWeight;
  }

  if (totalWeight <= 0) {
    return {
      adjustment: 0,
      status: "insufficient_combined_evidence",
      selectedSignals: valid
    };
  }

  return {
    adjustment: round(
      weightedTotal / totalWeight
    ),
    status:
      "combined_historical_signals_shadow",
    selectedSignals: valid
  };
}

async function projectNBAWithInjuries({
  db,
  slate,
  cutoffAt,
  contextByPlayer = {}
} = {}) {
  if (
    !db ||
    typeof db.from !== "function"
  ) {
    throw new Error(
      "Supabase client required"
    );
  }

  if (!validDate(cutoffAt)) {
    throw new Error(
      "Valid cutoffAt required"
    );
  }

  const base = await projectRealNBASlate({
    db,
    slate,
    cutoffAt,
    contextByPlayer
  });

  const snapshots =
    await loadInjurySnapshots(
      db,
      cutoffAt
    );

  const snapshotByGame =
    matchSnapshots(
      slate,
      snapshots
    );

  const historyCache = new Map();

  async function getTeamIndexes(teamId) {
    const key = asId(teamId);

    if (!historyCache.has(key)) {
      const rows = await loadTeamHistory(
        db,
        key,
        cutoffAt
      );

      historyCache.set(
        key,
        buildHistoryIndexes(rows)
      );
    }

    return historyCache.get(key);
  }

  const players = [];
  const removed = [];
  const injuryAudit = [];

  for (const player of base.players) {
    const teamId = asId(player.teamId);
    const gameId = asId(player.gameId);

    const snapshot =
      snapshotByGame.get(gameId);

    const original =
      player.projectedPoints;

    if (!snapshot) {
      players.push({
        ...player,
        baseProjectedPoints: original,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          "no_verified_snapshot",
        injuryImpactEvidence: []
      });

      continue;
    }

    const context = buildNBAInjuryContext({
      snapshot,
      cutoffAt,
      playerId: player.playerId,
      teamId,
      maxAgeHours: 12
    });

    if (!context.usable) {
      players.push({
        ...player,
        baseProjectedPoints: original,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          context.reason,
        injuryImpactEvidence: []
      });

      continue;
    }

    // El reporte actual confirma que
    // el jugador evaluado no jugara.

    if (context.playerStatus === "out") {
      removed.push({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
        reason: "confirmed_out",
        checkedAt: context.checkedAt
      });

      continue;
    }

    const absentTeammates =
      context.ruledOutTeammates;

    if (!absentTeammates.length) {
      players.push({
        ...player,
        baseProjectedPoints: original,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          "no_confirmed_absent_teammates",
        injuryImpactEvidence: [],
        injurySnapshotCheckedAt:
          context.checkedAt
      });

      continue;
    }

    const indexes = await getTeamIndexes(
      teamId
    );

    const signals = [];

    for (const teammate of absentTeammates) {
      const teammateId =
        asId(teammate.playerId);

      if (
        !teammateId ||
        teammateId ===
          asId(player.playerId)
      ) {
        continue;
      }

      const signal =
        calculateIndividualSignal({
          player,
          teammateId,
          teamId,
          indexes,
          cutoffAt
        });

      if (signal) {
        signals.push(signal);
      }
    }

    const combined =
      combineSignals(signals);

    const adjustedPoints = round(
      Math.max(
        0,
        original +
          combined.adjustment
      )
    );

    const actualAdjustment = round(
      adjustedPoints - original
    );

    players.push({
      ...player,

      baseProjectedPoints:
        original,

      projectedPoints:
        adjustedPoints,

      injuryAdjustment:
        actualAdjustment,

      injuryAdjustmentStatus:
        combined.status,

      injuryImpactEvidence:
        combined.selectedSignals,

      injurySignalsEvaluated:
        signals.length,

      injurySnapshotCheckedAt:
        context.checkedAt,

      // Mantener SHADOW.
      readyForOptimization: false
    });

    if (signals.length) {
      injuryAudit.push({
        playerId: player.playerId,
        name: player.name,
        team: player.team,

        previousPoints:
          original,

        adjustedPoints,

        actualAdjustment,

        adjustmentStatus:
          combined.status,

        signalsConsidered:
          signals.length,

        signals:
          signals
      });
    }
  }

  const adjustedCount = players.filter(
    player =>
      player.injuryAdjustment !== 0
  ).length;

  return {
    ...base,

    sport: "nba",
    platform: "draftkings",
    mode: "shadow",

    players,

    excluded: [
      ...base.excluded,
      ...removed
    ],

    totals: {
      ...base.totals,

      projected:
        players.length,

      excluded:
        base.excluded.length +
        removed.length,

      removedConfirmedOut:
        removed.length,

      playersWithInjuryAdjustments:
        adjustedCount,

      playersWithHistoricalSignals:
        injuryAudit.length
    },

    injuryAudit,

    injurySnapshotCount:
      snapshotByGame.size,

    readyForOptimization: false,
    readyForPublication: false,

    limitations: [
      ...base.limitations,
      "Injury impact remains experimental",
      "Historical non-participation is not proof of injury",
      "Expected minutes are unchanged",
      "Opposing signals produce no adjustment",
      "Multiple absences are not summed",
      "Pregame injury statuses require a fresh check"
    ]
  };
}

module.exports = {
  projectNBAWithInjuries,
  loadTeamHistory,
  loadInjurySnapshots,
  calculateIndividualSignal,
  combineSignals
};

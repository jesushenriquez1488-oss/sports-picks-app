
"use strict";

// CASHEDGE FANTASY EDGE
// NBA INJURY SLATE BRIDGE
//
// Solo lectura de Supabase.
// No modifica la proyeccion base.
// No escribe en la base de datos.
// No publica recomendaciones.
// Ajustes exclusivamente SHADOW.

const {
  projectRealNBASlate
} = require("./slate-history");

const {
  evaluateTeammateImpact
} = require("./teammate-impact");

const {
  buildNBAInjuryContext
} = require("./injury-context");

const STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

const FIELDS = [
  "game_id",
  "season",
  "game_date",
  "team_id",
  "player_id",
  "player_name",
  "minutes",
  ...STATS
].join(",");

const OUT = new Set([
  "out",
  "ruled out",
  "inactive",
  "suspended"
]);

const PAGE_SIZE = 1000;

const id = value =>
  value === null || value === undefined
    ? ""
    : String(value);

const round = value =>
  Math.round(value * 100) / 100;

function seasonRange(cutoffAt) {
  const date = new Date(cutoffAt);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const current = month >= 9 ? year : year - 1;

  return [current, current - 1];
}

function baseDK(row) {
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
  const value = Date.parse(row.game_date);
  const cutoff = Date.parse(cutoffAt);

  return (
    Number.isFinite(value) &&
    value < cutoff &&
    row.game_date.slice(0, 10) !==
      cutoffAt.slice(0, 10) &&
    Number(row.minutes) >= 5 &&
    STATS.every(field =>
      row[field] !== null &&
      row[field] !== undefined &&
      Number.isFinite(Number(row[field])) &&
      Number(row[field]) >= 0
    )
  );
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
      .select(FIELDS)
      .eq("team_id", Number(teamId))
      .in("season", seasonRange(cutoffAt))
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
        "NBA team history: " + error.message
      );
    }

    const rows = data || [];
    all.push(...rows);

    if (rows.length < PAGE_SIZE) break;

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

function weightedBase(rows) {
  if (!rows.length) return null;

  let total = 0;
  let weights = 0;

  rows.forEach((row, index) => {
    const weight = Math.pow(0.91, index);
    total += baseDK(row) * weight;
    weights += weight;
  });

  return total / weights;
}

function computeBaseAdjustment({
  targetRows,
  absentId,
  teamId,
  impact,
  cutoffAt
}) {
  const eligible = targetRows
    .filter(row =>
      id(row.team_id) === id(teamId) &&
      validHistory(row, cutoffAt)
    )
    .sort(
      (a, b) =>
        Date.parse(b.game_date) -
        Date.parse(a.game_date)
    )
    .slice(0, 60);

  const recentBaseline =
    weightedBase(eligible.slice(0, 20));

  if (
    recentBaseline === null ||
    !impact.evidenceSufficient
  ) {
    return 0;
  }

  // El modulo historico ya verifico
  // que existen al menos cuatro partidos
  // por situacion.
  //
  // Calculamos el ajuste sobre puntos BASE,
  // sin incluir bonos DraftKings.

  const absenceGameIds = new Set(
    impact.absenceGameIds || []
  );

  // Si no contamos con IDs verificados,
  // devolvemos cero: nunca inventamos
  // el grupo de partidos.

  if (!absenceGameIds.size) {
    return null;
  }

  const without = eligible.filter(row =>
    absenceGameIds.has(id(row.game_id))
  );

  if (without.length < 4) {
    return null;
  }

  const withoutAverage =
    without.reduce(
      (sum, row) => sum + baseDK(row),
      0
    ) / without.length;

  return round(
    (
      withoutAverage -
      recentBaseline
    ) * impact.sampleWeight
  );
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

  if (
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
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
    await loadInjurySnapshots(db, cutoffAt);

  const snapshotByGame = new Map();

  const gameTeams = new Map();

  for (const player of slate.players) {
    const gameId = id(player.gameId);

    if (!gameTeams.has(gameId)) {
      gameTeams.set(gameId, new Set());
    }

    gameTeams.get(gameId).add(
      id(player.teamId)
    );
  }

  for (const snapshot of snapshots) {
    const pair = new Set([
      id(snapshot.away_team_id),
      id(snapshot.home_team_id)
    ]);

    if (
      pair.size !== 2 ||
      !Array.isArray(snapshot.injuries)
    ) {
      continue;
    }

    for (const [gameId, teams] of gameTeams) {
      if (
        teams.size === 2 &&
        [...teams].every(team =>
          pair.has(team)
        ) &&
        !snapshotByGame.has(gameId)
      ) {
        snapshotByGame.set(
          gameId,
          snapshot
        );
      }
    }
  }

  const historyCache = new Map();

  async function teamHistory(teamId) {
    const key = id(teamId);

    if (!historyCache.has(key)) {
      historyCache.set(
        key,
        await loadTeamHistory(
          db,
          key,
          cutoffAt
        )
      );
    }

    return historyCache.get(key);
  }

  const adjusted = [];
  const removed = [];
  const audits = [];

  for (const player of base.players) {
    const gameId = id(player.gameId);
    const teamId = id(player.teamId);

    const snapshot =
      snapshotByGame.get(gameId);

    if (!snapshot) {
      adjusted.push({
        ...player,
        baseProjectedPoints:
          player.projectedPoints,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          "no_verified_snapshot"
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
      adjusted.push({
        ...player,
        baseProjectedPoints:
          player.projectedPoints,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          context.reason
      });

      continue;
    }

    if (context.playerStatus === "out") {
      removed.push({
        playerId: player.playerId,
        name: player.name,
        reason: "confirmed_out",
        checkedAt: context.checkedAt
      });

      continue;
    }

    const absent = context.ruledOutTeammates;

    if (!absent.length) {
      adjusted.push({
        ...player,
        baseProjectedPoints:
          player.projectedPoints,
        injuryAdjustment: 0,
        injuryAdjustmentStatus:
          "no_confirmed_absent_teammates"
      });

      continue;
    }

    const rows = await teamHistory(teamId);

    const teamGames = new Map();
    const byPlayer = new Map();

    for (const row of rows) {
      const gameKey = id(row.game_id);
      const playerKey = id(row.player_id);

      if (!teamGames.has(gameKey)) {
        teamGames.set(
          gameKey,
          new Set()
        );
      }

      teamGames.get(gameKey).add(
        playerKey
      );

      if (!byPlayer.has(playerKey)) {
        byPlayer.set(playerKey, []);
      }

      byPlayer.get(playerKey).push(row);
    }

    const coverage = [
      ...teamGames.entries()
    ].map(([historicalGameId, players]) => ({
      gameId: historicalGameId,
      teamId,
      playersRecorded: players.size
    }));

    const signals = [];

    for (const teammate of absent) {
      const teammateId =
        id(teammate.playerId);

      const targetRows =
        byPlayer.get(
          id(player.playerId)
        ) || [];

      const teammateRows =
        byPlayer.get(teammateId) || [];

      // Si el jugador ausente no tiene
      // historial en este mismo equipo,
      // no extrapolamos el impacto.

      if (!teammateRows.length) {
        continue;
      }

      const impact = evaluateTeammateImpact({
        playerId: player.playerId,
        teammateId,
        teamId,
        targetGames: targetRows,
        teammateGames: teammateRows,
        teamGames: coverage,
        cutoffAt
      });

      if (!impact.evidenceSufficient) {
        continue;
      }

      // Identificamos partidos sin el
      // compañero a partir de los registros
      // completos del mismo equipo.

      const targetRecent = targetRows
        .filter(row =>
          validHistory(row, cutoffAt) &&
          (teamGames.get(id(row.game_id))
            ?.size || 0) >= 8
        )
        .sort(
          (a, b) =>
            Date.parse(b.game_date) -
            Date.parse(a.game_date)
        )
        .slice(0, 60);

      const teammatePlayed = new Set(
        teammateRows
          .filter(row =>
            validHistory(row, cutoffAt)
          )
          .map(row => id(row.game_id))
      );

      const absenceGameIds =
        targetRecent
          .filter(row =>
            !teammatePlayed.has(
              id(row.game_id)
            )
          )
          .map(row => id(row.game_id));

      const adjustment =
        computeBaseAdjustment({
          targetRows,
          absentId: teammateId,
          teamId,
          impact: {
            ...impact,
            absenceGameIds
          },
          cutoffAt
        });

      if (
        adjustment === null ||
        !Number.isFinite(adjustment)
      ) {
        continue;
      }

      signals.push({
        absentPlayerId: teammateId,
        gamesWith:
          impact.withTeammate?.games || 0,
        gamesWithout:
          impact.withoutTeammate?.games || 0,
        weight: impact.sampleWeight,
        adjustment,
        rawDifference:
          impact.rawDifference?.fantasyDK,
        source: "historical_team_games"
      });
    }

    // Proteccion contra ajustes duplicados:
    // si hay varias ausencias simultaneas,
    // NO sumamos sus diferencias.
    //
    // Utilizamos la señal individual con
    // mayor ajuste absoluto.
    //
    // El efecto combinado requerira una
    // validacion historica independiente.

    signals.sort(
      (a, b) =>
        Math.abs(b.adjustment) -
        Math.abs(a.adjustment)
    );

    const selected = signals[0] || null;

    const change = selected
      ? selected.adjustment
      : 0;

    const updatedPoints = round(
      Math.max(
        0,
        player.projectedPoints + change
      )
    );

    const record = {
      ...player,
      baseProjectedPoints:
        player.projectedPoints,
      projectedPoints: updatedPoints,
      injuryAdjustment:
        round(
          updatedPoints -
          player.projectedPoints
        ),
      injuryAdjustmentStatus:
        selected
          ? "historical_signal_shadow"
          : "insufficient_evidence",
      injuryImpactEvidence: signals,
      injurySnapshotCheckedAt:
        context.checkedAt,

      // No habilitar publicacion.
      readyForOptimization: false
    };

    adjusted.push(record);

    if (selected) {
      audits.push({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
        previousPoints:
          player.projectedPoints,
        adjustedPoints: updatedPoints,
        selectedSignal: selected,
        signalsConsidered:
          signals.length
      });
    }
  }

  return {
    ...base,
    mode: "shadow",
    players: adjusted,
    excluded: [
      ...base.excluded,
      ...removed
    ],
    totals: {
      ...base.totals,
      projected: adjusted.length,
      excluded:
        base.excluded.length +
        removed.length,
      removedConfirmedOut:
        removed.length,
      playersWithInjuryAdjustments:
        audits.length
    },
    injuryAudit: audits,
    injurySnapshotCount:
      snapshotByGame.size,
    readyForOptimization: false,
    readyForPublication: false,
    limitations: [
      ...base.limitations,
      "Injury effects are experimental",
      "Historical non-participation does not prove injury",
      "Multiple absences are not added together",
      "Pregame statuses must be rechecked"
    ]
  };
}

module.exports = {
  projectNBAWithInjuries,
  loadTeamHistory,
  loadInjurySnapshots
};

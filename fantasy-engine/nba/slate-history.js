
"use strict";

// CASHEDGE FANTASY EDGE
// NBA REAL SLATE HISTORY BRIDGE
//
// DraftKings y FanDuel.
// Solo lectura de Supabase.
// No modifica Premium Picks ni Player Props.
// No escribe en Supabase.
// No publica recomendaciones.
// No modifica la formula de proyeccion.

const {
  projectNBAPlayer
} = require("./projection");

const SUPPORTED_PLATFORMS = new Set([
  "draftkings",
  "fanduel"
]);

const HISTORY_FIELDS = [
  "game_id",
  "season",
  "game_date",
  "team_id",
  "player_id",
  "player_name",
  "minutes",
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
].join(",");

const PAGE_SIZE = 1000;
const BATCH_SIZE = 25;

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function validCutoff(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function getSeasons(cutoffAt) {
  const day = new Date(cutoffAt)
    .toISOString()
    .slice(0, 10);

  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));

  const currentSeason =
    month >= 9 ? year : year - 1;

  return [
    currentSeason,
    currentSeason - 1
  ];
}

function chunks(values, size) {
  const result = [];

  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }

  return result;
}

async function loadBatch(db, ids, cutoffAt) {
  const day = new Date(cutoffAt)
    .toISOString()
    .slice(0, 10);

  const seasons = getSeasons(cutoffAt);
  const all = [];

  for (const batch of chunks(ids, BATCH_SIZE)) {
    let offset = 0;

    while (true) {
      const { data, error } = await db
        .from("nba_player_game_stats")
        .select(HISTORY_FIELDS)
        .in("player_id", batch)
        .in("season", seasons)
        .lt("game_date", day)
        .order("game_date", {
          ascending: false
        })
        .range(
          offset,
          offset + PAGE_SIZE - 1
        );

      if (error) {
        throw new Error(
          "Fantasy NBA batch history: " +
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
  }

  return all;
}

function groupHistory(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const id = String(row.player_id);

    if (!grouped.has(id)) {
      grouped.set(id, []);
    }

    grouped.get(id).push(row);
  }

  for (const games of grouped.values()) {
    games.sort(
      (a, b) =>
        Date.parse(b.game_date) -
        Date.parse(a.game_date)
    );
  }

  return grouped;
}

function checkIdentity(player, games) {
  const dfsName = normalizeName(player.name);

  if (!dfsName || !games.length) {
    return {
      verified: false,
      reason: "missing_name_or_history"
    };
  }

  const historicalNames = [
    ...new Set(
      games
        .map(g => normalizeName(g.player_name))
        .filter(Boolean)
    )
  ];

  if (!historicalNames.length) {
    return {
      verified: false,
      reason: "historical_name_missing"
    };
  }

  if (!historicalNames.includes(dfsName)) {
    return {
      verified: false,
      reason: "player_name_mismatch",
      dfsName: player.name,
      historicalNames: [
        ...new Set(
          games
            .map(g => g.player_name)
            .filter(Boolean)
        )
      ]
    };
  }

  return {
    verified: true,
    reason: "id_and_name_match",
    source: "nba_player_game_stats"
  };
}

function getPlatform(slate) {
  return String(
    slate?.platform || ""
  ).trim().toLowerCase();
}

async function projectRealNBASlate({
  db,
  slate,
  cutoffAt,
  contextByPlayer = {}
} = {}) {
  if (!db || typeof db.from !== "function") {
    throw new Error(
      "Falta cliente Supabase"
    );
  }

  const platform = getPlatform(slate);

  if (
    !slate ||
    slate.sport !== "nba" ||
    !SUPPORTED_PLATFORMS.has(platform) ||
    !slate.slateId ||
    !Array.isArray(slate.players)
  ) {
    throw new Error(
      "Se requiere slate real NBA " +
      "DraftKings o FanDuel"
    );
  }

  if (!validCutoff(cutoffAt)) {
    throw new Error(
      "cutoffAt ISO invalido"
    );
  }

  if (!slate.complete) {
    throw new Error(
      "No se aceptan slates incompletos"
    );
  }

  if (
    !validCutoff(slate.startsAt) ||
    Date.parse(cutoffAt) >
      Date.parse(slate.startsAt)
  ) {
    throw new Error(
      "La prediccion debe ser anterior al slate"
    );
  }

  const uniquePlayers = new Map();

  for (const player of slate.players) {
    const id = String(
      player.playerId ?? ""
    );

    if (
      !/^\d+$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      Number(id) <= 0
    ) {
      throw new Error(
        "Slate contiene playerId invalido: " + id
      );
    }

    if (uniquePlayers.has(id)) {
      throw new Error(
        "Jugador duplicado en slate: " + id
      );
    }

    uniquePlayers.set(id, player);
  }

  const ids = [...uniquePlayers.keys()]
    .map(Number);

  const historicalRows = await loadBatch(
    db,
    ids,
    cutoffAt
  );

  const historyById = groupHistory(
    historicalRows
  );

  const projected = [];
  const excluded = [];
  const identityLinks = [];

  for (const [id, player] of uniquePlayers) {
    const games = historyById.get(id) || [];

    const identity = checkIdentity(
      player,
      games
    );

    if (!identity.verified) {
      excluded.push({
        playerId: id,
        name: player.name,
        gamesFound: games.length,
        reason: identity.reason,
        historicalNames:
          identity.historicalNames || []
      });

      continue;
    }

    identityLinks.push({
      platform,
      dfsPlayerId: id,
      historicalPlayerId: id,
      verified: true,
      source: identity.source,
      teamId: player.teamId ?? null
    });

    const status = String(
      player.status ??
      player.providerStatus ??
      ""
    ).trim().toLowerCase();

    if ([
      "out",
      "o",
      "d",
      "doubtful",
      "inactive",
      "suspended",
      "ir"
    ].includes(status)) {
      excluded.push({
        playerId: id,
        name: player.name,
        gamesFound: games.length,
        reason: "unavailable"
      });

      continue;
    }

    if (
      !Number.isFinite(Number(player.salary)) ||
      Number(player.salary) <= 0 ||
      !Array.isArray(player.positions) ||
      player.positions.length === 0
    ) {
      excluded.push({
        playerId: id,
        name: player.name,
        reason: "invalid_salary_or_positions"
      });

      continue;
    }

    let projection;

    try {
      projection = projectNBAPlayer({
        playerId: id,
        games,
        cutoffAt,
        context: contextByPlayer[id] || {}
      });
    } catch (error) {
      excluded.push({
        playerId: id,
        name: player.name,
        gamesFound: games.length,
        reason: "projection_error",
        error: error.message
      });

      continue;
    }

    const platformPoints =
      projection.fantasyBasePoints?.[platform];

    if (
      projection.status !== "baseline_shadow" ||
      !Number.isFinite(Number(platformPoints)) ||
      Number(platformPoints) <= 0
    ) {
      excluded.push({
        playerId: id,
        name: player.name,
        gamesFound: games.length,
        reason:
          projection.status === "baseline_shadow"
            ? "invalid_platform_points"
            : projection.status
      });

      continue;
    }

    projected.push({
      playerId: id,
      historicalPlayerId: id,
      name: player.name,
      teamId: player.teamId ?? null,
      team: player.team ?? null,
      gameId: player.gameId ?? null,

      salary: Number(player.salary),
      positions: player.positions,
      rosterSlotIds:
        player.rosterSlotIds || [],

      injuryStatus:
        player.status ??
        player.providerStatus ??
        null,

      projectedPoints:
        Number(platformPoints),

      expectedMinutes:
        projection.expectedMinutes,

      gamesAvailable:
        projection.gamesAvailable,

      projectedStats:
        projection.stats,

      projectionStatus:
        projection.status,

      scoringPlatform: platform,
      identityVerified: true,

      readyForOptimization: false
    });
  }

  const totals = {
    playersReceived: uniquePlayers.size,
    historicalRows: historicalRows.length,
    identitiesVerified: identityLinks.length,
    projected: projected.length,
    excluded: excluded.length
  };

  return {
    sport: "nba",
    platform,
    slateId: String(slate.slateId),
    cutoffAt,
    mode: "shadow",

    totals,
    players: projected,
    excluded,
    identityLinks,

    readyForOptimization: false,
    readyForPublication: false,

    limitations: [
      "Proyecciones iniciales no calibradas prospectivamente",
      platform === "draftkings"
        ? "Bonos DraftKings pendientes"
        : "Puntuacion base FanDuel sin bonos DraftKings",
      "Estados de lesiones requieren verificacion pregame",
      "Reglas reales del slate pendientes de certificacion"
    ]
  };
}

module.exports = {
  projectRealNBASlate,
  loadBatch,
  checkIdentity,
  normalizeName
};

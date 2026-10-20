
"use strict";

// CASHEDGE FANTASY EDGE — NBA INJURY CONTEXT
// Solo transforma datos ya consultados.
// No consulta APIs ni modifica Supabase.

const OUT_STATUSES = new Set([
  "out",
  "ruled out",
  "inactive",
  "suspended"
]);

const asId = value =>
  value === null || value === undefined
    ? ""
    : String(value).trim();

const normalizeStatus = value =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

const parseTime = value => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
};

function buildNBAInjuryContext({
  snapshot,
  cutoffAt,
  playerId,
  teamId,
  maxAgeHours = 12
} = {}) {
  const cutoff = parseTime(cutoffAt);
  const gameTime = parseTime(snapshot?.game_time);
  const checked = parseTime(snapshot?.checked_at);

  if (
    !asId(playerId) ||
    !asId(teamId) ||
    cutoff === null
  ) {
    throw new Error(
      "playerId, teamId y cutoffAt validos son obligatorios"
    );
  }

  if (
    !Number.isFinite(maxAgeHours) ||
    maxAgeHours <= 0
  ) {
    throw new Error(
      "maxAgeHours debe ser positivo"
    );
  }

  const blocked = reason => ({
    usable: false,
    reason,
    gameId: snapshot?.game_id || null,
    playerStatus: "unknown",
    playerInjury: null,
    ruledOutTeammates: [],
    uncertainTeammates: [],
    automaticMinutesAdjustment: false
  });

  if (
    !snapshot ||
    !Array.isArray(snapshot.injuries) ||
    gameTime === null ||
    checked === null
  ) {
    return blocked("invalid_snapshot");
  }

  // Prohibir información posterior al cutoff.

  if (checked > cutoff) {
    return blocked("snapshot_after_cutoff");
  }

  // Esta fuente solo se utiliza antes del partido.

  if (
    cutoff >= gameTime ||
    checked >= gameTime
  ) {
    return blocked("game_already_started");
  }

  // Rechazar estados demasiado antiguos.

  if (
    cutoff - checked >
    maxAgeHours * 60 * 60 * 1000
  ) {
    return blocked("stale_snapshot");
  }

  const records = snapshot.injuries
    .filter(item =>
      item && typeof item === "object"
    )
    .map(item => ({
      playerId: asId(item.player_id),
      teamId: asId(item.team_id),
      status: normalizeStatus(item.status),
      description: item.description || null,
      returnDate: item.return_date || null
    }))
    .filter(item =>
      item.playerId && item.teamId
    );

  // Estado del jugador evaluado.

  const own = records.filter(
    item => item.playerId === asId(playerId)
  );

  const playerInjury =
    own.find(item =>
      OUT_STATUSES.has(item.status)
    ) || own[0] || null;

  // Compañeros del mismo equipo.
  // Excluimos al jugador evaluado.

  const teammates = records.filter(
    item =>
      item.teamId === asId(teamId) &&
      item.playerId !== asId(playerId)
  );

  const ruledOutTeammates =
    teammates.filter(item =>
      OUT_STATUSES.has(item.status)
    );

  const uncertainTeammates =
    teammates.filter(item =>
      !OUT_STATUSES.has(item.status)
    );

  return {
    usable: true,
    reason: null,

    gameId: snapshot.game_id || null,
    source: snapshot.provider || "unknown",

    checkedAt:
      new Date(checked).toISOString(),

    cutoffAt:
      new Date(cutoff).toISOString(),

    // No figurar en el reporte no garantiza
    // que el jugador esté disponible.

    playerStatus: !playerInjury
      ? "not_listed"
      : OUT_STATUSES.has(playerInjury.status)
        ? "out"
        : "uncertain",

    playerInjury,

    ruledOutTeammates,
    uncertainTeammates,

    // No inventar aumentos de minutos.
    automaticMinutesAdjustment: false
  };
}

module.exports = {
  buildNBAInjuryContext
};

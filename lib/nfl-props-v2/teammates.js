
"use strict";

// CASHEDGE NFL V2 — TEAMMATE INJURIES
// Reutiliza las tablas existentes.
// Solo lectura. No modifica Confidence.

function dateMillis(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function classify(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();

  if (s === "out") return "reported_out";
  if (s === "questionable") return "questionable";
  if (s === "doubtful") return "doubtful";
  if (s === "probable") return "probable";

  return "unclassified";
}

async function loadNFLV2Teammates({
  db,
  team,
  ownGsisId,
  now = new Date()
} = {}) {

  if (!db) {
    throw new Error("Supabase client required");
  }

  const teamId = String(team || "")
    .trim()
    .toUpperCase();

  const gsisId =
    String(ownGsisId || "").trim();

  const nowMs = new Date(now).getTime();

  if (!teamId || !Number.isFinite(nowMs)) {
    throw new Error("Valid team and time required");
  }

  // Relación existente entre NFLverse
  // y API-Sports para este equipo.
  const {
    data: crosswalk,
    error: crosswalkError
  } = await db
    .from("nfl_player_crosswalk")
    .select(
      "gsis_player_id," +
      "api_sports_player_id," +
      "api_sports_team_id," +
      "player_name,position"
    )
    .eq("nflverse_team_id", teamId)
    .limit(100);

  if (crosswalkError) throw crosswalkError;

  if ((crosswalk || []).length === 100) {
    throw new Error("Crosswalk page cap reached");
  }

  // Excluir al jugador analizado:
  // aquí buscamos lesiones de compañeros.
  const players = (crosswalk || []).filter(
    p =>
      p.api_sports_player_id != null &&
      String(p.api_sports_player_id).trim() &&
      String(p.gsis_player_id || "") !== gsisId
  );

  const ids = [
    ...new Set(
      players.map(p =>
        String(p.api_sports_player_id)
      )
    )
  ];

  const base = {
    team: teamId,
    playersInCrosswalk: players.length,
    currentInjuryReports: [],
    outReports: [],
    uncertainReports: [],
    availableForAdjustment: false,
    opportunityChange: null
  };

  if (!ids.length) {
    return {
      ...base,
      status: "no_team_player_ids"
    };
  }

  // Consultar únicamente reportes actuales
  // que ya existen en Supabase.
  const {
    data: reports,
    error: injuryError
  } = await db
    .from("nfl_injury_state")
    .select(
      "api_sports_player_id," +
      "api_sports_team_id," +
      "player_name,position," +
      "normalized_status,raw_status," +
      "report_date,last_seen_at,active"
    )
    .in("api_sports_player_id", ids)
    .eq("active", true)
    .order("last_seen_at", {
      ascending: false
    })
    .limit(500);

  if (injuryError) throw injuryError;

  if ((reports || []).length === 500) {
    throw new Error("Injury page cap reached");
  }

  const byApiId = new Map(
    players.map(p => [
      String(p.api_sports_player_id),
      p
    ])
  );

  const latestByPlayer = new Map();

  for (const report of reports || []) {

    const apiId = String(
      report.api_sports_player_id || ""
    );

    const mapping = byApiId.get(apiId);

    if (
      !mapping ||
      latestByPlayer.has(apiId)
    ) continue;

    // Evitar lesiones asociadas a otro
    // equipo después de una transferencia.
    if (
      mapping.api_sports_team_id != null &&
      String(mapping.api_sports_team_id).trim() &&
      String(mapping.api_sports_team_id) !==
        String(report.api_sports_team_id)
    ) {
      continue;
    }

    const observed =
      dateMillis(report.last_seen_at);

    const reported =
      dateMillis(report.report_date);

    if (
      observed === null ||
      reported === null
    ) continue;

    const observationAge = nowMs - observed;
    const reportAge = nowMs - reported;

    // Control provisional de antigüedad.
    // Se validará con la cadencia real.
    if (
      observationAge < -3600000 ||
      observationAge > 72 * 3600000
    ) continue;

    if (
      reportAge < -86400000 ||
      reportAge > 7 * 86400000
    ) continue;

    const status =
      report.normalized_status ||
      report.raw_status;

    latestByPlayer.set(apiId, {
      name:
        mapping.player_name ||
        report.player_name ||
        null,

      position:
        mapping.position ||
        report.position ||
        null,

      gsisId:
        mapping.gsis_player_id || null,

      category: classify(status),

      status: status || null,

      reportDate: report.report_date,
      lastSeenAt: report.last_seen_at
    });
  }

  const current = [
    ...latestByPlayer.values()
  ];

  const outReports = current.filter(
    p => p.category === "reported_out"
  );

  const uncertainReports = current.filter(
    p => p.category !== "reported_out"
  );

  return {
    ...base,

    currentInjuryReports: current,
    outReports,
    uncertainReports,

    status: current.length
      ? "recent_reports_found"
      : "no_recent_active_reports",

    note:
      "A report is not official game-day " +
      "availability. Missing reports do not " +
      "prove health. No targets or carries " +
      "have been redistributed."
  };
}

module.exports = {
  loadNFLV2Teammates
};

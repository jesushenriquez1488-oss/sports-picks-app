
"use strict";

// CASHEDGE FANTASY NBA
// ROTATION CONTEXT BUILDER V1
//
// Consume la auditoria ESPN/Supabase.
// No consulta APIs.
// No escribe en Supabase.
// No modifica proyecciones.
// No convierte candidatos en identidades verificadas.
// SHADOW ONLY.

const fs = require("node:fs");
const path = require("node:path");

const INPUT = path.resolve(
  "fantasy-shadow-input/nba-identity-report.json"
);

const OUTPUT = path.resolve(
  "fantasy-shadow-input/nba-rotation-context.json"
);

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

function asId(value) {
  return String(value ?? "").trim();
}

function validTime(value) {
  return Number.isFinite(Date.parse(value || ""));
}

function main() {
  const source = JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

  if (
    source.mode !== "shadow" ||
    source.sport !== "nba" ||
    source.teamsFound !== 30 ||
    !Array.isArray(source.teams) ||
    !Array.isArray(source.players) ||
    !validTime(source.generatedAt)
  ) {
    throw new Error(
      "Invalid NBA identity report"
    );
  }

  const teamMap = new Map();

  for (const team of source.teams) {
    const key = asId(team.espnTeamId);

    if (!key || teamMap.has(key)) {
      throw new Error(
        "Duplicate or invalid ESPN team"
      );
    }

    teamMap.set(key, team);
  }

  if (teamMap.size !== 30) {
    throw new Error(
      "Expected 30 unique ESPN teams"
    );
  }

  const checkedPlayers = new Set();
  const verifiedNbaIds = new Set();
  const players = [];

  for (const player of source.players) {
    const espnId = asId(player.espnPlayerId);
    const teamId = asId(player.espnTeamId);
    const key = `${teamId}:${espnId}`;

    if (
      !espnId ||
      !teamId ||
      checkedPlayers.has(key) ||
      !teamMap.has(teamId)
    ) {
      throw new Error(
        "Invalid or duplicated player: " + key
      );
    }

    checkedPlayers.add(key);

    const mapping = teamMap.get(teamId);

    const positions = Array.isArray(player.positions)
      ? player.positions
          .filter(item =>
            POSITIONS.includes(item.position) &&
            Number.isInteger(item.rank) &&
            item.rank >= 1
          )
          .map(item => ({
            position: item.position,
            depthRank: item.rank,
            firstListed: item.rank === 1
          }))
      : [];

    if (
      positions.length === 0 ||
      positions.length !== player.positions.length
    ) {
      throw new Error(
        "Invalid positions for " + espnId
      );
    }

    const positionKeys = positions.map(
      item => item.position
    );

    if (
      new Set(positionKeys).size !==
      positionKeys.length
    ) {
      throw new Error(
        "Repeated position for " + espnId
      );
    }

    const firstListedPositions = positions
      .filter(item => item.firstListed)
      .map(item => item.position);

    // Solo ALREADY_VERIFIED constituye
    // una identidad validada en Supabase.
    //
    // STRONG_CANDIDATE sigue siendo
    // una coincidencia por verificar.

    const identityVerified =
      player.status === "ALREADY_VERIFIED" &&
      Boolean(asId(player.nbaPlayerId));

    if (identityVerified) {
      const nbaId = asId(player.nbaPlayerId);

      if (verifiedNbaIds.has(nbaId)) {
        throw new Error(
          "Duplicate verified NBA ID: " + nbaId
        );
      }

      verifiedNbaIds.add(nbaId);
    }

    players.push({
      espnPlayerId: espnId,
      espnName: player.espnName,
      espnTeamId: teamId,
      team: player.team,

      nbaTeamId: mapping.nbaTeamId || null,
      teamMappingStatus: mapping.status,

      nbaPlayerId: identityVerified
        ? asId(player.nbaPlayerId)
        : null,

      candidateNbaPlayerId:
        !identityVerified && player.nbaPlayerId
          ? asId(player.nbaPlayerId)
          : null,

      identityStatus: player.status,
      identityVerified,

      positions,
      firstListedPositions,

      // Primer lugar del Depth Chart
      // NO significa titular confirmado.
      listedFirstAnywhere:
        firstListedPositions.length > 0,

      // Esta senal no autoriza cambios
      // automaticos en los minutos.
      automaticMinutesAdjustment: false,

      usableForPlayerProjection:
        identityVerified &&
        mapping.nbaTeamId !== null,

      checkedAt: source.generatedAt
    });
  }

  const counts = {};

  for (const player of players) {
    const key = player.identityStatus;

    counts[key] = (counts[key] || 0) + 1;
  }

  const ready = players.filter(
    p => p.usableForPlayerProjection
  );

  const output = {
    sport: "nba",
    mode: "shadow",
    source: "espn_depthchart_supabase_crosswalk",
    generatedAt: new Date().toISOString(),
    sourceReportAt: source.generatedAt,

    teams: source.teams.map(team => ({
      espnTeamId: asId(team.espnTeamId),
      team: team.team,
      nbaTeamId: team.nbaTeamId || null,
      status: team.status
    })),

    totals: {
      teamCount: teamMap.size,
      playerCount: players.length,
      verifiedPlayers:
        players.filter(p => p.identityVerified).length,
      eligibleForContext: ready.length,
      unresolvedPlayers: players.length - ready.length
    },

    classification: counts,
    players,

    readyForOptimization: false,
    readyForPublication: false,

    limitations: [
      "Depth Chart does not confirm game starters",
      "Depth Chart does not predict minutes",
      "Strong candidates are not verified identities",
      "No automatic injury or minutes adjustments"
    ]
  };

  fs.mkdirSync(path.dirname(OUTPUT), {
    recursive: true
  });

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "===== CASHEDGE NBA ROTATION CONTEXT ====="
  );

  console.log(
    "Teams:", output.totals.teamCount
  );

  console.log(
    "Players:", output.totals.playerCount
  );

  console.log(
    "Verified identities:",
    output.totals.verifiedPlayers
  );

  console.log(
    "Usable verified context:",
    output.totals.eligibleForContext
  );

  console.log(
    "Pending verification:",
    output.totals.unresolvedPlayers
  );

  console.log(
    "Classification:",
    JSON.stringify(counts)
  );

  console.log(
    "Output:", OUTPUT
  );

  console.log(
    "SHADOW ONLY | NO DATABASE WRITES"
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      "ROTATION_CONTEXT_ERROR:",
      error.stack || error.message
    );

    process.exitCode = 1;
  }
}


"use strict";

// CASHEDGE FANTASY EDGE
// ESPN NBA — AUDITORIA DE ROTACIONES
//
// Consulta equipos y Depth Charts de ESPN.
// Solo lectura. Sin Supabase.
// No modifica proyecciones ni recomendaciones.

const {
  getDepthChart
} = require("./espn-depthchart-probe");

const {
  normalizeDepthChart
} = require("./espn-depthchart-normalizer");

const TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/" +
  "sports/basketball/nba/teams?limit=100";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

async function loadTeams() {
  const response = await fetch(TEAMS_URL, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `ESPN Teams HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const entries =
    data?.sports?.[0]?.leagues?.[0]?.teams;

  if (!Array.isArray(entries)) {
    throw new Error(
      "Estructura de equipos ESPN inesperada"
    );
  }

  const teams = entries
    .map(entry => entry?.team)
    .filter(team =>
      team?.id &&
      team?.abbreviation
    )
    .map(team => ({
      id: String(team.id),
      name: String(
        team.displayName || team.name || ""
      ),
      abbreviation: String(team.abbreviation)
    }));

  const unique = new Map(
    teams.map(team => [team.id, team])
  );

  return [...unique.values()].sort(
    (a, b) =>
      a.abbreviation.localeCompare(b.abbreviation)
  );
}

async function auditTeam(team) {
  const result = await getDepthChart(team.id);

  if (result.team?.id &&
      String(result.team.id) !== team.id) {
    throw new Error(
      "ESPN Team ID mismatch"
    );
  }

  const records = normalizeDepthChart(result);

  const uniquePlayers = new Set(
    records.map(row => row.espnPlayerId)
  );

  const firstListed = POSITIONS.map(position => {
    const first = records.find(row =>
      row.position === position &&
      row.depthRank === 1
    );

    return {
      position,
      player: first?.playerName || null,
      espnPlayerId: first?.espnPlayerId || null
    };
  });

  return {
    teamId: team.id,
    abbreviation: team.abbreviation,
    name: team.name,
    season: result.season?.year ?? null,
    checkedAt: result.checkedAt,
    entries: records.length,
    uniquePlayers: uniquePlayers.size,
    injuryEntries: records.filter(
      row => row.injuries.length > 0
    ).length,
    missingPositions: firstListed
      .filter(row => !row.player)
      .map(row => row.position),
    firstListed
  };
}

async function main() {
  console.log(
    "===== CASHEDGE ESPN NBA LEAGUE AUDIT ====="
  );

  console.log("MODE: SHADOW / READ ONLY");

  const teams = await loadTeams();

  console.log(
    "Teams discovered:", teams.length
  );

  if (teams.length !== 30) {
    console.log(
      "WARNING: ESPN did not return 30 teams."
    );
  }

  const results = [];
  const failures = [];

  // Grupos pequeños para no lanzar
  // 30 solicitudes al mismo tiempo.
  for (let i = 0; i < teams.length; i += 3) {
    const batch = teams.slice(i, i + 3);

    const settled = await Promise.allSettled(
      batch.map(team => auditTeam(team))
    );

    settled.forEach((item, index) => {
      const team = batch[index];

      if (item.status === "fulfilled") {
        results.push(item.value);

        console.log(
          "\nTEAM:",
          item.value.abbreviation,
          "| Players:",
          item.value.uniquePlayers,
          "| Position entries:",
          item.value.entries
        );

        for (const slot of item.value.firstListed) {
          console.log(
            `${slot.position}: ` +
            (slot.player || "MISSING")
          );
        }

        if (item.value.missingPositions.length) {
          console.log(
            "MISSING POSITIONS:",
            item.value.missingPositions.join(", ")
          );
        }
      } else {
        failures.push({
          team: team.abbreviation,
          error: item.reason?.message ||
            String(item.reason)
        });

        console.log(
          "FAILED:",
          team.abbreviation,
          item.reason?.message ||
            String(item.reason)
        );
      }
    });
  }

  const allComplete = (
    teams.length === 30 &&
    results.length === 30 &&
    failures.length === 0 &&
    results.every(team =>
      team.missingPositions.length === 0 &&
      team.uniquePlayers > 0
    )
  );

  console.log(
    "\n===== FINAL SUMMARY ====="
  );

  console.log("Teams discovered:", teams.length);
  console.log("Teams successful:", results.length);
  console.log("Teams failed:", failures.length);
  console.log("All 30 complete:", allComplete);

  console.log(
    "No database writes | No formula changes"
  );

  if (!allComplete) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      "ESPN_LEAGUE_AUDIT_ERROR:",
      error.message
    );

    process.exitCode = 1;
  });
}

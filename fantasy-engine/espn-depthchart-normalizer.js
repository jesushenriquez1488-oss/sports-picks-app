
"use strict";

// CASHEDGE FANTASY EDGE
// ESPN NBA DEPTH CHART NORMALIZER V1
//
// Solo lectura.
// Sin escrituras en Supabase.
// Sin cambios en proyecciones.
// Sin publicaciones.

const {
  getDepthChart
} = require("./espn-depthchart-probe");

const POSITIONS = ["pg", "sg", "sf", "pf", "c"];

function normalizeDepthChart(result) {
  if (
    !result ||
    !result.chartPresent ||
    !Array.isArray(result.chartPreview)
  ) {
    throw new Error("ESPN Depth Chart no disponible");
  }

  const records = [];
  const team = result.team || {};

  for (const chart of result.chartPreview) {
    const positions = chart?.positions;

    if (!positions || typeof positions !== "object") {
      continue;
    }

    for (const position of POSITIONS) {
      const athletes = positions[position]?.athletes;

      if (!Array.isArray(athletes)) {
        continue;
      }

      athletes.forEach((athlete, index) => {
        const espnPlayerId = String(
          athlete?.id ?? ""
        ).trim();

        if (!espnPlayerId || !athlete?.displayName) {
          return;
        }

        records.push({
          provider: "espn",
          espnTeamId: String(result.teamId),
          team: team.abbreviation || null,
          season: result.season?.year ?? null,
          checkedAt: result.checkedAt,
          espnPlayerId,
          playerName: athlete.displayName,
          position: position.toUpperCase(),
          depthRank: index + 1,
          listedStarter: index === 0,
          injuries: Array.isArray(athlete.injuries)
            ? athlete.injuries
            : []
        });
      });
    }
  }

  return records;
}

async function main() {
  const result = await getDepthChart("25");
  const records = normalizeDepthChart(result);

  if (!records.length) {
    throw new Error("No se encontraron jugadores");
  }

  console.log(
    "===== CASHEDGE NBA ROTATION AUDIT ====="
  );

  console.log("Team:", result.team?.displayName);
  console.log("Season:", result.season?.year);
  console.log("Checked at:", result.checkedAt);
  console.log("Position entries:", records.length);

  for (const position of POSITIONS) {
    const group = records.filter(
      player => player.position === position.toUpperCase()
    );

    console.log(
      `\n===== ${position.toUpperCase()} =====`
    );

    for (const player of group) {
      console.log(
        `${player.depthRank}. ${player.playerName}` +
        ` | ESPN ID: ${player.espnPlayerId}` +
        ` | Starter: ${player.listedStarter}` +
        ` | Injuries: ${player.injuries.length}`
      );
    }
  }

  console.log(
    "\nUnique players:",
    new Set(records.map(p => p.espnPlayerId)).size
  );

  console.log(
    "SHADOW ONLY | NO DATABASE WRITES"
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizeDepthChart
};

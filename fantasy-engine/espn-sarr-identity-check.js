
"use strict";

// CASHEDGE FANTASY EDGE
// ESPN NBA — ALEX SARR IDENTITY CHECK
//
// Solo lectura de ESPN.
// No escribe en Supabase.
// No modifica proyecciones.
// SHADOW ONLY.

const {
  getDepthChart
} = require("./espn-depthchart-probe");

const {
  normalizeDepthChart
} = require("./espn-depthchart-normalizer");

async function main() {
  const url =
    "https://site.api.espn.com/apis/site/v2/" +
    "sports/basketball/nba/teams?limit=100";

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `ESPN teams HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const teams =
    data?.sports?.[0]?.leagues?.[0]?.teams;

  if (!Array.isArray(teams)) {
    throw new Error("Invalid ESPN teams response");
  }

  const washington = teams
    .map(item => item.team)
    .find(team =>
      team?.abbreviation === "WSH"
    );

  if (!washington?.id) {
    throw new Error(
      "Washington Wizards not found"
    );
  }

  const result = await getDepthChart(
    String(washington.id)
  );

  const records = normalizeDepthChart(result);

  const matches = records.filter(player =>
    /sarr/i.test(player.playerName)
  );

  const unique = [
    ...new Map(
      matches.map(player => [
        player.espnPlayerId,
        player
      ])
    ).values()
  ];

  console.log(
    "===== CASHEDGE SARR IDENTITY CHECK ====="
  );

  console.log(
    "ESPN Team:",
    result.team?.displayName
  );

  console.log(
    "ESPN Team ID:",
    washington.id
  );

  console.log(
    "Checked At:",
    result.checkedAt
  );

  console.log(
    "Matching players:",
    JSON.stringify(unique, null, 2)
  );

  console.log(
    "Supabase expected name: Alexandre Sarr"
  );

  console.log(
    "Supabase expected ID: 1028028405"
  );

  console.log(
    "Supabase expected team ID: 30"
  );

  if (unique.length !== 1) {
    throw new Error(
      "Sarr identity requires manual review"
    );
  }

  console.log(
    "ESPN PLAYER ID:",
    unique[0].espnPlayerId
  );

  console.log(
    "IDENTITY CANDIDATE — NOT AUTOMATICALLY VERIFIED"
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

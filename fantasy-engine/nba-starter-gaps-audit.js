
"use strict";

// CASHEDGE FANTASY NBA
// STARTER GAPS AUDIT
//
// Solo analiza el resultado del Core V1.
// No modifica jugadores, filtros ni formulas.
// No conecta a Supabase.
// SHADOW ONLY.

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  "fantasy-shadow-input"
);

const input = path.join(
  root,
  "nba-fantasy-core-shadow.json"
);

const output = path.join(
  root,
  "nba-starter-gaps-audit.json"
);

if (!fs.existsSync(input)) {
  throw new Error(
    "Missing NBA Fantasy Core report"
  );
}

const core = JSON.parse(
  fs.readFileSync(input, "utf8")
);

if (
  core.module !== "fantasy_nba" ||
  core.mode !== "shadow" ||
  !Array.isArray(core.players)
) {
  throw new Error(
    "Invalid Fantasy SHADOW input"
  );
}

const starters = core.players.filter(
  player => player.rank === 1
);

const blocked = starters.filter(
  player => !player.poolEligible
);

const byReason = {};

for (const player of blocked) {
  for (const reason of player.reasons || []) {
    byReason[reason] =
      (byReason[reason] || 0) + 1;
  }
}

const blockedPlayers = blocked.map(
  player => ({
    player: player.player,
    team: player.team,
    espnPlayerId: player.espnPlayerId,
    nbaPlayerId: player.nbaPlayerId,

    identity: player.identity,

    recentSampleGames:
      player.sampleGames,

    currentSeasonGames:
      player.currentTeam2026Games,

    observedMinutes:
      player.observedMinutes,

    expectedMinutes:
      player.expectedMinutes,

    reasons: player.reasons
  })
);

const report = {
  module: "fantasy_nba",
  mode: "shadow",
  audit: "starter-gaps-v1",
  targetDate: core.targetDate,

  summary: {
    firstListed: starters.length,

    admitted: starters.filter(
      player => player.poolEligible
    ).length,

    blocked: blocked.length,

    blockedByReason: Object.entries(
      byReason
    ).sort((a, b) => b[1] - a[1])
  },

  blockedPlayers,

  rulesUnchanged: true,
  noDatabaseWrites: true
};

fs.writeFileSync(
  output,
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(
  "===== CASHEDGE STARTER GAPS AUDIT ====="
);

console.log(
  JSON.stringify(
    report.summary,
    null,
    2
  )
);

console.log(
  "===== BLOCKED STARTERS ====="
);

console.table(
  blockedPlayers.map(player => ({
    player: player.player,
    team: player.team,
    sample: player.recentSampleGames,
    minutes: player.observedMinutes,
    reasons: player.reasons.join(", ")
  }))
);

console.log("OUTPUT:", output);
console.log("SHADOW ONLY | NO CHANGES");

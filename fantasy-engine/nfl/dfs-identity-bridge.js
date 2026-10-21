
"use strict";

// CASHEDGE FANTASY — NFL DFS / NFLVERSE IDENTITY BRIDGE
// SHADOW ONLY — READ ONLY
// BALLDONTLIE IDs are NOT GSIS IDs.

const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

const TEAM_ALIASES = {
  LA: "LAR", STL: "LAR", LAR: "LAR",
  JAC: "JAX", JAX: "JAX",
  WSH: "WAS", WAS: "WAS",
  OAK: "LV", LV: "LV",
  SD: "LAC", LAC: "LAC",
  SF: "SF", SFO: "SF",
  GB: "GB", GNB: "GB",
  NE: "NE", NWE: "NE",
  NO: "NO", NOR: "NO",
  TB: "TB", TAM: "TB",
  KC: "KC", KAN: "KC",
  BAL: "BAL", ARI: "ARI"
};

function teamCode(raw) {
  const value = String(raw || "").trim().toUpperCase();
  return TEAM_ALIASES[value] || value;
}

function normalizeName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(?:[a-z] ){1,3}[a-z]\b/g,
      initials => initials.replace(/ /g, "")
    )
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validSalary(value) {
  return Number.isFinite(value) && value > 0;
}

function buildNFLDFSIdentityBridge({ slate, byPlayer }) {
  if (
    slate?.sport !== "nfl" ||
    !["draftkings", "fanduel"].includes(slate.platform) ||
    !Array.isArray(slate.draftables) ||
    !byPlayer ||
    typeof byPlayer !== "object"
  ) {
    throw new Error(
      "NFL identity bridge: slate o historia invalidos"
    );
  }

  const nflverseIndex = new Map();

  for (const [gsisId, games] of Object.entries(byPlayer)) {
    if (!Array.isArray(games) || !games.length) continue;

    const recent = games.reduce(
      (latest, game) =>
        !latest ||
        String(game.game_date) >
          String(latest.game_date)
          ? game
          : latest,
      null
    );

    const pos = String(
      recent.position || ""
    ).trim().toUpperCase();

    const team = teamCode(recent.team);
    const name = normalizeName(recent.player_name);

    if (!POSITIONS.has(pos) || !team || !name) {
      continue;
    }

    const key = `${team}|${pos}|${name}`;

    if (!nflverseIndex.has(key)) {
      nflverseIndex.set(key, new Set());
    }

    nflverseIndex.get(key).add(gsisId);
  }

  const dfsOffense = new Map();
  const dfsDST = new Map();
  const conflicts = new Set();

  for (const row of slate.draftables) {
    if (
      row.active === false ||
      row.disabled === true ||
      !validSalary(row.salary)
    ) {
      continue;
    }

    const entityType = String(
      row.entityType || ""
    ).toLowerCase();

    if (
      entityType === "team" &&
      row.teamId != null
    ) {
      const key = String(row.teamId);

      if (!dfsDST.has(key)) {
        dfsDST.set(key, {
          type: "DST",
          teamId: key,
          name: row.name,
          salary: row.salary,
          eventId: row.eventId,
          gameId: row.gameId,
          team: teamCode(row.team)
        });
      } else {
        const previous = dfsDST.get(key);

        if (
          previous.salary !== row.salary ||
          String(previous.eventId) !==
            String(row.eventId)
        ) {
          conflicts.add(`DST:${key}`);
          dfsDST.delete(key);
        }
      }

      continue;
    }

    if (
      entityType !== "player" ||
      row.playerId == null
    ) {
      continue;
    }

    const pos = String(
      row.position || ""
    ).trim().toUpperCase();

    if (!POSITIONS.has(pos)) continue;

    const id = String(row.playerId);

    const candidate = {
      dfsPlayerId: id,
      name: row.name,
      position: pos,
      team: teamCode(row.team),
      salary: row.salary,
      eventId: row.eventId,
      gameId: row.gameId
    };

    if (
      !candidate.team ||
      !normalizeName(candidate.name) ||
      conflicts.has(`P:${id}`)
    ) {
      continue;
    }

    if (!dfsOffense.has(id)) {
      dfsOffense.set(id, candidate);
      continue;
    }

    const prior = dfsOffense.get(id);

    if (
      prior.position !== candidate.position ||
      prior.team !== candidate.team ||
      normalizeName(prior.name) !==
        normalizeName(candidate.name) ||
      prior.salary !== candidate.salary ||
      String(prior.eventId) !==
        String(candidate.eventId)
    ) {
      conflicts.add(`P:${id}`);
      dfsOffense.delete(id);
    }
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const candidate of dfsOffense.values()) {
    const key = [
      candidate.team,
      candidate.position,
      normalizeName(candidate.name)
    ].join("|");

    const possible = nflverseIndex.get(key);

    if (!possible || possible.size === 0) {
      unmatched.push({
        name: candidate.name,
        position: candidate.position,
        team: candidate.team
      });

    } else if (possible.size !== 1) {
      ambiguous.push({
        name: candidate.name,
        position: candidate.position,
        team: candidate.team
      });

    } else {
      const nflversePlayerId = [...possible][0];

      matched.push({
        ...candidate,
        nflversePlayerId,
        games: byPlayer[nflversePlayerId]
      });
    }
  }

  // Prevent two DFS IDs from matching one GSIS ID.
  const gsisClaims = new Map();

  for (const player of matched) {
    gsisClaims.set(
      player.nflversePlayerId,
      (gsisClaims.get(player.nflversePlayerId) || 0) + 1
    );
  }

  const uniqueMatched = [];

  for (const player of matched) {
    if (
      gsisClaims.get(player.nflversePlayerId) > 1
    ) {
      ambiguous.push({
        name: player.name,
        position: player.position,
        team: player.team
      });
    } else {
      uniqueMatched.push(player);
    }
  }

  const defenses = [...dfsDST.entries()]
    .filter(
      ([id]) => !conflicts.has(`DST:${id}`)
    )
    .map(([, value]) => value);

  return {
    sport: "nfl",
    platform: slate.platform,
    slateId: slate.id,

    identityMethod:
      "exact_normalized_name_latest_team_position",

    identitiesOfficiallyCrosswalked: false,
    readOnly: true,
    readyForPublication: false,

    matched: uniqueMatched,
    unmatched,
    ambiguous,
    defenses,

    report: {
      offensiveCandidates: dfsOffense.size,
      matched: uniqueMatched.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      dst: defenses.length,
      conflictingEntries: conflicts.size,

      coveragePercent: dfsOffense.size
        ? Math.round(
            10000 * uniqueMatched.length /
            dfsOffense.size
          ) / 100
        : 0
    }
  };
}

module.exports = {
  buildNFLDFSIdentityBridge,
  normalizeName,
  teamCode
};

// Independent read-only audit.
if (require.main === module) {
  const {
    loadNFLVerseHistory
  } = require("./stats-bridge");

  const {
    listFantasySlates,
    loadFantasySlate
  } = require("../shared/dfs-provider");

  const apiKey =
    process.env.BALLDONTLIE_NFL_API_KEY ||
    process.env.BALLDONTLIE_API_KEY;

  async function audit() {
    if (!apiKey) {
      throw new Error(
        "Missing BALLDONTLIE_NFL_API_KEY"
      );
    }

    const history = await loadNFLVerseHistory({
      targetSeason: 2026,
      targetWeek: 8,
      cutoffAt: "2026-10-21T18:00:00Z"
    });

    console.log(
      "NFLVERSE HISTORY:",
      JSON.stringify(history.report)
    );

    for (const platform of [
      "draftkings",
      "fanduel"
    ]) {
      const slates = await listFantasySlates({
        sport: "nfl",
        platform,
        startDate: "2026-10-25",
        endDate: "2026-10-26",
        apiKey
      });

      const choices = slates
        .filter(s =>
          s.format === "salary_cap" &&
          s.scope === "multi_event" &&
          String(s.startsAt || "")
            .startsWith("2026-10-25")
        )
        .sort(
          (a, b) =>
            Number(b.eventCount || 0) -
            Number(a.eventCount || 0)
        );

      if (!choices.length) {
        throw new Error(
          `No Sunday NFL ${platform} main slate`
        );
      }

      const slateId = choices[0].id;

      const slate = await loadFantasySlate({
        sport: "nfl",
        platform,
        slateId,
        apiKey
      });

      const bridge = buildNFLDFSIdentityBridge({
        slate,
        byPlayer: history.byPlayer
      });

      console.log(
        `${platform.toUpperCase()} SLATE: ${slateId}`
      );

      console.log(
        `${platform.toUpperCase()} REPORT:`,
        JSON.stringify(bridge.report)
      );

      console.log(
        `${platform.toUpperCase()} UNMATCHED EXAMPLES:`,
        JSON.stringify(
          bridge.unmatched.slice(0, 12)
        )
      );

      console.log(
        `${platform.toUpperCase()} DST EXAMPLES:`,
        JSON.stringify(
          bridge.defenses.slice(0, 3)
        )
      );

      if (
        !bridge.report.offensiveCandidates ||
        !bridge.defenses.length
      ) {
        throw new Error(
          `${platform}: slate incompleto`
        );
      }
    }

    console.log(
      "NFL IDENTITY SHADOW COMPLETE"
    );

    console.log(
      "SUPABASE WRITES: ZERO"
    );
  }

  audit().catch(error => {
    console.error(
      error.stack || error.message
    );

    process.exitCode = 1;
  });
}

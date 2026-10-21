
"use strict";

// CASHEDGE FANTASY NFL — REAL SLATE PROJECTION AUDIT
// SHADOW ONLY. READ ONLY.
// NO GENERA NI RECOMIENDA ALINEACIONES.

const {
  loadNFLVerseHistory
} = require("./stats-bridge");

const {
  buildNFLDFSIdentityBridge
} = require("./dfs-identity-bridge");

const {
  projectNFLFantasyPoints
} = require("./fantasy-points-bridge");

const {
  loadFantasySlate
} = require("../shared/dfs-provider");

const PLATFORMS = new Set([
  "draftkings",
  "fanduel"
]);

function projectNFLSlateShadow({
  slate,
  history,
  cutoffAt,
  contextsByGSIS = {}
} = {}) {
  if (
    slate?.sport !== "nfl" ||
    !PLATFORMS.has(slate.platform) ||
    !Array.isArray(slate.draftables) ||
    !history?.byPlayer ||
    typeof history.byPlayer !== "object" ||
    !Number.isFinite(Date.parse(cutoffAt || "")) ||
    !Number.isFinite(Date.parse(slate.startsAt || "")) ||
    Date.parse(cutoffAt) >=
      Date.parse(slate.startsAt)
  ) {
    throw new Error(
      "NFL shadow: slate, historial o cutoffAt invalidos"
    );
  }

  const bridge = buildNFLDFSIdentityBridge({
    slate,
    byPlayer: history.byPlayer
  });

  const projected = [];
  const rejected = [];
  const statuses = Object.create(null);

  let thrown = 0;

  for (const player of bridge.matched) {
    let result;

    try {
      result = projectNFLFantasyPoints({
        playerId: player.nflversePlayerId,
        position: player.position,
        games: player.games,
        cutoffAt,
        context:
          contextsByGSIS[player.nflversePlayerId] || {}
      });

    } catch (error) {
      thrown++;

      rejected.push({
        name: player.name,
        reason: "projection_exception",
        detail: String(
          error?.message || error
        ).slice(0, 180)
      });

      continue;
    }

    const status = String(
      result?.status || "unknown"
    );

    statuses[status] =
      (statuses[status] || 0) + 1;

    const draftkings =
      result?.fantasyPoints?.draftkings;

    const fanduel =
      result?.fantasyPoints?.fanduel;

    if (
      !Number.isFinite(draftkings) ||
      !Number.isFinite(fanduel) ||
      draftkings < 0 ||
      fanduel < 0
    ) {
      rejected.push({
        name: player.name,
        reason: status,
        gamesAvailable:
          result?.gamesAvailable ?? null
      });

      continue;
    }

    projected.push({
      dfsPlayerId:
        String(player.dfsPlayerId),

      gsisPlayerId:
        String(player.nflversePlayerId),

      name: player.name,
      team: player.team,
      position: player.position,

      eventId: player.eventId,
      gameId: player.gameId,
      salary: player.salary,

      projectedPoints: {
        draftkings,
        fanduel
      },

      projectionStatus: status,

      availabilityStatus:
        result.availabilityStatus ??
        "unverified",

      gamesAvailable:
        result.gamesAvailable ?? null,

      // Falta validar rol, lesiones y DST.
      readyForOptimization: false
    });
  }

  projected.sort(
    (a, b) =>
      b.projectedPoints[slate.platform] -
      a.projectedPoints[slate.platform]
  );

  const report = {
    platform: slate.platform,
    slateId: slate.id,
    salaryCap: slate.salaryCap,

    matchedIdentities:
      bridge.report.matched,

    unmatchedIdentities:
      bridge.report.unmatched,

    dstAvailableWithoutProjection:
      bridge.defenses.length,

    offensiveScoresCalculated:
      projected.length,

    offensiveScoresUnavailable:
      rejected.length,

    projectionExceptions: thrown,

    projectionStatuses: statuses,

    readyForOptimization: 0,
    readyForPublication: false,
    writesToSupabase: 0
  };

  return {
    mode: "shadow",
    sport: "nfl",
    platform: slate.platform,
    cutoffAt,

    report,
    projected,
    rejected,

    defenses: bridge.defenses
  };
}

module.exports = {
  projectNFLSlateShadow
};

// PRUEBA INDEPENDIENTE CON DATOS REALES.
// SOLO LECTURA.

if (require.main === module) {
  const apiKey =
    process.env.BALLDONTLIE_NFL_API_KEY ||
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BALLDONTLIE_NBA_API_KEY;

  async function run() {
    if (!apiKey) {
      throw new Error(
        "Missing BALLDONTLIE API key"
      );
    }

    // Snapshot pregame de semana 8.
    const cutoffAt =
      "2026-10-21T18:00:00Z";

    // Se descarga el historial una sola vez,
    // no una vez por jugador o plataforma.
    const history = await loadNFLVerseHistory({
      targetSeason: 2026,
      targetWeek: 8,
      cutoffAt
    });

    console.log(
      "NFLVERSE:",
      JSON.stringify(history.report)
    );

    // Slates que ya verificamos con datos reales.
    const slates = [
      ["draftkings", 77192],
      ["fanduel", 75887]
    ];

    for (const [
      platform,
      slateId
    ] of slates) {
      const slate = await loadFantasySlate({
        sport: "nfl",
        platform,
        slateId,
        apiKey
      });

      const result = projectNFLSlateShadow({
        slate,
        history,
        cutoffAt
      });

      console.log(
        `${platform.toUpperCase()} PROJECTION REPORT:`,
        JSON.stringify(result.report)
      );

      console.log(
        `${platform.toUpperCase()} REJECTION EXAMPLES:`,
        JSON.stringify(
          result.rejected.slice(0, 8)
        )
      );

      console.log(
        `${platform.toUpperCase()} PROJECTION SAMPLE (NOT VERIFIED FOR USE):`,
        JSON.stringify(
          result.projected.slice(0, 5).map(
            player => ({
              name: player.name,
              position: player.position,
              salary: player.salary,
              points:
                player.projectedPoints[platform],
              status:
                player.projectionStatus
            })
          )
        )
      );

      if (
        !result.report.offensiveScoresCalculated
      ) {
        throw new Error(
          `${platform}: no valid fantasy-point projections`
        );
      }
    }

    console.log(
      "NFL OFFENSE SHADOW AUDIT COMPLETE"
    );

    console.log(
      "DST PROJECTIONS AND PLAYER AVAILABILITY: PENDING"
    );

    console.log(
      "SUPABASE WRITES: ZERO"
    );
  }

  run().catch(error => {
    console.error(
      "NFL SHADOW ERROR:",
      error.stack || error.message
    );

    process.exitCode = 1;
  });
}

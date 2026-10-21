
"use strict";

/**
 * CashEdge Fantasy Edge
 * NFL DST Slate Bridge - SHADOW
 *
 * Conecta:
 * - Slates oficiales BALLDONTLIE
 * - Salarios DraftKings y FanDuel
 * - Historial DST reconstruido
 * - Proyecciones NFL DST
 *
 * No modifica los motores ofensivos.
 * No escribe en Supabase.
 * No desbloquea alineaciones.
 */

const fs = require("fs");
const path = require("path");

const {
  loadFantasySlate
} = require("../shared/dfs-provider");

const {
  teamCode
} = require("./dfs-identity-bridge");

const {
  projectNFLDST
} = require("./dst-projection");

const HISTORY_FILE = path.resolve(
  process.cwd(),
  "dst-history-shadow.json"
);

const CUTOFF = "2026-10-21T18:00:00Z";

const SLATES = [
  { platform: "draftkings", id: 77192 },
  { platform: "fanduel", id: 75887 }
];

function id(value) {
  return String(value ?? "").trim();
}

function buildEventTeams(slate) {
  const teams = new Map();

  for (const entry of slate.draftables) {
    const eventId = id(entry.eventId);
    const code = teamCode(entry.team);

    if (!eventId || !code) continue;

    if (!teams.has(eventId)) {
      teams.set(eventId, new Set());
    }

    teams.get(eventId).add(code);
  }

  return teams;
}

function projectDSTSlateShadow({
  slate,
  history,
  cutoffAt
}) {
  if (
    slate?.sport !== "nfl" ||
    !["draftkings", "fanduel"].includes(slate.platform) ||
    !Array.isArray(slate.draftables) ||
    !Array.isArray(slate.events) ||
    !Array.isArray(history?.records) ||
    history.mode !== "SHADOW" ||
    history.readyForOptimization !== false ||
    history.readyForPublication !== false
  ) {
    throw new Error("Invalid DST shadow input");
  }

  const cutoffMs = Date.parse(cutoffAt);

  if (
    !Number.isFinite(cutoffMs) ||
    cutoffMs >= Date.parse(slate.startsAt)
  ) {
    throw new Error("Invalid pregame cutoff");
  }

  // Corte conservador: no usar partidos
  // del mismo dia del snapshot.
  const historicalCutoff =
    cutoffAt.slice(0, 10) + "T00:00:00Z";

  const validHistory = history.records.filter(r =>
    r.complete === true &&
    Number.isFinite(Date.parse(r.gameDate)) &&
    Date.parse(r.gameDate) <
      Date.parse(historicalCutoff)
  );

  const eventTeams = buildEventTeams(slate);

  const events = new Map(
    slate.events.map(e => [id(e.id), e])
  );

  const projected = [];
  const rejected = [];
  const seenTeams = new Set();

  const candidates = slate.draftables.filter(row =>
    String(row.entityType).toLowerCase() === "team" &&
    row.teamId != null &&
    row.active !== false &&
    row.disabled !== true &&
    Number.isFinite(row.salary) &&
    row.salary > 0
  );

  for (const row of candidates) {
    const team = teamCode(row.team);
    const eventId = id(row.eventId);
    const teamId = id(row.teamId);

    const uniqueKey = `${eventId}|${teamId}`;

    if (seenTeams.has(uniqueKey)) {
      continue;
    }

    seenTeams.add(uniqueKey);

    const event = events.get(eventId);
    const teams = eventTeams.get(eventId);

    const reject = reason => {
      rejected.push({
        team,
        teamId,
        eventId,
        reason
      });
    };

    if (
      !team ||
      !event ||
      !teams ||
      teams.size !== 2 ||
      !teams.has(team)
    ) {
      reject("unverified_event_opponent");
      continue;
    }

    if (
      !Number.isFinite(Date.parse(event.startsAt)) ||
      Date.parse(event.startsAt) <= cutoffMs
    ) {
      reject("invalid_future_event");
      continue;
    }

    const opponent = [...teams].find(
      code => code !== team
    );

    if (!opponent) {
      reject("opponent_missing");
      continue;
    }

    const defenseGames = validHistory.filter(
      r => teamCode(r.team) === team
    );

    const opponentGames = validHistory.filter(
      r => teamCode(r.opponent) === opponent
    );

    let projection;

    try {
      projection = projectNFLDST({
        platform: slate.platform,
        team,
        opponent,
        kickoff: historicalCutoff,
        defenseGames,
        opponentGames
      });
    } catch (error) {
      reject("projection_exception");
      continue;
    }

    if (
      !Number.isFinite(projection.projectedPoints)
    ) {
      reject(
        projection.status || "projection_unavailable"
      );
      continue;
    }

    projected.push({
      type: "DST",
      team,
      opponent,
      teamId,
      name: row.name,
      eventId,
      gameId: row.gameId,
      eventStartsAt: event.startsAt,
      salary: row.salary,
      projectedPoints: projection.projectedPoints,
      breakdown: projection.breakdown,
      sample: projection.sample,
      projectionStatus: projection.status,
      availabilityStatus: "unverified",
      mode: "SHADOW",
      readyForOptimization: false,
      readyForPublication: false
    });
  }

  projected.sort(
    (a, b) =>
      b.projectedPoints - a.projectedPoints
  );

  const statuses = {};

  for (const row of rejected) {
    statuses[row.reason] =
      (statuses[row.reason] || 0) + 1;
  }

  return {
    mode: "SHADOW",
    sport: "nfl",
    platform: slate.platform,
    slateId: slate.id,
    cutoffAt,
    report: {
      platform: slate.platform,
      slateId: slate.id,
      salaryCap: slate.salaryCap,
      dstCandidates: candidates.length,
      dstProjected: projected.length,
      dstRejected: rejected.length,
      rejectionReasons: statuses,
      completeHistoricalRecords:
        validHistory.length,
      readyForOptimization: 0,
      readyForPublication: false,
      writesToSupabase: 0
    },
    projected,
    rejected
  };
}

async function main() {
  if (!fs.existsSync(HISTORY_FILE)) {
    throw new Error(
      "Missing DST history. Run Python bridge first."
    );
  }

  const history = JSON.parse(
    fs.readFileSync(HISTORY_FILE, "utf8")
  );

  const apiKey =
    process.env.BALLDONTLIE_NFL_API_KEY ||
    process.env.BALLDONTLIE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing BALLDONTLIE key");
  }

  for (const config of SLATES) {
    const slate = await loadFantasySlate({
      sport: "nfl",
      platform: config.platform,
      slateId: config.id,
      apiKey
    });

    const result = projectDSTSlateShadow({
      slate,
      history,
      cutoffAt: CUTOFF
    });

    console.log(
      `\n===== ${config.platform.toUpperCase()} DST =====`
    );

    console.log(
      "REPORT:",
      JSON.stringify(result.report)
    );

    console.log(
      "TOP DST:",
      JSON.stringify(
        result.projected.slice(0, 10).map(r => ({
          team: r.team,
          opponent: r.opponent,
          salary: r.salary,
          projectedPoints: r.projectedPoints,
          sample: r.sample
        }))
      )
    );

    console.log(
      "REJECTIONS:",
      JSON.stringify(result.rejected.slice(0, 10))
    );

    if (!result.projected.length) {
      throw new Error(
        `${config.platform}: no DST projections`
      );
    }
  }

  console.log("\nNFL DST SLATE SHADOW COMPLETE");
  console.log("Optimization remains BLOCKED");
  console.log("Publication remains BLOCKED");
  console.log("Supabase writes: 0");
}

module.exports = {
  projectDSTSlateShadow
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}


"use strict";

/**
 * CashEdge NFL - Primera alineacion SHADOW
 *
 * Simulacion tecnica con datos reales.
 * No confirma disponibilidad final.
 * No publica recomendaciones.
 * No escribe en Supabase.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");


const {
  loadNFLVerseHistory,
  parseCSV
} = require("./stats-bridge");

const {
  teamCode
} = require("./dfs-identity-bridge");


const {
  loadFantasySlate
} = require("../shared/dfs-provider");

const {
  projectNFLSlateShadow
} = require("./slate-projections");

const {
  projectDSTSlateShadow
} = require("./dst-slate-bridge");

const CUTOFF = "2026-10-21T18:00:00Z";

const SLATES = [
  ["draftkings", 77192],
  ["fanduel", 75887]
];

const HISTORY_FILE = path.resolve(
  process.cwd(),
  "dst-history-shadow.json"
);

const SOLVER = path.resolve(
  __dirname,
  "../optimizer/solver.py"
);

const timestamp = value =>
  Date.parse(value || "");

const ident = value =>
  String(value ?? "").trim();

async function readRows(table, select, filters = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    throw new Error("Supabase secrets missing");
  }

  const url = new URL(
    `${base.replace(/\/$/, "")}/rest/v1/${table}`
  );

  url.searchParams.set("select", select);

  for (const [column, filter] of Object.entries(filters)) {
    url.searchParams.set(column, filter);
  }

  const rows = [];

  for (let start = 0; start < 30000; start += 1000) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${start}-${start + 999}`
      }
    });

    if (!response.ok) {
      throw new Error(
        `${table}: HTTP ${response.status}`
      );
    }

    const page = await response.json();

    if (!Array.isArray(page)) {
      throw new Error(`${table}: invalid data`);
    }

    rows.push(...page);

    if (page.length < 1000) {
      return rows;
    }
  }

  throw new Error(`${table}: pagination limit`);
}

async function loadWeeklyRosterStatus() {
  const url =
    "https://github.com/nflverse/nflverse-data/" +
    "releases/download/weekly_rosters/" +
    "roster_weekly_2026.csv";

  const response = await fetch(url, {
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    throw new Error(
      `NFLverse roster HTTP ${response.status}`
    );
  }

  const rows = parseCSV(
    await response.text(),
    [
      "season",
      "week",
      "game_type",
      "gsis_id",
      "team",
      "status"
    ]
  );

  const latest = new Map();
  const ambiguous = new Set();

  // Snapshot de prueba del 21 de octubre.
  // Solo semanas terminadas antes del corte.
  const MAX_COMPLETED_WEEK = 6;

  for (const row of rows) {
    const gsis = ident(row.gsis_id);
    const week = Number(row.week);

    if (
      Number(row.season) !== 2026 ||
      String(row.game_type).toUpperCase() !== "REG" ||
      !Number.isInteger(week) ||
      week < 1 ||
      week > MAX_COMPLETED_WEEK ||
      !gsis
    ) {
      continue;
    }

    const candidate = {
      week,
      team: teamCode(row.team),
      status: String(row.status || "")
        .trim()
        .toUpperCase()
    };

    const previous = latest.get(gsis);

    if (!previous || week > previous.week) {
      latest.set(gsis, candidate);
      ambiguous.delete(gsis);
    } else if (
      week === previous.week &&
      (
        previous.team !== candidate.team ||
        previous.status !== candidate.status
      )
    ) {
      ambiguous.add(gsis);
    }
  }

  if (!latest.size) {
    throw new Error(
      "NFLverse weekly roster returned no valid players"
    );
  }

  return {
    rowsRead: rows.length,
    indexedPlayers: latest.size,
    check(gsis, expectedTeam) {
      const key = ident(gsis);
      const record = latest.get(key);

      if (
        !record ||
        ambiguous.has(key) ||
        record.team !== teamCode(expectedTeam)
      ) {
        return "UNKNOWN";
      }

      return ["ACT", "ACTIVE"].includes(
        record.status
      )
        ? "ACTIVE"
        : "INACTIVE";
    }
  };
}

function buildEvidence(snaps, links, injuries) {
  const cutoff = timestamp(CUTOFF);
  const snapDates = new Map();

  for (const row of snaps) {
    const date = timestamp(row.game_date);
    const gsis = ident(row.player_id);

    if (
      !gsis ||
      !Number.isFinite(date) ||
      date >= cutoff ||
      date < cutoff - 28 * 86400000 ||
      !(Number(row.offense_snaps) > 0)
    ) {
      continue;
    }

    if (!snapDates.has(gsis)) {
      snapDates.set(gsis, new Set());
    }

    snapDates.get(gsis).add(
      String(row.game_date).slice(0, 10)
    );
  }

  const gsisToApi = new Map();
  const conflicts = new Set();

  for (const row of links) {
    const gsis = ident(row.gsis_player_id);
    const apiId = ident(row.api_sports_player_id);

    if (!gsis || !apiId) continue;

    if (
      gsisToApi.has(gsis) &&
      gsisToApi.get(gsis) !== apiId
    ) {
      conflicts.add(gsis);
    } else {
      gsisToApi.set(gsis, apiId);
    }
  }

  for (const gsis of conflicts) {
    gsisToApi.delete(gsis);
  }

  const blockedApiIds = new Set();

  for (const row of injuries) {
    const observed = timestamp(
      row.last_seen_at || row.updated_at
    );

    if (
      row.active !== true ||
      !Number.isFinite(observed) ||
      observed >= cutoff ||
      observed < cutoff - 7 * 86400000
    ) {
      continue;
    }

    const status = String(
      row.normalized_status ||
      row.raw_status ||
      ""
    ).toLowerCase();

    if (
      /\b(out|inactive|suspended|ir|questionable|doubtful)\b/.test(status) ||
      status.includes("injured reserve")
    ) {
      blockedApiIds.add(
        ident(row.api_sports_player_id)
      );
    }
  }

  return {
    hasSnaps: gsis =>
      (snapDates.get(ident(gsis))?.size || 0) >= 2,

    blocked: gsis =>
      blockedApiIds.has(
        gsisToApi.get(ident(gsis))
      )
  };
}

function runSolver(payload) {
  const result = spawnSync(
    "python",
    [SOLVER],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 3 * 1024 * 1024,
      timeout: 60000
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `Solver failed: ${
        result.error?.message ||
        result.stderr ||
        result.stdout
      }`
    );
  }

  return JSON.parse(result.stdout.trim());
}

async function main() {
  const apiKey =
    process.env.BALLDONTLIE_NFL_API_KEY ||
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BALLDONTLIE_NBA_API_KEY;

  if (!apiKey) {
    throw new Error("BALLDONTLIE key missing");
  }

  if (!fs.existsSync(HISTORY_FILE)) {
    throw new Error("Run DST Python bridge first");
  }

  const dstHistory = JSON.parse(
    fs.readFileSync(HISTORY_FILE, "utf8")
  );

  if (
    dstHistory.mode !== "SHADOW" ||
    dstHistory.readyForPublication !== false ||
    dstHistory.readyForOptimization !== false
  ) {
    throw new Error("DST history is not SHADOW");
  }

  const [history, snaps, links, injuries] =
    await Promise.all([
      loadNFLVerseHistory({
        targetSeason: 2026,
        targetWeek: 8,
        cutoffAt: CUTOFF
      }),

      readRows(
        "football_player_game_stats",
        "player_id,game_date,offense_snaps",
        {
          sport: "eq.nfl",
          season: "eq.2026",
          game_date: "gte.2026-09-01"
        }
      ),

      readRows(
        "nfl_player_crosswalk",
        "gsis_player_id,api_sports_player_id"
      ),

      readRows(
        "nfl_injury_state",
        "api_sports_player_id,normalized_status,raw_status,active,last_seen_at,updated_at"
      )
    ]);

  if (
    !snaps.length ||
    !links.length ||
    !injuries.length
  ) {
    throw new Error("Missing critical source data");
  }

 
  const evidence = buildEvidence(
    snaps,
    links,
    injuries
  );

  const weeklyRoster =
    await loadWeeklyRosterStatus();

  console.log(
    "WEEKLY ROSTER:",
    JSON.stringify({
      rowsRead: weeklyRoster.rowsRead,
      indexedPlayers: weeklyRoster.indexedPlayers
    })
  );


  for (const [platform, slateId] of SLATES) {
    const slate = await loadFantasySlate({
      sport: "nfl",
      platform,
      slateId,
      apiKey
    });

    const salaryCap =
      platform === "draftkings" ? 50000 : 60000;

    if (
      slate.format !== "salary_cap" ||
      slate.scope !== "multi_event" ||
      slate.salaryCap !== salaryCap ||
      timestamp(slate.startsAt) <= timestamp(CUTOFF)
    ) {
      throw new Error(
        `${platform}: unexpected contest rules`
      );
    }

    const offense = projectNFLSlateShadow({
      slate,
      history,
      cutoffAt: CUTOFF
    });

    const defense = projectDSTSlateShadow({
      slate,
      history: dstHistory,
      cutoffAt: CUTOFF
    });

    const allowedEvents = new Set(
      slate.events.map(e => ident(e.id))
    );

    const metadata = new Map();

    for (const row of slate.draftables) {
      if (
        row.entityType !== "player" ||
        row.playerId == null
      ) {
        continue;
      }

      const key = ident(row.playerId);

      if (!metadata.has(key)) {
        metadata.set(key, row);
      }
    }


    const exclusions = {
      noSnaps: 0,
      knownInjury: 0,
      rosterInactive: 0,
      rosterUnknown: 0,
      invalid: 0
    };

    const players = [];

   
    for (const p of offense.projected) {
      const rosterStatus = weeklyRoster.check(
        p.gsisPlayerId,
        p.team
      );

      if (rosterStatus !== "ACTIVE") {
        if (rosterStatus === "INACTIVE") {
          exclusions.rosterInactive++;
        } else {
          exclusions.rosterUnknown++;
        }

        continue;
      }

      if (!evidence.hasSnaps(p.gsisPlayerId)) {

        exclusions.noSnaps++;
        continue;
      }

      if (evidence.blocked(p.gsisPlayerId)) {
        exclusions.knownInjury++;
        continue;
      }

      const raw = metadata.get(
        ident(p.dfsPlayerId)
      );

      const points = p.projectedPoints[platform];

      if (
        !raw ||
        raw.disabled === true ||
        raw.active === false ||
        /^(out|inactive|injured|suspended)$/i.test(
          String(raw.status || "")
        ) ||
        !Number.isFinite(points) ||
        points < 0 ||
        !allowedEvents.has(ident(p.eventId))
      ) {
        exclusions.invalid++;
        continue;
      }

      players.push({
        playerId: `P:${ident(p.dfsPlayerId)}`,
        name: p.name,
        teamId: ident(raw.teamId),
        gameId: ident(p.eventId),
        position: p.position,
        salary: p.salary,
        projectedPoints: points
      });
    }

    for (const d of defense.projected) {
      if (!allowedEvents.has(ident(d.eventId))) {
        continue;
      }

      players.push({
        playerId: `DST:${ident(d.teamId)}`,
        name: d.name,
        teamId: ident(d.teamId),
        gameId: ident(d.eventId),
        position: "DST",
        salary: d.salary,
        projectedPoints: d.projectedPoints
      });
    }

    const result = runSolver({
      sport: "nfl",
      platform,
      slate: {
        id: slate.id,
        sport: "nfl",
        platform,
        format: "classic",
        gameIds: [...allowedEvents]
      },
      players,
      timeLimitSeconds: 15
    });

    console.log(
      `\n===== ${platform.toUpperCase()} FIRST SHADOW LINEUP =====`
    );

    console.log(
      "Player pool:", players.length
    );

    console.log(
      "Offense:",
      players.filter(p => p.position !== "DST").length
    );

    console.log(
      "DST:",
      players.filter(p => p.position === "DST").length
    );

    console.log(
      "Exclusions:",
      JSON.stringify(exclusions)
    );

    console.log(
      "Solver status:",
      result.status
    );

    console.log(
      "Mathematically optimal:",
      result.optimalityGuaranteed
    );

    if (!result.found) {
      console.log("Reason:", result.reason);

      throw new Error(
        `${platform}: no feasible technical lineup`
      );
    }

    console.log(
      "Salary:",
      result.salary
    );

    console.log(
      "Projected points:",
      result.projectedPoints
    );

    for (const row of result.lineup) {
      console.log(
        `${row.slot}: ${row.name} | ` +
        `$${row.salary} | ` +
        `${row.projectedPoints} pts`
      );
    }

    console.log(
      "AVAILABILITY NOT CONFIRMED"
    );

    console.log(
      "TECHNICAL SIMULATION ONLY"
    );
  }

  console.log(
    "\nSHADOW SMOKE TEST COMPLETE"
  );

  console.log(
    "PUBLICATION BLOCKED"
  );
}

main().catch(error => {
  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;
});

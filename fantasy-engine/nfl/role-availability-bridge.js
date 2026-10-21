
"use strict";

/**
 * CashEdge Fantasy Edge
 * NFL Role & Availability Bridge V1
 *
 * Cruza jugadores DFS con:
 * - NFLverse / GSIS
 * - Historial de snaps en Supabase
 * - Crosswalk API-Sports
 * - Estado de lesiones almacenado
 *
 * Solo lectura. SHADOW.
 * No autoriza optimizacion ni publicacion.
 */

const {
  loadNFLVerseHistory
} = require("./stats-bridge");

const {
  buildNFLDFSIdentityBridge
} = require("./dfs-identity-bridge");

const {
  loadFantasySlate
} = require("../shared/dfs-provider");

const CUTOFF = "2026-10-21T18:00:00Z";
const HISTORY_START = "2026-09-01";

const SLATES = [
  ["draftkings", 77192],
  ["fanduel", 75887]
];

function id(value) {
  return String(value ?? "").trim();
}

function dateMs(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function injuryCategory(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();

  if (!s) return "unknown";

  if (
    /\binjured reserve\b|\breserve\/injured\b/.test(s) ||
    s === "ir"
  ) return "out";

  if (
    /\bout\b|\binactive\b|\bsuspended\b/.test(s)
  ) return "out";

  if (/\bdoubtful\b/.test(s)) return "doubtful";
  if (/\bquestionable\b/.test(s)) return "questionable";
  if (/\bprobable\b/.test(s)) return "probable";

  return "unknown";
}

async function readAll(table, columns, filters = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const url = new URL(
    `${base.replace(/\/$/, "")}/rest/v1/${table}`
  );

  url.searchParams.set("select", columns);

  for (const [field, filter] of Object.entries(filters)) {
    url.searchParams.set(field, filter);
  }

  const rows = [];
  const pageSize = 1000;

  for (let page = 0; page < 30; page++) {
    const start = page * pageSize;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${start}-${start + pageSize - 1}`
      }
    });

    if (!response.ok) {
      throw new Error(
        `${table}: Supabase HTTP ${response.status}`
      );
    }

    const batch = await response.json();

    if (!Array.isArray(batch)) {
      throw new Error(`${table}: invalid response`);
    }

    rows.push(...batch);

    if (batch.length < pageSize) {
      return rows;
    }
  }

  throw new Error(`${table}: pagination limit exceeded`);
}

function indexUniqueCrosswalk(rows) {
  const index = new Map();
  const conflicts = new Set();

  for (const row of rows) {
    const gsis = id(row.gsis_player_id);

    if (!gsis) continue;

    const previous = index.get(gsis);

    if (
      previous &&
      id(previous.api_sports_player_id) !==
        id(row.api_sports_player_id)
    ) {
      conflicts.add(gsis);
    } else {
      index.set(gsis, row);
    }
  }

  for (const gsis of conflicts) {
    index.delete(gsis);
  }

  return { index, conflicts };
}

function inspectPlayer({
  player,
  crosswalk,
  snaps,
  injuries,
  cutoff
}) {
  const gsis = id(player.nflversePlayerId);
  const link = crosswalk.get(gsis);

  const priorSnaps = (snaps.get(gsis) || [])
    .filter(row => {
      const d = dateMs(row.game_date);
      return d !== null && d < cutoff;
    })
    .sort(
      (a, b) =>
        dateMs(b.game_date) - dateMs(a.game_date)
    );

  const recent = priorSnaps
    .filter(row => {
      const d = dateMs(row.game_date);
      return d >= cutoff - 28 * 86400000;
    })
    .slice(0, 4);

  const positive = recent.filter(row =>
    Number(row.offense_snaps) > 0
  );

  const apiId = id(link?.api_sports_player_id);

  const injuryRows = (injuries.get(apiId) || [])
    .filter(row => {
      const observed = dateMs(
        row.last_seen_at || row.updated_at
      );

      return (
        row.active === true &&
        observed !== null &&
        observed < cutoff
      );
    })
    .sort(
      (a, b) =>
        dateMs(b.last_seen_at || b.updated_at) -
        dateMs(a.last_seen_at || a.updated_at)
    );

  const latestInjury = injuryRows[0] || null;

  const injuryStatus = latestInjury
    ? injuryCategory(
        latestInjury.normalized_status ||
        latestInjury.raw_status
      )
    : "not_confirmed";

  const injuryObservedAt = latestInjury
    ? latestInjury.last_seen_at ||
      latestInjury.updated_at
    : null;

  // Evidencia historica de participacion:
  // NO equivale a confirmar que jugara el domingo.
  const snapsEvidence = positive.length >= 2;

  const injuryFresh =
    injuryObservedAt &&
    cutoff - dateMs(injuryObservedAt) <=
      7 * 86400000;

  const blockedByInjury =
    injuryStatus === "out" && injuryFresh;

  const injuryUnresolved =
    ["questionable", "doubtful"].includes(
      injuryStatus
    ) && injuryFresh;

  return {
    name: player.name,
    team: player.team,
    position: player.position,
    gsisPlayerId: gsis,
    dfsPlayerId: id(player.dfsPlayerId),
    salary: player.salary,
    hasCrosswalk: Boolean(link),
    recentGamesWithSnaps: positive.length,
    medianOffenseSnaps: median(
      positive.map(row => Number(row.offense_snaps))
    ),
    lastSnapDate: priorSnaps[0]?.game_date ?? null,
    snapsEvidence,
    injuryStatus,
    injuryObservedAt,
    blockedByInjury: Boolean(blockedByInjury),
    injuryUnresolved: Boolean(injuryUnresolved),
    availabilityConfirmed: false,
    readyForOptimization: false
  };
}

async function main() {
  const apiKey =
    process.env.BALLDONTLIE_NFL_API_KEY ||
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BALLDONTLIE_NBA_API_KEY;

  if (!apiKey) {
    throw new Error("Missing BALLDONTLIE API key");
  }

  const cutoff = dateMs(CUTOFF);

  const [
    crosswalkRows,
    snapRows,
    injuryRows
  ] = await Promise.all([
    readAll(
      "nfl_player_crosswalk",
      "gsis_player_id,api_sports_player_id,player_name,position,nflverse_team_id"
    ),
    readAll(
      "football_player_game_stats",
      "player_id,season,game_date,offense_snaps,played",
      {
        sport: "eq.nfl",
        season: "eq.2026",
        game_date:
          `gte.${HISTORY_START}`
      }
    ),
    readAll(
      "nfl_injury_state",
      "api_sports_player_id,normalized_status,raw_status,active,last_seen_at,updated_at"
    )
  ]);

  const { index: crosswalk, conflicts } =
    indexUniqueCrosswalk(crosswalkRows);

  const snaps = new Map();

  for (const row of snapRows) {
    const key = id(row.player_id);

    if (!snaps.has(key)) snaps.set(key, []);
    snaps.get(key).push(row);
  }

  const injuries = new Map();

  for (const row of injuryRows) {
    const key = id(row.api_sports_player_id);

    if (!key) continue;

    if (!injuries.has(key)) {
      injuries.set(key, []);
    }

    injuries.get(key).push(row);
  }

  console.log("===== NFL ROLE DATA =====");
  console.log("Crosswalk rows:", crosswalkRows.length);
  console.log("Crosswalk conflicts:", conflicts.size);
  console.log("Snap rows:", snapRows.length);
  console.log("Injury state rows:", injuryRows.length);

  if (!crosswalkRows.length || !snapRows.length) {
    throw new Error("Insufficient source data");
  }

  const history = await loadNFLVerseHistory({
    targetSeason: 2026,
    targetWeek: 8,
    cutoffAt: CUTOFF
  });

  for (const [platform, slateId] of SLATES) {
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

    const players = bridge.matched.map(player =>
      inspectPlayer({
        player,
        crosswalk,
        snaps,
        injuries,
        cutoff
      })
    );

    const count = test =>
      players.filter(test).length;

    console.log(
      `\n===== ${platform.toUpperCase()} ROLE =====`
    );

    console.log("Matched DFS:", players.length);

    console.log(
      "Crosswalk available:",
      count(p => p.hasCrosswalk)
    );

    console.log(
      "Recent snap evidence:",
      count(p => p.snapsEvidence)
    );

    console.log(
      "Confirmed injury exclusions:",
      count(p => p.blockedByInjury)
    );

    console.log(
      "Unresolved injury reports:",
      count(p => p.injuryUnresolved)
    );

    console.log(
      "Availability still unverified:",
      count(p => !p.availabilityConfirmed)
    );

    console.log(
      "ROLE EXAMPLES:",
      JSON.stringify(
        players
          .filter(p => p.snapsEvidence)
          .slice(0, 8)
      )
    );

    console.log("Ready for optimization: 0");
  }

  console.log("\nROLE DATA INTEGRATION COMPLETE");
  console.log("No Supabase writes");
  console.log("No production changes");
  console.log("SHADOW ONLY");
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

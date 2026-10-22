
"use strict";

// ============================================
// CASHEDGE FANTASY NBA
// HISTORICAL PLAYER CONTEXT V1
// ============================================
//
// EXCLUSIVO DEL MODULO FANTASY NBA
//
// SHADOW ONLY
//
// NO modifica:
// - Premium Picks
// - Player Props
// - BALLDONTLIE
// - Sistema existente de IDs
// - Tablas de produccion
// - Crons existentes
//
// Solo lee estadisticas de Supabase.
// Los 308 candidatos siguen siendo provisionales.
// ============================================

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const INPUT = path.resolve(
  "fantasy-shadow-input/nba-identity-report.json"
);

const OUTPUT = path.resolve(
  "fantasy-shadow-input/nba-fantasy-history.json"
);

const CURRENT_SEASON = 2026;
const PREVIOUS_SEASON = 2025;

const PAGE_SIZE = 1000;
const MAX_ROWS = 100000;

const STAT_FIELDS = [
  "minutes",
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

function asId(value) {
  return String(value ?? "").trim();
}

function readMinutes(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" &&
    /^\d+:\d{1,2}$/.test(value)
  ) {
    const [minutes, seconds] =
      value.split(":").map(Number);

    if (seconds >= 60) {
      return null;
    }

    return minutes + seconds / 60;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function readNumber(value, field) {
  if (value === null || value === undefined) {
    return null;
  }

  if (field === "minutes") {
    return readMinutes(value);
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function average(rows, field) {
  const values = rows
    .map(row => readNumber(row[field], field))
    .filter(value => value !== null);

  if (!values.length) {
    return null;
  }

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  );

  return round(total / values.length);
}

function summarize(rows) {
  const summary = {
    games: rows.length
  };

  for (const field of STAT_FIELDS) {
    summary[field] = average(rows, field);
  }

  return summary;
}

async function loadSeason(db, season, cutoff) {
  const rows = [];

  for (
    let offset = 0;
    offset < MAX_ROWS;
    offset += PAGE_SIZE
  ) {
    const { data, error } = await db
      .from("nba_player_game_stats")
      .select([
        "player_id",
        "player_name",
        "team_id",
        "season",
        "game_id",
        "game_date",
        ...STAT_FIELDS
      ].join(","))
      .eq("season", season)
      .lt("game_date", cutoff)
      .order("game_date", {
        ascending: false
      })
      .order("game_id", {
        ascending: false
      })
      .order("player_id", {
        ascending: true
      })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        `Supabase season ${season}: ${error.message}`
      );
    }

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }

  throw new Error(
    `Pagination limit reached: ${season}`
  );
}

function indexHistory(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const playerId = asId(row.player_id);
    const gameId = asId(row.game_id);

    if (!playerId || !gameId) {
      continue;
    }

    if (!grouped.has(playerId)) {
      grouped.set(playerId, new Map());
    }

    const uniqueGameKey =
      `${row.season}:${gameId}`;

    if (
      !grouped.get(playerId).has(uniqueGameKey)
    ) {
      grouped.get(playerId).set(
        uniqueGameKey,
        row
      );
    }
  }

  const indexed = new Map();

  for (const [playerId, games] of grouped) {
    const ordered = [...games.values()]
      .sort((a, b) => {
        const dateA = String(a.game_date || "");
        const dateB = String(b.game_date || "");

        if (dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }

        return asId(b.game_id).localeCompare(
          asId(a.game_id)
        );
      });

    indexed.set(playerId, ordered);
  }

  return indexed;
}

function analyzePlayer(player, history) {
  const status = player.status;

  const verified =
    status === "ALREADY_VERIFIED";

  const provisional =
    status === "STRONG_CANDIDATE";

  const experimentalAllowed =
    verified || provisional;

  const nbaPlayerId = experimentalAllowed
    ? asId(player.nbaPlayerId)
    : "";

  const allGames = nbaPlayerId
    ? history.get(nbaPlayerId) || []
    : [];

  const currentGames = allGames.filter(
    row => Number(row.season) === CURRENT_SEASON
  );

  const previousGames = allGames.filter(
    row => Number(row.season) === PREVIOUS_SEASON
  );

  // Ultimos juegos reales disponibles.
  // Si la temporada actual no tiene suficientes,
  // puede incluir juegos de la temporada anterior.

  const last10 = allGames.slice(0, 10);
  const last5 = allGames.slice(0, 5);
  const last3 = allGames.slice(0, 3);

  const latestGame = allGames[0] || null;

  const historicalGames = allGames.map(
    row => ({
      gameId: asId(row.game_id),
      gameDate: row.game_date,
      season: Number(row.season),
      teamId: asId(row.team_id),

      minutes: readMinutes(row.minutes),

      points: readNumber(row.points, "points"),
      rebounds: readNumber(
        row.rebounds,
        "rebounds"
      ),
      assists: readNumber(
        row.assists,
        "assists"
      ),
      steals: readNumber(
        row.steals,
        "steals"
      ),
      blocks: readNumber(
        row.blocks,
        "blocks"
      ),
      turnovers: readNumber(
        row.turnovers,
        "turnovers"
      ),
      threePointersMade: readNumber(
        row.three_pointers_made,
        "three_pointers_made"
      )
    })
  );

  const historicalTeams = [
    ...new Set(
      historicalGames.map(
        game => game.teamId
      )
    )
  ];

  return {
    espnPlayerId: asId(
      player.espnPlayerId
    ),

    espnName: player.espnName,
    espnTeam: player.team,
    espnTeamId: asId(
      player.espnTeamId
    ),

    nbaPlayerId: nbaPlayerId || null,

    identityStatus: status,
    identityVerified: verified,
    provisionalIdentity: provisional,

    shadowEligible:
      experimentalAllowed &&
      Boolean(nbaPlayerId),

    readyForPublication: false,

    expectedCurrentTeamId:
      player.nbaTeamCandidate || null,

    latestHistoricalTeamId:
      latestGame
        ? asId(latestGame.team_id)
        : null,

    lastRecordedGame:
      latestGame?.game_date || null,

    historicalTeams,

    currentSeason: summarize(currentGames),
    previousSeason: summarize(previousGames),

    last10: summarize(last10),
    last5: summarize(last5),
    last3: summarize(last3),

    historicalGames
  };
}

function getCutoffDate() {
  const value =
    process.env.FANTASY_AS_OF_DATE ||
    new Date().toISOString().slice(0, 10);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !==
      value
  ) {
    throw new Error(
      "Invalid FANTASY_AS_OF_DATE"
    );
  }

  return value;
}

async function main() {
  const url = process.env.FANTASY_SUPABASE_URL;

  const key =
    process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Fantasy Supabase credentials"
    );
  }

  if (!fs.existsSync(INPUT)) {
    throw new Error(
      "Missing NBA identity report"
    );
  }

  const identityReport = JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

  if (
    identityReport.mode !== "shadow" ||
    identityReport.sport !== "nba" ||
    identityReport.teamsFound !== 30 ||
    !Array.isArray(identityReport.players)
  ) {
    throw new Error(
      "Invalid Fantasy identity report"
    );
  }

  const cutoff = getCutoffDate();

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const [current, previous] =
    await Promise.all([
      loadSeason(
        db,
        CURRENT_SEASON,
        cutoff
      ),
      loadSeason(
        db,
        PREVIOUS_SEASON,
        cutoff
      )
    ]);

  const history = indexHistory([
    ...current,
    ...previous
  ]);

  const players = identityReport.players.map(
    player => analyzePlayer(
      player,
      history
    )
  );

  const experimental = players.filter(
    player => player.shadowEligible
  );

  const verified = players.filter(
    player => player.identityVerified
  );

  const provisional = players.filter(
    player => player.provisionalIdentity
  );

  const currentAvailable = experimental.filter(
    player => player.currentSeason.games > 0
  );

  const previousAvailable = experimental.filter(
    player => player.previousSeason.games > 0
  );

  const output = {
    module: "fantasy_nba",
    mode: "shadow",
    generatedAt: new Date().toISOString(),

    asOfDate: cutoff,

    historicalCutoffExclusive: cutoff,

    summary: {
      espnPlayers: players.length,

      verifiedIdentities: verified.length,
      provisionalIdentities: provisional.length,

      experimentalPlayers:
        experimental.length,

      playersWithCurrentSeason:
        currentAvailable.length,

      playersWithPreviousSeason:
        previousAvailable.length,

      playersWithoutCurrentSeason:
        experimental.length -
        currentAvailable.length,

      currentSeasonStatRows:
        current.length,

      previousSeasonStatRows:
        previous.length
    },

    players,

    readyForOptimization: false,
    readyForPublication: false,

    productionIntegrationsModified: false
  };

  fs.mkdirSync(
    path.dirname(OUTPUT),
    { recursive: true }
  );

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "======================================"
  );

  console.log(
    "CASHEDGE FANTASY NBA HISTORICAL CONTEXT"
  );

  console.log(
    "======================================"
  );

  console.log(
    "MODE: SHADOW ONLY"
  );

  console.log(
    "HISTORY CUTOFF:",
    cutoff
  );

  console.log(
    "SUMMARY:",
    JSON.stringify(
      output.summary,
      null,
      2
    )
  );

  console.log(
    "OUTPUT:",
    OUTPUT
  );

  console.log(
    "NO DATABASE WRITES"
  );

  console.log(
    "NO PRODUCTION FORMULA CHANGES"
  );
}

main().catch(error => {
  console.error(
    "FANTASY_HISTORY_ERROR:",
    error.stack || error.message
  );

  process.exitCode = 1;
});

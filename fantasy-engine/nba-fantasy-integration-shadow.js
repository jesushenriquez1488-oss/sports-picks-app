
"use strict";

// CashEdge Fantasy NBA
// Recuperacion de historial por identidad.
// Solo SHADOW. No modifica Supabase.
// Sin minimo de 8 partidos ni ventana de 240 dias.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const DIR = path.resolve("fantasy-shadow-input");

const read = name => JSON.parse(
  fs.readFileSync(
    path.join(DIR, name),
    "utf8"
  )
);

const str = value =>
  String(value ?? "").trim();

const numeric = value =>
  value === null ||
  value === undefined ||
  value === ""
    ? NaN
    : Number(value);

const avg = values =>
  values.length
    ? values.reduce((a, b) => a + b, 0) /
      values.length
    : null;

const round = value =>
  value === null
    ? null
    : Math.round(value * 100) / 100;

function matchIdentity(rotation, report) {
  if (
    !report ||
    ![
      "ALREADY_VERIFIED",
      "STRONG_CANDIDATE",
      "TEAM_REVIEW"
    ].includes(report.status)
  ) {
    return null;
  }

  const matches = (
    report.possibleMatches || []
  ).filter(
    item =>
      str(item.nbaPlayerId) ===
      str(report.nbaPlayerId)
  );

  if (matches.length !== 1) return null;

  if (
    str(rotation.espnPlayerId) !==
      str(report.espnPlayerId) ||
    str(rotation.team) !== str(report.team)
  ) {
    return null;
  }

  const teamId = str(
    rotation.nbaTeamId ||
    report.nbaTeamCandidate
  );

  if (!teamId) return null;

  return {
    playerId: str(report.nbaPlayerId),
    teamId,
    status: report.status
  };
}

async function fetchGames(
  db,
  playerId,
  cutoff
) {
  const results = [];

  for (const season of [2025, 2026]) {
    let from = 0;

    while (true) {
      const { data, error } = await db
        .from("nba_player_game_stats")
        .select("*")
        .eq("player_id", playerId)
        .eq("season", season)
        .lt("game_date", cutoff)
        .order(
          "game_date",
          { ascending: false }
        )
        .range(from, from + 499);

      if (error) {
        throw new Error(
          `Stats fetch ${playerId}: ${error.message}`
        );
      }

      results.push(...data);

      if (data.length < 500) break;

      from += 500;

      if (from > 5000) {
        throw Error(
          "Unexpected historical pagination"
        );
      }
    }
  }

  return results;
}

function convert(raw) {
  const gameDate =
    raw.game_date ?? raw.gameDate;

  const time = Date.parse(gameDate || "");
  const minutes = numeric(raw.minutes);

  if (
    !Number.isFinite(time) ||
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    minutes > 60
  ) {
    return null;
  }

  return {
    gameId: str(
      raw.game_id ?? raw.gameId
    ),

    gameDate,
    season: numeric(raw.season),

    teamId: str(
      raw.team_id ?? raw.teamId
    ),

    minutes,

    points: numeric(raw.points),
    rebounds: numeric(raw.rebounds),
    assists: numeric(raw.assists),
    steals: numeric(raw.steals),
    blocks: numeric(raw.blocks),
    turnovers: numeric(raw.turnovers),

    threePointersMade: numeric(
      raw.three_pointers_made ??
      raw.threePointersMade
    )
  };
}

function gamesFor(history, cutoff) {
  return (
    history?.historicalGames || []
  )
    .map(convert)
    .filter(
      game =>
        game &&
        Date.parse(game.gameDate) < cutoff &&
        [2025, 2026].includes(game.season)
    );
}

function getRank(player) {
  const ranks = (
    player.positions || []
  )
    .map(position =>
      numeric(position.depthRank)
    )
    .filter(rank =>
      Number.isInteger(rank) &&
      rank >= 1
    );

  return ranks.length
    ? Math.min(...ranks)
    : null;
}

async function main() {
  const rotation = read(
    "nba-rotation-context.json"
  );

  const history = read(
    "nba-fantasy-history.json"
  );

  const identity = read(
    "nba-identity-report.json"
  );

  if (
    rotation.mode !== "shadow" ||
    history.mode !== "shadow" ||
    identity.mode !== "shadow"
  ) {
    throw Error(
      "Only SHADOW inputs accepted"
    );
  }

  const cutoffDay = history.asOfDate;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDay)
  ) {
    throw Error("Missing cutoff date");
  }

  const cutoff = Date.parse(
    cutoffDay + "T00:00:00Z"
  );

  const byId = players =>
    new Map(
      players.map(player => [
        str(player.espnPlayerId),
        player
      ])
    );

  const histories = byId(history.players);
  const identities = byId(identity.players);

  const url =
    process.env.FANTASY_SUPABASE_URL;

  const key =
    process.env
      .FANTASY_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw Error(
      "Missing Fantasy Supabase credentials"
    );
  }

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const results = [];

  for (const player of rotation.players) {
    const rank = getRank(player);

    // Unicamente titulares y
    // relevos de segundo puesto.
    // No perseguimos reservas profundas.

    if (rank !== 1 && rank !== 2) {
      continue;
    }

    const espnId = str(
      player.espnPlayerId
    );

    const candidate = matchIdentity(
      player,
      identities.get(espnId)
    );

    const existing = histories.get(
      espnId
    );

    let games = [];
    let source = "UNRESOLVED_ID";

    if (candidate) {
      if (
        str(existing?.nbaPlayerId) ===
          candidate.playerId &&
        existing?.shadowEligible
      ) {
        games = gamesFor(
          existing,
          cutoff
        );

        source = "EXISTING_HISTORY";
      }

      // Si el historial anterior no
      // lo incorporo, recuperamos
      // los datos usando su ID existente.

      if (!games.length) {
        const raw = await fetchGames(
          db,
          candidate.playerId,
          cutoffDay
        );

        games = raw
          .map(convert)
          .filter(Boolean);

        source = "READ_ONLY_ID_BACKFILL";
      }
    }

    const older = games.filter(
      game => game.season === 2025
    );

    const latest = games.filter(
      game => game.season === 2026
    );

    const sameOlder = older.filter(
      game =>
        game.teamId ===
        candidate?.teamId
    );

    const sameLatest = latest.filter(
      game =>
        game.teamId ===
        candidate?.teamId
    );

    // Preferencia al mismo equipo.
    // Si cambio de equipo, conservamos
    // el historial del jugador.

    const historical =
      sameOlder.length
        ? sameOlder
        : older;

    const current =
      sameLatest.length
        ? sameLatest
        : latest;

    const reference = [
      ...historical,
      ...current
    ];

    const previousAvg = avg(
      historical.map(
        game => game.minutes
      )
    );

    const currentAvg = avg(
      current.map(
        game => game.minutes
      )
    );

    const referenceAvg = avg(
      reference.map(
        game => game.minutes
      )
    );

    const warnings = [];

    if (!candidate) {
      warnings.push(
        "IDENTITY_NOT_UNIQUELY_RESOLVED"
      );
    }

    if (!reference.length) {
      warnings.push(
        "NO_HISTORICAL_GAMES"
      );
    }

    if (
      candidate?.status ===
      "TEAM_REVIEW"
    ) {
      warnings.push(
        "TEAM_MAPPING_PROVISIONAL_VERIFY"
      );
    }

    if (
      !sameOlder.length &&
      older.length
    ) {
      warnings.push(
        "PREVIOUS_TEAM_SAMPLE"
      );
    }

    if (latest.length === 0) {
      warnings.push(
        "ZERO_GAMES_CURRENT_SEASON_OK"
      );
    }

    results.push({
      player: player.espnName,
      team: player.team,
      rank,

      espnPlayerId: espnId,

      nbaPlayerId:
        candidate?.playerId ?? null,

      teamId:
        candidate?.teamId ?? null,

      identityStatus:
        candidate?.status ??
        "UNRESOLVED",

      sampleSource: source,

      previousSeasonGames:
        older.length,

      previousSameTeamGames:
        sameOlder.length,

      currentSeasonGames:
        latest.length,

      previousMinutes:
        round(previousAvg),

      currentMinutes:
        round(currentAvg),

      historicalMinutesBaseline:
        round(referenceAvg),

      // La base historica todavia
      // NO es una proyeccion del partido.
      minutesForecast: null,

      injuryAdjusted: false,
      opponentAdjusted: false,

      eligibleForSimulation: Boolean(
        candidate &&
        reference.length
      ),

      eligibleForLineup: false,

      warnings
    });
  }

  const summary = {
    reviewed: results.length,

    firstListed: results.filter(
      player => player.rank === 1
    ).length,

    secondListed: results.filter(
      player => player.rank === 2
    ).length,

    firstListedWithHistory:
      results.filter(
        player =>
          player.rank === 1 &&
          player.eligibleForSimulation
      ).length,

    secondListedWithHistory:
      results.filter(
        player =>
          player.rank === 2 &&
          player.eligibleForSimulation
      ).length,

    recoveredFromDatabase:
      results.filter(
        player =>
          player.sampleSource ===
            "READ_ONLY_ID_BACKFILL" &&
          player.eligibleForSimulation
      ).length,

    noHistory: results.filter(
      player =>
        !player.eligibleForSimulation
    ).length
  };

  const output = {
    module: "fantasy_nba",
    mode: "shadow",

    version:
      "identity-history-repair-v1",

    historicalCutoffExclusive:
      cutoffDay,

    createdAt:
      new Date().toISOString(),

    summary,

    blockers: [
      "Game-day availability not verified",
      "Official DFS salaries not connected",
      "Opponent defense not incorporated",
      "Historical baseline not calibrated as game-day projection"
    ],

    readyForLineups: false,
    players: results
  };

  const filename = path.join(
    DIR,
    "nba-fantasy-integration-shadow.json"
  );

  fs.writeFileSync(
    filename,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "===== CASHEDGE FANTASY HISTORY INTEGRATION ====="
  );

  console.log(
    JSON.stringify(summary, null, 2)
  );

  console.table(
    results
      .filter(player =>
        [
          "Nikola Jokic",
          "Donovan Mitchell",
          "James Harden",
          "Stephen Curry",
          "Anthony Davis",
          "Trae Young"
        ].includes(player.player)
      )
      .map(player => ({
        player: player.player,
        rank: player.rank,
        source: player.sampleSource,
        previous:
          player.previousSeasonGames,
        current:
          player.currentSeasonGames,
        minutes:
          player.historicalMinutesBaseline,
        warnings:
          player.warnings.join("|")
      }))
  );

  console.log("OUTPUT:", filename);

  console.log(
    "SHADOW ONLY | READ-ONLY DATABASE | NO LINEUPS"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

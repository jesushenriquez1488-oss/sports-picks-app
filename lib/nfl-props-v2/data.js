
"use strict";

const { createClient } = require("@supabase/supabase-js");

function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase server credentials");
  }

  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

function numeric(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) return null;

  const result = Number(value);

  return Number.isFinite(result) ? result : null;
}

function normalizeStats(stats, keys) {
  const output = {};

  for (const key of keys) {
    output[key] = numeric(stats?.[key]);
  }

  return output;
}

function parsePlayerFromGame(row, athleteId) {
  const teams = row.stats_json?.teams;

  if (!teams || typeof teams !== "object") {
    return null;
  }

  for (const team of Object.values(teams)) {
    const players = Array.isArray(team?.players)
      ? team.players
      : [];

    const player = players.find(
      p => String(p?.id || "") === athleteId
    );

    if (!player) continue;

    const passing = normalizeStats(
      player.passing,
      [
        "attempts",
        "completions",
        "yards",
        "touchdowns",
        "interceptions"
      ]
    );

    const rushing = normalizeStats(
      player.rushing,
      ["attempts", "yards", "touchdowns"]
    );

    const receiving = normalizeStats(
      player.receiving,
      [
        "targets",
        "receptions",
        "yards",
        "touchdowns"
      ]
    );

    return {
      espnPlayerId: athleteId,
      name: player.name || null,
      positionFromBoxscore: player.position || null,

      season: Number(row.season),
      gameId: String(row.game_id),
      gameDate: String(row.game_date).slice(0, 10),

      teamId: String(team.id || ""),
      teamAbbreviation: team.abbreviation || null,
      opponentId: String(team.opponentId || ""),

      passing,
      rushing,
      receiving,

      // Mercados combinados.
      passingPlusRushingYards:
        passing.yards !== null &&
        rushing.yards !== null
          ? passing.yards + rushing.yards
          : null,

      rushingPlusReceivingYards:
        rushing.yards !== null &&
        receiving.yards !== null
          ? rushing.yards + receiving.yards
          : null,

      // TD ofensivos por carrera y recepción.
      // No equivale todavía a cobertura completa de ATD.
      rushReceivingTDs:
        rushing.touchdowns !== null &&
        receiving.touchdowns !== null
          ? rushing.touchdowns +
            receiving.touchdowns
          : null,

      opportunityObserved:
        (passing.attempts || 0) > 0 ||
        (rushing.attempts || 0) > 0 ||
        (receiving.targets || 0) > 0,

      source: "nfl_boxscore_cache"
    };
  }

  return null;
}

/*
 * CASHEDGE NFL V2
 *
 * Lee estadísticas históricas ya almacenadas.
 *
 * NO consulta ESPN.
 * NO escribe en Supabase.
 * NO modifica el motor Premium.
 *
 * beforeDate evita utilizar resultados futuros
 * durante las pruebas históricas.
 */

async function loadNFLV2History({
  espnPlayerId,
  seasons,
  beforeDate,
  db
} = {}) {

  const athleteId =
    String(espnPlayerId || "").trim();

  if (!/^\d+$/.test(athleteId)) {
    throw new Error(
      "Valid ESPN athlete ID required"
    );
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      String(beforeDate || "")
    )
  ) {
    throw new Error(
      "beforeDate required (YYYY-MM-DD)"
    );
  }

  const years = [
    ...new Set(seasons || [2025, 2026])
  ]
    .map(Number)
    .filter(
      y =>
        Number.isInteger(y) &&
        y >= 2000 &&
        y <= 2100
    );

  if (!years.length) {
    throw new Error(
      "At least one valid season required"
    );
  }

  const client = db || getDB();

  const games = [];
  let scannedGames = 0;

  for (
    let offset = 0;
    offset < 1000;
    offset += 200
  ) {
    const { data, error } = await client
      .from("nfl_boxscore_cache")
      .select(
        "game_id,game_date,season,stats_json"
      )
      .in("season", years)
      .lt("game_date", beforeDate)
      .order("game_date", {
        ascending: true
      })
      .order("game_id", {
        ascending: true
      })
      .range(offset, offset + 199);

    if (error) {
      throw new Error(
        `NFL V2 cache read: ${error.message}`
      );
    }

    const rows = data || [];

    scannedGames += rows.length;

    for (const row of rows) {
      const parsed = parsePlayerFromGame(
        row,
        athleteId
      );

      if (parsed) {
        games.push(parsed);
      }
    }

    if (rows.length < 200) {
      break;
    }

    if (offset === 800) {
      throw new Error(
        "NFL V2 page cap exceeded; narrow seasons"
      );
    }
  }

  games.sort(
    (a, b) =>
      a.gameDate.localeCompare(b.gameDate)
  );

  return {
    espnPlayerId: athleteId,
    beforeDate,
    seasons: years,

    scannedGames,
    playerGames: games,
    totalPlayerBoxscores: games.length,

    warning:
      "Boxscore-only history. Missing player " +
      "entries do not mean zero snaps or " +
      "zero targets. Verify participation."
  };
}

module.exports = {
  loadNFLV2History
};

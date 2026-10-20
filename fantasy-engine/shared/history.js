
"use strict";

// CASHEDGE FANTASY EDGE — HISTORY READER
// NBA + NFL
// Solo lectura. No modifica tablas.
// No toca Player Props ni Market Intelligence.

const NFL_FIELDS = {
  passing_attempts: ["passing", "attempts"],
  passing_yards: ["passing", "yards"],
  passing_tds: ["passing", "touchdowns"],
  passing_interceptions: ["passing", "interceptions"],

  rushing_attempts: ["rushing", "attempts"],
  rushing_yards: ["rushing", "yards"],
  rushing_tds: ["rushing", "touchdowns"],

  targets: ["receiving", "targets"],
  receptions: ["receiving", "receptions"],
  receiving_yards: ["receiving", "yards"],
  receiving_tds: ["receiving", "touchdowns"]
};

function cutoffDay(cutoffAt) {
  if (
    typeof cutoffAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoffAt) ||
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
    throw new Error(
      "cutoffAt requiere fecha ISO con zona horaria"
    );
  }

  // Excluir todo el dia del encuentro.
  // Nunca leer resultados del partido a proyectar.
  return new Date(cutoffAt)
    .toISOString()
    .slice(0, 10);
}

function seasonFromDay(sport, day) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));

  return sport === "nba"
    ? (month >= 9 ? year : year - 1)
    : (month <= 2 ? year - 1 : year);
}

function validSeasons(seasons) {
  if (
    !Array.isArray(seasons) ||
    seasons.length < 1 ||
    seasons.length > 3 ||
    seasons.some(
      year =>
        !Number.isInteger(year) ||
        year < 2020
    )
  ) {
    throw new Error(
      "Se requieren entre 1 y 3 temporadas validas"
    );
  }

  return [...new Set(seasons)];
}

function statOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeNFLLog(log, athleteId, season) {
  if (!log || !log.gameId || !log.date) {
    return null;
  }

  if (!Number.isFinite(Date.parse(log.date))) {
    return null;
  }

  const result = {
    gameId: String(log.gameId),
    player_id: String(athleteId),
    season,
    game_date: String(log.date),

    week: statOrNull(log.week),
    opponent: log.opponent || null,
    opponentId: log.opponentId || null,
    homeAway: log.homeAway || null
  };

  for (
    const [field, path]
    of Object.entries(NFL_FIELDS)
  ) {
    result[field] = statOrNull(
      log?.[path[0]]?.[path[1]]
    );
  }

  return result;
}

function assertDb(db) {
  if (
    !db ||
    typeof db.from !== "function"
  ) {
    throw new Error(
      "Falta cliente Supabase de lectura"
    );
  }
}

// ==============================================
// NBA — HISTORIAL DE JUGADORES
// ==============================================

async function loadNBAHistory(db, {
  playerId,
  cutoffAt,
  seasons,
  limit = 30
} = {}) {

  assertDb(db);

  const day = cutoffDay(cutoffAt);

  const year = seasonFromDay("nba", day);

  const years = validSeasons(
    seasons || [year, year - 1]
  );

  const id = Number(playerId);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error(
      "playerId o limit NBA invalidos"
    );
  }

  const { data, error } = await db
    .from("nba_player_game_stats")
    .select(`
      game_id,
      season,
      game_date,
      team_id,
      player_id,
      player_name,
      minutes,
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
      three_pointers_made
    `)
    .eq("player_id", id)
    .in("season", years)
    .lt("game_date", day)
    .order("game_date", {
      ascending: false
    })
    .limit(limit);

  if (error) {
    throw new Error(
      `Fantasy NBA history: ${error.message}`
    );
  }

  return data || [];
}

// ==============================================
// NFL — HISTORIAL DE JUGADORES
// ==============================================

async function loadNFLHistory(db, {
  athleteId,
  cutoffAt,
  seasons,
  limit = 16
} = {}) {

  assertDb(db);

  const day = cutoffDay(cutoffAt);

  const year = seasonFromDay("nfl", day);

  const years = validSeasons(
    seasons || [year, year - 1]
  );

  if (
    !String(athleteId ?? "").trim() ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 40
  ) {
    throw new Error(
      "athleteId o limit NFL invalidos"
    );
  }

  const all = [];

  for (const season of years) {

    const { data, error } = await db
      .from("nfl_player_gamelog_cache")
      .select("season,stats_json")
      .eq("athlete_id", String(athleteId))
      .eq("season", season)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Fantasy NFL history ${season}: ${error.message}`
      );
    }

    const logs = data?.stats_json?.logs;

    if (!Array.isArray(logs)) {
      continue;
    }

    for (const log of logs) {

      const row = normalizeNFLLog(
        log,
        athleteId,
        season
      );

      if (
        row &&
        row.game_date.slice(0, 10) < day
      ) {
        all.push(row);
      }
    }
  }

  // No duplicar partidos en el historial.

  const unique = new Map();

  for (const row of all) {
    const key = `${row.season}:${row.gameId}`;

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  return [...unique.values()]
    .sort(
      (a, b) =>
        Date.parse(b.game_date) -
        Date.parse(a.game_date)
    )
    .slice(0, limit);
}

module.exports = {
  loadNBAHistory,
  loadNFLHistory,
  normalizeNFLLog
};

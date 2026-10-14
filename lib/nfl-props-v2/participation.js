
"use strict";

// CASHEDGE NFL V2 — PARTICIPATION
// Lee los snaps existentes en Supabase.
// No descarga datos de ESPN.
// No modifica Premium ni Confidence.

function sameTeam(a, b) {
  const aliases = {
    LA: "LAR",
    LAR: "LAR",
    JAC: "JAX",
    JAX: "JAX",
    WSH: "WAS",
    WAS: "WAS"
  };

  const normalize = value => {
    const key = String(value || "")
      .trim()
      .toUpperCase();

    return aliases[key] || key;
  };

  const x = normalize(a);
  const y = normalize(b);

  return Boolean(x && y && x === y);
}

function mean(values) {
  return values.length
    ? values.reduce(
        (sum, n) => sum + n,
        0
      ) / values.length
    : null;
}

async function loadNFLV2Participation({
  db,
  espnPlayerId,
  playerGames,
  beforeDate,
  espnGsisMap
} = {}) {

  if (!db) {
    throw new Error("Supabase client required");
  }

  if (!(espnGsisMap instanceof Map)) {
    throw new Error(
      "Existing ESPN-GSIS map required"
    );
  }

  const espnId =
    String(espnPlayerId || "").trim();

  if (!/^\d+$/.test(espnId)) {
    throw new Error("Invalid ESPN player ID");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(
    String(beforeDate || "")
  )) {
    throw new Error("beforeDate required");
  }

  const history = (
    Array.isArray(playerGames)
      ? playerGames
      : []
  )
    .filter(game =>
      /^\d{4}-\d{2}-\d{2}$/.test(
        String(game.gameDate || "")
      ) &&
      game.gameDate < beforeDate
    )
    .sort((a, b) =>
      a.gameDate.localeCompare(b.gameDate)
    );

  const gsisId =
    espnGsisMap.get(espnId) || null;

  if (!gsisId) {
    return {
      status: "missing_espn_gsis_mapping",
      espnId,
      gsisId: null,
      boxscoreGames: history.length,
      matchedGames: 0,
      games: [],
      warning:
        "No verified ID mapping"
    };
  }

  const seasons = [
    ...new Set(
      history.map(g => Number(g.season))
    )
  ].filter(Number.isInteger);

  if (!seasons.length) {
    return {
      status: "no_boxscore_games",
      espnId,
      gsisId,
      boxscoreGames: 0,
      matchedGames: 0,
      games: []
    };
  }

  // Recuperar únicamente los snaps
  // de este jugador desde Supabase.
  const { data, error } = await db
    .from("football_player_game_stats")
    .select(
      "season,game_date,team_id," +
      "position,played,offense_snaps"
    )
    .eq("sport", "nfl")
    .eq("player_id", gsisId)
    .in("season", seasons)
    .lt("game_date", beforeDate)
    .order("game_date", {
      ascending: true
    })
    .limit(200);

  if (error) {
    throw new Error(
      `NFL V2 snaps: ${error.message}`
    );
  }

  if ((data || []).length === 200) {
    throw new Error(
      "NFL V2 snaps page limit hit"
    );
  }

  const byDate = new Map();

  for (const row of data || []) {
    const date = String(
      row.game_date || ""
    ).slice(0, 10);

    if (!byDate.has(date)) {
      byDate.set(date, []);
    }

    byDate.get(date).push(row);
  }

  const games = history.map(game => {
    const candidates =
      byDate.get(game.gameDate) || [];

    const matching = candidates.filter(
      row => sameTeam(
        row.team_id,
        game.teamAbbreviation
      )
    );

    // Un registro solo se acepta si
    // jugador, fecha y equipo coinciden.
    const row = matching.length === 1
      ? matching[0]
      : null;

    const snaps =
      row?.offense_snaps === null ||
      row?.offense_snaps === undefined
        ? null
        : Number(row.offense_snaps);

    return {
      date: game.gameDate,
      espnGameId: game.gameId,
      espnTeam:
        game.teamAbbreviation || null,

      match: row
        ? "verified_id_date_team"
        : matching.length > 1
          ? "ambiguous_team_match"
          : candidates.length
            ? "team_mismatch"
            : "no_snap_record",

      nflverseTeam:
        row?.team_id || null,

      position:
        row?.position || null,

      played:
        row?.played ?? null,

      offenseSnaps:
        Number.isFinite(snaps)
          ? snaps
          : null
    };
  });

  const matched = games.filter(g =>
    g.match === "verified_id_date_team" &&
    g.offenseSnaps !== null
  );

  const recent = matched.slice(-5);

  const positions = [
    ...new Set(
      matched
        .map(g =>
          String(g.position || "")
            .toUpperCase()
        )
        .filter(Boolean)
    )
  ];

  return {
    status: matched.length
      ? "snap_data_linked"
      : "no_verified_game_matches",

    espnId,
    gsisId,

    boxscoreGames: history.length,

    matchedGames: matched.length,

    unmatchedGames:
      history.length - matched.length,

    gamesWithPositiveSnaps:
      matched.filter(g =>
        g.offenseSnaps > 0 &&
        g.played !== false
      ).length,

    positionsFromNFLverse: positions,

    averageOffenseSnapsLast5Matches:
      mean(
        recent
          .map(g => g.offenseSnaps)
          .filter(Number.isFinite)
      ),

    lastGames: games.slice(-7),

    // Estas verificaciones se
    // incorporarán en el próximo módulo.
    starterConfirmed: false,
    injuryStatusVerified: false,

    canPublishPremium: false,

    warning:
      "Snaps linked. Starter status, " +
      "role changes and current injuries " +
      "still require verification."
  };
}

module.exports = {
  loadNFLV2Participation
};

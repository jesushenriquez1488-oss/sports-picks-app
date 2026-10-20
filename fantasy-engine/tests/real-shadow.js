
"use strict";

// CASHEDGE FANTASY — REAL SHADOW TEST
// Solo lectura. NBA + NFL. Sin escritura.

const { createClient } = require("@supabase/supabase-js");

const {
  runFantasyShadowPreview
} = require("../shared/shadow-preview");

async function run() {
  const url = process.env.FANTASY_SUPABASE_URL;
  const key = process.env.FANTASY_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan credenciales Fantasy de lectura"
    );
  }

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const cutoffAt = new Date().toISOString();

  // 1. Seleccionar jugadores NBA reales.

  const { data: nbaRows, error: nbaError } =
    await db
      .from("nba_player_game_stats")
      .select("player_id,player_name")
      .order("game_date", { ascending: false })
      .limit(120);


  if (nbaError) {
    throw new Error(
      `NBA SELECT: ${nbaError.message}`
    );
  }

  const nbaIds = [
    ...new Set(
      (nbaRows || [])
        .map(row => String(row.player_id || ""))
    )
  ].filter(Boolean).slice(0, 8);

  if (!nbaIds.length) {
    throw new Error(
      "NBA: sin jugadores disponibles"
    );
  }

  // 2. Seleccionar jugador NFL con historial.

  const { data: nflRows, error: nflError } =
    await db
      .from("nfl_player_gamelog_cache")
      .select("athlete_id,stats_json")
      .eq("season", 2026)
      .limit(350);

  if (nflError) {
    throw new Error(
      `NFL SELECT: ${nflError.message}`
    );
  }

  const eligible = (nflRows || []).filter(
    row =>
      Array.isArray(row.stats_json?.logs) &&
      row.stats_json.logs.length >= 6
  );

  const qb = eligible.find(row =>
    row.stats_json.logs.some(
      log => Number(log.passing?.attempts) >= 15
    )
  );

  const runner = eligible.find(row =>
    row.stats_json.logs.some(
      log => Number(log.rushing?.attempts) >= 8
    )
  );

  const receiver = eligible.find(row =>
    row.stats_json.logs.some(
      log => Number(log.receiving?.targets) >= 5
    )
  );

  const nflPlayer = qb || runner || receiver;

  if (!nflPlayer) {
    throw new Error(
      "NFL: sin historial suficiente"
    );
  }

  // Posicion provisional para esta prueba tecnica.
  // La elegibilidad real vendra del slate DFS.

  const nflPosition = qb
    ? "QB"
    : runner
      ? "RB"
      : "WR";

  // 3. Ejecutar ambos deportes por plataforma.

  for (const platform of [
    "draftkings",
    "fanduel"
  ]) {

    const nba = await runFantasyShadowPreview({
      db,
      sport: "nba",
      platform,
      cutoffAt,
      players: nbaIds.map(id => ({ id }))
    });

    const nfl = await runFantasyShadowPreview({
      db,
      sport: "nfl",
      platform,
      cutoffAt,
      players: [{
        id: String(nflPlayer.athlete_id),
        position: nflPosition
      }]
    });

    console.log(JSON.stringify({
      platform,

      nba: {
        requested: nba.counts.requested,
        projected: nba.counts.projected,
        errors: nba.counts.errors,

        examples: nba.results
          .slice(0, 3)
          .map(row => ({
            id: row.playerId,
            status: row.status,
            history: row.historicalGamesUsed,
            fantasyBasePoints:
              row.fantasyBasePoints
          }))
      },

      nfl: {
        projected: nfl.counts.projected,
        errors: nfl.counts.errors,

        example: {
          id: nfl.results[0].playerId,
          status: nfl.results[0].status,
          history:
            nfl.results[0].historicalGamesUsed,
          projectedStats:
            nfl.results[0].projectedStats
        }
      }
    }, null, 2));

    if (
      nba.counts.projected === 0 ||
      nfl.counts.projected === 0
    ) {
      throw new Error(
        `Proyeccion no generada para ${platform}`
      );
    }
  }

  console.log(
    "REAL SHADOW SMOKE TEST: OK"
  );
}

run().catch(error => {
  console.error(
    "REAL SHADOW ERROR:",
    error.message
  );

  process.exitCode = 1;
});

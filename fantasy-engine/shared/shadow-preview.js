
"use strict";

// Fantasy Edge — preview SHADOW.
// Solo SELECT a historiales.
// Sin picks, escrituras ni simulaciones.

const {
  loadNBAHistory,
  loadNFLHistory
} = require("./history");

const {
  projectNBAPlayer
} = require("../nba/projection");

const {
  projectNFLPlayer
} = require("../nfl/projection");

const SPORT_SET = new Set(["nba", "nfl"]);

const PLATFORM_SET = new Set([
  "draftkings",
  "fanduel"
]);

const NFL_POSITIONS = new Set([
  "QB", "RB", "WR", "TE"
]);

async function runFantasyShadowPreview({
  db,
  sport,
  platform,
  cutoffAt,
  players
} = {}) {

  sport = String(sport || "").toLowerCase();
  platform = String(platform || "").toLowerCase();

  if (
    !SPORT_SET.has(sport) ||
    !PLATFORM_SET.has(platform)
  ) {
    throw new Error(
      "Deporte o plataforma no admitidos"
    );
  }

  if (
    typeof cutoffAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoffAt) ||
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
    throw new Error(
      "cutoffAt requiere fecha ISO con zona horaria"
    );
  }

  if (
    !Array.isArray(players) ||
    players.length < 1 ||
    players.length > 20
  ) {
    throw new Error(
      "Selecciona entre 1 y 20 jugadores"
    );
  }

  if (
    !db ||
    typeof db.from !== "function"
  ) {
    throw new Error(
      "Falta cliente Supabase de lectura"
    );
  }

  const seen = new Set();
  const results = [];

  for (const player of players) {

    const playerId = String(
      player?.id ?? ""
    ).trim();

    const position = String(
      player?.position || ""
    ).toUpperCase();

    if (
      !playerId ||
      seen.has(playerId)
    ) {
      throw new Error(
        "Jugador sin ID o ID duplicado"
      );
    }

    seen.add(playerId);

    if (
      sport === "nfl" &&
      !NFL_POSITIONS.has(position)
    ) {
      throw new Error(
        `Posicion NFL no admitida: ${position}`
      );
    }

    try {

      const history = sport === "nba"
        ? await loadNBAHistory(db, {
            playerId,
            cutoffAt,
            limit: 30
          })
        : await loadNFLHistory(db, {
            athleteId: playerId,
            cutoffAt,
            limit: 16
          });

      const prediction = sport === "nba"
        ? projectNBAPlayer({
            playerId,
            games: history,
            cutoffAt,
            context: player.context || {}
          })
        : projectNFLPlayer({
            playerId,
            position,
            games: history,
            cutoffAt,
            context: player.context || {}
          });

      results.push({
        playerId,

        name:
          player.name || null,

        position:
          sport === "nfl"
            ? position
            : null,

        status:
          prediction.status,

        historicalGamesRead:
          history.length,

        historicalGamesUsed:
          prediction.gamesAvailable ?? null,

        projectedStats:
          prediction.stats ?? null,

        // NBA: puntuacion base sin bonos.
        // NFL: pendiente de estadisticas
        // adicionales para puntuar exacto.

        fantasyBasePoints:
          sport === "nba"
            ? (
                prediction
                  .fantasyBasePoints
                  ?.[platform] ?? null
              )
            : null,

        missingScoringStats:
          prediction.missingScoringStats || [],

        readyForOptimization:
          false
      });

    } catch (error) {

      results.push({
        playerId,

        name:
          player.name || null,

        position:
          sport === "nfl"
            ? position
            : null,

        status:
          "error",

        error:
          error?.message || String(error),

        projectedStats:
          null,

        fantasyBasePoints:
          null,

        readyForOptimization:
          false
      });
    }
  }

  return {
    mode: "shadow_preview",

    sport,
    platform,
    cutoffAt,

    modelVersion:
      `${sport}-baseline-v1`,

    source:
      sport === "nba"
        ? "nba_player_game_stats"
        : "nfl_player_gamelog_cache",

    counts: {
      requested:
        players.length,

      projected:
        results.filter(
          row => row.projectedStats !== null
        ).length,

      errors:
        results.filter(
          row => row.status === "error"
        ).length
    },

    slateVerified: false,
    readyForOptimization: false,
    simulationIterations: 0,
    persisted: false,

    results
  };
}

module.exports = {
  runFantasyShadowPreview
};

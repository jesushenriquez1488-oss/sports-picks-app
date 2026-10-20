
"use strict";

// CASHEDGE FANTASY EDGE — SHADOW PREVIEW
// Solo lectura. Sin picks ni escrituras.
// Lesiones NBA sin redistribucion automatica
// de minutos.

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

const {
  buildNBAInjuryContext
} = require("../nba/injury-context");

const SPORT_SET = new Set([
  "nba",
  "nfl"
]);

const PLATFORM_SET = new Set([
  "draftkings",
  "fanduel"
]);

const NFL_POSITIONS = new Set([
  "QB",
  "RB",
  "WR",
  "TE"
]);

// Consultar exclusivamente la tabla NBA
// cuando conocemos el partido y el equipo.

async function getNBAInjuryContext(
  db,
  player,
  cutoffAt
) {
  const gameId = String(
    player?.gameId ?? ""
  ).trim();

  const teamId = String(
    player?.teamId ?? ""
  ).trim();

  const playerId = String(
    player?.id ?? ""
  ).trim();

  const unavailable = reason => ({
    usable: false,
    reason,
    playerStatus: "unknown",
    playerInjury: null,
    ruledOutTeammates: [],
    uncertainTeammates: [],
    automaticMinutesAdjustment: false
  });

  if (!gameId || !teamId) {
    return unavailable(
      "game_id_or_team_id_missing"
    );
  }

  // Permitir un snapshot historico suministrado
  // por el caller, si existe.

  let snapshot =
    player.injurySnapshot ?? null;

  if (snapshot === null) {

    const { data, error } = await db
      .from("nba_live_injury_state")
      .select(
        "game_id,game_time,checked_at,provider,injuries"
      )
      .eq("game_id", gameId)
      .maybeSingle();

    if (error) {
      return unavailable(
        "injury_source_unavailable"
      );
    }

    snapshot = data;
  }

  if (!snapshot) {
    return unavailable(
      "injury_snapshot_missing"
    );
  }

  // Evitar mezclar reportes de partidos.

  if (
    String(snapshot.game_id ?? "") !== gameId
  ) {
    return unavailable(
      "injury_game_mismatch"
    );
  }

  // Valida timestamps y antiguedad.
  // Esta funcion NO acepta snapshots
  // posteriores al cutoff.

  return buildNBAInjuryContext({
    snapshot,
    cutoffAt,
    playerId,
    teamId
  });
}

async function runFantasyShadowPreview({
  db,
  sport,
  platform,
  cutoffAt,
  players
} = {}) {

  sport = String(
    sport || ""
  ).toLowerCase();

  platform = String(
    platform || ""
  ).toLowerCase();

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

    const identity = {
      playerId,

      name:
        player?.name || null,

      position:
        sport === "nfl"
          ? position
          : null
    };

    try {

      // NFL permanece intacto.
      // NBA obtiene el estado de lesiones.

      const injury = sport === "nba"
        ? await getNBAInjuryContext(
            db,
            player,
            cutoffAt
          )
        : null;

      const injuryStatus =
        injury?.usable
          ? injury.playerStatus
          : "unknown";

      const injuryFlags = [];

      if (
        injuryStatus === "uncertain"
      ) {
        injuryFlags.push(
          "player_injury_uncertain"
        );
      }

      if (
        injury?.usable &&
        injury.ruledOutTeammates.length
      ) {
        injuryFlags.push(
          "teammates_out_role_unverified"
        );
      }

      if (
        injury?.usable &&
        injury.uncertainTeammates.length
      ) {
        injuryFlags.push(
          "teammates_injury_uncertain"
        );
      }

      if (
        sport === "nba" &&
        !injury?.usable
      ) {
        injuryFlags.push(
          "injury_data_unverified"
        );
      }

      // Jugador confirmado OUT:
      // no calculamos puntos Fantasy.
      // Nunca interpretamos OUT como
      // un jugador disponible.

      if (
        injuryStatus === "out"
      ) {

        results.push({
          ...identity,

          status: "out_injury",

          historicalGamesRead: 0,
          historicalGamesUsed: null,

          projectedStats: null,
          fantasyBasePoints: null,

          missingScoringStats: [],

          injury,

          injuryFlags: [
            "player_out",
            ...injuryFlags
          ],

          readyForOptimization: false
        });

        continue;
      }

      // Jugadores elegibles para evaluacion
      // experimental de proyecciones.

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

      // Mantener formulas originales.
      // No agregar minutos por lesiones.

      const prediction = sport === "nba"
        ? projectNBAPlayer({
            playerId,
            games: history,
            cutoffAt,
            context:
              player?.context || {}
          })
        : projectNFLPlayer({
            playerId,
            position,
            games: history,
            cutoffAt,
            context:
              player?.context || {}
          });

      results.push({
        ...identity,

        status:
          prediction.status,

        historicalGamesRead:
          history.length,

        historicalGamesUsed:
          prediction.gamesAvailable ?? null,

        projectedStats:
          prediction.stats ?? null,

        // NBA: puntos base sin bonos
        // probabilisticos de DraftKings.
        // NFL: puntuacion completa pendiente.

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

        // Reporte y alertas separados
        // de la proyeccion matematica.

        injury,
        injuryFlags,

        readyForOptimization: false
      });

    } catch (error) {

      results.push({
        ...identity,

        status: "error",

        error:
          error?.message ||
          String(error),

        projectedStats: null,

        fantasyBasePoints: null,

        injury: null,
        injuryFlags: [],

        readyForOptimization: false
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
          row =>
            row.projectedStats !== null
        ).length,

      errors:
        results.filter(
          row =>
            row.status === "error"
        ).length,

      excludedOut:
        results.filter(
          row =>
            row.status === "out_injury"
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

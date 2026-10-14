
"use strict";

const crypto = require("crypto");

const { createClient } =
  require("@supabase/supabase-js");

const { loadNFLV2History } =
  require("../../lib/nfl-props-v2/data");

const { evaluateNFLV2Role } =
  require("../../lib/nfl-props-v2/roles");

const { loadNFLV2Participation } =
  require("../../lib/nfl-props-v2/participation");

const { nflPropEspnGsisMap } =
  require("../football-data");

// ==========================================
// CASHEDGE NFL PLAYER PROPS V2
// PRIVATE RESEARCH ENDPOINT
// ==========================================

function authorized(req) {
  const expected =
    String(process.env.CRON_SECRET || "");

  const bearer =
    String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

  const supplied =
    bearer ||
    String(
      req.headers["x-internal-secret"] || ""
    ).trim();

  if (!expected || !supplied) {
    return false;
  }

  const hash = value =>
    crypto
      .createHash("sha256")
      .update(value)
      .digest();

  return crypto.timingSafeEqual(
    hash(expected),
    hash(supplied)
  );
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(
    value + "T00:00:00Z"
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

// Encontrar un QB de ejemplo en
// los boxscores ya guardados.
async function sampleQuarterback(
  db,
  season,
  beforeDate
) {
  const { data, error } = await db
    .from("nfl_boxscore_cache")
    .select("game_id,game_date,stats_json")
    .eq("season", season)
    .lt("game_date", beforeDate)
    .order("game_date", {
      ascending: false
    })
    .limit(10);

  if (error) throw error;

  for (const game of data || []) {
    const teams = Object.values(
      game.stats_json?.teams || {}
    );

    for (const team of teams) {
      for (const player of team.players || []) {
        const id = String(player.id || "");

        if (
          /^\d+$/.test(id) &&
          Number(
            player.passing?.attempts || 0
          ) >= 15
        ) {
          return {
            id,
            name: player.name || null,
            gameId: String(game.game_id)
          };
        }
      }
    }
  }

  return null;
}

// ==========================================
// MAIN
// ==========================================

module.exports = async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "GET only"
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  try {
    const season = Number(
      req.query?.season || 2026
    );

    const beforeDate = String(
      req.query?.beforeDate ||
      new Date(
        Date.now() + 86400000
      ).toISOString().slice(0, 10)
    );

    if (
      ![2025, 2026].includes(season) ||
      !validDate(beforeDate)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid season or beforeDate"
      });
    }

    const db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false
        }
      }
    );

    const requestedId = String(
      req.query?.playerId || ""
    ).trim();

    const sample = requestedId
      ? null
      : await sampleQuarterback(
          db,
          season,
          beforeDate
        );

    const playerId =
      requestedId || sample?.id;

    if (
      !playerId ||
      !/^\d+$/.test(playerId)
    ) {
      return res.status(404).json({
        ok: false,
        error: "No sample player found"
      });
    }

    // Leer los partidos anteriores
    // desde Supabase.
    const history = await loadNFLV2History({
      espnPlayerId: playerId,
      seasons: [
        season - 1,
        season
      ],
      beforeDate,
      db
    });

    // Conectar boxscores ESPN con
    // participación real de NFLverse.
    const espnGsisMap =
      await nflPropEspnGsisMap();

    const participation =
      await loadNFLV2Participation({
        db,
        espnPlayerId: playerId,
        playerGames: history.playerGames,
        beforeDate,
        espnGsisMap
      });

    const requestedPosition = String(
      req.query?.position || ""
    ).trim().toUpperCase();

    // Para la prueba automática se usa
    // un jugador con volumen de pase.
    // Su posición aún no está verificada.
    const position =
      requestedPosition ||
      (sample ? "QB" : null);

    if (
      position &&
      !["QB", "RB", "FB", "WR", "TE"]
        .includes(position)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid position"
      });
    }

    // Todavía NO aprobamos roles.
    // Primero debemos conectar snaps,
    // titularidad y lesiones.
    const role = position
      ? evaluateNFLV2Role({
          playerGames:
            history.playerGames,
          position,
          verifiedRole: null
        })
      : null;

    return res.status(200).json({
      ok: true,
      experimental: true,
      readOnly: true,

      season,
      beforeDate,

      player: {
        espnId: playerId,

        name:
          history.playerGames.at(-1)?.name ||
          sample?.name ||
          null,

        positionForAudit: position,
        positionVerified: false
      },

      scannedGames:
        history.scannedGames,

      historicalGamesFound:
        history.totalPlayerBoxscores,

      participation,

      opportunities:
        role?.opportunities || null,

      roleStatus:
        role?.roleStatus ||
        "position_not_provided",

      canPublishPremium: false,
      confidence: null,

      lastGames:
        history.playerGames
          .slice(-5)
          .map(game => ({
            date: game.gameDate,
            gameId: game.gameId,
            team: game.teamAbbreviation,

            passing: game.passing,
            rushing: game.rushing,
            receiving: game.receiving,

            passingPlusRushingYards:
              game.passingPlusRushingYards,

            rushingPlusReceivingYards:
              game.rushingPlusReceivingYards
          })),

      warnings: [
        "Position is not verified.",
        "Low-volume games are retained.",
        "Missing games are not zero stats.",
        "Snaps and injuries are not joined.",
        "No predictions or picks generated."
      ]
    });

  } catch (error) {
    console.error(
      "NFL PROPS V2:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};

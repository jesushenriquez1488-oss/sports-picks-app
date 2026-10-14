
const crypto = require("crypto");

const { createClient } =
  require("@supabase/supabase-js");

const footballData =
  require("../football-data");

// ==========================================
// CASHEDGE NFL BOXSCORE AUTO COLLECTOR
// ==========================================

// Seguridad del endpoint
function authorized(req) {
  const expected =
    String(process.env.CRON_SECRET || "");

  const bearer =
    String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

  const supplied =
    bearer ||
    String(req.headers["x-internal-secret"] || "");

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

// Comprobar que el boxscore contiene
// estadísticas de ambos equipos.
function isValidBoxscore(json) {
  if (
    Number(json?.schemaVersion) !== 1
  ) {
    return false;
  }

  const teams =
    Object.values(json?.teams || {});

  return (
    teams.length === 2 &&
    teams.every(team =>
      Array.isArray(team.players) &&
      team.players.length >= 10
    )
  );
}

// ==========================================
// ENDPOINT AUTOMATICO
// ==========================================

module.exports = async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  try {

    const now = new Date();
    const month = now.getUTCMonth();

    // Marzo a agosto:
    // fuera de temporada regular NFL.
    if (month >= 2 && month <= 7) {
      return res.status(200).json({
        ok: true,
        skipped: "NFL offseason"
      });
    }

    const season =
      month <= 1
        ? now.getUTCFullYear() - 1
        : now.getUTCFullYear();

    // Calendario ESPN de la temporada.
    const url =
      "https://site.api.espn.com/apis/site/v2/" +
      "sports/football/nfl/scoreboard" +
      `?dates=${season}&seasontype=2&limit=500`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `ESPN scoreboard HTTP ${response.status}`
      );
    }

    const scoreboard =
      await response.json();

    const events =
      Array.isArray(scoreboard?.events)
        ? scoreboard.events
        : [];

    // Evitar procesar un calendario truncado.
    if (events.length < 30) {
      throw new Error(
        `Incomplete ESPN season scoreboard: ${events.length} events`
      );
    }

    // Organizar partidos por semana.
    const byWeek = new Map();

    for (const event of events) {

      const week =
        Number(event?.week?.number);

      const year =
        Number(
          event?.season?.year ?? season
        );

      const type =
        Number(
          event?.season?.type ?? 2
        );

      if (
        !event?.id ||
        year !== season ||
        type !== 2 ||
        !Number.isInteger(week) ||
        week < 1 ||
        week > 18
      ) {
        continue;
      }

      const status =
        event?.competitions?.[0]
          ?.status?.type ||
        event?.status?.type ||
        {};

      const game = {
        id: String(event.id),
        season,
        date: event.date,
        finished:
          status.completed === true ||
          status.state === "post"
      };

      if (!byWeek.has(week)) {
        byWeek.set(week, []);
      }

      byWeek.get(week).push(game);
    }

    // Solamente semanas terminadas.
    const completed =
      [...byWeek.entries()]
        .filter(([, games]) =>
          games.length >= 2 &&
          games.every(game => game.finished)
        )
        .sort((a, b) => a[0] - b[0]);

    if (!completed.length) {
      return res.status(200).json({
        ok: true,
        season,
        skipped: "No complete weeks"
      });
    }

    // Consultar boxscores ya guardados.
    const db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } =
      await db
        .from("nfl_boxscore_cache")
        .select("game_id,stats_json")
        .eq("season", season)
        .limit(500);

    if (error) {
      throw new Error(
        `Boxscore cache read: ${error.message}`
      );
    }

    const stored =
      new Map(
        (data || []).map(row => [
          String(row.game_id),
          row.stats_json
        ])
      );

    // Detectar las semanas incompletas.
    const pending =
      completed
        .map(([week, games]) => ({
          week,
          games,
          missing: games.filter(game =>
            !isValidBoxscore(
              stored.get(game.id)
            )
          )
        }))
        .filter(item =>
          item.missing.length > 0
        );

    // Si todo está guardado,
    // no descargar otra vez.
    if (!pending.length) {
      return res.status(200).json({
        ok: true,
        season,
        pendingWeeks: [],
        skipped: "All completed games cached"
      });
    }

    // Priorizar la semana más antigua
    // que tenga partidos pendientes.
    const target = pending[0];

    const preview =
      String(req.query?.preview || "") === "1";

    // PRUEBA: solo lectura.
    if (preview) {
      return res.status(200).json({
        ok: true,
        preview: true,
        season,
        week: target.week,
        expectedGames: target.games.length,
        missingGames: target.missing.length,
        pendingWeeks: pending.map(item => ({
          week: item.week,
          missing: item.missing.length
        }))
      });
    }

    // Reutilizar el recolector existente.
    if (
      typeof footballData
        .loadNFLPlayerStatsBoxscores !== "function"
    ) {
      throw new Error(
        "Export loadNFLPlayerStatsBoxscores not found"
      );
    }

    const result =
      await footballData
        .loadNFLPlayerStatsBoxscores(
          target.games
        );

    // Verificar cobertura después
    // de la ejecución.
    const invalid =
      target.games.filter(game =>
        !isValidBoxscore(
          result.byGameId?.get(game.id)
        )
      );

    const responseBody = {
      ok:
        invalid.length === 0 &&
        Number(result.failedCount || 0) === 0,

      season,
      week: target.week,
      expectedGames: target.games.length,

      cachedBefore:
        target.games.length -
        target.missing.length,

      fetched: result.fetchedCount,
      failed: result.failedCount,

      invalidGameIds:
        invalid.map(game => game.id)
    };

    return res
      .status(responseBody.ok ? 200 : 503)
      .json(responseBody);

  } catch (error) {

    console.error(
      "NFL BOXSCORE AUTO:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};

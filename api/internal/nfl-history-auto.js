
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const runBackfill = require("./nfl-history-backfill");

// ==================================================
// CASHEDGE NFL — AUTOMATIC HISTORY UPDATE
// ==================================================

function matchesSecret(given, expected) {
  if (!given || !expected) return false;

  const hash = value =>
    crypto
      .createHash("sha256")
      .update(String(value))
      .digest();

  return crypto.timingSafeEqual(
    hash(given),
    hash(expected)
  );
}

// Leer CSV respetando comillas.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;

      row.push(field);
      if (row.some(value => value.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() || [])
    .map(h => h.replace(/^\uFEFF/, "").trim());

  return rows.map(values =>
    Object.fromEntries(
      headers.map((h, i) => [h, values[i] || ""])
    )
  );
}

// Contar registros existentes por partido.
async function savedGameCounts(db, table, season) {
  const counts = new Map();

  for (let offset = 0; offset < 25000; offset += 1000) {
    const { data, error } = await db
      .from(table)
      .select("game_id")
      .eq("sport", "nfl")
      .eq("season", season)
      .order("game_id")
      .order("team_id")
      .range(offset, offset + 999);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    for (const row of data || []) {
      const id = String(row.game_id);
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    if (!data || data.length < 1000) {
      return counts;
    }
  }

  throw new Error(`Pagination limit reached: ${table}`);
}

// ==================================================
// MAIN
// ==================================================

module.exports = async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const secret = process.env.CRON_SECRET;

  const supplied =
    String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "") ||
    req.headers["x-internal-secret"];

  if (!matchesSecret(supplied, secret)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  try {
    const now = new Date();
    const month = now.getUTCMonth();

    // Marzo a agosto: fuera de temporada.
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

    // Calendario oficial recopilado por NFLverse.
    const scheduleResponse = await fetch(
      "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
      { cache: "no-store" }
    );

    if (!scheduleResponse.ok) {
      throw new Error(
        `NFL schedule HTTP ${scheduleResponse.status}`
      );
    }

    const schedule = parseCSV(
      await scheduleResponse.text()
    );

    const weeks = new Map();

    for (const game of schedule) {
      if (Number(game.season) !== season) continue;
      if (game.game_type !== "REG") continue;

      const week = Number(game.week);

      if (
        !Number.isInteger(week) ||
        week < 1 ||
        week > 18
      ) continue;

      if (!weeks.has(week)) {
        weeks.set(week, []);
      }

      const finished =
        game.home_score !== "" &&
        game.away_score !== "" &&
        Number.isFinite(Number(game.home_score)) &&
        Number.isFinite(Number(game.away_score));

      weeks.get(week).push({
        gameId: game.game_id,
        finished
      });
    }

    // Solo semanas completamente terminadas.
    const completed = [...weeks.entries()]
      .filter(([, games]) =>
        games.length > 0 &&
        games.every(game => game.finished)
      )
      .sort((a, b) => a[0] - b[0]);

    if (!completed.length) {
      return res.status(200).json({
        ok: true,
        season,
        skipped: "No completed NFL week"
      });
    }

    const db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const [teamCounts, playerCounts] =
      await Promise.all([
        savedGameCounts(
          db,
          "football_team_games",
          season
        ),
        savedGameCounts(
          db,
          "football_player_game_stats",
          season
        )
      ]);

    // Detectar semanas con partidos faltantes.
    const missing = completed.filter(([, games]) =>
      games.some(game =>
        (teamCounts.get(game.gameId) || 0) < 2 ||
        (playerCounts.get(game.gameId) || 0) < 15
      )
    );

    // Recuperar primero la semana más antigua pendiente.
    // Si ninguna falta, actualizar la última completa.
    const [week, scheduledGames] =
      missing[0] ||
      completed[completed.length - 1];

    const reason = missing.length
      ? "missing games"
      : "refresh latest completed week";

    // PREVIEW: no modifica Supabase.
    if (req.query.preview === "1") {
      return res.status(200).json({
        ok: true,
        preview: true,
        season,
        week,
        reason,
        missingWeeks: missing.map(([w]) => w),
        expectedGames: scheduledGames.length
      });
    }

    // Ejecutar el recolector original.
    const internalResponse = {
      statusCode: 200,
      body: null,

      status(code) {
        this.statusCode = code;
        return this;
      },

      json(body) {
        this.body = body;
        return this;
      }
    };

    await runBackfill(
      {
        headers: {
          "x-internal-secret": secret
        },
        query: {
          season: String(season),
          week: String(week)
        }
      },
      internalResponse
    );

    const result = internalResponse.body;

    if (
      internalResponse.statusCode !== 200 ||
      result?.ok !== true
    ) {
      throw new Error(
        result?.error || "NFL backfill failed"
      );
    }

    // Verificar cobertura mínima.
    if (
      Number(result.completedGamesSaved) !==
        scheduledGames.length ||
      Number(result.withOffensiveSnaps) <
        scheduledGames.length * 10
    ) {
      throw new Error(
        `Incomplete NFL source data for week ${week}`
      );
    }

    return res.status(200).json({
      ok: true,
      automatic: true,
      season,
      week,
      reason,
      games: result.completedGamesSaved,
      playerRows: result.playerGamesSaved,
      withOffensiveSnaps: result.withOffensiveSnaps
    });

  } catch (error) {
    console.error("NFL HISTORY AUTO ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};

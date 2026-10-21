
"use strict";

// CASHEDGE FANTASY EDGE
// NFLVERSE WEEKLY STATS BRIDGE
//
// SHADOW ONLY
// No escribe en Supabase.
// No modifica Player Props, Premium Picks ni NBA.

const BASE =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/";

const SCHEDULE_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

const REQUIRED = [
  "player_id",
  "player_name",
  "position",
  "team",
  "season",
  "week",
  "season_type",
  "game_id",
  "attempts",
  "carries",
  "targets",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "fumbles_lost_total",
  "passing_2pt_conversions",
  "rushing_2pt_conversions",
  "receiving_2pt_conversions",
  "special_teams_tds",
  "fumble_recovery_tds"
];

const OFFENSE = new Set([
  "QB", "RB", "WR", "TE"
]);

function parseCSV(text, selectedFields) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    throw new Error("NFLverse CSV vacio");
  }

  const wanted = new Set(selectedFields);
  const results = [];

  let headers = null;
  let indexes = [];
  let fields = [];
  let field = "";
  let quoted = false;

  function finishRow() {
    fields.push(field);
    field = "";

    if (!headers) {
      headers = fields.map(v =>
        v.replace(/^\uFEFF/, "").trim()
      );

      const missing = selectedFields.filter(
        name => !headers.includes(name)
      );

      if (missing.length) {
        throw new Error(
          "NFLverse CSV columnas faltantes: " +
          missing.join(", ")
        );
      }

      indexes = headers
        .map((name, i) =>
          wanted.has(name) ? [name, i] : null
        )
        .filter(Boolean);

    } else if (
      fields.some(v => v !== "")
    ) {
      const obj = {};

      for (const [name, i] of indexes) {
        obj[name] = fields[i] ?? "";
      }

      results.push(obj);
    }

    fields = [];
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (
        quoted &&
        text[i + 1] === '"'
      ) {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }

    } else if (
      char === "," &&
      !quoted
    ) {
      fields.push(field);
      field = "";

    } else if (
      (char === "\n" || char === "\r") &&
      !quoted
    ) {
      if (
        char === "\r" &&
        text[i + 1] === "\n"
      ) {
        i++;
      }

      if (fields.length || field.length) {
        finishRow();
      }

    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new Error(
      "NFLverse CSV con comillas incompletas"
    );
  }

  if (fields.length || field.length) {
    finishRow();
  }

  return results;
}

function numberFrom(row, key) {
  const raw = row[key];

  if (
    raw === "" ||
    raw === null ||
    raw === undefined
  ) {
    throw new Error(
      `NFLverse ${key} sin valor`
    );
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(
      `NFLverse ${key} invalido`
    );
  }

  return value;
}

function normalizeWeeklyPlayer(
  row,
  gameday
) {
  const playerId = String(
    row.player_id || ""
  ).trim();

  const position = String(
    row.position || ""
  ).trim().toUpperCase();

  const team = String(
    row.team || ""
  ).trim();

  const date = String(
    gameday || ""
  ).slice(0, 10);

  if (
    !playerId ||
    !row.player_name ||
    !team ||
    !OFFENSE.has(position) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null;
  }

  const recoveryTDs = numberFrom(
    row,
    "fumble_recovery_tds"
  );

  const passing2pt = numberFrom(
    row,
    "passing_2pt_conversions"
  );

  const rushing2pt = numberFrom(
    row,
    "rushing_2pt_conversions"
  );

  const receiving2pt = numberFrom(
    row,
    "receiving_2pt_conversions"
  );

  return {
    // GSIS ID: no asumir que es el ID DFS.
    player_id: playerId,
    player_name: row.player_name,
    position,
    team,
    game_id: row.game_id,

    season: numberFrom(row, "season"),
    week: numberFrom(row, "week"),

    // Fecha del calendario NFLverse.
    // No representa la hora exacta de kickoff.
    game_date: `${date}T00:00:00Z`,
    gameDatePrecision: "day",

    passing_attempts: numberFrom(
      row, "attempts"
    ),

    passing_yards: numberFrom(
      row, "passing_yards"
    ),

    passing_tds: numberFrom(
      row, "passing_tds"
    ),

    passing_interceptions: numberFrom(
      row, "passing_interceptions"
    ),

    rushing_attempts: numberFrom(
      row, "carries"
    ),

    rushing_yards: numberFrom(
      row, "rushing_yards"
    ),

    rushing_tds: numberFrom(
      row, "rushing_tds"
    ),

    targets: numberFrom(
      row, "targets"
    ),

    receptions: numberFrom(
      row, "receptions"
    ),

    receiving_yards: numberFrom(
      row, "receiving_yards"
    ),

    receiving_tds: numberFrom(
      row, "receiving_tds"
    ),

    // Total consolidado: no sumar por categoria.
    fumbles_lost: numberFrom(
      row, "fumbles_lost_total"
    ),

    two_point_conversions:
      passing2pt +
      rushing2pt +
      receiving2pt,

    return_tds: numberFrom(
      row, "special_teams_tds"
    ),

    // No atribuir TD defensivos a ofensivos.
    // Si hubo un TD de recuperación, requiere
    // clasificación mediante jugada real.
    offensive_fumble_recovery_tds:
      recoveryTDs === 0 ? 0 : null,

    rareEventReviewRequired:
      recoveryTDs > 0,

    source: "nflverse-stats-player-week"
  };
}

async function getText(url) {
  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "CashEdge-Fantasy-Shadow/1.0"
        },
        signal: AbortSignal.timeout(45000)
      });

    } catch (error) {
      if (attempt === 3) {
        throw error;
      }

      await new Promise(resolve =>
        setTimeout(resolve, attempt * 2000)
      );

      continue;
    }

    if (response.ok) {
      return response.text();
    }

    if (
      ![429, 500, 502, 503, 504].includes(
        response.status
      ) ||
      attempt === 3
    ) {
      throw new Error(
        `NFLverse HTTP ${response.status}: ${url}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, attempt * 3000)
    );
  }

  throw new Error(
    "NFLverse descarga agotada"
  );
}

async function loadNFLVerseHistory({
  targetSeason,
  targetWeek,
  cutoffAt,
  seasons = [
    targetSeason - 1,
    targetSeason
  ],
  playerIds = null
} = {}) {

  if (
    !Number.isInteger(targetSeason) ||
    !Number.isInteger(targetWeek) ||
    targetWeek < 1 ||
    targetWeek > 22 ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
      cutoffAt || ""
    ) ||
    !Number.isFinite(Date.parse(cutoffAt))
  ) {
    throw new Error(
      "NFL Fantasy: season, week o cutoffAt invalido"
    );
  }

  if (
    !Array.isArray(seasons) ||
    seasons.length < 1 ||
    seasons.length > 3 ||
    seasons.some(s =>
      !Number.isInteger(s) ||
      s > targetSeason ||
      s < 1999
    )
  ) {
    throw new Error(
      "NFL Fantasy: seasons invalidas"
    );
  }

  const ids = playerIds == null
    ? null
    : new Set(playerIds.map(String));

  // Calendario: convierte game_id a fecha real.
  const scheduleText = await getText(
    SCHEDULE_URL
  );

  const scheduleRows = parseCSV(
    scheduleText,
    ["game_id", "gameday"]
  );

  const dates = new Map(
    scheduleRows.map(g => [
      g.game_id,
      g.gameday
    ])
  );

  const byPlayer = Object.create(null);
  const seen = new Set();

  const report = {
    rowsRead: 0,
    recordsValid: 0,
    recordsWithoutSchedule: 0,
    recordsWithUnclassifiedTD: 0,
    recordsWithoutIdentity: 0,
    duplicates: 0,
    players: 0
  };

  for (
    const season of [...new Set(seasons)].sort()
  ) {
    const text = await getText(
      `${BASE}stats_player_week_${season}.csv`
    );

    const rows = parseCSV(
      text,
      REQUIRED
    );

    report.rowsRead += rows.length;

    for (const row of rows) {
      if (
        !OFFENSE.has(
          String(row.position).toUpperCase()
        ) ||
        String(row.season_type).toUpperCase() !==
          "REG" ||
        Number(row.season) > targetSeason ||
        (
          Number(row.season) === targetSeason &&
          Number(row.week) >= targetWeek
        )
      ) {
        continue;
      }

      if (
        !row.player_id ||
        !row.player_name ||
        !row.team
      ) {
        report.recordsWithoutIdentity++;
        continue;
      }

      if (
        ids &&
        !ids.has(String(row.player_id))
      ) {
        continue;
      }

      const date = dates.get(
        row.game_id
      );

      if (!date) {
        report.recordsWithoutSchedule++;
        continue;
      }

      // Impedir filtracion de resultados futuros.
      if (
        date.slice(0, 10) >=
        cutoffAt.slice(0, 10)
      ) {
        continue;
      }

      const rec = normalizeWeeklyPlayer(
        row,
        date
      );

      if (!rec) {
        continue;
      }

      const key =
        `${rec.player_id}|${rec.game_id}`;

      if (seen.has(key)) {
        report.duplicates++;
        continue;
      }

      seen.add(key);

      if (rec.rareEventReviewRequired) {
        report.recordsWithUnclassifiedTD++;
      }

      if (!byPlayer[rec.player_id]) {
        byPlayer[rec.player_id] = [];
      }

      byPlayer[rec.player_id].push(rec);

      report.recordsValid++;
    }
  }

  for (
    const games of Object.values(byPlayer)
  ) {
    games.sort(
      (a, b) =>
        b.game_date.localeCompare(
          a.game_date
        )
    );
  }

  report.players =
    Object.keys(byPlayer).length;

  return {
    mode: "shadow",
    sport: "nfl",

    targetSeason,
    targetWeek,
    cutoffAt,

    source: "nflverse",
    report,
    byPlayer,

    identitiesVerifiedAgainstDFS: false,
    readyForPublication: false
  };
}

module.exports = {
  parseCSV,
  normalizeWeeklyPlayer,
  loadNFLVerseHistory
};

// Permite ejecutar una auditoria directamente
// desde GitHub Actions sin tocar Supabase.
if (require.main === module) {
  const targetSeason = Number(
    process.env.NFL_FANTASY_SEASON || 2026
  );

  const targetWeek = Number(
    process.env.NFL_FANTASY_WEEK || 8
  );

  const cutoffAt =
    process.env.NFL_FANTASY_CUTOFF ||
    "2026-10-21T18:00:00Z";

  loadNFLVerseHistory({
    targetSeason,
    targetWeek,
    cutoffAt
  })
    .then(result => {
      console.log(
        JSON.stringify({
          sport: result.sport,
          mode: result.mode,

          season: targetSeason,
          week: targetWeek,
          cutoffAt,

          report: result.report,

          identitiesVerifiedAgainstDFS:
            result.identitiesVerifiedAgainstDFS,

          readyForPublication:
            result.readyForPublication
        }, null, 2)
      );
    })
    .catch(error => {
      console.error(
        "NFL FANTASY SHADOW ERROR:",
        error.message
      );

      process.exitCode = 1;
    });
}

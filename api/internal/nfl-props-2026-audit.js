
"use strict";

// CASHEDGE — AUDITORIA NFL PLAYER PROPS 2026
// SOLO LECTURA — NO MODIFICA PRODUCCION

const crypto = require("crypto");
const { createClient } =
  require("@supabase/supabase-js");

const { parsePlayerFromGame } =
  require("../../lib/nfl-props-v2/data");

const { loadNFLV2Participation } =
  require("../../lib/nfl-props-v2/participation");

const { analyzeNFLV2RoleSignals } =
  require("../../lib/nfl-props-v2/roles");

const {
  calculateNFLV2Baseline,
  applyNFLV2Defense
} = require("../../lib/nfl-props-v2/projections");

const { estimateRelativeDefense } =
  require("../../lib/nfl-props-v2/defense");

const { nflPropEspnGsisMap } =
  require("../football-data");

// ==========================================
// SEGURIDAD
// ==========================================

function authorized(req) {
  const secret = String(
    process.env.CRON_SECRET || ""
  );

  const bearer = String(
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "").trim();

  const provided = bearer ||
    String(
      req.headers["x-internal-secret"] || ""
    ).trim();

  if (!secret || !provided) return false;

  const digest = s => crypto
    .createHash("sha256")
    .update(s)
    .digest();

  return crypto.timingSafeEqual(
    digest(secret),
    digest(provided)
  );
}

function number(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function round(n) {
  return Number.isFinite(n)
    ? Number(n.toFixed(2))
    : null;
}

function normalize(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\bfootball team\b/g, "commanders")
    .replace(/[^a-z0-9]/g, "");
}

// ==========================================
// MERCADOS EXISTENTES CASHEDGE
// ==========================================

const MARKETS = {
  player_pass_yds: [
    "passing", "yards", "passingYards"
  ],
  player_rush_yds: [
    "rushing", "yards", "rushingYards"
  ],
  player_rush_attempts: [
    "rushing", "attempts", "rushingAttempts"
  ],
  player_reception_yds: [
    "receiving", "yards", "receivingYards"
  ],
  player_receptions: [
    "receiving", "receptions", "receptions"
  ]
};

function grade(side, line, actual) {
  if (
    !Number.isFinite(line) ||
    !Number.isFinite(actual)
  ) return null;

  if (actual === line) return "PUSH";

  return (
    (side === "OVER") === (actual > line)
  ) ? "WIN" : "LOSS";
}

function units(outcome, decimalOdds) {
  if (!(decimalOdds > 1)) return null;
  if (outcome === "PUSH") return 0;
  if (outcome === "LOSS") return -1;
  if (outcome === "WIN") return decimalOdds - 1;
  return null;
}

// ==========================================
// LECTURA PAGINADA DE SUPABASE
// ==========================================

async function readAll(
  db,
  table,
  selection,
  configure
) {
  const result = [];

  for (
    let offset = 0;
    offset < 20000;
    offset += 200
  ) {
    const query = configure(
      db.from(table).select(selection)
    );

    const { data, error } = await query
      .order("game_date")
      .order(
        table === "nfl_boxscore_cache"
          ? "game_id"
          : "event_id"
      )
      .range(offset, offset + 199);

    if (error) {
      throw new Error(
        `${table}: ${error.message}`
      );
    }

    result.push(...(data || []));

    if (!data || data.length < 200) {
      return result;
    }
  }

  throw new Error(
    "Pagination limit: " + table
  );
}

// ==========================================
// IDENTIFICAR PARTIDO Y JUGADOR
// ==========================================

function matchupKey(away, home) {
  return (
    normalize(away) +
    "@" +
    normalize(home)
  );
}

function findAthlete(box, athleteId) {
  for (
    const team of Object.values(
      box.stats_json?.teams || {}
    )
  ) {
    const player = (team.players || [])
      .find(p =>
        String(p.id) === String(athleteId)
      );

    if (player) {
      return { player, team };
    }
  }

  return null;
}

// ==========================================
// RESUMEN DE RESULTADOS ORIGINALES
// ==========================================

function summarize(records) {
  const groups = {};

  function add(groupName, record) {
    if (!groups[groupName]) {
      groups[groupName] = {
        bets: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        priced: 0,
        units: 0
      };
    }

    const g = groups[groupName];

    g.bets++;

    if (record.originalGrade === "WIN") {
      g.wins++;
    }

    if (record.originalGrade === "LOSS") {
      g.losses++;
    }

    if (record.originalGrade === "PUSH") {
      g.pushes++;
    }

    if (record.originalUnits !== null) {
      g.priced++;
      g.units += record.originalUnits;
    }
  }

  for (const r of records) {
    add("TODOS", r);
    add("MERCADO:" + r.market, r);
    add("GRUPO:" + r.group, r);
    add("PREMIUM:" + r.isPremium, r);
    add("LADO:" + r.originalSide, r);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([name, g]) => [
      name,
      {
        ...g,

        units: round(g.units),

        winRate: g.wins + g.losses
          ? round(
              100 * g.wins /
              (g.wins + g.losses)
            )
          : null,

        roiPct: g.priced
          ? round(
              100 * g.units / g.priced
            )
          : null
      }
    ])
  );
}

// ==========================================
// HISTORIAL PREVIO DEL JUGADOR
// ==========================================

function playerHistory(
  boxes,
  athleteId,
  beforeDate
) {
  const games = [];

  for (const box of boxes) {
    const year = Number(box.season);

    if (![2025, 2026].includes(year)) {
      continue;
    }

    if (
      String(box.game_date).slice(0, 10) >=
      beforeDate
    ) {
      continue;
    }

    const game = parsePlayerFromGame(
      box,
      String(athleteId)
    );

    if (game) games.push(game);
  }

  games.sort(
    (a, b) =>
      a.gameDate.localeCompare(b.gameDate)
  );

  return games;
}

// ==========================================
// COMPARAR FORMULA V2
// ==========================================

async function compareV2(
  original,
  boxes,
  db,
  espnGsisMap
) {
  const result = {
    ...original,

    v2Projection: null,
    v2Side: null,
    v2Grade: null,
    v2Factor: null,
    v2Status: null
  };

  const position =
    String(original.position || "")
      .toUpperCase();

  if (
    !["QB", "RB", "WR", "TE", "FB"]
      .includes(position)
  ) {
    result.v2Status =
      "position_not_verified";

    return result;
  }

  try {
    // SOLO partidos anteriores.
    const playerGames = playerHistory(
      boxes,
      original.athleteId,
      original.gameDate
    );

    const participation =
      await loadNFLV2Participation({
        db,

        espnPlayerId:
          original.athleteId,

        playerGames,

        beforeDate:
          original.gameDate,

        espnGsisMap
      });

    const roleSignals =
      analyzeNFLV2RoleSignals({
        playerGames,
        participation,
        position,
        season: 2026
      });

    const baseline =
      calculateNFLV2Baseline({
        playerGames,
        participation,
        roleSignals,
        season: 2026
      });

    if (!baseline.projections) {
      result.v2Status = baseline.status;
      return result;
    }

    // Defensa relativa: compara
    // los rivales anteriores contra
    // la defensa del partido.
    const defense =
      estimateRelativeDefense({
        boxscores: boxes,

        opponentTeamId:
          original.opponentTeamId,

        season: 2026,

        beforeDate:
          original.gameDate,

        sampleGames:
          baseline.sampleGames || []
      });

    const adjusted =
      applyNFLV2Defense({
        v2Baseline: baseline,
        defensiveContext: defense
      });

    const projectionField =
      MARKETS[original.market][2];

    // El mercado de intentos todavía
    // usa la estimación base V2.
    const projected =
      original.market ===
        "player_rush_attempts"
        ? number(
            baseline.expectedOpportunities
              ?.rushingAttempts
          )
        : number(
            adjusted?.projections
              ?.[projectionField]
          );

    if (projected === null) {
      result.v2Status =
        "projection_missing";

      return result;
    }

    result.v2Projection = round(projected);

    result.v2Side =
      projected > original.line
        ? "OVER"
        : projected < original.line
          ? "UNDER"
          : "NEUTRAL";

    result.v2Grade =
      result.v2Side === "NEUTRAL"
        ? null
        : grade(
            result.v2Side,
            original.line,
            original.actual
          );

    const metric =
      original.market === "player_pass_yds"
        ? "passYPA"
        : original.market === "player_rush_yds"
          ? "rushYPC"
          : original.market === "player_reception_yds"
            ? "recYPT"
            : original.market === "player_receptions"
              ? "catchRate"
              : "rushYPC";

    result.v2Factor =
      defense.metrics?.[metric]?.factor ??
      null;

    result.v2Status =
      original.market === "player_rush_attempts"
        ? "baseline_attempts_only"
        : "research_only";

  } catch (error) {
    result.v2Status =
      "error: " + error.message;
  }

  return result;
}

// ==========================================
// ENDPOINT PRINCIPAL
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
    const mode = String(
      req.query?.mode || "overview"
    );

    if (
      !["overview", "compare"].includes(mode)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid mode"
      });
    }

    const page = Math.max(
      0,
      Math.floor(number(req.query?.page) || 0)
    );

    // Lotes pequeños para evitar
    // exceder los límites de Vercel.
    const pageSize = Math.min(
      5,
      Math.max(
        1,
        Math.floor(
          number(req.query?.pageSize) || 3
        )
      )
    );

    const db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false
        }
      }
    );

    // Reutilizar datos ya almacenados.
    // NO descargar nuevamente ESPN.
    const [boxes, archives] =
      await Promise.all([

        readAll(
          db,
          "nfl_boxscore_cache",
          "game_id,game_date,season," +
          "away_team,home_team,stats_json",

          q => q.in(
            "season",
            [2025, 2026]
          )
        ),

        readAll(
          db,
          "player_props_cache",

          "game_date,event_id," +
          "game:analysis_json->>game," +
          "generated_at:analysis_json->>generatedAt," +
          "props:analysis_json->props," +
          "locked_props:analysis_json->lockedProps",

          q => q
            .eq("sport", "nfl")
            .gte(
              "game_date",
              "2026-09-01"
            )
            .lte(
              "game_date",
              "2026-10-15"
            )
        )
      ]);

    const boxes2026 = boxes.filter(
      b => Number(b.season) === 2026
    );

    // Indexar encuentros reales.
    const matchups = new Map();

    for (const box of boxes2026) {
      const away =
        box.stats_json?.away?.name ||
        box.away_team;

      const home =
        box.stats_json?.home?.name ||
        box.home_team;

      const key = matchupKey(
        away,
        home
      );

      if (!matchups.has(key)) {
        matchups.set(key, []);
      }

      matchups.get(key).push(box);
    }

    const excluded = {};

    function exclude(reason) {
      excluded[reason] =
        (excluded[reason] || 0) + 1;
    }

    // Conservar la última versión
    // verificable antes del kickoff.
    const latest = new Map();

    for (const archive of archives) {

      const parts = String(
        archive.game || ""
      ).split(/\s+@\s+/);

      if (parts.length !== 2) {
        exclude("invalid_matchup");
        continue;
      }

      const key = matchupKey(
        parts[0],
        parts[1]
      );

      const generated = Date.parse(
        archive.generated_at || ""
      );

      if (!Number.isFinite(generated)) {
        exclude("missing_generation_time");
        continue;
      }

      const options =
        matchups.get(key) || [];

      // Solo capturas anteriores al
      // inicio del partido y cercanas
      // a ese enfrentamiento.
      const matches = options.filter(box => {
        const kickoff = Date.parse(
          box.stats_json?.date || ""
        );

        return (
          Number.isFinite(kickoff) &&
          generated < kickoff &&
          kickoff - generated <=
            14 * 86400000
        );
      });

      const items = [
        ...(
          Array.isArray(archive.props)
            ? archive.props.map(p => ({
                p,
                group: "props"
              }))
            : []
        ),

        ...(
          Array.isArray(archive.locked_props)
            ? archive.locked_props.map(p => ({
                p,
                group: "lockedProps"
              }))
            : []
        )
      ];

      if (matches.length !== 1) {
        for (const item of items) {
          exclude(
            matches.length > 1
              ? "ambiguous_match"
              : "no_verified_pregame_match"
          );
        }
        continue;
      }

      const box = matches[0];

      for (const { p, group } of items) {
        const market = String(
          p.market || ""
        );

        const athleteId = String(
          p.athleteId || ""
        ).trim();

        const line = number(p.line);

        const originalSide = String(
          p.side || ""
        ).toUpperCase();

        if (
          !MARKETS[market] ||
          line === null ||
          !["OVER", "UNDER"].includes(
            originalSide
          ) ||
          !/^\d+$/.test(athleteId)
        ) {
          exclude("invalid_prop");
          continue;
        }

        const athlete = findAthlete(
          box,
          athleteId
        );

        if (!athlete) {
          exclude("athlete_not_in_boxscore");
          continue;
        }

        // No considerar un listado
        // de jugador con todos sus
        // registros en cero como prueba
        // definitiva de que jugó.
        const playedEvidence =
          number(
            athlete.player.passing?.attempts
          ) > 0 ||
          number(
            athlete.player.rushing?.attempts
          ) > 0 ||
          number(
            athlete.player.receiving?.targets
          ) > 0 ||
          number(
            athlete.player.receiving?.receptions
          ) > 0;

        if (!playedEvidence) {
          exclude("participation_not_verified");
          continue;
        }

        const [category, stat] =
          MARKETS[market];

        const actual = number(
          athlete.player?.[category]?.[stat]
        );

        if (actual === null) {
          exclude("missing_stat");
          continue;
        }

        const opponentTeamId = String(
          athlete.team.opponentId || ""
        );

        if (
          !/^\d+$/.test(opponentTeamId)
        ) {
          exclude("missing_opponent_id");
          continue;
        }

        const outcome = grade(
          originalSide,
          line,
          actual
        );

        const rec = {
          gameId: String(box.game_id),

          gameDate:
            String(box.game_date)
              .slice(0, 10),

          game: archive.game,

          kickoffUTC:
            box.stats_json.date,

          snapshotUTC:
            archive.generated_at,

          player:
            p.player ||
            athlete.player.name ||
            null,

          athleteId,

          position:
            p.position || null,

          opponentTeamId,

          market,
          group,

          isPremium:
            p.isPremium === true,

          line,

          sportsbook:
            p.bookmaker || null,

          odds: number(p.odds),

          originalSide,

          originalProjection:
            number(p.projection),

          confidence:
            number(p.confidence),

          actual,

          originalGrade: outcome,

          originalUnits: units(
            outcome,
            number(p.odds)
          ),

          generatedMs: generated
        };

        const uniqueKey = [
          rec.gameId,
          athleteId,
          market
        ].join("|");

        const previous =
          latest.get(uniqueKey);

        if (
          !previous ||
          rec.generatedMs >
            previous.generatedMs ||
          (
            rec.generatedMs ===
              previous.generatedMs &&
            group === "props" &&
            previous.group !== "props"
          )
        ) {
          latest.set(
            uniqueKey,
            rec
          );
        }
      }
    }

    // Orden estable para comparar
    // por páginas.
    const records = [...latest.values()]
      .sort((a, b) =>
        a.gameDate.localeCompare(
          b.gameDate
        ) ||
        a.game.localeCompare(
          b.game
        ) ||
        a.player.localeCompare(
          b.player
        ) ||
        a.market.localeCompare(
          b.market
        )
      );

    const results = records.map(
      ({ generatedMs, ...rest }) => rest
    );

    const summary = {
      ok: true,
      readOnly: true,
      season: 2026,

      archiveRows: archives.length,
      finishedESPNGames:
        boxes2026.length,

      verifiedUniqueRecommendations:
        results.length,

      excluded,

      groups: summarize(results),

      notes: [
        "Only saved pre-kickoff snapshots count.",
        "Overwritten earlier snapshots cannot be recovered.",
        "Original Confidence is unchanged.",
        "V2 uses the same original sportsbook line.",
        "Participation and sportsbook void rules require final verification."
      ]
    };

    // Resumen de toda la temporada.
    if (mode === "overview") {
      return res.status(200).json({
        ...summary,
        sample: results.slice(0, 12)
      });
    }

    // Comparación por lotes.
    const selected = results.slice(
      page * pageSize,
      (page + 1) * pageSize
    );

    const espnGsisMap =
      await nflPropEspnGsisMap();

    const comparisons = [];

    for (const record of selected) {
      comparisons.push(
        await compareV2(
          record,
          boxes,
          db,
          espnGsisMap
        )
      );
    }

    return res.status(200).json({
      ...summary,

      page,
      pageSize,

      totalPages: Math.ceil(
        results.length / pageSize
      ),

      comparisons
    });

  } catch (error) {
    console.error(
      "NFL PROPS AUDIT:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};

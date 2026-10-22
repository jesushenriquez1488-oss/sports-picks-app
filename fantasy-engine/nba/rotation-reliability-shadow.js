
"use strict";

// CashEdge NBA: Rotation Reliability SHADOW.
// No descarga estadisticas nuevas.
// No modifica formulas ni escribe en Supabase.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");
const { loadBatch } = require("./slate-history");

const REPORT_PATH = path.resolve(
  process.env.FANTASY_ROTATION_REPORT ||
  "fantasy-shadow-input/nba-77583-report.json"
);

const SLATE_PATH = path.resolve(
  process.env.FANTASY_ROTATION_SLATE ||
  "fantasy-engine/data/nba-draftkings-77583.json"
);

const SOLVER_PATH = path.resolve(
  "fantasy-engine/optimizer/recommendation_controller.py"
);

const id = x => String(x ?? "").trim();
const day = x => String(x || "").slice(0, 10);

const median = values => {
  if (!values.length) return null;

  const a = [...values].sort((x, y) => x - y);
  const h = Math.floor(a.length / 2);

  return a.length % 2
    ? a[h]
    : (a[h - 1] + a[h]) / 2;
};

const fraction = (played, total) =>
  total ? played / total : null;

const round = n =>
  n === null ? null : Math.round(n * 1000) / 1000;

// Leer exclusivamente partidos ya almacenados,
// completados y anteriores al cutoff.

async function readTeamGames(db, cutoffAt) {
  const month = Number(cutoffAt.slice(5, 7));
  const year = Number(cutoffAt.slice(0, 4));

  const season = month >= 9 ? year : year - 1;
  const rows = [];

  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await db
      .from("nba_games")
      .select(
        "game_id,game_date,home_team_id,visitor_team_id,season"
      )
      .in("season", [season - 1, season])
      .eq("stats_complete", true)
      .eq("postseason", false)
      .lt("game_date", day(cutoffAt))
      .order("game_date", { ascending: false })
      .range(offset, offset + 999);

    if (error) {
      throw new Error("nba_games: " + error.message);
    }

    rows.push(...(data || []));

    if (!data || data.length < 1000) break;

    if (offset === 9000) {
      throw new Error("nba_games pagination exceeded");
    }
  }

  if (!rows.length) {
    throw new Error(
      "No NBA completed team games before cutoff"
    );
  }

  const grouped = new Map();

  for (const g of rows) {
    if (!id(g.game_id) || !day(g.game_date)) {
      continue;
    }

    for (const team of [
      g.home_team_id,
      g.visitor_team_id
    ]) {
      const key = id(team);
      if (!key) continue;

      if (!grouped.has(key)) {
        grouped.set(key, new Map());
      }

      grouped.get(key).set(id(g.game_id), g);
    }
  }

  return grouped;
}

// Verificar la participacion sin confundir
// partidos jugados con partidos del equipo.

function rotationCheck(
  player,
  teamGamesById,
  playerHistory,
  cutoffAt
) {
  const teamId = id(player.teamId);
  const playerId = id(player.playerId);

  // No contar ausencias anteriores a su primera
  // aparicion registrada con este equipo.

  const sameTeam = playerHistory
    .filter(r =>
      id(r.player_id) === playerId &&
      id(r.team_id) === teamId
    )
    .filter(r =>
      day(r.game_date) &&
      day(r.game_date) < day(cutoffAt)
    )
    .sort((a, b) =>
      day(a.game_date).localeCompare(
        day(b.game_date)
      )
    );

  const base = {
    name: player.name,
    playerId,
    salary: player.salary,
    projectedPoints: player.projectedPoints,
    expectedMinutes: player.expectedMinutes
  };

  if (!sameTeam.length) {
    return {
      ...base,
      eligible: false,
      reason: "no_history_with_slate_team"
    };
  }

  const firstSeen = day(sameTeam[0].game_date);

  const teamGames = [
    ...(teamGamesById.get(teamId)?.values() || [])
  ]
    .filter(g => day(g.game_date) >= firstSeen)
    .sort((a, b) =>
      day(b.game_date).localeCompare(
        day(a.game_date)
      )
    )
    .slice(0, 20);

  const participated = new Map();

  for (const g of sameTeam) {
    const minutes = Number(g.minutes);

    if (
      Number.isFinite(minutes) &&
      minutes > 0
    ) {
      participated.set(
        id(g.game_id),
        minutes
      );
    }
  }

  const rates = n => {
    const selected = teamGames.slice(0, n);

    const played = selected.filter(g =>
      participated.has(id(g.game_id))
    );

    return {
      played: played.length,
      games: selected.length,
      rate: fraction(
        played.length,
        selected.length
      )
    };
  };

  const l20 = rates(20);
  const l10 = rates(10);
  const l5 = rates(5);

  const minList = teamGames
    .filter(g =>
      participated.has(id(g.game_id))
    )
    .map(g =>
      participated.get(id(g.game_id))
    )
    .slice(0, 10);

  const typicalMinutes = median(minList);
  const expectedMinutes = Number(
    player.expectedMinutes
  );

  // Los minutos deben respaldar la proyeccion.
  // No se exigen 16, 20 ni 30 a todos.

  const enoughMinutes =
    typicalMinutes !== null &&
    (
      !Number.isFinite(expectedMinutes) ||
      typicalMinutes >= Math.max(
        4.5,
        expectedMinutes * 0.55
      )
    );

  // Umbrales experimentales, no probabilidades
  // calibradas. Un DNP aislado no elimina a un
  // jugador confiable.

  const established =
    l20.games >= 10 &&
    l20.rate >= 0.80 &&
    l10.rate >= 0.70 &&
    l5.rate >= 0.60;

  const recentStable =
    l10.games >= 8 &&
    l10.rate >= 0.80 &&
    l5.rate >= 0.80;

  // Permitir un cambio de rol reciente,
  // si los cinco partidos mas cercanos
  // muestran participacion continua.

  const emergingRole =
    l10.games >= 6 &&
    l10.rate >= 0.70 &&
    l5.games === 5 &&
    l5.played === 5 &&
    typicalMinutes !== null &&
    typicalMinutes >= Math.max(
      8,
      expectedMinutes * 0.60
    );

 
  // Verificar vigencia del historial.
  // Una racha de la temporada anterior
  // no certifica la rotacion actual.

  const lastTeamGameDate = teamGames.length
    ? day(teamGames[0].game_date)
    : null;

  const cutoffDayMs = Date.parse(
    `${day(cutoffAt)}T00:00:00Z`
  );

  const lastTeamGameMs = lastTeamGameDate
    ? Date.parse(`${lastTeamGameDate}T00:00:00Z`)
    : NaN;

  const historicalOnly =
    Number.isFinite(lastTeamGameMs) &&
    cutoffDayMs - lastTeamGameMs >
      60 * 86400000;

  // Cuando el historial es antiguo,
  // necesitamos una muestra mas completa.
  // No exigimos minutos fijos ni ser titular.

  const establishedHistoricalRole =
    l20.games >= 16 &&
    l20.rate >= 0.85 &&
    l10.rate >= 0.80 &&
    l5.rate >= 0.60;

  const eligible =
    enoughMinutes &&
    (
      historicalOnly
        ? establishedHistoricalRole
        : (
            established ||
            recentStable ||
            emergingRole
          )
    );

  const reason = eligible
    ? historicalOnly
      ? "established_historical_rotation"
      : established
        ? "stable_rotation"
        : recentStable
          ? "reliable_recent_role"
          : "emerging_recent_role"
    : teamGames.length < 6
      ? "insufficient_team_games"
      : !enoughMinutes
        ? "minutes_not_supported"
        : historicalOnly
          ? "stale_or_insufficient_role_history"
          : "irregular_or_unverified_rotation";


  return {
    ...base,
  
    eligible,
    reason,
    firstSeen,
    lastTeamGameDate,
    historicalOnly,

    l20: {
      ...l20,
      rate: round(l20.rate)
    },

    l10: {
      ...l10,
      rate: round(l10.rate)
    },

    l5: {
      ...l5,
      rate: round(l5.rate)
    },

    typicalMinutes: round(typicalMinutes),

    // Una ausencia historica no demuestra
    // que el motivo fuera Coach Decision.
    dnpCoachDecisionConfirmed: false
  };
}

// Reutilizar exactamente el controlador
// CP-SAT que ya funciona en CashEdge.

function solve(report, players) {
  const games = [
    ...new Set(
      players.map(p => id(p.gameId))
    )
  ].filter(Boolean);

  const payload = {
    sport: "nba",
    platform: report.platform,

    slate: {
      id: report.slateId,
      sport: "nba",
      platform: report.platform,
      format: "classic",
      gameIds: games
    },

    players: players.map(p => ({
      playerId: id(p.playerId),
      name: p.name,
      teamId: id(p.teamId),
      gameId: id(p.gameId),
      salary: p.salary,
      positions: p.positions,
      projectedPoints: p.projectedPoints
    })),

    lineupCount: 3,
    minDifferentPlayers: 2,
    maxExposurePercent: 100,
    timeLimitSeconds: 30,
    locked: [],
    excluded: []
  };

  const result = spawnSync(
    "python",
    [SOLVER_PATH],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 90000
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
      result.stderr ||
      result.stdout
    );
  }

  return JSON.parse(result.stdout.trim());
}

async function main() {
  const url =
    process.env.FANTASY_SUPABASE_URL;

  const key =
    process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Fantasy Supabase secrets"
    );
  }

  const report = JSON.parse(
    fs.readFileSync(REPORT_PATH, "utf8")
  );

  const slate = JSON.parse(
    fs.readFileSync(SLATE_PATH, "utf8")
  );

  if (
    report.mode !== "shadow" ||
    report.sport !== "nba" ||
    !["draftkings", "fanduel"].includes(
      report.platform
    ) ||
    report.platform !== slate.platform ||
    id(report.slateId) !== id(slate.slateId) ||
    !Array.isArray(report.players) ||
    !report.players.length ||
    report.readyForPublication !== false ||
    report.cutoffAt !== slate.capturedAt ||
    Date.parse(report.cutoffAt) >=
      Date.parse(slate.startsAt)
  ) {
    throw new Error(
      "Report/slate integrity or historical cutoff failed"
    );
  }

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const ryan = slate.players.find(
    p => p.name === "Cormac Ryan"
  );

  const ids = [
    ...new Set([
      ...report.players.map(
        p => id(p.playerId)
      ),
      id(ryan?.playerId)
    ])
  ]
    .filter(Boolean)
    .map(Number);

  const [histories, teams] = await Promise.all([
    loadBatch(
      db,
      ids,
      report.cutoffAt
    ),

    readTeamGames(
      db,
      report.cutoffAt
    )
  ]);

  const byId = new Map();

  for (const row of histories) {
    const key = id(row.player_id);

    if (!byId.has(key)) {
      byId.set(key, []);
    }

    byId.get(key).push(row);
  }

  const checks = report.players.map(p =>
    rotationCheck(
      p,
      teams,
      byId.get(id(p.playerId)) || [],
      report.cutoffAt
    )
  );

  const reasons = {};

  for (const row of checks) {
    reasons[row.reason] =
      (reasons[row.reason] || 0) + 1;
  }

   // FANTASY NBA SHADOW
  // Excluir salarios de $3,000 a $3,500 inclusive.
  // Sin limitar superestrellas ni imponer filtros
  // adicionales de rotacion.

  const MIN_SALARY_EXCLUSIVE = 3500;

  const accepted = report.players.filter(p => {
    const salary = Number(p.salary);

    return (
      Number.isFinite(salary) &&
      salary > MIN_SALARY_EXCLUSIVE
    );
  });
  console.log(
    "===== NBA ROTATION RELIABILITY SHADOW ====="
  );

  console.log("Cutoff:", report.cutoffAt);
  console.log("No post-cutoff games used");

  console.log(
    "Existing NBA projections:",
    report.players.length
  );

  console.log(
    "Eligible by salary:",
    accepted.length
  );

  console.log(
    "Excluded by salary:",
    checks.length - accepted.length
  );

  console.log(
    "Reasons:",
    JSON.stringify(reasons)
  );

  // Verificar el caso que origino el cambio:
  // Cormac Ryan, ANTES de conocer su DNP.

  if (ryan) {
    const audit = checks.find(
      p => p.playerId === id(ryan.playerId)
    ) || rotationCheck(
      ryan,
      teams,
      byId.get(id(ryan.playerId)) || [],
      report.cutoffAt
    );

    console.log(
      "CORMAC RYAN PRE-GAME AUDIT:",
      JSON.stringify(audit)
    );
  }

  // AUDITORIA JERICHO SIMS — SOLO DIAGNOSTICO
  const simsAudit = checks.find(p =>
    /jericho\s+sims/i.test(String(p.name || ""))
  );

  console.log(
    "===== JERICHO SIMS PRE-GAME AUDIT ====="
  );

  if (simsAudit) {
    console.log(
      JSON.stringify(simsAudit, null, 2)
    );
  } else {
    console.log(
      "Jericho Sims no aparece en las proyecciones del reporte"
    );
  }

    // AUDITORIA NBA: JUGADORES NO SELECCIONADOS
  // Usa exclusivamente las proyecciones originales.
  // No recalcula ni modifica ningun jugador.

  const auditTargets = [
    { name: "Anthony Edwards", real: 72.00 },
    { name: "Ty Jerome", real: 66.75 },
    { name: "Anthony Davis", real: 61.50 },
    { name: "Paolo Banchero", real: 60.75 },
    { name: "Julius Randle", real: 55.00 },
    { name: "Yves Missi", real: 49.00 },
    { name: "Cooper Flagg", real: 47.75 },
    { name: "Naz Reid", real: 47.25 },
    { name: "Jalen Johnson", real: 47.00 },
    { name: "Tyrese Haliburton", real: 46.50 },
    { name: "Dejounte Murray", real: 46.25 },
    { name: "Nickeil Alexander-Walker", real: 46.00 },
    { name: "Kevin Durant", real: 45.00 }
  ];

  const normalizeName = value =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();

  const acceptedIds = new Set(
    accepted.map(p => id(p.playerId))
  );

  console.log(
    "===== NBA MISSED PLAYERS AUDIT ====="
  );

  console.log("Cutoff:", report.cutoffAt);
  console.log("Real points: user-reported");

  for (const target of auditTargets) {
    const matches = report.players.filter(
      p =>
        normalizeName(p.name) ===
        normalizeName(target.name)
    );

    if (matches.length !== 1) {
      console.log(
        JSON.stringify({
          name: target.name,
          realPoints: target.real,
          status: matches.length === 0
            ? "NOT_FOUND_IN_REPORT"
            : "AMBIGUOUS_NAME",
          matches: matches.length
        })
      );
      continue;
    }

    const p = matches[0];

    const projected = Number(p.projectedPoints);
    const real = Number(target.real);

    const rotation = checks.find(
      r => r.playerId === id(p.playerId)
    );

    console.log(
      JSON.stringify({
        name: p.name,
        playerId: id(p.playerId),
        salary: p.salary,
        positions: p.positions,
        projectedPoints: p.projectedPoints,
        realPoints: real,
        difference: Number.isFinite(projected)
          ? Number((real - projected).toFixed(2))
          : null,
        expectedMinutes: p.expectedMinutes ?? null,
        eligibleBySalary: acceptedIds.has(
          id(p.playerId)
        ),
        rotationReason: rotation?.reason ?? null,
        historicalOnly: rotation?.historicalOnly ?? null,
        typicalHistoricalMinutes:
          rotation?.typicalMinutes ?? null
      })
    );
  }

  console.log(
    "===== END MISSED PLAYERS AUDIT ====="
  );

  // Misma proyeccion, dos grupos distintos.
  // Nunca alterar salarios ni puntos.

  const oldLineup = solve(
    report,
    report.players
  );

  const newLineup = solve(
    report,
    accepted
  );

  for (const [name, result] of [
    ["ORIGINAL", oldLineup],
       ["SALARY FILTERED", newLineup]
  ]) {
    console.log(
      `===== ${name} OPTIMIZATION =====`
    );

    console.log(
      "Status:",
      result.status,
      "Main optimal:",
      result.mainOptimalityGuaranteed,
      "Generated:",
      result.generatedLineups || 0
    );

    if (result.recommended) {
      console.log(
        "Projected points:",
        result.recommended.projectedPoints,
        "Salary:",
        result.recommended.salary
      );

      for (const p of result.recommended.players) {
        console.log(
          `${p.slot}: ${p.name} | ` +
          `$${p.salary} | ` +
          `${p.projectedPoints} pts`
        );
      }
    } else {
      console.log(
        "Reason:",
        result.reason ||
        result.mainSolverStatus
      );
    }
  }

  console.log(
    "SHADOW ONLY | NO WRITES | NOT READY FOR PUBLICATION"
  );

  if (
    newLineup.mainOptimalityGuaranteed !== true
  ) {
    throw new Error(
      "Filtered optimal lineup not certified; do not publish"
    );
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}

module.exports = { rotationCheck };

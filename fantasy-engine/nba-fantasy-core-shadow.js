
"use strict";

// CashEdge Fantasy NBA Core V1
// SHADOW ONLY - sin escrituras en produccion.
// Sin salarios, lesiones ni defensas inventadas.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("fantasy-shadow-input");

const FILES = {
  rotation: "nba-rotation-context.json",
  history: "nba-fantasy-history.json",
  minutes: "nba-role-minutes-shadow.json",
  slate: "nba-dfs-slate.json"
};

const SIMS = 10000;

// Prohibicion absoluta:
// $3,000, $3,500 y cualquier salario inferior.
const MIN_SALARY = 3501;

const DAY_MS = 86400000;

const STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "threePointersMade"
];

const STAT_CAPS = {
  points: 75,
  rebounds: 35,
  assists: 30,
  steals: 12,
  blocks: 12,
  turnovers: 15,
  threePointersMade: 18
};

const round = n => Math.round(n * 100) / 100;
const ident = x => String(x ?? "").trim();

const numeric = x =>
  x === null || x === undefined || x === ""
    ? NaN
    : Number(x);

const valid = n => Number.isFinite(n);

function read(name, required = true) {
  const file = path.join(ROOT, name);

  if (!fs.existsSync(file)) {
    if (!required) return null;

    throw Error(`Missing input: ${file}`);
  }

  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function assert(condition, message) {
  if (!condition) throw Error(message);
}

function mean(values) {
  return values.reduce(
    (total, n) => total + n,
    0
  ) / values.length;
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null;

  const index = Math.floor(
    (sorted.length - 1) * fraction
  );

  return sorted[index];
}

// Generador reproducible.
// Permite comparar cambios sin variar
// aleatoriamente los resultados cada vez.

function hash(value) {
  let h = 2166136261;

  for (const character of value) {
    h ^= character.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function rng(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;

    let x = state;

    x = Math.imul(
      x ^ (x >>> 15),
      x | 1
    );

    x ^= x + Math.imul(
      x ^ (x >>> 7),
      x | 61
    );

    return (
      (x ^ (x >>> 14)) >>> 0
    ) / 4294967296;
  };
}

function normal(random) {
  const a = Math.max(random(), 1e-12);
  const b = random();

  return Math.sqrt(
    -2 * Math.log(a)
  ) * Math.cos(2 * Math.PI * b);
}

// DraftKings NBA Classic

function scoreDK(stats) {
  const categoriesAbove10 = [
    stats.points,
    stats.rebounds,
    stats.assists,
    stats.steals,
    stats.blocks
  ].filter(value => value >= 10).length;

  const doubleDouble =
    categoriesAbove10 >= 2 ? 1.5 : 0;

  const tripleDouble =
    categoriesAbove10 >= 3 ? 3 : 0;

  return (
    stats.points +
    1.25 * stats.rebounds +
    1.5 * stats.assists +
    2 * stats.steals +
    2 * stats.blocks -
    0.5 * stats.turnovers +
    0.5 * stats.threePointersMade +
    doubleDouble +
    tripleDouble
  );
}

// FanDuel NBA Classic

function scoreFD(stats) {
  return (
    stats.points +
    1.2 * stats.rebounds +
    1.5 * stats.assists +
    3 * stats.steals +
    3 * stats.blocks -
    stats.turnovers
  );
}

// Partidos anteriores a la fecha de corte.
// Filtra registros incompletos y minutos
// incompatibles con una participacion real.

function extractGames(history, cutoffMs) {
  return (
    history.historicalGames || []
  ).filter(game => {
    const time = Date.parse(game.gameDate);
    const minutes = numeric(game.minutes);

    return (
      valid(time) &&
      time < cutoffMs &&
      valid(minutes) &&
      minutes >= 8 &&
      minutes <= 55 &&
      STATS.every(key =>
        valid(numeric(game[key])) &&
        numeric(game[key]) >= 0
      )
    );
  }).sort(
    (a, b) =>
      Date.parse(b.gameDate) -
      Date.parse(a.gameDate)
  );
}

// FILTRO PRINCIPAL
// Primero participacion.
// Despues proyeccion.
// El salario se verifica aparte.

function selection(
  rotation,
  history,
  minutesReport,
  cutoffMs
) {
  const ranks = (
    rotation.positions || []
  )
    .map(position =>
      Number(position.depthRank)
    )
    .filter(rank =>
      Number.isInteger(rank) &&
      rank >= 1
    );

  const rank = ranks.length
    ? Math.min(...ranks)
    : null;

  const reasons = [];

  const candidateId = ident(
    rotation.nbaPlayerId ||
    rotation.candidateNbaPlayerId
  );

  const identityValid = Boolean(
    candidateId &&
    candidateId === ident(
      history?.nbaPlayerId
    ) &&
    [
      "STRONG_CANDIDATE",
      "ALREADY_VERIFIED"
    ].includes(rotation.identityStatus) &&
    history?.shadowEligible === true
  );

  const teamValid = Boolean(
    history &&
    ident(rotation.nbaTeamId) &&
    ident(rotation.nbaTeamId) ===
      ident(history.expectedCurrentTeamId)
  );

  if (!identityValid) {
    reasons.push(
      "NO_USABLE_PLAYER_ID_SHADOW"
    );
  }

  if (!teamValid) {
    reasons.push("TEAM_NOT_MATCHED");
  }

  if (rank === null || rank > 3) {
    reasons.push("NOT_CORE_ROTATION");
  }

  const games = history
    ? extractGames(history, cutoffMs)
    : [];

  const recentCutoff =
    cutoffMs - 240 * DAY_MS;

  const recent = games.filter(
    game =>
      Date.parse(game.gameDate) >=
      recentCutoff
  );

  const sameTeam = recent.filter(
    game =>
      ident(game.teamId) ===
      ident(rotation.nbaTeamId)
  );

  const current = sameTeam.filter(
    game => Number(game.season) === 2026
  );

  const sameTeamSample =
    sameTeam.slice(0, 12);

  const crossTeamSample =
    recent.slice(0, 12);

  // Para titulares que cambiaron de equipo,
  // permite historial anterior solo cuando
  // existe evidencia actual en el nuevo equipo.

  const usable =
    sameTeam.length >= 8
      ? sameTeamSample
      : rank === 1 &&
        current.length >= 1 &&
        crossTeamSample.length >= 10
        ? crossTeamSample
        : sameTeamSample;

  const avg = usable.length
    ? mean(
        usable.map(
          game => Number(game.minutes)
        )
      )
    : 0;

  const solidGames = usable.filter(
    game =>
      Number(game.minutes) >= (
        rank === 1 ? 20 : 16
      )
  ).length;

  if (usable.length < 8) {
    reasons.push(
      "INSUFFICIENT_RECENT_PLAYING_SAMPLE"
    );
  }

  if (
    rank === 1 &&
    (avg < 18 || solidGames < 6)
  ) {
    reasons.push(
      "STARTER_ROLE_NOT_SUPPORTED_BY_MINUTES"
    );
  }

  if (
    rank === 2 &&
    (avg < 15 || solidGames < 6)
  ) {
    reasons.push(
      "SECOND_UNIT_NOT_REGULAR"
    );
  }

  if (
    rank === 3 &&
    (
      avg < 20 ||
      solidGames < 8 ||
      (
        current.length < 3 &&
        sameTeam.length < 12
      )
    )
  ) {
    reasons.push(
      "THIRD_UNIT_NOT_ESTABLISHED"
    );
  }

  const roleMinutes = numeric(
    minutesReport?.estimatedMinutes
  );

  if (
    !valid(roleMinutes) ||
    roleMinutes <= 0
  ) {
    reasons.push(
      "NO_ROLE_MINUTES_ESTIMATE"
    );
  }

  if (
    minutesReport?.depthRank !== rank
  ) {
    reasons.push(
      "DEPTH_RANK_MISMATCH"
    );
  }

  if (
    minutesReport &&
    ident(minutesReport.nbaPlayerId) !==
      ident(history?.nbaPlayerId)
  ) {
    reasons.push(
      "MINUTES_ID_MISMATCH"
    );
  }

  const projectedMinutes =
    valid(roleMinutes)
      ? round(
          Math.min(
            42,
            Math.max(
              0,
              0.75 * roleMinutes +
              0.25 * avg
            )
          )
        )
      : null;

  const minimumMinutes =
    rank === 1 ? 18 :
    rank === 2 ? 15 : 20;

  if (
    projectedMinutes !== null &&
    projectedMinutes < minimumMinutes
  ) {
    reasons.push(
      "PROJECTED_MINUTES_TOO_LOW"
    );
  }

  return {
    espnPlayerId: ident(
      rotation.espnPlayerId
    ),

    nbaPlayerId: identityValid
      ? candidateId
      : null,

    player: rotation.espnName,
    team: rotation.team,
    teamId: ident(rotation.nbaTeamId),

    rank,

    group:
      rank === 1
        ? "STARTER_PRIORITY"
        : rank === 2
          ? "STRONG_RESERVE"
          : rank === 3
            ? "CONDITIONAL_THIRD"
            : "OUT_OF_POOL",

    identity: rotation.identityStatus,

    sampleGames: usable.length,
    currentTeam2026Games: current.length,

    observedMinutes: round(avg),
    expectedMinutes: projectedMinutes,

    historicalTeamMix: usable.some(
      game =>
        ident(game.teamId) !==
        ident(rotation.nbaTeamId)
    ),

    poolEligible: reasons.length === 0,

    reasons,

    // No se autoriza una alineacion
    // hasta comprobar el slate real.

    slateEligible: false,
    salary: null,
    availability: "UNCONFIRMED",
    dfsProvider: null,

    readyForPublication: false,

    _games: usable
  };
}

// 10,000 SIMULACIONES POR JUGADOR
//
// Se seleccionan partidos historicos completos
// para conservar las relaciones entre sus
// estadisticas dentro de cada partido.
//
// V1: no incluye aun lesiones, rival ni
// correlaciones entre distintos jugadores.

function simulations(player, targetDate) {
  const random = rng(
    hash(
      player.espnPlayerId +
      ":" +
      targetDate
    )
  );

  const samples = player._games;

  const dk = [];
  const fd = [];
  const minutes = [];

  const expectedMinutes =
    player.expectedMinutes;

  for (let n = 0; n < SIMS; n++) {
    const sample = samples[
      Math.floor(
        random() * samples.length
      )
    ];

    const simulatedMinutes = Math.min(
      46,
      Math.max(
        8,
        0.8 * expectedMinutes +
        0.2 * Number(sample.minutes) +
        normal(random) * 2.4
      )
    );

    const factor =
      simulatedMinutes /
      Number(sample.minutes);

    const stats = {};

    for (const key of STATS) {
      stats[key] = Math.min(
        STAT_CAPS[key],
        Math.max(
          0,
          Math.round(
            Number(sample[key]) * factor
          )
        )
      );
    }

    // Un triple convertido no puede
    // superar los puntos disponibles.

    stats.threePointersMade = Math.min(
      stats.threePointersMade,
      Math.floor(stats.points / 3)
    );

    dk.push(scoreDK(stats));
    fd.push(scoreFD(stats));

    minutes.push(simulatedMinutes);
  }

  dk.sort((a, b) => a - b);
  fd.sort((a, b) => a - b);

  return {
    simulations: SIMS,

    method:
      "JOINT_GAME_BOOTSTRAP_ROLE_MINUTES_V1",

    estimatedMinutes: round(
      mean(minutes)
    ),

    draftkings: {
      mean: round(mean(dk)),
      p10: round(quantile(dk, 0.10)),
      p50: round(quantile(dk, 0.50)),
      p90: round(quantile(dk, 0.90))
    },

    fanduel: {
      mean: round(mean(fd)),
      p10: round(quantile(fd, 0.10)),
      p50: round(quantile(fd, 0.50)),
      p90: round(quantile(fd, 0.90))
    }
  };
}

function main() {
  const rotation = read(FILES.rotation);
  const history = read(FILES.history);
  const role = read(FILES.minutes);

  // Opcional, solo cuando conectemos
  // salarios reales del proveedor.
  const slate = read(FILES.slate, false);

  assert(
    rotation.mode === "shadow" &&
    history.mode === "shadow" &&
    role.mode === "shadow",
    "SHADOW inputs only"
  );

  assert(
    Array.isArray(rotation.players) &&
    Array.isArray(history.players) &&
    Array.isArray(role.players),
    "Invalid player arrays"
  );

  assert(
    history.asOfDate === role.cutoffDay &&
    role.targetDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      role.targetDate
    ),
    "Snapshot/cutoff mismatch"
  );

  const cutoffMs = Date.parse(
    history.asOfDate + "T00:00:00Z"
  );

  const targetMs = Date.parse(
    role.targetDate + "T00:00:00Z"
  );

  assert(
    valid(cutoffMs) &&
    targetMs > cutoffMs,
    "Invalid target/cutoff ordering"
  );

  assert(
    Date.parse(rotation.sourceReportAt) <
      targetMs,
    "Depth chart must predate target"
  );

  const key = player =>
    ident(player.espnPlayerId);

  function uniqueMap(array, label) {
    const map = new Map();

    for (const player of array) {
      const playerKey = key(player);

      assert(
        playerKey &&
        !map.has(playerKey),
        `Duplicate ${label}: ${playerKey}`
      );

      map.set(playerKey, player);
    }

    return map;
  }

  const histories = uniqueMap(
    history.players,
    "history"
  );

  const minutes = uniqueMap(
    role.players,
    "role minutes"
  );

  let salaryMap = new Map();

  if (slate !== null) {
    assert(
      slate.mode === "shadow" &&
      ["draftkings", "fanduel"].includes(
        slate.provider
      ),
      "Unsupported slate provider/mode"
    );

    assert(
      slate.targetDate === role.targetDate &&
      Array.isArray(slate.players),
      "Slate date or players invalid"
    );

    salaryMap = uniqueMap(
      slate.players,
      "DFS salary"
    );
  }

  const players = rotation.players.map(
    rotationPlayer => {
      const playerKey = key(rotationPlayer);

      const player = selection(
        rotationPlayer,
        histories.get(playerKey),
        minutes.get(playerKey),
        cutoffMs
      );

      const offer = salaryMap.get(playerKey);

      if (offer) {
        const salary = numeric(
          offer.salary
        );

        player.salary = valid(salary)
          ? salary
          : null;

        player.availability =
          offer.availability ||
          "UNCONFIRMED";

        player.dfsProvider =
          slate.provider;

        // PROHIBICION DE SALARIO.
        // No puede ser anulada por
        // una buena proyeccion.

        if (
          !valid(salary) ||
          salary < MIN_SALARY
        ) {
          player.reasons.push(
            "SALARY_3500_OR_LESS_BANNED"
          );
        }

        if (
          player.availability !==
          "CONFIRMED_ACTIVE"
        ) {
          player.reasons.push(
            "NO_CONFIRMED_GAME_DAY_AVAILABILITY"
          );
        }

        if (!player.poolEligible) {
          player.reasons.push(
            "NOT_IN_RELIABLE_ROTATION"
          );
        }

        player.slateEligible =
          player.reasons.length === 0;
      }

      // Las simulaciones solo se ejecutan
      // para los jugadores confiables.
      // Aun no son recomendaciones.

      player.projection =
        player.poolEligible
          ? simulations(
              player,
              role.targetDate
            )
          : null;

      delete player._games;

      return player;
    }
  );

  const pool = players.filter(
    player => player.poolEligible
  );

  const slateEligible = players.filter(
    player => player.slateEligible
  );

  const countByDepth = list =>
    Object.fromEntries(
      [...new Set(
        list.map(player => player.rank)
      )]
        .sort((a, b) => a - b)
        .map(rank => [
          rank,
          list.filter(
            player => player.rank === rank
          ).length
        ])
    );

  const starterGaps = players
    .filter(
      player =>
        player.rank === 1 &&
        !player.poolEligible
    )
    .map(player => ({
      player: player.player,
      team: player.team,
      reasons: player.reasons
    }));

  const output = {
    module: "fantasy_nba",
    mode: "shadow",

    version: "nba-fantasy-core-v1",

    targetDate: role.targetDate,

    generatedAt:
      new Date().toISOString(),

    safety: {
      hardSalaryBanAtOrBelow: 3500,
      noDatabaseWrites: true,
      productionUnchanged: true,
      noGuessedSalary: true,
      noGuessedInjuries: true
    },

    summary: {
      depthChartPlayers:
        players.length,

      firstListed: players.filter(
        p => p.rank === 1
      ).length,

      secondListed: players.filter(
        p => p.rank === 2
      ).length,

      thirdListed: players.filter(
        p => p.rank === 3
      ).length,

      reliablePool: pool.length,

      poolByDepth:
        countByDepth(pool),

      excludedFromPool:
        players.length - pool.length,

      missingFirstListed:
        starterGaps.length,

      salarySlateConnected:
        Boolean(slate),

      slateEligible:
        slateEligible.length,

      salaryBanHits: players.filter(
        p => p.reasons.includes(
          "SALARY_3500_OR_LESS_BANNED"
        )
      ).length,

      simulationsPerPoolPlayer: SIMS
    },

    priorityStarterGaps:
      starterGaps,

    pendingForFullEngine: [
      "Verified pregame injuries and availability",
      "Real DraftKings/FanDuel salary slates",
      "Opponent defense and injury on/off data",
      "Correlated team-level minute allocation",
      "Legal lineup optimization by provider",
      "Prospective backtesting and calibration"
    ],

    readyForLineups: false,
    readyForPublication: false,

    players
  };

  fs.mkdirSync(ROOT, {
    recursive: true
  });

  const destination = path.join(
    ROOT,
    "nba-fantasy-core-shadow.json"
  );

  fs.writeFileSync(
    destination,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "===== CASHEDGE FANTASY NBA CORE V1 ====="
  );

  console.log(
    JSON.stringify(
      output.summary,
      null,
      2
    )
  );

  console.log(
    "SAMPLE:",
    JSON.stringify(
      pool.slice(0, 4).map(p => ({
        player: p.player,
        rank: p.rank,
        minutes: p.expectedMinutes,
        DK: p.projection.draftkings.mean
      })),
      null,
      2
    )
  );

  console.log(
    "OUT:",
    destination
  );

  console.log(
    "SHADOW ONLY | NO LINEUPS | NO PRODUCTION WRITES"
  );
}

main();


"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATE = process.env.FANTASY_TARGET_DATE || "2026-10-22";
const KEY = process.env.BALLDONTLIE_NBA_API_KEY;

const SOURCE =
  "fantasy-slate-data/nba-draftkings-context-shadow.json";

const DEST =
  "fantasy-slate-data/nba-draftkings-advanced-shadow.json";

const N = 10000;
const seasons = [2025, 2026];

const STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "threePointersMade"
];

const num = x =>
  x === null || x === undefined || x === ""
    ? NaN
    : Number(x);

const ok = Number.isFinite;
const str = x => String(x ?? "").trim();

const avg = a =>
  a.length
    ? a.reduce((p, c) => p + c, 0) / a.length
    : null;

const round = x => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) =>
  Math.min(hi, Math.max(lo, x));

function assert(x, msg) {
  if (!x) throw Error(msg);
}

function minutes(x) {
  if (
    typeof x === "string" &&
    /^\d+:\d\d$/.test(x)
  ) {
    const [m, s] = x.split(":").map(Number);
    return m + s / 60;
  }

  return num(x);
}

function seedFrom(x) {
  let h = 2166136261;

  for (const c of String(x)) {
    h = Math.imul(
      h ^ c.charCodeAt(0),
      16777619
    );
  }

  return h >>> 0;
}

function rng(seed) {
  let state = seed;

  return () => {
    state += 0x6D2B79F5;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return (
      (t ^ (t >>> 14)) >>> 0
    ) / 4294967296;
  };
}

async function get(route, query = {}) {
  assert(
    KEY,
    "Falta BALLDONTLIE_NBA_API_KEY"
  );

  const u = new URL(
    "https://api.balldontlie.io" + route
  );

  for (const [k, v] of Object.entries(query)) {
    for (
      const value of Array.isArray(v)
        ? v
        : [v]
    ) {
      if (value !== null && value !== undefined) {
        u.searchParams.append(
          k + (Array.isArray(v) ? "[]" : ""),
          String(value)
        );
      }
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(u, {
      headers: {
        Authorization: KEY
      }
    });

    if (res.ok) return res.json();

    const body = (
      await res.text()
    ).slice(0, 160);

    if (
      ![429, 500, 502, 503, 504].includes(
        res.status
      )
    ) {
      throw Error(
        `${route} HTTP ${res.status}: ${body}`
      );
    }

    await new Promise(r =>
      setTimeout(
        r,
        1800 * (attempt + 1)
      )
    );
  }

  throw Error(
    "Agotados reintentos: " + route
  );
}

async function pages(route, query = {}) {
  let cursor = null;
  const out = [];
  const seen = new Set();

  for (let i = 0; i < 100; i++) {
    const r = await get(route, {
      ...query,
      per_page: 100,
      ...(cursor ? { cursor } : {})
    });

    assert(
      Array.isArray(r.data),
      "Formato inesperado: " + route
    );

    out.push(...r.data);

    const next = r.meta?.next_cursor;

    if (!next) return out;

    assert(
      !seen.has(String(next)),
      "Cursor repetido: " + route
    );

    cursor = next;
    seen.add(String(next));
  }

  throw Error(
    "Paginación incompleta: " + route
  );
}

function normal(raw) {
  const date = str(
    raw.game?.date
  ).slice(0, 10);

  const min = minutes(raw.min);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date >= DATE ||
    !(min > 0 && min <= 60) ||
    raw.game?.postseason === true
  ) {
    return null;
  }

  const map = {
    points: raw.pts,
    rebounds: raw.reb,
    assists: raw.ast,
    steals: raw.stl,
    blocks: raw.blk,
    turnovers: raw.turnover,
    threePointersMade: raw.fg3m
  };

  const stats = {};

  for (const [k, v] of Object.entries(map)) {
    const n = num(v);

    if (!ok(n) || n < 0) return null;

    stats[k] = n;
  }

  return {
    date,
    min,
    team: str(raw.team?.id),
    playerId: str(raw.player?.id),
    position: str(raw.player?.position),
    gameId: str(raw.game?.id),
    season: Number(raw.game?.season),
    stats
  };
}

function group(position) {
  const s = str(position).toUpperCase();

  if (
    s === "C" ||
    s.includes("CENTER")
  ) return "C";

  if (
    s.includes("G") ||
    s === "PG" ||
    s === "SG"
  ) return "G";

  if (
    s.includes("F") ||
    s === "SF" ||
    s === "PF"
  ) return "F";

  return null;
}

function playerGroup(positions) {
  const set = new Set(
    (positions || []).flatMap(
      v => str(v)
        .toUpperCase()
        .split(/[^A-Z]+/)
    )
  );

  if (set.has("C")) return "C";

  if (
    set.has("PF") ||
    set.has("SF")
  ) return "F";

  if (
    set.has("SG") ||
    set.has("PG")
  ) return "G";

  return null;
}

function profile(row) {
  const s = row?.stats || {};
  const m = minutes(
    s.min ?? s.minutes
  );

  if (!(m >= 14)) return null;

  const p = {
    min: m,
    group: group(
      row.player?.position
    ),
    name: [
      row.player?.first_name,
      row.player?.last_name
    ].filter(Boolean).join(" ")
  };

  const keys = {
    points: "pts",
    rebounds: "reb",
    assists: "ast",
    steals: "stl",
    blocks: "blk",
    turnovers: "tov",
    threePointersMade: "fg3m"
  };

  for (
    const [name, api]
    of Object.entries(keys)
  ) {
    const v = num(s[api]);

    p[name] = ok(v) && v >= 0
      ? v * 36 / m
      : null;
  }

  return [
    p.points,
    p.rebounds,
    p.assists
  ].every(ok)
    ? p
    : null;
}

function similarity(a, b) {
  if (
    !a ||
    !b ||
    a.group !== b.group
  ) return 0;

  const weights = {
    points: 0.4,
    rebounds: 0.3,
    assists: 0.3
  };

  let dist = 0;

  for (
    const [k, w]
    of Object.entries(weights)
  ) {
    dist += w * Math.abs(
      Math.log(
        (a[k] + 3) / (b[k] + 3)
      )
    );
  }

  return Math.exp(
    -2.3 * dist
  );
}

function score(stats) {
  const double = [
    stats.points,
    stats.rebounds,
    stats.assists,
    stats.steals,
    stats.blocks
  ].filter(v => v >= 10).length;

  return (
    stats.points +
    1.25 * stats.rebounds +
    1.5 * stats.assists +
    2 * stats.steals +
    2 * stats.blocks -
    0.5 * stats.turnovers +
    0.5 * stats.threePointersMade +
    (double >= 2 ? 1.5 : 0) +
    (double >= 3 ? 3 : 0)
  );
}

function defensiveEvidence({
  target,
  samples,
  profiles,
  baseDefense
}) {
  const targetProfile = profiles.get(
    str(target.playerId)
  );

  const groupNeeded = playerGroup(
    target.positions
  );

  const neutralFactors = () =>
    Object.fromEntries(
      STATS.map(k => [k, 1])
    );

  if (
    !targetProfile ||
    !groupNeeded
  ) {
    return {
      applied: false,
      reason: "SIN_PERFIL_COMPARABLE",
      examples: [],
      factors: neutralFactors()
    };
  }

  targetProfile.group = groupNeeded;

  const matching = [];

  for (const game of samples) {
    const other = profiles.get(
      game.playerId
    );

    const sim = similarity(
      targetProfile,
      other
    );

    if (
      game.playerId === str(target.playerId) ||
      sim < 0.64 ||
      !(game.min >= 14)
    ) continue;

    matching.push({
      game,
      other,
      sim
    });
  }

  const uniq = new Set(
    matching.map(
      m => m.game.playerId
    )
  ).size;

  const factors = {};

  for (const stat of STATS) {
    let weighted = 0;
    let total = 0;
    let count = 0;

    for (const m of matching) {
      const seasonPer36 =
        m.other[stat];

      if (
        !(seasonPer36 >= (
          stat === "points"
            ? 4
            : 0.35
        ))
      ) continue;

      const observed =
        m.game.stats[stat] *
        36 / m.game.min;

      const ratio = clamp(
        observed / seasonPer36,
        0.35,
        2.8
      );

      weighted += ratio * m.sim;
      total += m.sim;
      count++;
    }

    const enough =
      matching.length >= 6 &&
      uniq >= 4 &&
      count >= 6;

    if (!enough) {
      factors[stat] = 1;
      continue;
    }

    const observedRatio =
      weighted / total;

    // Defensa general incluida en A.
    // Evitamos contarla dos veces.
    const residual =
      stat === "points"
        ? observedRatio / baseDefense
        : observedRatio;

    // Peso experimental conservador.
    const confidence = Math.min(
      0.42,
      count / (count + 15)
    );

    const shrink =
      1 +
      (residual - 1) *
      confidence;

    factors[stat] = clamp(
      shrink,
      0.87,
      1.13
    );
  }

  const examples = [
    ...new Map(
      matching.map(x => [
        x.game.playerId,
        {
          playerId: x.game.playerId,
          name: x.other.name,
          similarity: round(x.sim)
        }
      ])
    ).values()
  ]
    .sort(
      (a, b) =>
        b.similarity - a.similarity
    )
    .slice(0, 6);

  const applied =
    matching.length >= 6 &&
    uniq >= 4;

  return {
    applied,
    matchedGames: matching.length,
    distinctPlayers: uniq,
    examples,
    factors,
    reason: applied
      ? "PERFIL_Y_PARTIDOS_REALES"
      : "MUESTRA_INSUFICIENTE"
  };
}

function simulateB(
  p,
  historical,
  evidence
) {
  const random = rng(
    seedFrom(
      `${DATE}:B:${p.playerId}`
    )
  );

  const impact =
    p.teammateImpact?.adjustments || {};

  const baselineMinutes =
    num(p.expectedMinutes);

  assert(
    ok(baselineMinutes) &&
    baselineMinutes > 0,
    "Minutos inválidos " + p.name
  );

  const weights = historical.map(g => {
    const recency =
      g.season === 2026
        ? 2.5
        : 1;

    const sameTeam =
      g.team === str(p.teamId)
        ? 1.45
        : 0.75;

    return recency * sameTeam;
  });

  const cum = [];
  let sum = 0;

  for (const w of weights) {
    sum += w;
    cum.push(sum);
  }

  const pace = num(
    p.simulation?.paceFactor
  );

  const defense = num(
    p.simulation?.defenseFactor
  );

  assert(
    ok(pace) && pace > 0 &&
    ok(defense) && defense > 0,
    "Faltan ajustes para " + p.name
  );

  const outcomes = [];

  for (let i = 0; i < N; i++) {
    const selector = random() * sum;

    let low = 0;
    let hi = cum.length - 1;

    while (low < hi) {
      const mid =
        (low + hi) >>> 1;

      if (
        cum[mid] < selector
      ) {
        low = mid + 1;
      } else {
        hi = mid;
      }
    }

    const h = historical[low];

    const scale =
      baselineMinutes /
      h.min *
      pace;

    const stat = {};

    for (const k of STATS) {
      let value =
        h.stats[k] * scale;

      if (k === "points") {
        value *= defense;
      }

      value *= (
        evidence.factors[k] ?? 1
      );

      if (
        [
          "points",
          "rebounds",
          "assists"
        ].includes(k)
      ) {
        value += (
          num(impact[k]) || 0
        );
      }

      stat[k] = Math.max(
        0,
        Math.round(value)
      );
    }

    stat.threePointersMade = Math.min(
      stat.threePointersMade,
      Math.floor(
        stat.points / 3
      )
    );

    outcomes.push(
      score(stat)
    );
  }

  outcomes.sort(
    (a, b) => a - b
  );

  return {
    projectedPoints: round(
      avg(outcomes)
    ),
    p10: round(outcomes[999]),
    p50: round(outcomes[4999]),
    p90: round(outcomes[8999]),
    simulations: N
  };
}

async function main() {
  assert(
    KEY,
    "Falta BALLDONTLIE_NBA_API_KEY"
  );

  assert(
    fs.existsSync(SOURCE),
    "No existe reporte contextual original"
  );

  assert(
    !fs.existsSync(DEST),
    "La muestra B ya existe; no sobrescribir"
  );

  const baseline = JSON.parse(
    fs.readFileSync(
      SOURCE,
      "utf8"
    )
  );

  assert(
    baseline.mode === "shadow" &&
    baseline.date === DATE &&
    baseline.platform === "draftkings",
    "Fecha o slate incorrectos"
  );

  assert(
    (baseline.players || []).length > 0,
    "Sin jugadores para evaluar"
  );

  const profiles = new Map();

  const seasonAverages = await pages(
    "/nba/v1/season_averages/general",
    {
      season: 2025,
      season_type: "regular",
      type: "base"
    }
  );

  for (const row of seasonAverages) {
    const p = profile(row);

    if (
      p &&
      row.player?.id
    ) {
      profiles.set(
        str(row.player.id),
        p
      );
    }
  }

  assert(
    profiles.size >= 50,
    "Sin perfiles históricos suficientes"
  );

  console.log(
    "Perfiles históricos:",
    profiles.size
  );

  const opponents = new Map();

  for (const p of baseline.players) {
    const opp = str(
      p.defenseContext?.opponentTeamId
    );

    assert(
      opp,
      "Falta rival para " + p.name
    );

    if (!opponents.has(opp)) {
      const games = await pages(
        "/v1/games",
        {
          team_ids: [opp],
          seasons,
          postseason: false,
          end_date: DATE
        }
      );

      const previous = games
        .filter(g =>
          str(g.date).slice(0, 10) < DATE &&
          (
            str(
              g.status_state
            ).toLowerCase() === "final" ||
            str(
              g.status
            ).toLowerCase() === "final"
          )
        )
        .sort(
          (a, b) =>
            str(b.date).localeCompare(
              str(a.date)
            )
        )
        .slice(0, 18);

      const samples = [];
      const ids = previous.map(
        g => g.id
      );

      for (
        let i = 0;
        i < ids.length;
        i += 5
      ) {
        const rows = await pages(
          "/v1/stats",
          {
            game_ids: ids.slice(
              i,
              i + 5
            )
          }
        );

        for (const row of rows) {
          const normalized = normal(
            row
          );

          if (
            normalized &&
            normalized.team !== opp
          ) {
            samples.push(
              normalized
            );
          }
        }
      }

      const perGame = new Map();

      for (const row of samples) {
        if (
          !perGame.has(row.gameId)
        ) {
          perGame.set(
            row.gameId,
            []
          );
        }

        perGame.get(
          row.gameId
        ).push(row);
      }

      const allowed = {};

      for (const stat of STATS) {
        allowed[stat] = round(
          avg(
            [
              ...perGame.values()
            ].map(
              gameRows =>
                gameRows.reduce(
                  (a, x) =>
                    a +
                    x.stats[stat],
                  0
                )
            )
          ) || 0
        );
      }

      opponents.set(
        opp,
        {
          samples,
          sampleGames: perGame.size,
          allowed
        }
      );

      console.log(
        "Rival",
        opp,
        "partidos:",
        perGame.size,
        "registros:",
        samples.length
      );
    }
  }

  const advanced = [];

  for (const p of baseline.players) {
    const id = str(
      p.playerId
    );

    const history = (
      await pages(
        "/v1/stats",
        {
          player_ids: [id],
          seasons,
          season_type: "regular",
          end_date: DATE
        }
      )
    )
      .map(normal)
      .filter(Boolean);

    if (!history.length) {
      advanced.push({
        ...p,
        model: "INCOMPLETE_HISTORY",
        readyForOptimization: false,
        diagnostics: {
          reason:
            "SIN_PARTIDOS_CON_BOX_SCORE_COMPLETO"
        }
      });

      continue;
    }

    const opp = opponents.get(
      str(
        p.defenseContext.opponentTeamId
      )
    );

    const evidence =
      defensiveEvidence({
        target: p,
        samples: opp.samples,
        profiles,
        baseDefense:
          num(
            p.simulation?.defenseFactor
          ) || 1
      });

    const sim = simulateB(
      p,
      history,
      evidence
    );

    advanced.push({
      ...p,

      projectedPoints:
        sim.projectedPoints,

      simulation: sim,

      model:
        "CONTEXT_V2_MATCHUP_SIMILAR_PLAYERS",

      readyForOptimization: true,

      diagnostics: {
        sampleGames: history.length,

        opponentGames:
          opp.sampleGames,

        opponentAllowedPerGame:
          opp.allowed,

        defenseSimilarPlayers:
          evidence,

        teammateEvidence:
          p.teammateImpact?.evidence || [],

        injuryStatus:
          p.injuryStatus,

        adjustmentsReusedFromA:
          true
      }
    });
  }

  const output = {
    mode: "shadow",
    date: DATE,
    platform: "draftkings",

    slateId:
      baseline.slateId,

    salaryCap:
      baseline.salaryCap,

    capturedAt:
      new Date().toISOString(),

    simulationsPerPlayer: N,

    source: SOURCE,

    model:
      "CONTEXT_V2_MATCHUP_SIMILAR_PLAYERS",

    limitations: [
      "Comparables de 2025 y últimos 18 partidos contra rival",
      "Defensa por estadística, no defensor individual",
      "Impacto de compañeros reutilizado del motor A",
      "Pesos experimentales sin calibración histórica",
      "Disponibilidad pendiente de confirmación"
    ],

    readyForPublication: false,

    players: advanced
  };

  fs.mkdirSync(
    path.dirname(DEST),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    DEST,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    "MUESTRA B:",
    advanced.filter(
      p => p.readyForOptimization
    ).length,
    "proyectados de",
    advanced.length
  );

  console.log(
    "OUTPUT:",
    DEST
  );

  console.log(
    "SHADOW | SOLO LECTURA | A INTACTA"
  );
}

main().catch(err => {
  console.error(
    err.stack || err.message
  );

  process.exitCode = 1;
});

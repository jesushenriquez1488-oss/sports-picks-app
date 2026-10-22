
"use strict";

// CASHEDGE FANTASY NBA — CONTEXT SHADOW V1
// Solo lectura: BALLDONTLIE + Supabase.
// No modifica datos ni formulas de produccion.

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const DIR = "fantasy-slate-data";
const INTEGRATION =
  "fantasy-shadow-input/nba-fantasy-integration-shadow.json";
const API = "https://api.balldontlie.io";
const KEY = process.env.BALLDONTLIE_NBA_API_KEY;
const DATE = process.env.FANTASY_TARGET_DATE || "2026-10-22";
const SIMS = 10000;

const id = x => String(x ?? "").trim();
const number = x =>
  x === null || x === undefined || x === "" ? NaN : Number(x);
const valid = Number.isFinite;
const round = x => Math.round(x * 100) / 100;
const mean = arr =>
  arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : null;

function required(condition, message) {
  if (!condition) throw new Error(message);
}

const load = file =>
  JSON.parse(fs.readFileSync(file, "utf8"));

const save = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

function parseMinutes(value) {
  if (
    typeof value === "string" &&
    /^\d+:\d{1,2}$/.test(value)
  ) {
    const [minutes, seconds] = value.split(":").map(Number);
    return minutes + seconds / 60;
  }

  return number(value);
}

async function request(route, query = {}) {
  const url = new URL(API + route);

  for (const [name, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(name + "[]", String(item));
      }
    } else if (value !== undefined && value !== null) {
      url.searchParams.set(name, String(value));
    }
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: KEY }
    });

    if (response.ok) return response.json();

    const body = (await response.text()).slice(0, 200);

    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(
        `${route} HTTP ${response.status}: ${body}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, 2000 * (attempt + 1))
    );
  }

  throw new Error(`BALLDONTLIE unavailable: ${route}`);
}

async function allPages(route, query = {}) {
  const rows = [];
  let cursor = null;
  const seen = new Set();

  for (let page = 0; page < 100; page++) {
    const response = await request(route, {
      ...query,
      per_page: 100,
      ...(cursor ? { cursor } : {})
    });

    required(
      Array.isArray(response.data),
      `Invalid API response: ${route}`
    );

    rows.push(...response.data);

    const next = response.meta?.next_cursor;

    if (!next) return rows;

    required(
      !seen.has(String(next)),
      `Repeated API cursor: ${route}`
    );

    seen.add(String(next));
    cursor = next;
  }

  throw new Error(`Incomplete pagination: ${route}`);
}

function normalGame(raw) {
  const minutes = parseMinutes(raw.min ?? raw.minutes);

  const date = String(
    raw.game?.date ??
    raw.gameDate ??
    raw.game_date ??
    ""
  ).slice(0, 10);

  const source = {
    points: raw.pts ?? raw.points,
    rebounds: raw.reb ?? raw.rebounds,
    assists: raw.ast ?? raw.assists,
    steals: raw.stl ?? raw.steals,
    blocks: raw.blk ?? raw.blocks,
    turnovers: raw.turnover ?? raw.turnovers,
    threePointersMade:
      raw.fg3m ??
      raw.three_pointers_made ??
      raw.threePointersMade
  };

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date >= DATE ||
    !(minutes > 0 && minutes <= 60) ||
    raw.game?.postseason === true
  ) {
    return null;
  }

  const stats = {};

  for (const [key, value] of Object.entries(source)) {
    const n = number(value);

    if (!valid(n) || n < 0) return null;

    stats[key] = n;
  }

  return {
    date,
    minutes,
    teamId: id(raw.team?.id ?? raw.team_id ?? raw.teamId),
    gameId: id(raw.game?.id ?? raw.game_id ?? raw.gameId),
    ...stats
  };
}

function score(stats, platform) {
  if (platform === "fanduel") {
    return (
      stats.points +
      1.2 * stats.rebounds +
      1.5 * stats.assists +
      3 * stats.steals +
      3 * stats.blocks -
      stats.turnovers
    );
  }

  const doubles = [
    stats.points,
    stats.rebounds,
    stats.assists,
    stats.steals,
    stats.blocks
  ].filter(x => x >= 10).length;

  return (
    stats.points +
    1.25 * stats.rebounds +
    1.5 * stats.assists +
    2 * stats.steals +
    2 * stats.blocks -
    0.5 * stats.turnovers +
    0.5 * stats.threePointersMade +
    (doubles >= 2 ? 1.5 : 0) +
    (doubles >= 3 ? 3 : 0)
  );
}

function hash(value) {
  let h = 2166136261;

  for (const character of String(value)) {
    h ^= character.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function randomGenerator(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadDefense() {
  // Temporada 2025-26 como base al inicio
  // de la temporada 2026-27.

  const rows = await allPages(
    "/nba/v1/team_season_averages/general",
    {
      season: 2025,
      season_type: "regular",
      type: "advanced"
    }
  );

  const byId = new Map();

  for (const row of rows) {
    const stats = row.stats || {};

    const rating = number(
      stats.defensive_rating ?? stats.def_rating
    );

    const pace = number(stats.pace);

    if (id(row.team?.id) && rating > 0 && pace > 0) {
      byId.set(id(row.team.id), {
        rating,
        pace
      });
    }
  }

  const values = [...byId.values()];

  return {
    byId,
    league: {
      rating: mean(values.map(x => x.rating)),
      pace: mean(values.map(x => x.pace))
    }
  };
}

async function readTeamHistory(db, teamId) {
  const all = [];

  for (const season of [2025, 2026]) {
    let start = 0;

    while (true) {
      const { data, error } = await db
        .from("nba_player_game_stats")
        .select(
          "game_id,season,game_date,team_id,player_id," +
          "minutes,points,rebounds,assists"
        )
        .eq("team_id", teamId)
        .eq("season", season)
        .lt("game_date", DATE)
        .order("game_date", { ascending: false })
        .range(start, start + 499);

      if (error) {
        throw new Error(
          `Supabase team ${teamId}: ${error.message}`
        );
      }

      all.push(...data);

      if (data.length < 500) break;

      start += 500;

      required(
        start < 50000,
        `Team history pagination overflow: ${teamId}`
      );
    }
  }

  return all
    .filter(row => {
      const minutes = parseMinutes(row.minutes);

      return (
        minutes > 0 &&
        minutes <= 60 &&
        String(row.game_date).slice(0, 10) < DATE
      );
    })
    .map(row => ({
      ...row,
      minutes: parseMinutes(row.minutes)
    }));
}

function teammateEffects(
  rows,
  playerId,
  missingTeammates,
  expectedMinutes
) {
  const own = rows.filter(
    row => id(row.player_id) === playerId
  );

  const adjustments = {
    minutes: 0,
    points: 0,
    rebounds: 0,
    assists: 0
  };

  const evidence = [];

  if (!own.length) {
    return { adjustments, evidence };
  }

  for (const absent of missingTeammates) {
    const mateRows = rows.filter(
      row => id(row.player_id) === absent.playerId
    );

    const mateGames = new Set(
      mateRows.map(row => id(row.game_id))
    );

    const teammateDates = mateRows
      .map(row => String(row.game_date).slice(0, 10))
      .sort();

    if (!teammateDates.length) {
      evidence.push({
        teammate: absent.playerId,
        status: absent.status,
        applied: false,
        reason: "NO_SHARED_TEAM_HISTORY"
      });

      continue;
    }

    const withMate = [];
    const withoutMate = [];

    for (const game of own) {
      if (
        String(game.game_date).slice(0, 10) <
        teammateDates[0]
      ) {
        continue;
      }

      if (mateGames.has(id(game.game_id))) {
        withMate.push(game);
      } else {
        withoutMate.push(game);
      }
    }

    if (!withMate.length || !withoutMate.length) {
      evidence.push({
        teammate: absent.playerId,
        status: absent.status,
        applied: false,
        reason: "NO_WITH_AND_WITHOUT_COMPARISON",
        withGames: withMate.length,
        withoutGames: withoutMate.length
      });

      continue;
    }

    // Ajuste exploratorio reducido por la proporcion
    // de juegos observados sin el companero.

    const sampleWeight =
      withoutMate.length /
      (withMate.length + withoutMate.length);

    const avgWith = mean(
      withMate.map(game => game.minutes)
    );

    const avgWithout = mean(
      withoutMate.map(game => game.minutes)
    );

    adjustments.minutes +=
      (avgWithout - avgWith) * sampleWeight;

    for (const stat of [
      "points",
      "rebounds",
      "assists"
    ]) {
      const before = withMate
        .map(game => number(game[stat]) / game.minutes)
        .filter(valid);

      const after = withoutMate
        .map(game => number(game[stat]) / game.minutes)
        .filter(valid);

      if (before.length && after.length) {
        adjustments[stat] += (
          mean(after) - mean(before)
        ) * expectedMinutes * sampleWeight;
      }
    }

    evidence.push({
      teammate: absent.playerId,
      status: absent.status,
      applied: true,
      withGames: withMate.length,
      withoutGames: withoutMate.length,
      sampleWeight: round(sampleWeight)
    });
  }

  return { adjustments, evidence };
}

function simulate({
  games,
  expectedMinutes,
  defense,
  ownPace,
  effect,
  platform,
  seed
}) {
  const random = randomGenerator(hash(seed));

  const outcomes = [];

  const paceFactor = Math.sqrt(
    (ownPace / defense.leaguePace) *
    defense.paceRelative
  );

  const effectiveMinutes = Math.min(
    48,
    Math.max(0, expectedMinutes + effect.minutes)
  );

  for (let i = 0; i < SIMS; i++) {
    const game = games[
      Math.floor(random() * games.length)
    ];

    const scale =
      effectiveMinutes / game.minutes * paceFactor;

    const stats = {};

    for (const key of [
      "points",
      "rebounds",
      "assists",
      "steals",
      "blocks",
      "turnovers",
      "threePointersMade"
    ]) {
      let value = game[key] * scale;

      if (key === "points") {
        value *= defense.ratingRelative;
      }

      if (
        ["points", "rebounds", "assists"].includes(key)
      ) {
        value += effect[key];
      }

      stats[key] = Math.max(0, Math.round(value));
    }

    stats.threePointersMade = Math.min(
      stats.threePointersMade,
      Math.floor(stats.points / 3)
    );

    outcomes.push(score(stats, platform));
  }

  outcomes.sort((a, b) => a - b);

  return {
    mean: round(mean(outcomes)),
    p10: round(outcomes[999]),
    p50: round(outcomes[4999]),
    p90: round(outcomes[8999]),
    effectiveMinutes: round(effectiveMinutes),
    paceFactor: round(paceFactor),
    defenseFactor: round(defense.ratingRelative)
  };
}

async function main() {
  required(KEY, "BALLDONTLIE_NBA_API_KEY missing");

  required(
    /^\d{4}-\d{2}-\d{2}$/.test(DATE),
    "Invalid target date"
  );

  required(
    process.env.FANTASY_SUPABASE_URL &&
    process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY,
    "Supabase credentials missing"
  );

  const integration = load(INTEGRATION);

  const rotation = load(
    "fantasy-shadow-input/nba-rotation-context.json"
  );

  const rotationTimestamp = Date.parse(
    rotation.sourceReportAt || ""
  );

  required(
    Number.isFinite(rotationTimestamp),
    "ESPN capture timestamp missing"
  );

  const rotationDay = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date(rotationTimestamp));

  required(
    rotationDay === DATE,
    `ESPN Depth Chart is stale: ${rotationDay}`
  );

  required(
    integration.mode === "shadow" &&
    integration.historicalCutoffExclusive <= DATE,
    "Invalid SHADOW integration"
  );

  const db = createClient(
    process.env.FANTASY_SUPABASE_URL,
    process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  const [teams, injuries, defense] = await Promise.all([
    allPages("/v1/teams"),
    allPages("/v1/player_injuries"),
    loadDefense()
  ]);

  required(
    defense.byId.size > 0 &&
    defense.league.rating > 0 &&
    defense.league.pace > 0,
    "Opponent defense data unavailable"
  );

  const teamIds = new Map(
    teams.map(team => [
      id(team.abbreviation).toUpperCase(),
      id(team.id)
    ])
  );

  const injuryById = new Map(
    injuries
      .filter(row => row.player?.id)
      .map(row => [id(row.player.id), row])
  );

  const captureTime = new Date().toISOString();

  const teamHistory = new Map();
  const fullHistory = new Map();

  async function playerGames(playerId) {
    if (!fullHistory.has(playerId)) {
      const raw = await allPages(
        "/v1/stats",
        {
          player_ids: [playerId],
          seasons: [2025, 2026]
        }
      );

      const games = raw
        .map(normalGame)
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date));

      fullHistory.set(playerId, games);
    }

    return fullHistory.get(playerId);
  }

  const summaries = [];

  for (const platform of ["draftkings", "fanduel"]) {
    const input = path.join(
      DIR,
      `nba-${platform}-live-shadow.json`
    );

    if (!fs.existsSync(input)) {
      console.log(`${platform}: no slate available`);
      continue;
    }

    const slate = load(input);

    required(
      slate.mode === "shadow" &&
      slate.targetDate === DATE &&
      slate.platform === platform,
      `Wrong slate: ${platform}`
    );

    const events = new Map(
      (slate.games || []).map(event => [
        id(event.id),
        event
      ])
    );

    const players = [];
    const excluded = [];

    for (const player of slate.players || []) {
      const playerId = id(player.playerId);
      const salary = number(player.salary);

      if (
        !(salary > 3500) ||
        ![1, 2].includes(Number(player.depthRank))
      ) {
        excluded.push({
          playerId,
          reason: "SALARY_OR_ROLE_BANNED"
        });

        continue;
      }

      const event = events.get(
        id(player.eventId)
      );

      if (!event) {
        excluded.push({
          playerId,
          reason: "EVENT_NOT_MATCHED"
        });

        continue;
      }

      const away = id(
        teamIds.get(
          id(event.away_team_abbreviation).toUpperCase()
        )
      );

      const home = id(
        teamIds.get(
          id(event.home_team_abbreviation).toUpperCase()
        )
      );

      const teamId = id(player.teamId);

      const opponentId =
        teamId === away ? home :
        teamId === home ? away :
        null;

      if (!opponentId) {
        excluded.push({
          playerId,
          reason: "NO_CONFIRMED_OPPONENT"
        });

        continue;
      }

      const own = defense.byId.get(teamId);
      const rival = defense.byId.get(opponentId);

      if (!own || !rival) {
        excluded.push({
          playerId,
          reason: "NO_TEAM_DEFENSE_DATA"
        });

        continue;
      }

      const integrationPlayer = (
        integration.players || []
      ).find(row =>
        id(row.nbaPlayerId) === playerId &&
        id(row.teamId) === teamId
      );

      if (
        !integrationPlayer ||
        ![1, 2].includes(Number(integrationPlayer.rank))
      ) {
        excluded.push({
          playerId,
          reason: "SLATE_TEAM_OR_ROLE_NOT_MATCHED"
        });

        continue;
      }

      const injury = injuryById.get(playerId);

      const status = id(
        injury?.status
      ).toLowerCase();

      if ([
        "out",
        "doubtful",
        "questionable",
        "day-to-day",
        "gtd",
        "inactive"
      ].includes(status)) {
        excluded.push({
          playerId,
          reason: `INJURY_${status.toUpperCase()}`
        });

        continue;
      }

      const games = await playerGames(playerId);

      if (!games.length) {
        excluded.push({
          playerId,
          reason: "NO_COMPLETE_BOX_SCORES"
        });

        continue;
      }

      const minutes = number(
        integrationPlayer.historicalMinutesBaseline
      );

      if (!(minutes > 0)) {
        excluded.push({
          playerId,
          reason: "NO_MINUTES_BASELINE"
        });

        continue;
      }

      if (!teamHistory.has(teamId)) {
        teamHistory.set(
          teamId,
          await readTeamHistory(db, teamId)
        );
      }

      const unavailableTeammates = injuries
        .filter(row =>
          id(row.player?.team_id) === teamId &&
          id(row.player?.id) !== playerId &&
          ["out", "inactive"].includes(
            id(row.status).toLowerCase()
          )
        )
        .map(row => ({
          playerId: id(row.player.id),
          status: row.status
        }));

      const impact = teammateEffects(
        teamHistory.get(teamId),
        playerId,
        unavailableTeammates,
        minutes
      );

      const defenseFactor =
        rival.rating / defense.league.rating;

      const simulation = simulate({
        games,
        expectedMinutes: minutes,
        defense: {
          ratingRelative: defenseFactor,
          paceRelative:
            rival.pace / defense.league.pace,
          leaguePace: defense.league.pace
        },
        ownPace: own.pace,
        effect: impact.adjustments,
        platform,
        seed: `${DATE}:${platform}:${playerId}`
      });

      const startTime = Date.parse(
        event.starts_at || ""
      );

      const capturedBeforeTipoff =
        Number.isFinite(startTime) &&
        Date.parse(captureTime) < startTime &&
        rotationTimestamp < startTime &&
        Date.parse(slate.capturedAt || "") < startTime;

      players.push({
        ...player,
        playerId,
        salary,

        projectedPoints: simulation.mean,
        expectedMinutes: simulation.effectiveMinutes,
        simulation,

        defenseContext: {
          opponentTeamId: opponentId,
          opponentDefRating: rival.rating,
          leagueDefRating: round(
            defense.league.rating
          ),
          opponentPace: rival.pace,
          teamPace: own.pace,
          sourceSeason: 2025
        },

        teammateImpact: impact,

        injuryStatus: injury?.status || "NOT_LISTED",
        injurySnapshotAt: captureTime,

        capturedBeforeTipoff,
        availabilityConfirmed: false,
        readyForPublication: false
      });
    }

    const report = {
      sport: "nba",
      platform,
      mode: "shadow",
      date: DATE,
      slateId: slate.slateId,
      salaryCap: slate.salaryCap,
      generatedAt: captureTime,

      model: "NBA_CONTEXT_EXPERIMENTAL_V1",
      simulationsPerPlayer: SIMS,

      limitations: [
        "Availability not guaranteed",
        "Team-level defense only",
        "Historical teammate on/off estimates",
        "Uncalibrated adjustments",
        "No interplayer simulation correlation"
      ],

      readyForPublication: false,
      players,
      exclusions: excluded
    };

    save(
      path.join(
        DIR,
        `nba-${platform}-context-shadow.json`
      ),
      report
    );

    summaries.push({
      platform,
      slate: report.slateId,
      candidates: players.length,
      excluded: excluded.length
    });

    console.log(
      `${platform.toUpperCase()} CONTEXT: ` +
      `${players.length} candidates, ` +
      `${excluded.length} excluded`
    );
  }

  console.log(
    JSON.stringify(summaries, null, 2)
  );

  console.log(
    "SHADOW ONLY | NO DATABASE WRITES"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

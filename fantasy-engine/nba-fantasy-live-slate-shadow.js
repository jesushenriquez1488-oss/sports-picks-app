
"use strict";

// CASHEDGE FANTASY NBA — LIVE SLATE SHADOW
// Solo lectura. No modifica produccion.
// Reutiliza historial reparado y BALLDONTLIE.
// No inventa salarios, lesiones ni jugadores.

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve("fantasy-shadow-input");
const OUT = path.resolve("fantasy-slate-data");
const API = "https://api.balldontlie.io/nba/v1";

const KEY = process.env.BALLDONTLIE_NBA_API_KEY;
const DB_URL = process.env.FANTASY_SUPABASE_URL;
const DB_KEY = process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY;

const TARGET_DATE =
  process.env.FANTASY_TARGET_DATE || "2026-10-22";

const SIMULATIONS = 10000;
const MIN_ALLOWED_SALARY = 3501;

const str = x => String(x ?? "").trim();
const num = x =>
  x === null || x === undefined || x === ""
    ? NaN
    : Number(x);
const round = x => Math.round(x * 100) / 100;

function read(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, name), "utf8")
  );
}

function ensure(test, message) {
  if (!test) throw Error(message);
}

async function api(endpoint, params = {}) {
  const url = new URL(`${API}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, String(value));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: KEY
      }
    });

    if (response.ok) return response.json();

    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw Error(
        `BALLDONTLIE ${response.status}: ${endpoint}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, 1500 * (attempt + 1))
    );
  }

  throw Error(`BALLDONTLIE unavailable: ${endpoint}`);
}

async function pages(endpoint, params) {
  const data = [];
  let cursor = null;
  const seen = new Set();

  for (let page = 0; page < 100; page++) {
    const response = await api(endpoint, {
      ...params,
      per_page: 100,
      ...(cursor ? { cursor } : {})
    });

    ensure(Array.isArray(response.data), "Invalid API page");
    data.push(...response.data);

    const next = response.meta?.next_cursor;
    if (!next) return data;

    ensure(!seen.has(String(next)), "Repeated API cursor");
    seen.add(String(next));
    cursor = next;
  }

  throw Error("Incomplete BALLDONTLIE pagination");
}

function localDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function chooseSlate(provider) {
  const slates = await pages("/dfs/slates", {
    "providers[]": provider,
    start_date: TARGET_DATE,
    end_date: TARGET_DATE,
    "formats[]": "salary_cap"
  });

  const candidates = slates.filter(slate =>
    slate.provider === provider &&
    slate.format === "salary_cap" &&
    slate.active !== false &&
    /classic/i.test(String(slate.style || "")) &&
    localDay(slate.starts_at) === TARGET_DATE &&
    num(slate.salary_cap) > 0
  );

  // Preferimos el Classic con mas partidos.
  // La seleccion se informa en los resultados.
  candidates.sort((a, b) =>
    num(b.event_count) - num(a.event_count)
  );

  if (!candidates.length) return null;

  const detail = await api(
    `/dfs/slates/${candidates[0].id}`
  );

  return detail.data;
}

function normalizeGame(row) {
  const minutes = num(row.minutes);
  const date = row.gameDate ?? row.game_date;

  const source = {
    points: row.points,
    rebounds: row.rebounds,
    assists: row.assists,
    steals: row.steals,
    blocks: row.blocks,
    turnovers: row.turnovers,
    threes:
      row.threePointersMade ??
      row.three_pointers_made
  };

  if (
    !date ||
    !Number.isFinite(Date.parse(date)) ||
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    minutes > 60
  ) return null;

  const values = {};

  for (const [key, value] of Object.entries(source)) {
    values[key] = num(value);

    if (
      !Number.isFinite(values[key]) ||
      values[key] < 0
    ) return null;
  }

  return {
    date,
    minutes,
    ...values
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

  const doubled = [
    stats.points,
    stats.rebounds,
    stats.assists,
    stats.steals,
    stats.blocks
  ].filter(value => value >= 10).length;

  return (
    stats.points +
    1.25 * stats.rebounds +
    1.5 * stats.assists +
    2 * stats.steals +
    2 * stats.blocks -
    0.5 * stats.turnovers +
    0.5 * stats.threes +
    (doubled >= 2 ? 1.5 : 0) +
    (doubled >= 3 ? 3 : 0)
  );
}

function simulate(games, expectedMinutes, platform) {
  // Bootstrap conjunto: selecciona un partido
  // historico completo y mantiene la relacion
  // entre sus estadisticas.
  //
  // Aun no ajusta por defensa ni lesiones.

  let state = 123456789;

  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  const results = [];

  for (let i = 0; i < SIMULATIONS; i++) {
    const game = games[
      Math.floor(random() * games.length)
    ];

    const factor = expectedMinutes / game.minutes;

    const stats = {
      points: Math.max(0, Math.round(game.points * factor)),
      rebounds: Math.max(0, Math.round(game.rebounds * factor)),
      assists: Math.max(0, Math.round(game.assists * factor)),
      steals: Math.max(0, Math.round(game.steals * factor)),
      blocks: Math.max(0, Math.round(game.blocks * factor)),
      turnovers: Math.max(0, Math.round(game.turnovers * factor)),
      threes: Math.max(0, Math.round(game.threes * factor))
    };

    stats.threes = Math.min(
      stats.threes,
      Math.floor(stats.points / 3)
    );

    results.push(score(stats, platform));
  }

  results.sort((a, b) => a - b);

  return {
    mean: round(
      results.reduce((a, b) => a + b, 0) /
      SIMULATIONS
    ),
    p10: round(results[999]),
    median: round(results[4999]),
    p90: round(results[8999])
  };
}

async function main() {
  ensure(KEY, "Missing BALLDONTLIE_NBA_API_KEY");
  ensure(DB_URL && DB_KEY, "Missing Supabase read credentials");
  ensure(
    /^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE),
    "Invalid target date"
  );

  const integration = read(
    "nba-fantasy-integration-shadow.json"
  );

  const history = read(
    "nba-fantasy-history.json"
  );

  ensure(
    integration.mode === "shadow" &&
    history.mode === "shadow",
    "SHADOW reports required"
  );

  ensure(
    TARGET_DATE >= integration.historicalCutoffExclusive,
    "Target precedes historical cutoff"
  );

  const db = createClient(DB_URL, DB_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const byId = new Map(
    history.players
      .filter(player => player.nbaPlayerId)
      .map(player => [
        str(player.nbaPlayerId),
        player
      ])
  );

  const eligible = new Map(
    integration.players
      .filter(player =>
        [1, 2].includes(player.rank) &&
        player.eligibleForSimulation &&
        player.nbaPlayerId &&
        player.historicalMinutesBaseline > 0
      )
      .map(player => [
        str(player.nbaPlayerId),
        player
      ])
  );

  const historyCache = new Map();

  async function playerGames(playerId) {
    if (historyCache.has(playerId)) {
      return historyCache.get(playerId);
    }

    const old = byId.get(playerId);

    let games = (
      old?.historicalGames || []
    )
      .map(normalizeGame)
      .filter(Boolean);

    if (!games.length) {
      const rows = [];

      for (const season of [2025, 2026]) {
        let from = 0;

        while (true) {
          const { data, error } = await db
            .from("nba_player_game_stats")
            .select("*")
            .eq("player_id", playerId)
            .eq("season", season)
            .lt("game_date", TARGET_DATE)
            .order("game_date", {
              ascending: false
            })
            .range(from, from + 499);

          if (error) throw Error(error.message);

          rows.push(...data);

          if (data.length < 500) break;
          from += 500;
        }
      }

      games = rows
        .map(normalizeGame)
        .filter(Boolean);
    }

    games = games.filter(game =>
      Date.parse(game.date) <
      Date.parse(`${TARGET_DATE}T00:00:00Z`)
    );

    historyCache.set(playerId, games);
    return games;
  }

  fs.mkdirSync(OUT, { recursive: true });

  for (const platform of ["draftkings", "fanduel"]) {
    const slate = await chooseSlate(platform);

    if (!slate) {
      console.log(
        `${platform}: no Classic slate for ${TARGET_DATE}`
      );
      continue;
    }

    const draftables = await pages(
      "/dfs/draftables",
      { "slate_ids[]": slate.id }
    );

    const grouped = new Map();

    for (const entry of draftables) {
      if (
        entry.entity_type !== "player" ||
        entry.active === false ||
        entry.is_disabled === true ||
        !entry.player_id
      ) continue;

      const salary = num(entry.salary);

      // Regla obligatoria del usuario.
      if (
        !Number.isFinite(salary) ||
        salary < MIN_ALLOWED_SALARY
      ) continue;

      const status = str(entry.status).toLowerCase();

      // No incluimos estados de lesion o
      // disponibilidad incierta.
      if (
        !["", "none", "active", "available"].includes(status)
      ) continue;

      const playerId = str(entry.player_id);
      const historyPlayer = eligible.get(playerId);

      if (!historyPlayer) continue;

      // Evitar unir por nombre o por equipo
      // cuando el ID ya esta disponible.

      const key = `${playerId}:${entry.slate_event_id}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          playerId,
          name: entry.display_name,
          teamId: str(entry.team_id),
          gameId: entry.game_id,
          eventId: entry.slate_event_id,
          salary,
          positions: new Set(),
          rosterSlotIds: new Set(),
          role: historyPlayer.rank,
          minutes: historyPlayer.historicalMinutesBaseline
        });
      }

      const player = grouped.get(key);

      // No mezclar salarios distintos dentro
      // de la misma entrada de jugador.
      if (player.salary !== salary) {
        grouped.delete(key);
        continue;
      }

      if (entry.position) {
        player.positions.add(
          String(entry.position)
        );
      }

      if (entry.roster_slot_id) {
        player.rosterSlotIds.add(
          str(entry.roster_slot_id)
        );
      }
    }

    const players = [];

    for (const player of grouped.values()) {
      const games = await playerGames(player.playerId);

      if (!games.length) continue;

      const simulation = simulate(
        games,
        player.minutes,
        platform
      );

      players.push({
        playerId: player.playerId,
        name: player.name,
        teamId: player.teamId,
        gameId: player.gameId,
        eventId: player.eventId,
        salary: player.salary,
        positions: [...player.positions],
        rosterSlotIds: [...player.rosterSlotIds],
        depthRank: player.role,
        expectedMinutes: player.minutes,
        projectedPoints: simulation.mean,
        simulation,
        historicalGames: games.length,
        availabilityConfirmed: false
      });
    }

    const report = {
      sport: "nba",
      platform,
      mode: "shadow",
      targetDate: TARGET_DATE,
      slateId: str(slate.id),
      salaryCap: slate.salary_cap,
      style: slate.style,
      capturedAt: new Date().toISOString(),
      games: slate.events || [],
      rosterSlots: slate.roster_slots || [],
      simulationsPerPlayer: SIMULATIONS,
      model: "HISTORICAL_BOOTSTRAP_BASELINE",
      injuriesAdjusted: false,
      opponentAdjusted: false,
      availabilityConfirmed: false,
      readyForPublication: false,
      players
    };

    const filename = path.join(
      OUT,
      `nba-${platform}-live-shadow.json`
    );

    fs.writeFileSync(
      filename,
      JSON.stringify(report, null, 2)
    );

    console.log(
      `${platform.toUpperCase()} | Slate ${slate.id}`
    );

    console.log(
      `Salary cap: ${slate.salary_cap}`
    );

    console.log(
      `Eligible player projections: ${players.length}`
    );

    console.log(
      `Output: ${filename}`
    );
  }

  console.log(
    "SHADOW ONLY | NO DB WRITES | NO PRODUCTION CHANGES"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

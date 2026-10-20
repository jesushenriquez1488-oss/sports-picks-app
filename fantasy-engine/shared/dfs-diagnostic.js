
"use strict";

// CASHEDGE FANTASY EDGE — DFS DIAGNOSTIC V2
// NBA + NFL | DraftKings + FanDuel
//
// Solo lectura.
// Maximo 3 solicitudes por combinacion.
// Regulador compartido de solicitudes.
// No consulta Supabase ni modifica produccion.

const {
  getContestConfig
} = require("./contest-config");

const BASE = "https://api.balldontlie.io";

const SPORTS = ["nba", "nfl"];
const PLATFORMS = ["draftkings", "fanduel"];

// Durante el trial: 5 requests/min.
// Dejamos 15 segundos entre inicios de peticion.
// Este regulador se comparte dentro del proceso.

const MIN_REQUEST_INTERVAL_MS = 15000;

let requestQueue = Promise.resolve();
let lastRequestStarted = 0;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const asId = value =>
  value === null || value === undefined
    ? ""
    : String(value).trim();

const asNumber = value => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function apiKeyFor(sport, supplied) {
  const key = supplied ||
    process.env[
      sport === "nba"
        ? "BALLDONTLIE_NBA_API_KEY"
        : "BALLDONTLIE_NFL_API_KEY"
    ] ||
    process.env.BALLDONTLIE_API_KEY;

  if (!key) {
    throw new Error(
      `Falta API key BALLDONTLIE para ${sport}`
    );
  }

  return key;
}

// Regula las peticiones de las cuatro plataformas.
// No coordina otros procesos ni aplicaciones que
// compartan la misma clave API.

async function reserveRequest(minIntervalMs) {
  let release;

  const previous = requestQueue;

  requestQueue = new Promise(resolve => {
    release = resolve;
  });

  await previous;

  try {
    const remaining = Math.max(
      0,
      minIntervalMs -
        (Date.now() - lastRequestStarted)
    );

    if (remaining) {
      await sleep(remaining);
    }

    lastRequestStarted = Date.now();
  } finally {
    release();
  }
}

async function getDFS({
  sport,
  path,
  params = {},
  key,
  fetchFn,
  waitMs
}) {
  await reserveRequest(
    Math.max(MIN_REQUEST_INTERVAL_MS, waitMs)
  );

  const url = new URL(
    `${BASE}/${sport}/v1/dfs/${path}`
  );

  for (const [name, value] of Object.entries(params)) {
    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      url.searchParams.append(name, String(value));
    }
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetchFn(url.toString(), {
      headers: { Authorization: key },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `BALLDONTLIE ${sport} DFS HTTP ${response.status}` +
        (
          response.status === 429
            ? " — limite de solicitudes"
            : response.status === 401 ||
              response.status === 403
              ? " — comprobar acceso GOAT"
              : ""
        )
      );
    }

    const body = await response.json();

    if (!body || !Array.isArray(body.data) &&
        !(body.data && typeof body.data === "object")) {
      throw new Error(
        `Respuesta ${sport} DFS sin data valida`
      );
    }

    return body;

  } finally {
    clearTimeout(timeout);
  }
}

async function auditDfsFeed({
  sport,
  platform,
  startDate,
  season,
  week,
  waitMs = 15000,
  fetchFn = fetch,
  apiKey
} = {}) {
  sport = String(sport || "").toLowerCase();
  platform = String(platform || "").toLowerCase();

  if (
    !SPORTS.includes(sport) ||
    !PLATFORMS.includes(platform)
  ) {
    throw new Error(
      "Deporte o plataforma invalidos"
    );
  }

  if (
    startDate !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
  ) {
    throw new Error("startDate invalida");
  }

  if (
    !Number.isInteger(waitMs) ||
    waitMs < 0
  ) {
    throw new Error("waitMs invalido");
  }

  if (
    season !== undefined &&
    (!Number.isInteger(season) ||
      season < 2020 ||
      season > 2100)
  ) {
    throw new Error("season invalida");
  }

  if (
    week !== undefined &&
    (!Number.isInteger(week) ||
      week < 1 ||
      week > 22)
  ) {
    throw new Error("week invalida");
  }

  const key = apiKeyFor(sport, apiKey);

  let requests = 0;

  const get = async (path, params = {}) => {
    requests++;

    return getDFS({
      sport,
      path,
      params,
      key,
      fetchFn,
      waitMs
    });
  };

  // NFL puede buscar por temporada/semana.
  // NBA puede buscar por fecha.
  // Sin filtros temporales no se presupone
  // que el primer slate sea el deseado.

  const filters = {
    "providers[]": platform,
    "formats[]": "salary_cap",
    "scopes[]": "multi_event",
    per_page: 100
  };

  if (sport === "nfl" && season && week) {
    filters.season = season;
    filters.week = week;
  } else if (startDate) {
    filters.start_date = startDate;
  }

  // Solicitud 1: listado de slates.
  const listed = await get("slates", filters);

  if (!Array.isArray(listed.data)) {
    throw new Error("Listado de slates invalido");
  }

  const matching = listed.data.filter(row =>
    row &&
    row.provider === platform &&
    row.sport === sport &&
    row.format === "salary_cap" &&
    row.scope === "multi_event"
  );

 const classic = matching.filter(row => {
  const style = String(row.style || "")
    .trim()
    .toLowerCase();

  if (platform === "draftkings") {
    return style === "classic";
  }

  if (platform === "fanduel") {
    return style === "full roster";
  }

  return false;
});

  // No seleccionar concursos especiales
  // como si fueran Classic.

  if (!classic.length) {
    return {
      sport,
      platform,
      accessConfirmed: true,
      classicSlateFound: false,
      requests,
      slatesReturned: listed.data.length,
      matchingSlates: matching.length,
      stylesFound: [
        ...new Set(
          matching.map(row => row.style || null)
        )
      ],
      hasMoreSlatePages:
        listed.meta?.next_cursor != null,
      note:
        "Sin slate Classic confirmado en la primera pagina"
    };
  }

  classic.sort((a, b) =>
    String(a.starts_at || "")
      .localeCompare(String(b.starts_at || ""))
  );

  const chosen = classic[0];

  // Solicitud 2: detalle del concurso.
  const detailResponse = await get(
    `slates/${encodeURIComponent(chosen.id)}`
  );

  const detail = detailResponse.data;

  if (
    !detail ||
    Array.isArray(detail) ||
    String(detail.id) !== String(chosen.id) ||
    detail.provider !== platform ||
    detail.sport !== sport ||
    !Array.isArray(detail.events) ||
    !Array.isArray(detail.roster_slots)
  ) {
    throw new Error(
      "Detalle de slate incompleto o inconsistente"
    );
  }

  // Solicitud 3: primera pagina de salarios.
  const draftableResponse = await get(
    "draftables",
    {
      "slate_ids[]": chosen.id,
      per_page: 100
    }
  );

  if (!Array.isArray(draftableResponse.data)) {
    throw new Error("Draftables invalidos");
  }

  const rows = draftableResponse.data;

  const config = getContestConfig({
    sport,
    platform
  });

  const activeSlots = detail.roster_slots.filter(
    row => row.active !== false
  );

  const rosterSize = activeSlots.reduce(
    (total, slot) =>
      total + (
        asNumber(slot.required_count) || 0
      ),
    0
  );

  const knownSlots = new Set(
    detail.roster_slots.map(row =>
      asId(row.id)
    )
  );

  const entities = new Map();
  const salaryByEntity = new Map();

  let teamEntries = 0;
  let playerEntries = 0;
  let unknownEntities = 0;
  let missingSalaries = 0;
  let missingPlayerIds = 0;
  let missingTeamIds = 0;
  let missingGameIds = 0;
  let invalidSlotReferences = 0;

  for (const row of rows) {
    const type = String(
      row.entity_type || ""
    ).toLowerCase();

    if (type === "team") {
      teamEntries++;
    } else if (type === "player") {
      playerEntries++;
    } else {
      unknownEntities++;
    }

    const identity = type === "team"
      ? `team:${asId(row.team_id || row.id)}`
      : type === "player"
        ? `player:${asId(row.player_id || row.id)}`
        : `unknown:${asId(row.id)}`;

    entities.set(identity, true);

    if (
      type === "player" &&
      !asId(row.player_id)
    ) {
      missingPlayerIds++;
    }

    if (!asId(row.team_id)) {
      missingTeamIds++;
    }

    if (!asId(row.game_id) &&
        !asId(row.slate_event_id)) {
      missingGameIds++;
    }

    const salary = asNumber(row.salary);

    if (
      salary === null ||
      salary <= 0
    ) {
      missingSalaries++;
    } else {
      if (!salaryByEntity.has(identity)) {
        salaryByEntity.set(identity, new Set());
      }

      salaryByEntity.get(identity).add(salary);
    }

    if (
      !knownSlots.has(
        asId(row.roster_slot_id)
      )
    ) {
      invalidSlotReferences++;
    }
  }

  const salaryConflicts = [
    ...salaryByEntity.entries()
  ].filter(([, salaries]) =>
    salaries.size > 1
  ).map(([identity, salaries]) => ({
    identity,
    salaries: [...salaries]
  }));

  return {
    sport,
    platform,

    accessConfirmed: true,
    classicSlateFound: true,
    requests,

    slate: {
      id: detail.id,
      provider: detail.provider,
      style: detail.style,
      startsAt: detail.starts_at,
      format: detail.format,
      scope: detail.scope,
      salaryCap: asNumber(detail.salary_cap),
      rosterSize,
      eventCount: detail.events.length,
      lateSwap: detail.allow_late_swap
    },

    checks: {
      salaryCapMatchesClassic:
        asNumber(detail.salary_cap) ===
        config.salaryCap,

      rosterSizeMatchesClassic:
        rosterSize === config.rosterSize,

      eventsAvailable:
        detail.events.length > 0,

      hasPositiveSalaries:
        rows.some(row =>
          asNumber(row.salary) > 0
        ),

      invalidSlotReferences
    },

    firstPage: {
      draftables: rows.length,
      uniqueEntities: entities.size,
      playerEntries,
      teamEntries,
      unknownEntities,
      missingSalaries,
      missingPlayerIds,
      missingTeamIds,
      missingGameIds,
      salaryConflicts
    },

    eventSample: detail.events.slice(0, 3).map(
      event => ({
        id: event.id ?? null,
        gameId: event.game_id ?? null,
        startsAt: event.starts_at ?? null,
        keys: Object.keys(event)
      })
    ),

    draftableSample: rows.slice(0, 5).map(
      row => ({
        id: row.id ?? null,
        playerId: row.player_id ?? null,
        teamId: row.team_id ?? null,
        gameId: row.game_id ?? null,
        eventId: row.slate_event_id ?? null,
        entityType: row.entity_type ?? null,
        name: row.display_name ?? null,
        position: row.position ?? null,
        salary: row.salary ?? null,
        rosterSlotId: row.roster_slot_id ?? null
      })
    ),

    draftableFields:
      rows.length ? Object.keys(rows[0]) : [],

    moreDraftablePages:
      draftableResponse.meta?.next_cursor != null,

    moreSlatePages:
      listed.meta?.next_cursor != null,

    note:
      "Diagnostico de primera pagina. " +
      "No certifica cobertura total, identidades, " +
      "reglas especiales ni proyecciones."
  };
}

// Ejecuta las cuatro combinaciones de forma
// secuencial, con el mismo regulador de peticiones.

async function auditDfsMatrix({
  startDate,
  nflSeason,
  nflWeek,
  waitMs = 15000,
  fetchFn = fetch,
  nbaApiKey,
  nflApiKey
} = {}) {
  const results = [];

  for (const sport of SPORTS) {
    for (const platform of PLATFORMS) {
      try {
        const result = await auditDfsFeed({
          sport,
          platform,
          startDate,
          season:
            sport === "nfl"
              ? nflSeason
              : undefined,
          week:
            sport === "nfl"
              ? nflWeek
              : undefined,
          waitMs,
          fetchFn,
          apiKey:
            sport === "nba"
              ? nbaApiKey
              : nflApiKey
        });

        results.push(result);

      } catch (error) {
        results.push({
          sport,
          platform,
          accessConfirmed: false,
          error: error.message
        });
      }
    }
  }

  return {
    mode: "fantasy_dfs_diagnostic",
    readOnly: true,
    combinationsChecked: results.length,
    results
  };
}

module.exports = {
  auditDfsFeed,
  auditDfsMatrix
};

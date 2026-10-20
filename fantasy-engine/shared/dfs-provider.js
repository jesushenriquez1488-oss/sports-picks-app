
"use strict";

// Fantasy Edge: conexion DFS independiente.
// Solo servidor. Nunca exponer API keys al cliente.

const BASE = "https://api.balldontlie.io";
const SPORTS = new Set(["nba", "nfl"]);
const PLATFORMS = new Set(["draftkings", "fanduel"]);

function validate(sport, platform) {
  if (!SPORTS.has(sport) || !PLATFORMS.has(platform)) {
    throw new Error("Deporte o plataforma no admitidos");
  }
}

function optionalNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getApiKey(sport, suppliedKey) {
  const key =
    suppliedKey ||
    (sport === "nfl"
      ? process.env.BALLDONTLIE_NFL_API_KEY
      : null) ||
    process.env.BALLDONTLIE_API_KEY;

  if (!key) {
    throw new Error(
      "Falta la clave BALLDONTLIE para " + sport
    );
  }

  return key;
}

async function requestDFS(sport, path, params, apiKey) {
  const url = new URL(
    `${BASE}/${sport}/v1/dfs/${path}`
  );

  for (const [key, value] of Object.entries(params || {})) {
    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      url.searchParams.append(key, String(value));
    }
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: apiKey
      },
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      if (
        response.status === 401 ||
        response.status === 403
      ) {
        throw new Error(
          `BALLDONTLIE ${sport} DFS HTTP ${response.status}: comprobar clave y acceso GOAT`
        );
      }

      throw new Error(
        `BALLDONTLIE ${sport} DFS HTTP ${response.status}`
      );
    }

    return await response.json();

  } finally {
    clearTimeout(timeout);
  }
}

async function allPages(sport, path, params, apiKey) {
  const result = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 50; page++) {
    const response = await requestDFS(
      sport,
      path,
      {
        ...params,
        per_page: 100,
        ...(cursor === null ? {} : { cursor })
      },
      apiKey
    );

    if (!Array.isArray(response?.data)) {
      throw new Error(
        "Respuesta DFS sin lista data"
      );
    }

    result.push(...response.data);

    const next = response?.meta?.next_cursor;

    if (
      next === null ||
      next === undefined ||
      next === ""
    ) {
      return result;
    }

    if (seen.has(String(next))) {
      throw new Error(
        "Cursor DFS repetido; paginacion detenida"
      );
    }

    seen.add(String(next));
    cursor = next;
  }

  throw new Error(
    "Limite de 50 paginas DFS alcanzado"
  );
}

// ==============================================
// LISTAR SLATES POR DEPORTE Y PLATAFORMA
// ==============================================

async function listFantasySlates({
  sport,
  platform,
  startDate,
  endDate,
  apiKey
} = {}) {
  validate(sport, platform);

  if (
    startDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
  ) {
    throw new Error(
      "startDate debe ser YYYY-MM-DD"
    );
  }

  if (
    endDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    throw new Error(
      "endDate debe ser YYYY-MM-DD"
    );
  }

  const key = getApiKey(sport, apiKey);

  const rows = await allPages(
    sport,
    "slates",
    {
      "providers[]": platform,
      "formats[]": "salary_cap",
      "scopes[]": "multi_event",
      active: true,
      start_date: startDate,
      end_date: endDate
    },
    key
  );

  return rows.map(row => ({
    id: row.id,
    sport: row.sport,
    platform: row.provider,
    format: row.format,
    scope: row.scope,
    style: row.style,
    salaryCap: optionalNumber(row.salary_cap),
    startsAt: row.starts_at,
    lastEventStartsAt: row.last_event_starts_at,
    eventCount: row.event_count,
    allowLateSwap: row.allow_late_swap,
    active: row.active,
    status: row.status,
    updatedAt: row.updated_at
  }));
}

// ==============================================
// OBTENER SLATE COMPLETO Y SALARIOS
// ==============================================

async function loadFantasySlate({
  sport,
  platform,
  slateId,
  apiKey
} = {}) {
  validate(sport, platform);

  if (!/^\d+$/.test(String(slateId ?? ""))) {
    throw new Error("slateId invalido");
  }

  const key = getApiKey(sport, apiKey);

  const response = await requestDFS(
    sport,
    `slates/${slateId}`,
    {},
    key
  );

  const slate = response?.data;

  if (
    !slate ||
    slate.sport !== sport ||
    slate.provider !== platform
  ) {
    throw new Error(
      "Slate no corresponde al deporte y plataforma seleccionados"
    );
  }

  if (
    !Array.isArray(slate.events) ||
    !Array.isArray(slate.roster_slots)
  ) {
    throw new Error(
      "Slate sin partidos o posiciones verificables"
    );
  }

  const entries = await allPages(
    sport,
    "draftables",
    {
      "slate_ids[]": slateId,
      active: true
    },
    key
  );

  return {
    id: slate.id,
    sport,
    platform,
    format: slate.format,
    scope: slate.scope,
    style: slate.style,
    salaryCap: optionalNumber(slate.salary_cap),
    startsAt: slate.starts_at,
    updatedAt: slate.updated_at,
    allowLateSwap: slate.allow_late_swap,

    events: slate.events.map(event => ({
      id: event.id,
      gameId: event.game_id ?? null,
      name: event.name,
      startsAt: event.starts_at,
      active: event.active
    })),

    rosterSlots: slate.roster_slots.map(slot => ({
      id: slot.id,
      name: slot.name,
      requiredCount: slot.required_count,
      displayOrder: slot.display_order,
      active: slot.active
    })),

    // Un jugador puede aparecer en varios slots.
    // El optimizador debe impedir utilizarlo
    // mas de una vez dentro de la alineacion.

    draftables: entries.map(entry => ({
      id: entry.id,
      slateId: entry.slate_id,
      eventId: entry.slate_event_id,
      rosterSlotId: entry.roster_slot_id,
      gameId: entry.game_id ?? null,
      playerId: entry.player_id ?? null,
      teamId: entry.team_id ?? null,
      entityType: entry.entity_type,
      name: entry.display_name,
      position: entry.position,
      salary: optionalNumber(entry.salary),
      status: entry.status,
      disabled: entry.is_disabled,
      swappable: entry.is_swappable,
      team: entry.team_abbreviation,
      active: entry.active,
      updatedAt: entry.updated_at
    }))
  };
}

module.exports = {
  listFantasySlates,
  loadFantasySlate
};

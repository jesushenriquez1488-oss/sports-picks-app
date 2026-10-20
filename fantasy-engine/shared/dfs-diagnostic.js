
"use strict";

// Fantasy Edge — Diagnostico DFS
// Solo lectura. No modifica Supabase.
// Para ejecutar en un servicio Fantasy aislado.

const {
  getContestConfig
} = require("./contest-config");

const BASE = "https://api.balldontlie.io";

const SPORTS = new Set(["nba", "nfl"]);

const PLATFORMS = new Set([
  "draftkings",
  "fanduel"
]);

const pause = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function auditDfsFeed({
  sport,
  platform,
  startDate = new Date().toISOString().slice(0, 10),
  waitMs = 15000,
  fetchFn = fetch,
  apiKey
} = {}) {

  if (
    !SPORTS.has(sport) ||
    !PLATFORMS.has(platform)
  ) {
    throw new Error(
      "Deporte o plataforma invalidos"
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(
      "Fecha invalida. Usa YYYY-MM-DD"
    );
  }

  if (
    !Number.isInteger(waitMs) ||
    waitMs < 0
  ) {
    throw new Error("Espera invalida");
  }

  const key =
    apiKey ||
    (
      sport === "nba"
        ? process.env.BALLDONTLIE_NBA_API_KEY
        : process.env.BALLDONTLIE_NFL_API_KEY
    ) ||
    process.env.BALLDONTLIE_API_KEY;

  if (!key) {
    throw new Error(
      `Falta API key para ${sport}`
    );
  }

  let requests = 0;

  async function get(path, params = {}) {

    if (requests > 0) {
      await pause(waitMs);
    }

    requests++;

    const url = new URL(
      `${BASE}/${sport}/v1/dfs/${path}`
    );

    for (
      const [name, value]
      of Object.entries(params)
    ) {
      url.searchParams.set(
        name,
        String(value)
      );
    }

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      15000
    );

    try {

      const response = await fetchFn(
        url.toString(),
        {
          headers: {
            Authorization: key
          },
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(
          `BALLDONTLIE ${sport} HTTP ${response.status}` +
          (
            response.status === 429
              ? ": limite de peticiones"
              : ""
          )
        );
      }

      return await response.json();

    } finally {
      clearTimeout(timeout);
    }
  }

  // 1. Buscar slates Classic disponibles.
  // Solo una pagina para limitar peticiones.

  const listed = await get("slates", {
    "providers[]": platform,
    "formats[]": "salary_cap",
    "scopes[]": "multi_event",
    active: true,
    start_date: startDate,
    per_page: 100
  });

  if (!Array.isArray(listed?.data)) {
    throw new Error(
      "Lista DFS sin data valida"
    );
  }

  const choices = listed.data.filter(row =>
    row.provider === platform &&
    row.sport === sport &&
    row.format === "salary_cap" &&
    row.scope === "multi_event" &&
    String(row.style || "")
      .toLowerCase()
      .includes("classic")
  );

  if (!choices.length) {
    return {
      ok: true,
      accessConfirmed: true,
      slateAvailable: false,
      sport,
      platform,
      startDate,
      returnedSlates: listed.data.length,
      morePages:
        listed?.meta?.next_cursor != null,
      requests
    };
  }

  choices.sort((a, b) =>
    String(a.starts_at || "")
      .localeCompare(
        String(b.starts_at || "")
      )
  );

  const chosen = choices[0];

  // 2. Consultar partidos y posiciones.

  const detailResult = await get(
    `slates/${encodeURIComponent(chosen.id)}`
  );

  const detail = detailResult?.data;

  if (
    String(detail?.id) !== String(chosen.id) ||
    detail?.provider !== platform ||
    detail?.sport !== sport ||
    !Array.isArray(detail?.events) ||
    !Array.isArray(detail?.roster_slots)
  ) {
    throw new Error(
      "Detalle DFS inconsistente o incompleto"
    );
  }

  // 3. Consultar primera pagina de salarios.

  const draftablesResult = await get(
    "draftables",
    {
      "slate_ids[]": chosen.id,
      per_page: 100,
      active: true
    }
  );

  if (!Array.isArray(draftablesResult?.data)) {
    throw new Error(
      "Draftables DFS sin data valida"
    );
  }

  const entries = draftablesResult.data;

  const expected = getContestConfig({
    sport,
    platform
  });

  const requiredSlots = detail.roster_slots
    .filter(slot => slot.active !== false)
    .reduce(
      (sum, slot) =>
        sum + Number(slot.required_count || 0),
      0
    );

  const entities = new Set();
  const missingSalary = [];
  const orphanSlotIds = new Set();

  const slots = new Set(
    detail.roster_slots.map(
      slot => String(slot.id)
    )
  );

  for (const entry of entries) {

    const identity =
      entry.entity_type === "team"
        ? `team:${entry.team_id ?? entry.id}`
        : `player:${entry.player_id ?? entry.id}`;

    entities.add(identity);

    if (
      entry.salary == null ||
      !Number.isFinite(Number(entry.salary))
    ) {
      missingSalary.push(entry.id);
    }

    if (
      !slots.has(
        String(entry.roster_slot_id)
      )
    ) {
      orphanSlotIds.add(
        String(entry.roster_slot_id)
      );
    }
  }

  return {
    ok: true,
    accessConfirmed: true,
    slateAvailable: true,
    sport,
    platform,
    startDate,

    slate: {
      id: detail.id,
      style: detail.style,
      startsAt: detail.starts_at,
      eventCount: detail.events.length,
      salaryCap: detail.salary_cap,
      rosterSize: requiredSlots,
      lateSwap: detail.allow_late_swap
    },

    checks: {
      salaryCapMatchesClassic:
        Number(detail.salary_cap) ===
        expected.salaryCap,

      rosterSizeMatchesClassic:
        requiredSlots === expected.rosterSize,

      hasRealEvents:
        detail.events.length > 0,

      hasSalaryData:
        entries.some(
          entry => Number(entry.salary) > 0
        ),

      invalidRosterSlotReferences:
        [...orphanSlotIds]
    },

    draftablesFirstPage:
      entries.length,

    uniqueEntitiesFirstPage:
      entities.size,

    missingSalaryFirstPage:
      missingSalary.length,

    moreDraftablePages:
      draftablesResult?.meta?.next_cursor != null,

    sample: entries.slice(0, 4).map(
      entry => ({
        id: entry.id,
        name: entry.display_name,
        entityType: entry.entity_type,
        position: entry.position,
        salary: entry.salary,
        rosterSlotId: entry.roster_slot_id
      })
    ),

    requests,

    note:
      "Muestra inicial: no confirma cobertura total ni reglas de puntuacion"
  };
}

module.exports = {
  auditDfsFeed
};

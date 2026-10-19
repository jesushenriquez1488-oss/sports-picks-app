
"use strict";

const PREFIX = "[learning-split-feed]";
const CAPTURE_CHUNK_SIZE = 500;

// ============================================================
// HELPERS
// ============================================================

function txt(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ============================================================
// SPLIT EVENT DATE
// ============================================================

function splitEventDate(event) {
  const eventId = txt(event?.event_id);
  if (!eventId) return null;

  const match = eventId.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;

  const [, year, month, day] = match;
  const result = `${year}-${month}-${day}`;

  return Number.isFinite(Date.parse(`${result}T12:00:00Z`))
    ? result
    : null;
}

function normalizeSourceKey(value) {
  const key = normalize(value);

  if (key === "dk") return "draftkings";
  if (key === "fd") return "fanduel";

  return key;
}

// ============================================================
// EVENT IDENTITY
// ============================================================

function splitGameIdentity({ sport, event }) {
  const date = splitEventDate(event);
  if (!date) return null;

  const away = normalize(event?.away_team);
  const home = normalize(event?.home_team);

  if (!sport || !away || !home) return null;

  return [normalize(sport), date, away, home].join("|");
}

// ============================================================
// DEDUPLICATE STATES
// ============================================================

function pushState(map, state) {
  if (
    !state?.cashedge_game_id ||
    !state?.sport ||
    !state?.provider ||
    !state?.split_source_key ||
    !state?.market_type ||
    !state?.selection_key ||
    !Number.isFinite(state.money_pct) ||
    !Number.isFinite(state.tickets_pct)
  ) {
    return;
  }

  const identity = [
    state.sport,
    state.cashedge_game_id,
    state.provider,
    state.split_source_key,
    state.market_type,
    state.selection_key
  ].join("|");

  map.set(identity, state);
}

// ============================================================
// BUILD STATES
// ============================================================

function buildSourceStates({
  sport,
  tracked,
  event,
  providerSplit,
  observedAt,
  normalizeSelectionKey
}) {
  const states = [];

  const sourceKey = normalizeSourceKey(providerSplit?.book);
  if (!sourceKey) return states;

  const selectionNormalizer =
    typeof normalizeSelectionKey === "function"
      ? normalizeSelectionKey
      : normalize;

  const away = selectionNormalizer(event?.away_team);
  const home = selectionNormalizer(event?.home_team);

  if (!away || !home) return states;

  const base = {
    cashedge_game_id: tracked.cashedge_game_id,
    sport: normalize(sport),
    provider: "owls",
    split_source_key: sourceKey,
    provider_timestamp: null,
    observed_at: observedAt
  };

  // ==========================================================
  // SPREAD
  // ==========================================================

  const spread = providerSplit?.spread;

  if (spread) {
    const awayLine = num(spread.away_line);
    const awayMoney = num(spread.away_handle_pct);
    const awayTickets = num(spread.away_bets_pct);

    const homeLine = num(spread.home_line);
    const homeMoney = num(spread.home_handle_pct);
    const homeTickets = num(spread.home_bets_pct);

    if (
      awayLine !== null &&
      awayMoney !== null &&
      awayTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "spread",
        selection_key: away,
        line: awayLine,
        price_american: null,
        money_pct: awayMoney,
        tickets_pct: awayTickets
      });
    }

    if (
      homeLine !== null &&
      homeMoney !== null &&
      homeTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "spread",
        selection_key: home,
        line: homeLine,
        price_american: null,
        money_pct: homeMoney,
        tickets_pct: homeTickets
      });
    }
  }

  // ==========================================================
  // TOTAL
  // ==========================================================

  const total = providerSplit?.total;

  if (total) {
    const line = num(total.line);
    const overMoney = num(total.over_handle_pct);
    const overTickets = num(total.over_bets_pct);
    const underMoney = num(total.under_handle_pct);
    const underTickets = num(total.under_bets_pct);

    if (
      line !== null &&
      overMoney !== null &&
      overTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "total",
        selection_key: "over",
        line,
        price_american: null,
        money_pct: overMoney,
        tickets_pct: overTickets
      });
    }

    if (
      line !== null &&
      underMoney !== null &&
      underTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "total",
        selection_key: "under",
        line,
        price_american: null,
        money_pct: underMoney,
        tickets_pct: underTickets
      });
    }
  }

  // ==========================================================
  // MONEYLINE
  // ==========================================================

  const ml = providerSplit?.moneyline;

  if (ml) {
    const awayPrice = num(ml.away_price);
    const awayMoney = num(ml.away_handle_pct);
    const awayTickets = num(ml.away_bets_pct);

    const homePrice = num(ml.home_price);
    const homeMoney = num(ml.home_handle_pct);
    const homeTickets = num(ml.home_bets_pct);

    if (
      awayPrice !== null &&
      awayMoney !== null &&
      awayTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "moneyline",
        selection_key: away,
        line: null,
        price_american: Math.round(awayPrice),
        money_pct: awayMoney,
        tickets_pct: awayTickets
      });
    }

    if (
      homePrice !== null &&
      homeMoney !== null &&
      homeTickets !== null
    ) {
      states.push({
        ...base,
        market_type: "moneyline",
        selection_key: home,
        line: null,
        price_american: Math.round(homePrice),
        money_pct: homeMoney,
        tickets_pct: homeTickets
      });
    }
  }

  return states;
}

// ============================================================
// CAPTURE SPLIT BOARD
// ============================================================

async function captureSplitBoard({
  sport,
  events,
  learningCapture,
  resolveGame,
  normalizeSelectionKey
}) {
  if (
    !learningCapture ||
    typeof learningCapture.captureSplitStates !== "function" ||
    typeof learningCapture.getStatus !== "function" ||
    typeof resolveGame !== "function"
  ) {
    return {
      ok: false,
      written: 0,
      reason: "split_dependencies_unavailable"
    };
  }

  if (learningCapture.getStatus()?.active !== true) {
    return {
      ok: true,
      written: 0,
      skipped: true,
      reason: "learning_disabled"
    };
  }

  const list = Array.isArray(events) ? events : [];
  const identityCounts = new Map();

  for (const event of list) {
    const identity = splitGameIdentity({ sport, event });

    if (identity) {
      identityCounts.set(
        identity,
        (identityCounts.get(identity) || 0) + 1
      );
    }
  }

  const stateMap = new Map();

  let matchedEvents = 0;
  let ambiguousEvents = 0;
  let unmatchedEvents = 0;

  // NEW DIAGNOSTIC COUNTERS
  let invalidEventIds = 0;
  let resolverMisses = 0;
  let emptySources = 0;

  const observedAt = new Date().toISOString();

  for (const event of list) {
    const identity = splitGameIdentity({ sport, event });

    if (!identity) {
      unmatchedEvents++;
      invalidEventIds++;
      continue;
    }

    if ((identityCounts.get(identity) || 0) !== 1) {
      ambiguousEvents++;
      continue;
    }

    const eventDate = splitEventDate(event);
    let tracked = null;

    try {
      tracked = resolveGame({
        sport,
        event,
        eventDate
      });
    } catch (error) {
      console.error(
        `${PREFIX} resolver failed: ${error?.message || error}`
      );
      continue;
    }

    if (!tracked?.cashedge_game_id) {
      unmatchedEvents++;
      resolverMisses++;
      continue;
    }

    matchedEvents++;

    const sources = Array.isArray(event?.splits)
      ? event.splits
      : [];

    if (!sources.length) {
      emptySources++;
    }

    for (const providerSplit of sources) {
      const states = buildSourceStates({
        sport,
        tracked,
        event,
        providerSplit,
        observedAt,
        normalizeSelectionKey
      });

      for (const state of states) {
        pushState(stateMap, state);
      }
    }
  }

  const states = Array.from(stateMap.values());
  let written = 0;

  for (
    let index = 0;
    index < states.length;
    index += CAPTURE_CHUNK_SIZE
  ) {
    const chunk = states.slice(
      index,
      index + CAPTURE_CHUNK_SIZE
    );

    const result = await learningCapture.captureSplitStates(chunk);

    if (result?.ok !== true) {
      return {
        ok: false,
        matchedEvents,
        ambiguousEvents,
        unmatchedEvents,
        invalidEventIds,
        resolverMisses,
        emptySources,
        states: states.length,
        written,
        reason: "capture_failed"
      };
    }

    written += Number(result.written || 0);
  }

  return {
    ok: true,
    matchedEvents,
    ambiguousEvents,
    unmatchedEvents,
    invalidEventIds,
    resolverMisses,
    emptySources,
    states: states.length,
    written
  };
}

// ============================================================
// SAFE WRAPPER + DIAGNOSTICS
// ============================================================

async function captureSplitBoardSafe(args) {
  try {
    const result = await captureSplitBoard(args);

    const list = Array.isArray(args?.events)
      ? args.events
      : [];

    const sample = list[0] || null;
    const sampleId = txt(sample?.event_id);

    // IMPORTANT:
    // ALWAYS LOG THE RESULT, EVEN IF WRITTEN IS ZERO.

    console.log(
      `${PREFIX} diagnostic sport=${String(args?.sport || "")}, ` +
      `events=${list.length}, ` +
      `matched=${Number(result?.matchedEvents || 0)}, ` +
      `ambiguous=${Number(result?.ambiguousEvents || 0)}, ` +
      `unmatched=${Number(result?.unmatchedEvents || 0)}, ` +
      `invalid_ids=${Number(result?.invalidEventIds || 0)}, ` +
      `resolver_misses=${Number(result?.resolverMisses || 0)}, ` +
      `empty_sources=${Number(result?.emptySources || 0)}, ` +
      `states=${Number(result?.states || 0)}, ` +
      `written=${Number(result?.written || 0)}, ` +
      `ok=${result?.ok === true}, ` +
      `reason=${String(result?.reason || "none")}, ` +
      `sample_event_id=${JSON.stringify(sampleId?.slice(0, 80) || null)}, ` +
      `sample_date=${splitEventDate(sample) || "null"}`
    );

    if (result?.ok !== true) {
      console.error(`${PREFIX} capture unsuccessful`);
    }

    return result;
  } catch (error) {
    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );

    return {
      ok: false,
      written: 0
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  captureSplitBoardSafe,
  captureSplitBoard,
  splitEventDate
};

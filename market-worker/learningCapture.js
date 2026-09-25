"use strict";

const crypto = require("crypto");

const PREFIX = "[learning-capture]";

const ENABLED =
  String(process.env.LEARNING_ENABLED || "").toLowerCase() === "true";

const URL =
  String(process.env.LEARNING_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

const KEY =
  String(process.env.LEARNING_SUPABASE_SERVICE_ROLE_KEY || "").trim();

const TIMEOUT_MS = 5000;
const HEAD_PAGE_SIZE = 1000;


// ============================================================
// IN-MEMORY STATE
// ============================================================

const lastMarket = new Map();
const lastCashEdge = new Map();

const hydrated = {
  market: false,
  cashedge: false
};

const hydrationPromises = {
  market: null,
  cashedge: null
};

let warnedMissingConfig = false;


// ============================================================
// HELPERS
// ============================================================

function txt(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const output = String(value).trim();
  return output || null;
}


function low(value) {
  const output = txt(value);

  return output
    ? output.toLowerCase()
    : null;
}


function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const output = Number(value);

  return Number.isFinite(output)
    ? output
    : null;
}


function int(value) {
  const output = num(value);

  return output === null
    ? null
    : Math.trunc(output);
}


function ts(value) {
  if (!value) {
    return null;
  }

  const output = new Date(value);

  return Number.isNaN(output.getTime())
    ? null
    : output.toISOString();
}


function bool(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  );
}


function hash(...parts) {
  return crypto
    .createHash("sha256")
    .update(
      parts
        .map(value => String(value ?? "∅"))
        .join("|")
    )
    .digest("hex");
}


// ============================================================
// SAFETY / FEATURE FLAG
// ============================================================

function active() {
  if (!ENABLED) {
    return false;
  }

  if (URL && KEY) {
    return true;
  }

  if (!warnedMissingConfig) {
    warnedMissingConfig = true;

    console.warn(
      `${PREFIX} disabled: missing Learning Supabase environment variables`
    );
  }

  return false;
}


// ============================================================
// SAFE HTTP
// ============================================================

async function request(path, options = {}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

  timer.unref?.();

  try {
    return await fetch(
      `${URL}/rest/v1/${path}`,
      {
        ...options,

        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          ...(options.headers || {})
        },

        signal: controller.signal
      }
    );

  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// IDENTITIES / SIGNATURES
// ============================================================

function marketIdentity(row) {
  return (
    `${row.sport}|` +
    `${row.cashedge_game_id}|` +
    `${row.provider}|` +
    `${row.sportsbook_key}|` +
    `${row.market_type}|` +
    `${row.selection_key}`
  );
}


function marketSignature(row) {
  return hash(
    row.line,
    row.price_american
  );
}


function cashEdgeIdentity(row) {
  return (
    `${row.sport}|` +
    `${row.cashedge_game_id}|` +
    `${row.market_type}|` +
    `${row.selection_key || ""}`
  );
}


function cashEdgeSignature(row) {
  return hash(
    row.pick_text,
    row.line,
    row.price_american,
    row.projection,
    row.edge,
    row.confidence,
    row.is_premium,
    row.is_primary,
    row.projected_home_score,
    row.projected_away_score
  );
}


// ============================================================
// MARKET NORMALIZATION
// ============================================================

function normalizeMarket(input = {}) {
  const row = {

    cashedge_game_id:
      txt(input.cashedge_game_id),

    sport:
      low(input.sport),

    provider:
      low(input.provider),

    provider_event_id:
      txt(input.provider_event_id),

    sportsbook_key:
      low(input.sportsbook_key),

    market_type:
      low(input.market_type),

    selection_key:
      low(input.selection_key),

    line:
      num(input.line),

    price_american:
      int(input.price_american),

    provider_timestamp:
      ts(input.provider_timestamp),

    observed_at:
      ts(input.observed_at) ||
      new Date().toISOString()
  };


  if (
    !row.cashedge_game_id ||
    !row.sport ||
    !row.provider ||
    !row.sportsbook_key ||
    !row.market_type ||
    !row.selection_key ||
    row.price_american === null
  ) {
    return null;
  }


  const identity =
    marketIdentity(row);

  const signature =
    marketSignature(row);


  row.dedupe_key =
    hash(
      "market",
      identity,
      signature,
      row.provider_timestamp ||
        row.observed_at
    );


  return row;
}


// ============================================================
// CASHEDGE NORMALIZATION
// ============================================================

function normalizeCashEdge(input = {}) {
  const row = {

    cashedge_game_id:
      txt(input.cashedge_game_id),

    sport:
      low(input.sport),

    market_type:
      low(input.market_type),

    selection_key:
      low(input.selection_key),

    pick_text:
      txt(input.pick_text),

    line:
      num(input.line),

    price_american:
      int(input.price_american),

    projection:
      num(input.projection),

    edge:
      num(input.edge),

    confidence:
      num(input.confidence),

    is_premium:
      bool(input.is_premium),

    is_primary:
      bool(input.is_primary),

    projected_home_score:
      num(input.projected_home_score),

    projected_away_score:
      num(input.projected_away_score),

    source_updated_at:
      ts(input.source_updated_at),

    observed_at:
      ts(input.observed_at) ||
      new Date().toISOString()
  };


  if (
    !row.cashedge_game_id ||
    !row.sport ||
    !row.market_type
  ) {
    return null;
  }


  const identity =
    cashEdgeIdentity(row);

  const signature =
    cashEdgeSignature(row);


  row.dedupe_key =
    hash(
      "cashedge",
      identity,
      signature,
      row.source_updated_at ||
        row.observed_at
    );


  return row;
}


// ============================================================
// DURABLE HEAD CACHE
// ============================================================

async function loadHeads(
  streamType,
  cache
) {
  let start = 0;

  try {

    while (true) {

      const end =
        start +
        HEAD_PAGE_SIZE -
        1;


      const response =
        await request(
          `learning_capture_heads?select=identity_key,signature&stream_type=eq.${encodeURIComponent(streamType)}&order=identity_key.asc`,
          {
            method:
              "GET",

            headers: {
              Range:
                `${start}-${end}`,

              "Range-Unit":
                "items"
            }
          }
        );


      if (!response.ok) {

        const detail =
          (
            await response.text()
          ).slice(
            0,
            300
          );


        console.error(
          `${PREFIX} head load failed (${streamType}) HTTP ${response.status}: ${detail}`
        );

        return false;
      }


      const rows =
        await response
          .json()
          .catch(
            () => null
          );


      if (!Array.isArray(rows)) {

        console.error(
          `${PREFIX} head load failed (${streamType}): invalid response`
        );

        return false;
      }


      for (
        const row
        of rows
      ) {

        const identityKey =
          txt(
            row?.identity_key
          );

        const signature =
          txt(
            row?.signature
          );


        if (
          identityKey &&
          signature
        ) {

          cache.set(
            identityKey,
            signature
          );
        }
      }


      if (
        rows.length <
        HEAD_PAGE_SIZE
      ) {
        break;
      }


      start +=
        HEAD_PAGE_SIZE;
    }


    return true;

  } catch (error) {

    console.error(
      `${PREFIX} head load failed (${streamType}): ${error?.message || error}`
    );

    return false;
  }
}


// ============================================================
// SAFE HYDRATION
// ============================================================

async function ensureHydrated(
  streamType,
  cache
) {

  if (!active()) {
    return false;
  }


  if (
    hydrated[streamType] ===
    true
  ) {
    return true;
  }


  if (
    hydrationPromises[
      streamType
    ]
  ) {

    return hydrationPromises[
      streamType
    ];
  }


  hydrationPromises[
    streamType
  ] =
    (async () => {

      const ok =
        await loadHeads(
          streamType,
          cache
        );


      if (ok) {
        hydrated[
          streamType
        ] =
          true;
      }


      return ok;
    })();


  try {

    return await hydrationPromises[
      streamType
    ];

  } finally {

    if (
      hydrated[
        streamType
      ] !== true
    ) {

      hydrationPromises[
        streamType
      ] =
        null;
    }
  }
}


// ============================================================
// PERSIST LAST STATE
// ============================================================

async function upsertHeads(
  streamType,
  pending
) {

  if (!pending.size) {
    return true;
  }


  const now =
    new Date()
      .toISOString();


  const rows =
    Array.from(
      pending,
      (
        [
          identity_key,
          signature
        ]
      ) => ({
        stream_type:
          streamType,

        identity_key,

        signature,

        updated_at:
          now
      })
    );


  try {

    const response =
      await request(
        "learning_capture_heads?on_conflict=stream_type%2Cidentity_key",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "resolution=merge-duplicates,return=minimal"
          },

          body:
            JSON.stringify(
              rows
            )
        }
      );


    if (response.ok) {
      return true;
    }


    const detail =
      (
        await response.text()
      ).slice(
        0,
        300
      );


    console.error(
      `${PREFIX} head update failed (${streamType}) HTTP ${response.status}: ${detail}`
    );


    return false;

  } catch (error) {

    console.error(
      `${PREFIX} head update failed (${streamType}): ${error?.message || error}`
    );


    return false;
  }
}


// ============================================================
// HISTORY WRITE
// ============================================================

async function insertRows(
  table,
  rows
) {

  if (
    !rows.length ||
    !active()
  ) {
    return false;
  }


  try {

    const response =
      await request(
        `${table}?on_conflict=dedupe_key`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "resolution=ignore-duplicates,return=minimal"
          },

          body:
            JSON.stringify(
              rows
            )
        }
      );


    if (response.ok) {
      return true;
    }


    const detail =
      (
        await response.text()
      ).slice(
        0,
        300
      );


    console.error(
      `${PREFIX} ${table} write failed HTTP ${response.status}: ${detail}`
    );


    return false;

  } catch (error) {

    console.error(
      `${PREFIX} ${table} write failed: ${error?.message || error}`
    );


    return false;
  }
}


// ============================================================
// GENERIC CAPTURE
// ============================================================

async function capture({
  inputs,
  streamType,
  table,
  normalize,
  identity,
  signature,
  cache
}) {

  try {

    if (!active()) {

      return {
        ok: true,
        written: 0,
        disabled: true
      };
    }


    const ready =
      await ensureHydrated(
        streamType,
        cache
      );


    if (!ready) {

      return {
        ok: false,
        written: 0,
        reason:
          "head_cache_unavailable"
      };
    }


    const rows =
      [];

    const pending =
      new Map();


    for (
      const input
      of Array.isArray(inputs)
        ? inputs
        : [inputs]
    ) {

      const row =
        normalize(
          input
        );


      if (!row) {
        continue;
      }


      const id =
        identity(
          row
        );

      const sig =
        signature(
          row
        );


      const previous =
        pending.has(
          id
        )
          ? pending.get(
              id
            )
          : cache.get(
              id
            );


      if (
        previous ===
        sig
      ) {
        continue;
      }


      pending.set(
        id,
        sig
      );


      rows.push(
        row
      );
    }


    if (
      !rows.length
    ) {

      return {
        ok: true,
        written: 0
      };
    }


    const historyOk =
      await insertRows(
        table,
        rows
      );


    if (!historyOk) {

      return {
        ok: false,
        written: 0
      };
    }


    /*
     * History succeeded.
     * Update RAM immediately so a temporary
     * head-write problem cannot create spam
     * while this worker remains alive.
     */
    for (
      const [
        id,
        sig
      ]
      of pending
    ) {

      cache.set(
        id,
        sig
      );
    }


    const headOk =
      await upsertHeads(
        streamType,
        pending
      );


    return {
      ok: true,

      written:
        rows.length,

      head_persisted:
        headOk
    };

  } catch (error) {

    console.error(
      `${PREFIX} capture failed (${streamType}): ${error?.message || error}`
    );


    return {
      ok: false,
      written: 0
    };
  }
}


// ============================================================
// PUBLIC API
// ============================================================

async function initialize() {

  try {

    if (!active()) {

      return {
        ok: true,
        disabled: true
      };
    }


    const [
      marketReady,
      cashEdgeReady
    ] =
      await Promise.all([
        ensureHydrated(
          "market",
          lastMarket
        ),

        ensureHydrated(
          "cashedge",
          lastCashEdge
        )
      ]);


    return {
      ok:
        marketReady &&
        cashEdgeReady,

      market_ready:
        marketReady,

      cashedge_ready:
        cashEdgeReady
    };

  } catch (error) {

    console.error(
      `${PREFIX} initialize failed: ${error?.message || error}`
    );


    return {
      ok: false,
      market_ready: false,
      cashedge_ready: false
    };
  }
}


function captureMarketStates(
  inputs
) {

  return capture({

    inputs,

    streamType:
      "market",

    table:
      "learning_market_states",

    normalize:
      normalizeMarket,

    identity:
      marketIdentity,

    signature:
      marketSignature,

    cache:
      lastMarket
  });
}


function captureCashEdgeStates(
  inputs
) {

  return capture({

    inputs,

    streamType:
      "cashedge",

    table:
      "learning_cashedge_states",

    normalize:
      normalizeCashEdge,

    identity:
      cashEdgeIdentity,

    signature:
      cashEdgeSignature,

    cache:
      lastCashEdge
  });
}


function getStatus() {

  return {

    enabled:
      ENABLED,

    configured:
      Boolean(
        URL &&
        KEY
      ),

    active:
      ENABLED &&
      Boolean(
        URL &&
        KEY
      ),

    market_hydrated:
      hydrated.market,

    cashedge_hydrated:
      hydrated.cashedge
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  initialize,
  captureMarketStates,
  captureCashEdgeStates,
  getStatus
};

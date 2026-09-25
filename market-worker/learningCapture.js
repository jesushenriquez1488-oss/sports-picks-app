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


// ============================================================
// IN-MEMORY STATE
// Prevents repeated writes while Railway is running.
// ============================================================

const lastMarket = new Map();
const lastCashEdge = new Map();

let warnedMissingConfig = false;


// ============================================================
// SMALL NORMALIZATION HELPERS
// ============================================================

const txt = (value) => {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const output =
    String(value).trim();

  return output || null;
};


const low = (value) => {

  const output =
    txt(value);

  return output
    ? output.toLowerCase()
    : null;
};


const num = (value) => {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const output =
    Number(value);

  return Number.isFinite(output)
    ? output
    : null;
};


const int = (value) => {

  const output =
    num(value);

  return output === null
    ? null
    : Math.trunc(output);
};


const ts = (value) => {

  if (!value) {
    return null;
  }

  const output =
    new Date(value);

  return Number.isNaN(
    output.getTime()
  )
    ? null
    : output.toISOString();
};


const bool = (value) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  value === "true";


const hash = (...parts) =>
  crypto
    .createHash("sha256")
    .update(
      parts
        .map(
          (value) =>
            String(
              value ?? "∅"
            )
        )
        .join("|")
    )
    .digest("hex");


// ============================================================
// FEATURE FLAG / SAFETY
// ============================================================

function active() {

  if (!ENABLED) {
    return false;
  }

  if (
    URL &&
    KEY
  ) {
    return true;
  }


  if (
    !warnedMissingConfig
  ) {

    warnedMissingConfig =
      true;

    console.warn(
      `${PREFIX} disabled: missing Learning Supabase environment variables`
    );
  }


  return false;
}


// ============================================================
// MARKET NORMALIZATION
// ============================================================

function normalizeMarket(
  input = {}
) {

  const row = {

    cashedge_game_id:
      txt(
        input.cashedge_game_id
      ),

    sport:
      low(
        input.sport
      ),

    provider:
      low(
        input.provider
      ),

    provider_event_id:
      txt(
        input.provider_event_id
      ),

    sportsbook_key:
      low(
        input.sportsbook_key
      ),

    market_type:
      low(
        input.market_type
      ),

    selection_key:
      low(
        input.selection_key
      ),

    line:
      num(
        input.line
      ),

    price_american:
      int(
        input.price_american
      ),

    provider_timestamp:
      ts(
        input.provider_timestamp
      ),

    observed_at:
      ts(
        input.observed_at
      ) ||
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


  row.dedupe_key =
    hash(
      row.cashedge_game_id,
      row.provider,
      row.provider_event_id,
      row.sportsbook_key,
      row.market_type,
      row.selection_key,
      row.line,
      row.price_american,
      row.provider_timestamp ||
        row.observed_at
    );


  return row;
}


// ============================================================
// CASHEDGE NORMALIZATION
// ============================================================

function normalizeCashEdge(
  input = {}
) {

  const row = {

    cashedge_game_id:
      txt(
        input.cashedge_game_id
      ),

    sport:
      low(
        input.sport
      ),

    market_type:
      low(
        input.market_type
      ),

    selection_key:
      low(
        input.selection_key
      ),

    pick_text:
      txt(
        input.pick_text
      ),

    line:
      num(
        input.line
      ),

    price_american:
      int(
        input.price_american
      ),

    projection:
      num(
        input.projection
      ),

    edge:
      num(
        input.edge
      ),

    confidence:
      num(
        input.confidence
      ),

    is_premium:
      bool(
        input.is_premium
      ),

    is_primary:
      bool(
        input.is_primary
      ),

    projected_home_score:
      num(
        input.projected_home_score
      ),

    projected_away_score:
      num(
        input.projected_away_score
      ),

    source_updated_at:
      ts(
        input.source_updated_at
      ),

    observed_at:
      ts(
        input.observed_at
      ) ||
      new Date().toISOString()
  };


  if (
    !row.cashedge_game_id ||
    !row.sport ||
    !row.market_type
  ) {
    return null;
  }


  row.dedupe_key =
    hash(
      row.cashedge_game_id,
      row.market_type,
      row.selection_key,
      row.pick_text,
      row.line,
      row.price_american,
      row.projection,
      row.edge,
      row.confidence,
      row.is_premium,
      row.is_primary,
      row.projected_home_score,
      row.projected_away_score,
      row.source_updated_at ||
        row.observed_at
    );


  return row;
}


// ============================================================
// CHANGE DETECTION
// ============================================================

function marketIdentity(
  row
) {

  return (
    `${row.cashedge_game_id}|` +
    `${row.provider}|` +
    `${row.sportsbook_key}|` +
    `${row.market_type}|` +
    `${row.selection_key}`
  );
}


function marketSignature(
  row
) {

  return hash(
    row.line,
    row.price_american
  );
}


function cashEdgeIdentity(
  row
) {

  return (
    `${row.cashedge_game_id}|` +
    `${row.market_type}|` +
    `${row.selection_key || ""}`
  );
}


function cashEdgeSignature(
  row
) {

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
// SUPABASE WRITE
//
// IMPORTANT:
// - Learning only.
// - Never throws outside this module.
// - 5 second timeout.
// - Duplicate dedupe_key values are ignored.
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


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );


  timer.unref?.();


  try {

    const response =
      await fetch(
        `${URL}/rest/v1/${table}?on_conflict=dedupe_key`,
        {

          method:
            "POST",

          headers: {

            apikey:
              KEY,

            Authorization:
              `Bearer ${KEY}`,

            "Content-Type":
              "application/json",

            Prefer:
              "resolution=ignore-duplicates,return=minimal"
          },

          body:
            JSON.stringify(
              rows
            ),

          signal:
            controller.signal
        }
      );


    if (
      response.ok
    ) {
      return true;
    }


    const detail =
      (
        await response.text()
      )
        .slice(
          0,
          300
        );


    console.error(
      `${PREFIX} ${table} write failed (${response.status}): ${detail}`
    );


    return false;

  } catch (
    error
  ) {

    console.error(
      `${PREFIX} ${table} write failed: ${error?.message || error}`
    );


    return false;

  } finally {

    clearTimeout(
      timer
    );
  }
}


// ============================================================
// GENERIC CAPTURE
// ============================================================

async function capture({
  inputs,
  table,
  normalize,
  identity,
  signature,
  cache
}) {

  try {

    if (
      !active()
    ) {

      return {
        ok: true,
        written: 0,
        disabled: true
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


      if (
        !row
      ) {
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


      if (
        (
          pending.get(id) ??
          cache.get(id)
        ) === sig
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


    const ok =
      await insertRows(
        table,
        rows
      );


    if (
      ok
    ) {

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
    }


    return {
      ok,
      written:
        ok
          ? rows.length
          : 0
    };

  } catch (
    error
  ) {

    console.error(
      `${PREFIX} capture failed: ${error?.message || error}`
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

function captureMarketStates(
  inputs
) {

  return capture({

    inputs,

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
      )
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  captureMarketStates,

  captureCashEdgeStates,

  getStatus
};

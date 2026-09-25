"use strict";

const PREFIX = "[learning-cashedge-sync]";

const URL =
  String(process.env.LEARNING_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

const KEY =
  String(process.env.LEARNING_SUPABASE_SERVICE_ROLE_KEY || "")
    .trim();

const TIMEOUT_MS = 5000;

let syncRunning = false;


function txt(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const output = String(value).trim();
  return output || null;
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


function american(value) {
  const output = num(value);

  return output === null
    ? null
    : Math.trunc(output);
}


function normalizeSelection(value) {
  const output = txt(value);

  if (!output) {
    return null;
  }

  return output
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}


function sameText(a, b) {
  return normalizeSelection(a) === normalizeSelection(b);
}


function getCentralDate() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}


function addDays(dateText, days) {
  const [year, month, day] =
    String(dateText)
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day + days,
      12
    )
  )
    .toISOString()
    .slice(0, 10);
}


async function supabaseGet(path) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

  timer.unref?.();

  try {
    const response =
      await fetch(
        `${URL}/rest/v1/${path}`,
        {
          headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`
          },
          signal: controller.signal
        }
      );

    if (!response.ok) {
      const detail =
        (await response.text()).slice(0, 300);

      throw new Error(
        `Supabase HTTP ${response.status}: ${detail}`
      );
    }

    const body =
      await response.json();

    if (!Array.isArray(body)) {
      throw new Error(
        "Invalid daily_picks response"
      );
    }

    return body;

  } finally {
    clearTimeout(timer);
  }
}


async function readFootballRows() {
  if (!URL || !KEY) {
    throw new Error(
      "Learning Supabase environment variables are missing"
    );
  }

  const today =
    getCentralDate();

  const endDate =
    addDays(today, 6);

  const params =
    new URLSearchParams();

  /*
   * IMPORTANT:
   * We do NOT download the full analysis_json.
   *
   * We only read the small premium object and
   * isPremiumPick flag needed by Learning.
   */
  params.set(
    "select",
    [
      "game_id",
      "sport",
      "away_team",
      "home_team",
      "updated_at",
      "premium:analysis_json->premium",
      "is_premium_pick:analysis_json->isPremiumPick"
    ].join(",")
  );

  params.set(
    "sport",
    "in.(nfl,ncaaf)"
  );

  params.append(
    "game_date",
    `gte.${today}`
  );

  params.append(
    "game_date",
    `lte.${endDate}`
  );

  params.set(
    "limit",
    "1000"
  );

  return supabaseGet(
    `daily_picks?${params.toString()}`
  );
}


function projectedScores(row, premium) {
  const scores =
    premium?.projectedScore &&
    typeof premium.projectedScore === "object"
      ? premium.projectedScore
      : {};

  return {
    projected_home_score:
      num(scores?.[row.home_team]),

    projected_away_score:
      num(scores?.[row.away_team])
  };
}


function extractSpreadState(row) {
  const premium =
    row?.premium;

  const spreadPick =
    premium?.spreadPick;

  if (
    !spreadPick ||
    typeof spreadPick !== "object"
  ) {
    return null;
  }

  const side =
    txt(
      spreadPick.side ||
      (
        row.away_team &&
        String(spreadPick.pick || "").includes(row.away_team)
          ? row.away_team
          : row.home_team &&
            String(spreadPick.pick || "").includes(row.home_team)
            ? row.home_team
            : null
      )
    );

  const selectionKey =
    normalizeSelection(side);

  if (!selectionKey) {
    return null;
  }

  const odds =
    premium?.odds || {};

  const isAway =
    sameText(
      side,
      row.away_team
    );

  const isHome =
    sameText(
      side,
      row.home_team
    );

  const rawProjectedSpread =
    num(
      premium?.projectedSpread
    );

  let projection = null;

  /*
   * Store projection from the perspective
   * of the selected side so it is directly
   * comparable to that side's market line.
   */
  if (
    rawProjectedSpread !== null &&
    isHome
  ) {
    projection =
      rawProjectedSpread;
  }

  if (
    rawProjectedSpread !== null &&
    isAway
  ) {
    projection =
      -rawProjectedSpread;
  }

  const primary =
    sameText(
      spreadPick.pick,
      premium?.pick
    );

  const scores =
    projectedScores(
      row,
      premium
    );

  return {
    cashedge_game_id:
      txt(row.game_id),

    sport:
      txt(row.sport),

    market_type:
      "spread",

    selection_key:
      selectionKey,

    pick_text:
      txt(spreadPick.pick),

    line:
      isAway
        ? num(odds.spreadLineA)
        : isHome
          ? num(odds.spreadLineB)
          : null,

    price_american:
      american(
        spreadPick.odds_american
      ),

    projection,

    edge:
      num(spreadPick.edge),

    confidence:
      num(spreadPick.confidence),

    is_premium:
      spreadPick.isPremium === true ||
      (
        row.is_premium_pick === true &&
        primary
      ),

    is_primary:
      primary,

    ...scores,

    source_updated_at:
      txt(row.updated_at)
  };
}


function extractTotalState(row) {
  const premium =
    row?.premium;

  const totalPick =
    premium?.totalPick;

  if (
    !totalPick ||
    typeof totalPick !== "object"
  ) {
    return null;
  }

  const pickText =
    txt(totalPick.pick);

  const normalizedPick =
    String(pickText || "")
      .trim()
      .toLowerCase();

  let selectionKey = null;

  if (
    normalizedPick === "over" ||
    normalizedPick.startsWith("over ")
  ) {
    selectionKey = "over";
  }

  if (
    normalizedPick === "under" ||
    normalizedPick.startsWith("under ")
  ) {
    selectionKey = "under";
  }

  if (!selectionKey) {
    return null;
  }

  const primary =
    sameText(
      totalPick.pick,
      premium?.pick
    );

  const scores =
    projectedScores(
      row,
      premium
    );

  return {
    cashedge_game_id:
      txt(row.game_id),

    sport:
      txt(row.sport),

    market_type:
      "total",

    selection_key:
      selectionKey,

    pick_text:
      pickText,

    line:
      num(
        premium?.odds?.totalLine
      ),

    price_american:
      american(
        totalPick.odds_american
      ),

    projection:
      num(
        premium?.projectedTotal
      ),

    edge:
      num(totalPick.edge),

    confidence:
      num(totalPick.confidence),

    is_premium:
      totalPick.isPremium === true ||
      (
        row.is_premium_pick === true &&
        primary
      ),

    is_primary:
      primary,

    ...scores,

    source_updated_at:
      txt(row.updated_at)
  };
}


function extractStates(row) {
  if (
    !row ||
    !row.game_id ||
    !row.sport ||
    !row.premium ||
    typeof row.premium !== "object"
  ) {
    return [];
  }

  return [
    extractSpreadState(row),
    extractTotalState(row)
  ].filter(Boolean);
}


async function syncCashEdgeStatesSafe(
  learningCapture
) {
  if (syncRunning) {
    return {
      ok: true,
      skipped: true,
      reason: "already_running"
    };
  }

  try {
    if (
      !learningCapture ||
      typeof learningCapture.getStatus !== "function" ||
      typeof learningCapture.captureCashEdgeStates !== "function"
    ) {
      return {
        ok: false,
        skipped: true,
        reason: "learning_capture_unavailable"
      };
    }

    const status =
      learningCapture.getStatus();

    if (status?.active !== true) {
      return {
        ok: true,
        skipped: true,
        reason: "learning_disabled"
      };
    }

    syncRunning = true;

    const rows =
      await readFootballRows();

    const states =
      rows.flatMap(
        extractStates
      );

    const result =
      await learningCapture
        .captureCashEdgeStates(
          states
        );

    if (result?.ok !== true) {
      console.error(
        `${PREFIX} capture was not successful`
      );

      return {
        ok: false,
        checked: rows.length,
        states: states.length,
        written: Number(result?.written || 0)
      };
    }

    return {
      ok: true,
      checked: rows.length,
      states: states.length,
      written: Number(result?.written || 0)
    };

  } catch (error) {
    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );

    return {
      ok: false,
      written: 0
    };

  } finally {
    syncRunning = false;
  }
}


module.exports = {
  syncCashEdgeStatesSafe
};

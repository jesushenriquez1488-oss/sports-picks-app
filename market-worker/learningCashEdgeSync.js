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


function pickHasTeam(pick, team) {
  const normalizedPick =
    normalizeSelection(pick);

  const normalizedTeam =
    normalizeSelection(team);

  if (
    !normalizedPick ||
    !normalizedTeam
  ) {
    return false;
  }

  return (
    normalizedPick === normalizedTeam ||
    normalizedPick.startsWith(`${normalizedTeam} `)
  );
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


function parseSignedLine(value) {
  const match =
    String(value || "")
      .match(/([+-]\d+(?:\.\d+)?)/);

  return match
    ? num(match[1])
    : null;
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


async function readActiveDailyRows() {
  if (!URL || !KEY) {
    throw new Error(
      "Learning Supabase environment variables are missing"
    );
  }

  const today =
    getCentralDate();

  const params =
    new URLSearchParams();

  /*
   * MLB and WNBA use different analysis_json shapes.
   *
   * MLB:
   *   premium.recommendedCards
   *
   * WNBA:
   *   premium + marketSnapshot
   */
  params.set(
    "select",
   [
  "game_id",
  "sport",
  "away_team",
  "home_team",
  "updated_at",
  "public_data:analysis_json->public",
  "premium:analysis_json->premium",
  "market_snapshot:analysis_json->marketSnapshot",
  "is_premium_pick:analysis_json->isPremiumPick"
].join(",")
  );

  params.set(
    "sport",
    "in.(mlb,wnba)"
  );

  params.set(
    "game_date",
    `eq.${today}`
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


// ============================================================
// FOOTBALL — NFL / NCAAF
// Existing behavior kept unchanged.
// ============================================================

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


function extractFootballStates(row) {
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


// ============================================================
// MLB
// ============================================================

function extractMlbState(row) {
  const premium =
    row?.premium;

  if (
    !premium ||
    typeof premium !== "object"
  ) {
    return null;
  }

  /*
   * Fuente preferida:
   * recommendedCards[0] cuando existe.
   *
   * Fallback seguro:
   * public.freePick.play YA guardado por CashEdge.
   *
   * Learning NO recalcula ningún pick.
   */
  const card =
    premium?.recommendedCards?.[0] &&
    typeof premium.recommendedCards[0] === "object"
      ? premium.recommendedCards[0]
      : null;

  const freePickText =
    txt(
      row?.public_data
        ?.freePick
        ?.play
    );

  const pickText =
    txt(card?.play) ||
    freePickText;

  if (!pickText) {
    return null;
  }

  let type =
    String(card?.type || "")
      .trim()
      .toUpperCase();

  /*
   * freePick solo persiste el texto.
   *
   * Únicamente identificamos el tipo de mercado
   * explícito en ese mismo texto.
   *
   * NO reconstruimos:
   * - confidence
   * - edge
   * - odds
   * - probabilidades
   */
  if (!type) {
    const upperPick =
      String(pickText)
        .trim()
        .toUpperCase();

    if (
      upperPick === "OVER" ||
      upperPick.startsWith("OVER ")
    ) {
      type = "OVER";

    } else if (
      upperPick === "UNDER" ||
      upperPick.startsWith("UNDER ")
    ) {
      type = "UNDER";

    } else if (
      /\bML\b/.test(upperPick)
    ) {
      type = "ML";

    } else if (
      parseSignedLine(pickText) !== null
    ) {
      type = "RUNLINE";
    }
  }

  let marketType = null;
  let selectionKey = null;
  let line = null;
  let projection = null;
  let edge = null;


  // ==========================================================
  // TOTAL
  // ==========================================================

  if (
    type === "OVER" ||
    type === "UNDER"
  ) {
    marketType =
      "total";

    selectionKey =
      type.toLowerCase();

    line =
      num(
        premium?.totalLine
      );

    /*
     * Estos valores YA están persistidos
     * en analysis_json.
     */
    projection =
      card
        ? (
            num(card.projectedTotal) ??
            num(premium?.projectedTotal)
          )
        : num(
            premium?.projectedTotal
          );

    edge =
      card
        ? (
            num(card.totalEdge) ??
            num(premium?.totalEdge)
          )
        : num(
            premium?.totalEdge
          );
  }


  // ==========================================================
  // RUNLINE
  // ==========================================================

  if (
    type === "RUNLINE"
  ) {
    marketType =
      "spread";

    selectionKey =
      normalizeSelection(
        card?.team ||
        (
          pickHasTeam(
            pickText,
            row.away_team
          )
            ? row.away_team
            : pickHasTeam(
                pickText,
                row.home_team
              )
              ? row.home_team
              : null
        )
      );

    line =
      num(card?.spread) ??
      parseSignedLine(
        pickText
      );

    /*
     * Para recommendedCard sí existen
     * los valores exactos.
     *
     * Para freePick NO están persistidos,
     * así que dejamos null.
     */
    projection =
      card
        ? num(
            card.projectedMargin
          )
        : null;

    edge =
      card
        ? (
            num(card.protectedEdge) ??
            num(card.edge)
          )
        : null;
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    type === "ML"
  ) {
    marketType =
      "moneyline";

    selectionKey =
      normalizeSelection(
        card?.team ||
        (
          pickHasTeam(
            pickText,
            row.away_team
          )
            ? row.away_team
            : pickHasTeam(
                pickText,
                row.home_team
              )
              ? row.home_team
              : null
        )
      );

    line =
      null;

    /*
     * No usamos favoriteProb como sustituto
     * de la probabilidad exacta del freePick.
     *
     * Si no fue persistida, queda null.
     */
    projection =
      card
        ? num(
            card.modelProbability
          )
        : null;

    edge =
      card
        ? num(
            card.edge
          )
        : null;
  }


  if (
    !marketType ||
    !selectionKey
  ) {
    return null;
  }


  return {
    cashedge_game_id:
      txt(
        row.game_id
      ),

    sport:
      "mlb",

    market_type:
      marketType,

    selection_key:
      selectionKey,

    pick_text:
      pickText,

    line,

    price_american:
      card
        ? american(
            card.odds_american
          )
        : null,

    projection,

    edge,

    confidence:
      card
        ? num(
            card.percentage
          )
        : null,

    /*
     * Esta bandera es la verdad final
     * de CashEdge guardada en daily_picks.
     *
     * No usamos card.isPremium para evitar
     * reinterpretar una jugada después.
     */
    is_premium:
      row.is_premium_pick ===
      true,

    is_primary:
      true,

    projected_home_score:
      num(
        premium?.expectedRunsB
      ),

    projected_away_score:
      num(
        premium?.expectedRunsA
      ),

    source_updated_at:
      txt(
        row.updated_at
      )
  };
}

// ============================================================
// WNBA
// ============================================================

function extractWnbaState(row) {
  const premium =
    row?.premium;

  if (
    !premium ||
    typeof premium !== "object"
  ) {
    return null;
  }

  const pickText =
    txt(premium.pick);

  if (!pickText) {
    return null;
  }

  const normalizedPick =
    String(pickText)
      .trim()
      .toLowerCase();

  const market =
    row?.market_snapshot &&
    typeof row.market_snapshot === "object"
      ? row.market_snapshot
      : {};

  const isOver =
    normalizedPick === "over" ||
    normalizedPick.startsWith("over ");

  const isUnder =
    normalizedPick === "under" ||
    normalizedPick.startsWith("under ");

  let marketType = null;
  let selectionKey = null;
  let line = null;
  let projection = null;

  if (
    isOver ||
    isUnder
  ) {
    marketType = "total";

    selectionKey =
      isOver
        ? "over"
        : "under";

    line =
      num(market.total) ??
      num(premium.totalLine);

    projection =
      num(premium.totalProj);

  } else {
    marketType = "spread";

    const isAway =
      pickHasTeam(
        pickText,
        row.away_team
      );

    const isHome =
      pickHasTeam(
        pickText,
        row.home_team
      );

    if (isAway) {
      selectionKey =
        normalizeSelection(
          row.away_team
        );

      line =
        num(
          market.awaySpread
        );

      projection =
        num(
          premium.spreadDiff
        );
    }

    if (isHome) {
      selectionKey =
        normalizeSelection(
          row.home_team
        );

      line =
        num(
          market.homeSpread
        );

      const rawSpreadDiff =
        num(
          premium.spreadDiff
        );

      projection =
        rawSpreadDiff === null
          ? null
          : -rawSpreadDiff;
    }
  }

  if (
    !marketType ||
    !selectionKey
  ) {
    return null;
  }

  return {
    cashedge_game_id:
      txt(row.game_id),

    sport:
      "wnba",

    market_type:
      marketType,

    selection_key:
      selectionKey,

    pick_text:
      pickText,

    line,

    price_american:
      american(
        premium.odds_american
      ),

    projection,

    edge:
      num(
        premium.mainEdge
      ),

    confidence:
      num(
        premium.confidence
      ),

    is_premium:
      row.is_premium_pick === true,

    is_primary:
      true,

    projected_home_score:
      num(
        premium.projB
      ),

    projected_away_score:
      num(
        premium.projA
      ),

    source_updated_at:
      txt(row.updated_at)
  };
}


// ============================================================
// SPORT ROUTER
// ============================================================

function extractStates(row) {
  if (
    !row ||
    !row.game_id ||
    !row.sport
  ) {
    return [];
  }

  const sport =
    String(row.sport)
      .trim()
      .toLowerCase();

  if (
    sport === "nfl" ||
    sport === "ncaaf"
  ) {
    return extractFootballStates(row);
  }

  if (sport === "mlb") {
    return [
      extractMlbState(row)
    ].filter(Boolean);
  }

  if (sport === "wnba") {
    return [
      extractWnbaState(row)
    ].filter(Boolean);
  }

  return [];
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

    const [
      footballRows,
      activeDailyRows
    ] =
      await Promise.all([
        readFootballRows(),
        readActiveDailyRows()
      ]);

    const rows = [
      ...footballRows,
      ...activeDailyRows
    ];

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

    const bySport = {};

    for (const state of states) {
      const sport =
        String(state?.sport || "unknown")
          .trim()
          .toLowerCase();

      bySport[sport] =
        Number(bySport[sport] || 0) + 1;
    }

    return {
      ok: true,
      checked: rows.length,
      states: states.length,
      written: Number(result?.written || 0),
      bySport
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

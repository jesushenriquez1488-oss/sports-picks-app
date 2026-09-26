"use strict";

// ============================================================
// CASHEDGE LEARNING INTELLIGENCE
// LABEL ENGINE
//
// Purpose:
// - Read completed Learning games.
// - Read every historical market state for those games.
// - Settle EACH historical line independently.
// - Store only labels that do not already exist.
//
// IMPORTANT:
// - Read-only against production data.
// - Writes ONLY to public.learning_labels.
// - Never modifies Market Intelligence.
// - Never modifies daily_picks.
// - Never modifies picks_history.
// - Failure must remain non-fatal.
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const LEARNING_ENABLED =
  String(
    process.env.LEARNING_ENABLED || ""
  )
    .trim()
    .toLowerCase() ===
  "true";


const SUPABASE_URL =
  String(
    process.env.LEARNING_SUPABASE_URL || ""
  )
    .trim()
    .replace(
      /\/+$/,
      ""
    );


const SUPABASE_SERVICE_ROLE_KEY =
  String(
    process.env
      .LEARNING_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  )
    .trim();


const REQUEST_TIMEOUT_MS =
  8 * 1000;


const READ_PAGE_SIZE =
  1000;


const GAME_ID_CHUNK_SIZE =
  40;


const STATE_ID_CHUNK_SIZE =
  250;


const INSERT_BATCH_SIZE =
  500;


let running =
  false;


// ============================================================
// HELPERS
// ============================================================

function normalizeText(
  value
) {

  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


function normalizeTeam(
  sport,
  value
) {

  const normalized =
    normalizeText(
      value
    );


  /*
   * MLB Athletics naming has changed
   * across providers over time.
   */
  if (
    normalizeText(sport) ===
    "mlb"
  ) {

    const athleticsAliases =
      new Set([
        "athletics",
        "oakland athletics",
        "sacramento athletics",
        "las vegas athletics",
        "a s"
      ]);


    if (
      athleticsAliases.has(
        normalized
      )
    ) {

      return "athletics";
    }
  }


  return normalized;
}


function chunkArray(
  values,
  size
) {

  const chunks =
    [];


  for (
    let i = 0;
    i < values.length;
    i += size
  ) {

    chunks.push(
      values.slice(
        i,
        i + size
      )
    );
  }


  return chunks;
}


function pgTextIn(
  values
) {

  const encoded =
    values.map(
      value => {

        const escaped =
          String(value)
            .replace(
              /\\/g,
              "\\\\"
            )
            .replace(
              /"/g,
              '\\"'
            );


        return `"${escaped}"`;
      }
    );


  return (
    `in.(${encoded.join(",")})`
  );
}


function pgNumberIn(
  values
) {

  return (
    `in.(${values.join(",")})`
  );
}


function compareSettlement(
  value
) {

  const EPSILON =
    0.0000001;


  if (
    value > EPSILON
  ) {

    return "win";
  }


  if (
    value < -EPSILON
  ) {

    return "loss";
  }


  return "push";
}


function isValidGameDate(
  value
) {

  return (
    /^\d{4}-\d{2}-\d{2}$/
      .test(
        String(value || "")
      )
  );
}


// ============================================================
// SUPABASE REST
// ============================================================

function getHeaders(
  extra = {}
) {

  return {
    apikey:
      SUPABASE_SERVICE_ROLE_KEY,

    Authorization:
      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

    "Content-Type":
      "application/json",

    ...extra
  };
}


async function supabaseRequest({
  table,
  method = "GET",
  params = {},
  body = null,
  headers = {}
}) {

  const url =
    new URL(
      `${SUPABASE_URL}/rest/v1/${table}`
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
  ) {

    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }


    url.searchParams.set(
      key,
      String(value)
    );
  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          method,

          headers:
            getHeaders(
              headers
            ),

          body:
            body === null
              ? undefined
              : JSON.stringify(
                  body
                ),

          signal:
            controller.signal
        }
      );


    const text =
      await response
        .text();


    let parsed =
      null;


    if (
      text
    ) {

      try {

        parsed =
          JSON.parse(
            text
          );

      } catch {

        parsed =
          text;
      }
    }


    if (
      !response.ok
    ) {

      throw new Error(
        `Supabase ${table} HTTP ${response.status}: ${
          typeof parsed ===
          "string"
            ? parsed
            : JSON.stringify(
                parsed
              )
        }`
      );
    }


    return parsed;

  } finally {

    clearTimeout(
      timer
    );
  }
}


async function readAllRows(
  table,
  params
) {

  const rows =
    [];


  let offset =
    0;


  while (true) {

    const page =
      await supabaseRequest({
        table,

        params,

        headers: {
          Range:
            `${offset}-${offset + READ_PAGE_SIZE - 1}`,

          "Range-Unit":
            "items"
        }
      });


    const pageRows =
      Array.isArray(page)
        ? page
        : [];


    rows.push(
      ...pageRows
    );


    if (
      pageRows.length <
      READ_PAGE_SIZE
    ) {

      break;
    }


    offset +=
      READ_PAGE_SIZE;
  }


  return rows;
}


// ============================================================
// LOAD DATA
// ============================================================

async function loadGames(
  gameDate
) {

  return readAllRows(
    "learning_games",
    {
      select:
        "cashedge_game_id,sport,away_team,home_team,game_date",

      game_date:
        `eq.${gameDate}`,

      order:
        "cashedge_game_id.asc"
    }
  );
}


async function loadResults(
  gameIds
) {

  const rows =
    [];


  for (
    const chunk
    of chunkArray(
      gameIds,
      GAME_ID_CHUNK_SIZE
    )
  ) {

    const result =
      await readAllRows(
        "learning_game_results",
        {
          select:
            "cashedge_game_id,sport,away_score,home_score,winner,margin,total_points",

          cashedge_game_id:
            pgTextIn(
              chunk
            )
        }
      );


    rows.push(
      ...result
    );
  }


  return rows;
}


async function loadMarketStates(
  gameIds
) {

  const rows =
    [];


  for (
    const chunk
    of chunkArray(
      gameIds,
      GAME_ID_CHUNK_SIZE
    )
  ) {

    const result =
      await readAllRows(
        "learning_market_states",
        {
          select:
            "id,cashedge_game_id,sport,sportsbook_key,market_type,selection_key,line,price_american,observed_at",

          cashedge_game_id:
            pgTextIn(
              chunk
            ),

          order:
            "id.asc"
        }
      );


    rows.push(
      ...result
    );
  }


  return rows;
}


async function loadExistingLabelIds(
  stateIds
) {

  const existing =
    new Set();


  for (
    const chunk
    of chunkArray(
      stateIds,
      STATE_ID_CHUNK_SIZE
    )
  ) {

    const rows =
      await readAllRows(
        "learning_labels",
        {
          select:
            "market_state_id",

          market_state_id:
            pgNumberIn(
              chunk
            )
        }
      );


    for (
      const row
      of rows
    ) {

      const id =
        Number(
          row?.market_state_id
        );


      if (
        Number.isFinite(id)
      ) {

        existing.add(
          id
        );
      }
    }
  }


  return existing;
}


// ============================================================
// SELECTION RESOLUTION
// ============================================================

function resolveSelectionSide({
  marketState,
  game
}) {

  const marketType =
    normalizeText(
      marketState?.market_type
    );


  const selection =
    normalizeTeam(
      marketState?.sport,
      marketState?.selection_key
    );


  if (
    marketType === "total"
  ) {

    if (
      selection === "over"
    ) {

      return "over";
    }


    if (
      selection === "under"
    ) {

      return "under";
    }


    return null;
  }


  if (
    marketType !== "spread" &&
    marketType !== "moneyline"
  ) {

    return null;
  }


  const away =
    normalizeTeam(
      game?.sport,
      game?.away_team
    );


  const home =
    normalizeTeam(
      game?.sport,
      game?.home_team
    );


  if (
    selection === away
  ) {

    return "away";
  }


  if (
    selection === home
  ) {

    return "home";
  }


  return null;
}


// ============================================================
// SETTLEMENT
// ============================================================

function buildLabel({
  marketState,
  game,
  result
}) {

  const marketType =
    normalizeText(
      marketState?.market_type
    );


  if (
    ![
      "moneyline",
      "spread",
      "total"
    ].includes(
      marketType
    )
  ) {

    return null;
  }


  const stateId =
    Number(
      marketState?.id
    );


  const price =
    Number(
      marketState?.price_american
    );


  const awayScore =
    Number(
      result?.away_score
    );


  const homeScore =
    Number(
      result?.home_score
    );


  if (
    !Number.isFinite(stateId) ||
    !Number.isFinite(price) ||
    !Number.isFinite(awayScore) ||
    !Number.isFinite(homeScore)
  ) {

    return null;
  }


  const selectionSide =
    resolveSelectionSide({
      marketState,
      game
    });


  if (
    !selectionSide
  ) {

    return null;
  }


  const homeMargin =
    homeScore -
    awayScore;


  const totalPoints =
    homeScore +
    awayScore;


  let referenceLine =
    null;


  let settlementMargin =
    null;


  let betResult =
    null;


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType ===
    "moneyline"
  ) {

    settlementMargin =
      selectionSide === "home"
        ? homeMargin
        : -homeMargin;


    betResult =
      compareSettlement(
        settlementMargin
      );
  }


  // ==========================================================
  // SPREAD
  // ==========================================================

  if (
    marketType ===
    "spread"
  ) {

    const line =
      Number(
        marketState?.line
      );


    if (
      !Number.isFinite(line)
    ) {

      return null;
    }


    referenceLine =
      line;


    settlementMargin =
      selectionSide === "home"
        ? homeMargin + line
        : -homeMargin + line;


    betResult =
      compareSettlement(
        settlementMargin
      );
  }


  // ==========================================================
  // TOTAL
  // ==========================================================

  if (
    marketType ===
    "total"
  ) {

    const line =
      Number(
        marketState?.line
      );


    if (
      !Number.isFinite(line)
    ) {

      return null;
    }


    referenceLine =
      line;


    settlementMargin =
      selectionSide === "over"
        ? totalPoints - line
        : line - totalPoints;


    betResult =
      compareSettlement(
        settlementMargin
      );
  }


  if (
    !betResult
  ) {

    return null;
  }


  return {
    market_state_id:
      stateId,

    cashedge_game_id:
      marketState
        .cashedge_game_id,

    sport:
      normalizeText(
        marketState.sport
      ),

    sportsbook_key:
      String(
        marketState
          .sportsbook_key ||
        ""
      )
        .trim()
        .toLowerCase(),

    market_type:
      marketType,

    selection_key:
      String(
        marketState
          .selection_key ||
        ""
      )
        .trim(),

    selection_side:
      selectionSide,

    reference_line:
      referenceLine,

    reference_price_american:
      Math.round(
        price
      ),

    bet_result:
      betResult,

    settlement_margin:
      settlementMargin,

    labeled_at:
      new Date()
        .toISOString(),

    label_version:
      1
  };
}


// ============================================================
// WRITE LABELS
// ============================================================

async function insertLabels(
  labels
) {

  let written =
    0;


  for (
    const batch
    of chunkArray(
      labels,
      INSERT_BATCH_SIZE
    )
  ) {

    if (
      !batch.length
    ) {

      continue;
    }


    await supabaseRequest({
      table:
        "learning_labels",

      method:
        "POST",

      params: {
        on_conflict:
          "market_state_id"
      },

      headers: {
        Prefer:
          "resolution=ignore-duplicates,return=minimal"
      },

      body:
        batch
    });


    /*
     * Existing IDs were removed before insert.
     * Therefore this is the expected write count.
     */
    written +=
      batch.length;
  }


  return written;
}


// ============================================================
// MAIN LABEL RUN
// ============================================================

async function labelGameDate(
  gameDate
) {

  if (
    !LEARNING_ENABLED
  ) {

    return {
      ok: true,
      disabled: true,
      gameDate
    };
  }


  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {

    throw new Error(
      "Learning Supabase environment missing"
    );
  }


  if (
    !isValidGameDate(
      gameDate
    )
  ) {

    throw new Error(
      `Invalid Learning game date: ${gameDate}`
    );
  }


  const games =
    await loadGames(
      gameDate
    );


  if (
    !games.length
  ) {

    return {
      ok: true,
      gameDate,
      games: 0,
      resultGames: 0,
      marketStates: 0,
      existing: 0,
      written: 0,
      skipped: 0
    };
  }


  const gameMap =
    new Map(
      games.map(
        game => [
          String(
            game.cashedge_game_id
          ),
          game
        ]
      )
    );


  const gameIds =
    Array.from(
      gameMap.keys()
    );


  const results =
    await loadResults(
      gameIds
    );


  const resultMap =
    new Map(
      results.map(
        result => [
          String(
            result.cashedge_game_id
          ),
          result
        ]
      )
    );


  /*
   * Only games with a real final result
   * are labelable.
   *
   * Doubleheaders intentionally skipped by
   * Results Sync naturally disappear here.
   */
  const completedGameIds =
    gameIds.filter(
      gameId =>
        resultMap.has(
          gameId
        )
    );


  if (
    !completedGameIds.length
  ) {

    return {
      ok: true,
      gameDate,
      games:
        games.length,
      resultGames: 0,
      marketStates: 0,
      existing: 0,
      written: 0,
      skipped: 0
    };
  }


  const marketStates =
    await loadMarketStates(
      completedGameIds
    );


  if (
    !marketStates.length
  ) {

    return {
      ok: true,
      gameDate,
      games:
        games.length,
      resultGames:
        completedGameIds.length,
      marketStates: 0,
      existing: 0,
      written: 0,
      skipped: 0
    };
  }


  const stateIds =
    marketStates
      .map(
        state =>
          Number(
            state.id
          )
      )
      .filter(
        Number.isFinite
      );


  const existingIds =
    await loadExistingLabelIds(
      stateIds
    );


  const labels =
    [];


  let skipped =
    0;


  for (
    const marketState
    of marketStates
  ) {

    const stateId =
      Number(
        marketState?.id
      );


    if (
      existingIds.has(
        stateId
      )
    ) {

      continue;
    }


    const gameId =
      String(
        marketState
          ?.cashedge_game_id ||
        ""
      );


    const game =
      gameMap.get(
        gameId
      );


    const result =
      resultMap.get(
        gameId
      );


    if (
      !game ||
      !result
    ) {

      skipped += 1;
      continue;
    }


    const label =
      buildLabel({
        marketState,
        game,
        result
      });


    if (
      !label
    ) {

      skipped += 1;
      continue;
    }


    labels.push(
      label
    );
  }


  const written =
    await insertLabels(
      labels
    );


  return {
    ok: true,

    gameDate,

    games:
      games.length,

    resultGames:
      completedGameIds.length,

    missingResultGames:
      games.length -
      completedGameIds.length,

    marketStates:
      marketStates.length,

    existing:
      existingIds.size,

    written,

    skipped
  };
}


// ============================================================
// SAFE PUBLIC ENTRY
// ============================================================

async function labelGameDateSafe(
  gameDate
) {

  if (
    running
  ) {

    return {
      ok: true,
      skippedRun: true,
      reason:
        "already-running",
      gameDate
    };
  }


  running =
    true;


  try {

    return await labelGameDate(
      gameDate
    );

  } catch (error) {

    console.error(
      `[learning-labels] failed: ${error?.message || error}`
    );


    return {
      ok: false,
      gameDate,
      error:
        error?.message ||
        String(error)
    };

  } finally {

    running =
      false;
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  labelGameDateSafe
};

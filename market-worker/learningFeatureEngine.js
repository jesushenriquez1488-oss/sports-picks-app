"use strict";

// ============================================================
// CASHEDGE LEARNING INTELLIGENCE
// FEATURE ENGINE
//
// Builds PRE-GAME features only.
//
// IMPORTANT:
// - No final score is used to calculate a feature.
// - learning_labels is read ONLY to identify eligible
//   market_state_id values.
// - For a snapshot observed at T, only information with
//   observed_at <= T may be used.
// - Writes ONLY to learning_feature_snapshots.
// - Never modifies Market Intelligence.
// ============================================================

const ENABLED =
  String(
    process.env.LEARNING_ENABLED || ""
  )
    .trim()
    .toLowerCase() === "true";


const SUPABASE_URL =
  String(
    process.env.LEARNING_SUPABASE_URL || ""
  )
    .trim()
    .replace(
      /\/+$/,
      ""
    );


const SERVICE_KEY =
  String(
    process.env
      .LEARNING_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  )
    .trim();


const TIMEOUT_MS =
  8000;

const PAGE_SIZE =
  1000;

const GAME_CHUNK =
  40;

const ID_CHUNK =
  250;

const INSERT_BATCH =
  500;


let running =
  false;


// ============================================================
// NORMALIZATION
// ============================================================

function norm(
  value
) {

  return String(
    value || ""
  )
    .normalize(
      "NFD"
    )
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


function normTeam(
  sport,
  value
) {

  const normalized =
    norm(
      value
    );


  if (
    norm(sport) ===
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


function num(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function int(
  value
) {

  const number =
    num(
      value
    );


  return number === null
    ? null
    : Math.round(
        number
      );
}


function rnd(
  value,
  decimals = 6
) {

  const number =
    num(
      value
    );


  if (
    number === null
  ) {

    return null;
  }


  const factor =
    10 ** decimals;


  return (
    Math.round(
      number *
      factor
    ) /
    factor
  );
}


function ms(
  value
) {

  const parsed =
    Date.parse(
      value
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function chunks(
  values,
  size
) {

  const output =
    [];


  for (
    let i = 0;
    i < values.length;
    i += size
  ) {

    output.push(
      values.slice(
        i,
        i + size
      )
    );
  }


  return output;
}


function pgTextIn(
  values
) {

  return (
    `in.(${
      values
        .map(
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


            return (
              `"${escaped}"`
            );
          }
        )
        .join(",")
    })`
  );
}


function pgNumberIn(
  values
) {

  return (
    `in.(${values.join(",")})`
  );
}


function mean(
  values
) {

  const valid =
    values
      .map(
        num
      )
      .filter(
        value =>
          value !== null
      );


  if (
    !valid.length
  ) {

    return null;
  }


  return (
    valid.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    ) /
    valid.length
  );
}


// ============================================================
// AMERICAN ODDS -> IMPLIED PROBABILITY
//
// Raw sportsbook implied probability.
// This is NOT de-vigged probability.
// ============================================================

function implied(
  price
) {

  const odds =
    num(
      price
    );


  if (
    odds === null ||
    odds === 0
  ) {

    return null;
  }


  if (
    odds > 0
  ) {

    return (
      100 /
      (
        odds +
        100
      )
    );
  }


  const absolute =
    Math.abs(
      odds
    );


  return (
    absolute /
    (
      absolute +
      100
    )
  );
}


// ============================================================
// SUPABASE REST
// ============================================================

function headers(
  extra = {}
) {

  return {
    apikey:
      SERVICE_KEY,

    Authorization:
      `Bearer ${SERVICE_KEY}`,

    "Content-Type":
      "application/json",

    ...extra
  };
}


async function request(
  table,
  {
    method = "GET",
    params = {},
    body = null,
    extraHeaders = {}
  } = {}
) {

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
      value !== null &&
      value !== undefined
    ) {

      url.searchParams.set(
        key,
        String(value)
      );
    }
  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          method,

          headers:
            headers(
              extraHeaders
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


async function readAll(
  table,
  params
) {

  const all =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const page =
      await request(
        table,
        {
          params,

          extraHeaders: {
            Range:
              `${offset}-${offset + PAGE_SIZE - 1}`,

            "Range-Unit":
              "items"
          }
        }
      );


    const rows =
      Array.isArray(
        page
      )
        ? page
        : [];


    all.push(
      ...rows
    );


    if (
      rows.length <
      PAGE_SIZE
    ) {

      break;
    }


    offset +=
      PAGE_SIZE;
  }


  return all;
}


// ============================================================
// LOAD DATA
// ============================================================

async function loadGames(
  gameDate
) {

  return readAll(
    "learning_games",
    {
      select:
        "cashedge_game_id,sport,away_team,home_team,game_date,game_time",

      game_date:
        `eq.${gameDate}`,

      order:
        "cashedge_game_id.asc"
    }
  );
}


async function loadChunked(
  table,
  gameIds,
  select,
  order
) {

  const output =
    [];


  for (
    const chunk
    of chunks(
      gameIds,
      GAME_CHUNK
    )
  ) {

    const rows =
      await readAll(
        table,
        {
          select,

          cashedge_game_id:
            pgTextIn(
              chunk
            ),

          ...(
            order
              ? {
                  order
                }
              : {}
          )
        }
      );


    output.push(
      ...rows
    );
  }


  return output;
}


async function loadExisting(
  stateIds
) {

  const existing =
    new Set();


  for (
    const chunk
    of chunks(
      stateIds,
      ID_CHUNK
    )
  ) {

    const rows =
      await readAll(
        "learning_feature_snapshots",
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
        int(
          row?.market_state_id
        );


      if (
        id !== null
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
// INDEX KEYS
// ============================================================

function selectionIndex(
  sport,
  selection
) {

  return normTeam(
    sport,
    selection
  );
}


function marketKey(
  row
) {

  return [
    String(
      row?.cashedge_game_id ||
      ""
    ),

    String(
      row?.sportsbook_key ||
      ""
    )
      .trim()
      .toLowerCase(),

    norm(
      row?.market_type
    ),

    selectionIndex(
      row?.sport,
      row?.selection_key
    )
  ].join("|");
}


function splitPrefix(
  row
) {

  return [
    String(
      row?.cashedge_game_id ||
      ""
    ),

    norm(
      row?.market_type
    ),

    selectionIndex(
      row?.sport,
      row?.selection_key
    )
  ].join("|");
}


// ============================================================
// GENERIC GROUPED INDEX
// ============================================================

function group(
  rows,
  keyFn
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      keyFn(
        row
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );
    }


    map
      .get(key)
      .push(
        row
      );
  }


  for (
    const list
    of map.values()
  ) {

    list.sort(
      (
        a,
        b
      ) => {

        const timeA =
          ms(
            a?.observed_at
          ) ??
          Number
            .POSITIVE_INFINITY;


        const timeB =
          ms(
            b?.observed_at
          ) ??
          Number
            .POSITIVE_INFINITY;


        if (
          timeA !==
          timeB
        ) {

          return (
            timeA -
            timeB
          );
        }


        return (
          (
            int(
              a?.id
            ) ||
            0
          ) -
          (
            int(
              b?.id
            ) ||
            0
          )
        );
      }
    );
  }


  return map;
}


// ============================================================
// SPLIT INDEX
//
// game + market + selection
//   -> source
//       -> chronological states
// ============================================================

function buildSplitIndex(
  rows
) {

  const index =
    new Map();


  for (
    const row
    of rows
  ) {

    const prefix =
      splitPrefix(
        row
      );


    const source =
      String(
        row?.split_source_key ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      !source
    ) {

      continue;
    }


    if (
      !index.has(
        prefix
      )
    ) {

      index.set(
        prefix,
        new Map()
      );
    }


    const bySource =
      index.get(
        prefix
      );


    if (
      !bySource.has(
        source
      )
    ) {

      bySource.set(
        source,
        []
      );
    }


    bySource
      .get(source)
      .push(
        row
      );
  }


  for (
    const bySource
    of index.values()
  ) {

    for (
      const list
      of bySource.values()
    ) {

      list.sort(
        (
          a,
          b
        ) => {

          const timeA =
            ms(
              a?.observed_at
            ) ??
            Number
              .POSITIVE_INFINITY;


          const timeB =
            ms(
              b?.observed_at
            ) ??
            Number
              .POSITIVE_INFINITY;


          if (
            timeA !==
            timeB
          ) {

            return (
              timeA -
              timeB
            );
          }


          return (
            (
              int(
                a?.id
              ) ||
              0
            ) -
            (
              int(
                b?.id
              ) ||
              0
            )
          );
        }
      );
    }
  }


  return index;
}


// ============================================================
// LATEST STATE AT OR BEFORE T
// ============================================================

function latestAtOrBefore(
  rows,
  targetMs
) {

  if (
    !rows?.length ||
    targetMs === null
  ) {

    return null;
  }


  let low =
    0;

  let high =
    rows.length -
    1;

  let answer =
    -1;


  while (
    low <= high
  ) {

    const middle =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    const timestamp =
      ms(
        rows[middle]
          ?.observed_at
      );


    if (
      timestamp !== null &&
      timestamp <= targetMs
    ) {

      answer =
        middle;

      low =
        middle +
        1;

    } else {

      high =
        middle -
        1;
    }
  }


  return answer >= 0
    ? rows[answer]
    : null;
}


// ============================================================
// LATEST PRIMARY CASHEDGE STATE AT OR BEFORE T
//
// We intentionally do NOT fall back to a secondary state.
// ============================================================

function latestPrimary(
  rows,
  targetMs
) {

  if (
    !rows?.length ||
    targetMs === null
  ) {

    return null;
  }


  for (
    let i =
      rows.length -
      1;

    i >= 0;

    i -= 1
  ) {

    const timestamp =
      ms(
        rows[i]
          ?.observed_at
      );


    if (
      timestamp === null ||
      timestamp > targetMs
    ) {

      continue;
    }


    if (
      rows[i]
        ?.is_primary ===
      true
    ) {

      return rows[i];
    }
  }


  return null;
}


// ============================================================
// SELECTION SIDE
// ============================================================

function sideFor({
  sport,
  marketType,
  selectionKey,
  game
}) {

  const type =
    norm(
      marketType
    );


  const selection =
    selectionIndex(
      sport,
      selectionKey
    );


  if (
    type ===
    "total"
  ) {

    if (
      selection ===
      "over"
    ) {

      return "over";
    }


    if (
      selection ===
      "under"
    ) {

      return "under";
    }


    return null;
  }


  if (
    ![
      "spread",
      "moneyline"
    ].includes(
      type
    )
  ) {

    return null;
  }


  if (
    selection ===
    normTeam(
      game?.sport,
      game?.home_team
    )
  ) {

    return "home";
  }


  if (
    selection ===
    normTeam(
      game?.sport,
      game?.away_team
    )
  ) {

    return "away";
  }


  return null;
}


// ============================================================
// MOVEMENT DIRECTION
// ============================================================

function movementDirection(
  type,
  selectionSide,
  lineDelta,
  probabilityDelta,
  hasPrevious
) {

  if (
    !hasPrevious ||
    !selectionSide
  ) {

    return "unknown";
  }


  const line =
    num(
      lineDelta
    );


  const probability =
    num(
      probabilityDelta
    );


  const EPSILON =
    0.0000001;


  // ==========================================================
  // TOTAL
  // ==========================================================

  if (
    type ===
    "total"
  ) {

    if (
      line !== null &&
      Math.abs(
        line
      ) > EPSILON
    ) {

      return line > 0
        ? "toward_over"
        : "toward_under";
    }


    /*
     * If the total line did not change,
     * price movement can still show pressure
     * toward Over or Under.
     */
    if (
      probability !== null &&
      Math.abs(
        probability
      ) > EPSILON
    ) {

      if (
        probability > 0
      ) {

        return selectionSide ===
          "over"
          ? "toward_over"
          : "toward_under";
      }


      return selectionSide ===
        "over"
        ? "toward_under"
        : "toward_over";
    }


    return "no_change";
  }


  // ==========================================================
  // SPREAD
  // ==========================================================

  if (
    type ===
    "spread"
  ) {

    /*
     * Selected team's spread:
     *
     * Home -2.5 -> -3.5
     * delta = -1
     * movement toward Home.
     *
     * Away +2.5 -> +3.5
     * delta = +1
     * also movement toward Home.
     */
    if (
      line !== null &&
      Math.abs(
        line
      ) > EPSILON
    ) {

      if (
        line < 0
      ) {

        return selectionSide ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return selectionSide ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    if (
      probability !== null &&
      Math.abs(
        probability
      ) > EPSILON
    ) {

      if (
        probability > 0
      ) {

        return selectionSide ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return selectionSide ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    return "no_change";
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    type ===
    "moneyline"
  ) {

    if (
      probability !== null &&
      Math.abs(
        probability
      ) > EPSILON
    ) {

      if (
        probability > 0
      ) {

        return selectionSide ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return selectionSide ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    return "no_change";
  }


  return "unknown";
}


function rawLineDirection(
  type,
  delta,
  hasPrevious
) {

  if (
    !hasPrevious
  ) {

    return null;
  }


  if (
    type ===
    "moneyline"
  ) {

    return "not_applicable";
  }


  const movement =
    num(
      delta
    );


  if (
    movement === null
  ) {

    return null;
  }


  if (
    movement > 0
  ) {

    return "up";
  }


  if (
    movement < 0
  ) {

    return "down";
  }


  return "flat";
}


function moveSize(
  type,
  lineDelta,
  probabilityDelta,
  hasPrevious
) {

  if (
    !hasPrevious
  ) {

    return null;
  }


  /*
   * Moneyline movement_size =
   * implied-probability percentage points.
   *
   * Example:
   * 0.45 -> 0.48
   * movement_size = 3.
   */
  if (
    type ===
    "moneyline"
  ) {

    const delta =
      num(
        probabilityDelta
      );


    return delta === null
      ? null
      : rnd(
          Math.abs(
            delta
          ) *
          100,
          6
        );
  }


  /*
   * Spread / Total movement_size =
   * actual line points.
   */
  const delta =
    num(
      lineDelta
    );


  return delta === null
    ? null
    : rnd(
        Math.abs(
          delta
        ),
        6
      );
}


// ============================================================
// SPLIT FEATURES AS OF T
// ============================================================

function splitFeature(
  splitIndex,
  marketState,
  asOfMs
) {

  const bySource =
    splitIndex.get(
      splitPrefix(
        marketState
      )
    );


  if (
    !bySource
  ) {

    return {
      split_money_pct:
        null,

      split_tickets_pct:
        null,

      split_money_ticket_gap:
        null,

      split_source_count:
        0,

      split_details:
        {}
    };
  }


  const details =
    {};


  const moneyValues =
    [];


  const ticketValues =
    [];


  for (
    const [
      source,
      rows
    ]
    of bySource.entries()
  ) {

    const row =
      latestAtOrBefore(
        rows,
        asOfMs
      );


    if (
      !row
    ) {

      continue;
    }


    const money =
      num(
        row?.money_pct
      );


    const tickets =
      num(
        row?.tickets_pct
      );


    if (
      money !== null
    ) {

      moneyValues.push(
        money
      );
    }


    if (
      tickets !== null
    ) {

      ticketValues.push(
        tickets
      );
    }


    details[source] = {
      provider:
        String(
          row?.provider ||
          ""
        )
          .trim()
          .toLowerCase() ||
        null,

      line:
        num(
          row?.line
        ),

      price_american:
        int(
          row?.price_american
        ),

      money_pct:
        money,

      tickets_pct:
        tickets,

      money_ticket_gap:
        money !== null &&
        tickets !== null
          ? rnd(
              money -
              tickets,
              4
            )
          : null,

      provider_timestamp:
        row
          ?.provider_timestamp ||
        null,

      observed_at:
        row
          ?.observed_at ||
        null
    };
  }


  /*
   * ANALYSIS-ONLY AGGREGATE
   *
   * This is simply the average of the latest
   * known split sources at this moment.
   *
   * It is for broad Learning queries such as:
   * "Money > Tickets".
   *
   * Every individual source remains untouched
   * inside split_details.
   *
   * This aggregate NEVER goes back into
   * production Market Intelligence.
   */

  const averageMoney =
    mean(
      moneyValues
    );


  const averageTickets =
    mean(
      ticketValues
    );


  return {
    split_money_pct:
      rnd(
        averageMoney,
        4
      ),

    split_tickets_pct:
      rnd(
        averageTickets,
        4
      ),

    split_money_ticket_gap:
      (
        averageMoney !== null &&
        averageTickets !== null
      )
        ? rnd(
            averageMoney -
            averageTickets,
            4
          )
        : null,

    split_source_count:
      Object
        .keys(
          details
        )
        .length,

    split_details:
      details
  };
}


// ============================================================
// CASHEDGE ALIGNMENT
// ============================================================

function cashEdgeAlignment(
  marketDirection,
  state,
  game
) {

  if (
    !state
  ) {

    return null;
  }


  if (
    marketDirection ===
    "unknown"
  ) {

    return "unknown";
  }


  if (
    marketDirection ===
    "no_change"
  ) {

    return "not_comparable";
  }


  const cashEdgeMarketType =
    norm(
      state?.market_type
    );


  const cashEdgeSide =
    sideFor({
      sport:
        state?.sport,

      marketType:
        cashEdgeMarketType,

      selectionKey:
        state?.selection_key,

      game
    });


  if (
    !cashEdgeSide
  ) {

    return "not_comparable";
  }


  let directionSide =
    null;


  if (
    marketDirection ===
    "toward_home"
  ) {

    directionSide =
      "home";
  }


  if (
    marketDirection ===
    "toward_away"
  ) {

    directionSide =
      "away";
  }


  if (
    marketDirection ===
    "toward_over"
  ) {

    directionSide =
      "over";
  }


  if (
    marketDirection ===
    "toward_under"
  ) {

    directionSide =
      "under";
  }


  if (
    !directionSide
  ) {

    return "not_comparable";
  }


  /*
   * Total movement only compares against
   * a CashEdge Total pick.
   */
  if (
    [
      "over",
      "under"
    ].includes(
      directionSide
    ) &&
    cashEdgeMarketType !==
      "total"
  ) {

    return "not_comparable";
  }


  /*
   * Home/Away directional movement can be
   * compared against a CashEdge Spread or ML pick.
   */
  if (
    [
      "home",
      "away"
    ].includes(
      directionSide
    ) &&
    ![
      "spread",
      "moneyline"
    ].includes(
      cashEdgeMarketType
    )
  ) {

    return "not_comparable";
  }


  return directionSide ===
    cashEdgeSide
      ? "aligned"
      : "against";
}


// ============================================================
// CASHEDGE FEATURE AS OF T
// ============================================================

function cashEdgeFeature(
  cashEdgeByGame,
  game,
  asOfMs,
  marketDirection
) {

  const rows =
    cashEdgeByGame.get(
      String(
        game?.cashedge_game_id ||
        ""
      )
    ) ||
    [];


  const state =
    latestPrimary(
      rows,
      asOfMs
    );


  if (
    !state
  ) {

    return {
      cashedge_state_id:
        null,

      cashedge_observed_at:
        null,

      cashedge_is_premium:
        null,

      cashedge_market_type:
        null,

      cashedge_selection_key:
        null,

      cashedge_pick_text:
        null,

      cashedge_line:
        null,

      cashedge_price_american:
        null,

      cashedge_projection:
        null,

      cashedge_edge:
        null,

      cashedge_confidence:
        null,

      cashedge_projected_home_score:
        null,

      cashedge_projected_away_score:
        null,

      cashedge_alignment:
        null
    };
  }


  return {
    cashedge_state_id:
      int(
        state?.id
      ),

    cashedge_observed_at:
      state?.observed_at ||
      null,

    cashedge_is_premium:
      typeof state
        ?.is_premium ===
      "boolean"
        ? state.is_premium
        : null,

    cashedge_market_type:
      norm(
        state?.market_type
      ) ||
      null,

    cashedge_selection_key:
      String(
        state?.selection_key ||
        ""
      )
        .trim() ||
      null,

    cashedge_pick_text:
      String(
        state?.pick_text ||
        ""
      )
        .trim() ||
      null,

    cashedge_line:
      num(
        state?.line
      ),

    cashedge_price_american:
      int(
        state?.price_american
      ),

    cashedge_projection:
      num(
        state?.projection
      ),

    cashedge_edge:
      num(
        state?.edge
      ),

    cashedge_confidence:
      num(
        state?.confidence
      ),

    cashedge_projected_home_score:
      num(
        state
          ?.projected_home_score
      ),

    cashedge_projected_away_score:
      num(
        state
          ?.projected_away_score
      ),

    cashedge_alignment:
      cashEdgeAlignment(
        marketDirection,
        state,
        game
      )
  };
}


// ============================================================
// BUILD ONE FEATURE SNAPSHOT
// ============================================================

function buildFeature({
  marketState,
  history,
  splitIndex,
  cashEdgeByGame,
  game
}) {

  const stateId =
    int(
      marketState?.id
    );


  const asOfMs =
    ms(
      marketState?.observed_at
    );


  const gameTimeMs =
    ms(
      game?.game_time
    );


  const currentPrice =
    int(
      marketState
        ?.price_american
    );


  /*
   * Strict pre-game rule.
   */
  if (
    stateId === null ||
    asOfMs === null ||
    gameTimeMs === null ||
    currentPrice === null ||
    asOfMs >= gameTimeMs
  ) {

    return null;
  }


  const marketType =
    norm(
      marketState?.market_type
    );


  const selectionSide =
    sideFor({
      sport:
        marketState?.sport,

      marketType,

      selectionKey:
        marketState?.selection_key,

      game
    });


  if (
    !selectionSide
  ) {

    return null;
  }


  const index =
    history.findIndex(
      row =>
        int(
          row?.id
        ) ===
        stateId
    );


  if (
    index < 0
  ) {

    return null;
  }


  const previous =
    index > 0
      ? history[
          index -
          1
        ]
      : null;


  const first =
    history[0] ||
    marketState;


  const currentLine =
    num(
      marketState?.line
    );


  const previousLine =
    previous
      ? num(
          previous?.line
        )
      : null;


  const firstLine =
    num(
      first?.line
    );


  const currentProbability =
    implied(
      currentPrice
    );


  const previousProbability =
    previous
      ? implied(
          previous
            ?.price_american
        )
      : null;


  const firstProbability =
    implied(
      first
        ?.price_american
    );


  const lineDelta =
    (
      previous &&
      currentLine !== null &&
      previousLine !== null
    )
      ? (
          currentLine -
          previousLine
        )
      : null;


  const probabilityDelta =
    (
      previous &&
      currentProbability !==
        null &&
      previousProbability !==
        null
    )
      ? (
          currentProbability -
          previousProbability
        )
      : null;


  const lineFromFirst =
    (
      currentLine !== null &&
      firstLine !== null
    )
      ? (
          currentLine -
          firstLine
        )
      : null;


  const probabilityFromFirst =
    (
      currentProbability !==
        null &&
      firstProbability !==
        null
    )
      ? (
          currentProbability -
          firstProbability
        )
      : null;


  const direction =
    movementDirection(
      marketType,
      selectionSide,
      lineDelta,
      probabilityDelta,
      Boolean(
        previous
      )
    );


  return {
    // ========================================================
    // IDENTITY
    // ========================================================

    market_state_id:
      stateId,

    cashedge_game_id:
      String(
        marketState
          ?.cashedge_game_id ||
        ""
      ),

    sport:
      norm(
        marketState?.sport
      ),

    sportsbook_key:
      String(
        marketState
          ?.sportsbook_key ||
        ""
      )
        .trim()
        .toLowerCase(),

    market_type:
      marketType,

    selection_key:
      String(
        marketState
          ?.selection_key ||
        ""
      )
        .trim(),

    selection_side:
      selectionSide,


    // ========================================================
    // TIME
    // ========================================================

    as_of_time:
      marketState
        ?.observed_at,

    game_time:
      game?.game_time,

    minutes_to_game:
      rnd(
        (
          gameTimeMs -
          asOfMs
        ) /
        60000,
        4
      ),


    // ========================================================
    // CURRENT MARKET
    // ========================================================

    current_line:
      currentLine,

    current_price_american:
      currentPrice,

    current_implied_probability:
      rnd(
        currentProbability,
        8
      ),


    // ========================================================
    // PREVIOUS STATE
    // ========================================================

    previous_market_state_id:
      previous
        ? int(
            previous?.id
          )
        : null,

    previous_observed_at:
      previous
        ?.observed_at ||
      null,

    previous_line:
      previousLine,

    previous_price_american:
      previous
        ? int(
            previous
              ?.price_american
          )
        : null,

    previous_implied_probability:
      rnd(
        previousProbability,
        8
      ),


    // ========================================================
    // IMMEDIATE MOVEMENT
    // ========================================================

    line_change:
      rnd(
        lineDelta,
        6
      ),

    raw_line_direction:
      rawLineDirection(
        marketType,
        lineDelta,
        Boolean(
          previous
        )
      ),

    implied_probability_change:
      rnd(
        probabilityDelta,
        8
      ),

    movement_size:
      moveSize(
        marketType,
        lineDelta,
        probabilityDelta,
        Boolean(
          previous
        )
      ),

    market_direction:
      direction,


    // ========================================================
    // FIRST OBSERVED STATE
    // ========================================================

    first_market_state_id:
      int(
        first?.id
      ),

    first_observed_at:
      first
        ?.observed_at ||
      null,

    first_line:
      firstLine,

    first_price_american:
      int(
        first
          ?.price_american
      ),

    first_implied_probability:
      rnd(
        firstProbability,
        8
      ),

    line_change_from_first:
      rnd(
        lineFromFirst,
        6
      ),

    implied_probability_change_from_first:
      rnd(
        probabilityFromFirst,
        8
      ),


    // ========================================================
    // SPLITS + CASHEDGE
    // ========================================================

    ...splitFeature(
      splitIndex,
      marketState,
      asOfMs
    ),

    ...cashEdgeFeature(
      cashEdgeByGame,
      game,
      asOfMs,
      direction
    ),


    feature_version:
      1,

    created_at:
      new Date()
        .toISOString()
  };
}


// ============================================================
// INSERT FEATURES
// ============================================================

async function insertFeatures(
  rows
) {

  let written =
    0;


  for (
    const batch
    of chunks(
      rows,
      INSERT_BATCH
    )
  ) {

    if (
      !batch.length
    ) {

      continue;
    }


    await request(
      "learning_feature_snapshots",
      {
        method:
          "POST",

        params: {
          on_conflict:
            "market_state_id"
        },

        extraHeaders: {
          Prefer:
            "resolution=ignore-duplicates,return=minimal"
        },

        body:
          batch
      }
    );


    written +=
      batch.length;
  }


  return written;
}


// ============================================================
// MAIN DATE BUILD
// ============================================================

async function buildGameDate(
  gameDate
) {

  if (
    !ENABLED
  ) {

    return {
      ok:
        true,

      disabled:
        true,

      gameDate
    };
  }


  if (
    !SUPABASE_URL ||
    !SERVICE_KEY
  ) {

    throw new Error(
      "Learning Supabase environment missing"
    );
  }


  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        String(
          gameDate ||
          ""
        )
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
      ok:
        true,

      gameDate,

      games:
        0,

      labeledStates:
        0,

      marketStates:
        0,

      existing:
        0,

      written:
        0,

      skipped:
        0,

      withSplits:
        0,

      withCashEdge:
        0,

      movements:
        0
    };
  }


  const gameMap =
    new Map(
      games.map(
        game => [
          String(
            game
              .cashedge_game_id
          ),
          game
        ]
      )
    );


  const gameIds =
    [
      ...gameMap.keys()
    ];


  /*
   * We read ONLY the label market_state IDs.
   *
   * No WIN / LOSS / settlement outcome is read here.
   */
  const labels =
    await loadChunked(
      "learning_labels",
      gameIds,
      "market_state_id,cashedge_game_id",
      "market_state_id.asc"
    );


  const labeledIds =
    new Set(
      labels
        .map(
          row =>
            int(
              row
                ?.market_state_id
            )
        )
        .filter(
          value =>
            value !== null
        )
    );


  if (
    !labeledIds.size
  ) {

    return {
      ok:
        true,

      gameDate,

      games:
        games.length,

      labeledStates:
        0,

      marketStates:
        0,

      existing:
        0,

      written:
        0,

      skipped:
        0,

      withSplits:
        0,

      withCashEdge:
        0,

      movements:
        0
    };
  }


  /*
   * Read the full PRE-GAME history for those games.
   * This allows us to reconstruct first state and
   * previous state correctly.
   */
  const [
    marketStates,
    splitStates,
    cashEdgeStates
  ] =
    await Promise.all([
      loadChunked(
        "learning_market_states",
        gameIds,
        "id,cashedge_game_id,sport,sportsbook_key,market_type,selection_key,line,price_american,observed_at",
        "observed_at.asc,id.asc"
      ),

      loadChunked(
        "learning_split_states",
        gameIds,
        "id,cashedge_game_id,sport,provider,split_source_key,market_type,selection_key,line,price_american,money_pct,tickets_pct,provider_timestamp,observed_at",
        "observed_at.asc,id.asc"
      ),

      loadChunked(
        "learning_cashedge_states",
        gameIds,
        "id,cashedge_game_id,sport,market_type,selection_key,pick_text,line,price_american,projection,edge,confidence,is_premium,is_primary,projected_home_score,projected_away_score,source_updated_at,observed_at",
        "observed_at.asc,id.asc"
      )
    ]);


  /*
   * Feature snapshots are created only for
   * market states that already have labels.
   *
   * Yesterday that should correspond to the
   * 517 eligible labeled market states.
   */
  const targets =
    marketStates.filter(
      row =>
        labeledIds.has(
          int(
            row?.id
          )
        )
    );


  const targetIds =
    targets
      .map(
        row =>
          int(
            row?.id
          )
      )
      .filter(
        value =>
          value !== null
      );


  const existing =
    await loadExisting(
      targetIds
    );


  const marketIndex =
    group(
      marketStates,
      marketKey
    );


  const splitIndex =
    buildSplitIndex(
      splitStates
    );


  const cashEdgeByGame =
    group(
      cashEdgeStates,
      row =>
        String(
          row
            ?.cashedge_game_id ||
          ""
        )
    );


  const features =
    [];


  let skipped =
    0;


  let withSplits =
    0;


  let withCashEdge =
    0;


  let movements =
    0;


  for (
    const marketState
    of targets
  ) {

    const stateId =
      int(
        marketState?.id
      );


    if (
      stateId === null ||
      existing.has(
        stateId
      )
    ) {

      continue;
    }


    const game =
      gameMap.get(
        String(
          marketState
            ?.cashedge_game_id ||
          ""
        )
      );


    if (
      !game
    ) {

      skipped +=
        1;

      continue;
    }


    const history =
      marketIndex.get(
        marketKey(
          marketState
        )
      ) ||
      [];


    const feature =
      buildFeature({
        marketState,
        history,
        splitIndex,
        cashEdgeByGame,
        game
      });


    if (
      !feature
    ) {

      skipped +=
        1;

      continue;
    }


    if (
      feature
        .split_source_count >
      0
    ) {

      withSplits +=
        1;
    }


    if (
      feature
        .cashedge_state_id !==
      null
    ) {

      withCashEdge +=
        1;
    }


    if (
      feature
        .previous_market_state_id !==
      null
    ) {

      movements +=
        1;
    }


    features.push(
      feature
    );
  }


  const written =
    await insertFeatures(
      features
    );


  return {
    ok:
      true,

    gameDate,

    games:
      games.length,

    labeledStates:
      labeledIds.size,

    marketStates:
      targets.length,

    existing:
      existing.size,

    written,

    skipped,

    withSplits,

    withCashEdge,

    movements
  };
}


// ============================================================
// SAFE PUBLIC ENTRY
// ============================================================

async function buildGameDateSafe(
  gameDate
) {

  if (
    running
  ) {

    return {
      ok:
        true,

      skippedRun:
        true,

      reason:
        "already-running",

      gameDate
    };
  }


  running =
    true;


  try {

    return await buildGameDate(
      gameDate
    );

  } catch (error) {

    console.error(
      `[learning-features] failed: ${error?.message || error}`
    );


    return {
      ok:
        false,

      gameDate,

      error:
        error?.message ||
        String(
          error
        )
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
  buildGameDateSafe
};

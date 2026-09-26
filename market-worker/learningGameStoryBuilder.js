"use strict";

const PREFIX =
  "[learning-game-stories]";


const ENABLED =
  String(
    process.env.LEARNING_ENABLED ||
    ""
  )
    .trim()
    .toLowerCase() ===
  "true";


const SUPABASE_URL =
  String(
    process.env.LEARNING_SUPABASE_URL ||
    ""
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

const INSERT_BATCH =
  100;

const STORY_VERSION =
  1;


let running =
  false;


// ============================================================
// HELPERS
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


  const output =
    Number(
      value
    );


  return Number.isFinite(
    output
  )
    ? output
    : null;
}


function int(
  value
) {

  const output =
    num(
      value
    );


  return output === null
    ? null
    : Math.round(
        output
      );
}


function rnd(
  value,
  decimals = 6
) {

  const output =
    num(
      value
    );


  if (
    output === null
  ) {
    return null;
  }


  const factor =
    10 ** decimals;


  return (
    Math.round(
      output *
      factor
    ) /
    factor
  );
}


function timeMs(
  value
) {

  const output =
    Date.parse(
      value
    );


  return Number.isFinite(
    output
  )
    ? output
    : null;
}


function chunks(
  values,
  size
) {

  const output =
    [];


  for (
    let index = 0;
    index < values.length;
    index += size
  ) {

    output.push(
      values.slice(
        index,
        index + size
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
              String(
                value
              )
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


// ============================================================
// SUPABASE
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
        String(
          value
        )
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


  timer.unref?.();


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

  const output =
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


    output.push(
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


  return output;
}


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
  order = null
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


function groupByGame(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const gameId =
      String(
        row
          ?.cashedge_game_id ||
        ""
      );


    if (
      !gameId
    ) {
      continue;
    }


    if (
      !map.has(
        gameId
      )
    ) {

      map.set(
        gameId,
        []
      );
    }


    map
      .get(
        gameId
      )
      .push(
        row
      );
  }


  return map;
}


// ============================================================
// MARKET STORY
// ============================================================

function oppositeDirection(
  direction
) {

  if (
    direction ===
    "toward_home"
  ) {
    return "toward_away";
  }


  if (
    direction ===
    "toward_away"
  ) {
    return "toward_home";
  }


  if (
    direction ===
    "toward_over"
  ) {
    return "toward_under";
  }


  if (
    direction ===
    "toward_under"
  ) {
    return "toward_over";
  }


  return null;
}


function chooseCanonicalSide(
  marketType,
  rows
) {

  const preferred =
    marketType ===
    "total"
      ? [
          "over",
          "under"
        ]
      : [
          "home",
          "away"
        ];


  for (
    const side
    of preferred
  ) {

    if (
      rows.some(
        row =>
          row
            ?.selection_side ===
          side
      )
    ) {

      return side;
    }
  }


  return null;
}


function netDirection(
  marketType,
  side,
  first,
  last
) {

  if (
    !first ||
    !last ||
    !side
  ) {
    return "unknown";
  }


  const lineDelta =
    (
      num(
        first
          .current_line
      ) !== null &&
      num(
        last
          .current_line
      ) !== null
    )
      ? (
          num(
            last
              .current_line
          ) -
          num(
            first
              .current_line
          )
        )
      : null;


  const probabilityDelta =
    (
      num(
        first
          .current_implied_probability
      ) !== null &&
      num(
        last
          .current_implied_probability
      ) !== null
    )
      ? (
          num(
            last
              .current_implied_probability
          ) -
          num(
            first
              .current_implied_probability
          )
        )
      : null;


  const epsilon =
    0.0000001;


  if (
    marketType ===
    "total"
  ) {

    if (
      lineDelta !== null &&
      Math.abs(
        lineDelta
      ) >
      epsilon
    ) {

      return lineDelta > 0
        ? "toward_over"
        : "toward_under";
    }


    if (
      probabilityDelta !== null &&
      Math.abs(
        probabilityDelta
      ) >
      epsilon
    ) {

      if (
        probabilityDelta > 0
      ) {

        return side ===
          "over"
          ? "toward_over"
          : "toward_under";
      }


      return side ===
        "over"
        ? "toward_under"
        : "toward_over";
    }


    return "no_change";
  }


  if (
    marketType ===
    "spread"
  ) {

    if (
      lineDelta !== null &&
      Math.abs(
        lineDelta
      ) >
      epsilon
    ) {

      if (
        lineDelta < 0
      ) {

        return side ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return side ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    if (
      probabilityDelta !== null &&
      Math.abs(
        probabilityDelta
      ) >
      epsilon
    ) {

      if (
        probabilityDelta > 0
      ) {

        return side ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return side ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    return "no_change";
  }


  if (
    marketType ===
    "moneyline"
  ) {

    if (
      probabilityDelta !== null &&
      Math.abs(
        probabilityDelta
      ) >
      epsilon
    ) {

      if (
        probabilityDelta > 0
      ) {

        return side ===
          "home"
          ? "toward_home"
          : "toward_away";
      }


      return side ===
        "home"
        ? "toward_away"
        : "toward_home";
    }


    return "no_change";
  }


  return "unknown";
}


function countReversals(
  rows
) {

  let previousDirection =
    null;


  let reversals =
    0;


  for (
    const row
    of rows
  ) {

    const direction =
      String(
        row
          ?.market_direction ||
        ""
      );


    if (
      ![
        "toward_home",
        "toward_away",
        "toward_over",
        "toward_under"
      ].includes(
        direction
      )
    ) {
      continue;
    }


    if (
      previousDirection &&
      oppositeDirection(
        previousDirection
      ) ===
      direction
    ) {

      reversals +=
        1;
    }


    previousDirection =
      direction;
  }


  return reversals;
}


function summarizeBook(
  marketType,
  sportsbook,
  rows
) {

  const side =
    chooseCanonicalSide(
      marketType,
      rows
    );


  if (
    !side
  ) {
    return null;
  }


  const canonical =
    rows
      .filter(
        row =>
          row
            ?.selection_side ===
          side
      )
      .sort(
        (
          a,
          b
        ) =>
          (
            timeMs(
              a?.as_of_time
            ) ||
            0
          ) -
          (
            timeMs(
              b?.as_of_time
            ) ||
            0
          )
      );


  if (
    !canonical.length
  ) {
    return null;
  }


  const first =
    canonical[0];


  const last =
    canonical[
      canonical.length -
      1
    ];


  return {
    sportsbook,

    tracked_side:
      side,

    state_count:
      canonical.length,

    movement_events:
      canonical
        .filter(
          row =>
            int(
              row
                ?.previous_market_state_id
            ) !==
            null
        )
        .length,

    reversal_count:
      countReversals(
        canonical
      ),

    first: {
      at:
        first
          ?.as_of_time ||
        null,

      line:
        num(
          first
            ?.current_line
        ),

      price_american:
        int(
          first
            ?.current_price_american
        ),

      implied_probability:
        rnd(
          first
            ?.current_implied_probability,
          8
        )
    },

    last: {
      at:
        last
          ?.as_of_time ||
        null,

      line:
        num(
          last
            ?.current_line
        ),

      price_american:
        int(
          last
            ?.current_price_american
        ),

      implied_probability:
        rnd(
          last
            ?.current_implied_probability,
          8
        )
    },

    net_line_change:
      (
        num(
          first
            ?.current_line
        ) !== null &&
        num(
          last
            ?.current_line
        ) !== null
      )
        ? rnd(
            num(
              last
                .current_line
            ) -
            num(
              first
                .current_line
            ),
            6
          )
        : null,

    net_implied_probability_change:
      (
        num(
          first
            ?.current_implied_probability
        ) !== null &&
        num(
          last
            ?.current_implied_probability
        ) !== null
      )
        ? rnd(
            num(
              last
                .current_implied_probability
            ) -
            num(
              first
                .current_implied_probability
            ),
            8
          )
        : null,

    net_direction:
      netDirection(
        marketType,
        side,
        first,
        last
      )
  };
}


function summarizeLineResults(
  marketType,
  labels
) {

  const unique =
    new Map();


  for (
    const row
    of labels
  ) {

    if (
      norm(
        row
          ?.market_type
      ) !==
      marketType
    ) {
      continue;
    }


    const side =
      String(
        row
          ?.selection_side ||
        ""
      )
        .trim()
        .toLowerCase();


    const line =
      num(
        row
          ?.reference_line
      );


    const result =
      String(
        row
          ?.bet_result ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      !side ||
      !result
    ) {
      continue;
    }


    const key =
      `${side}|${
        line === null
          ? "ml"
          : line
      }|${result}`;


    if (
      !unique.has(
        key
      )
    ) {

      unique.set(
        key,
        {
          side,
          line,
          result
        }
      );
    }
  }


  return [
    ...unique.values()
  ]
    .sort(
      (
        a,
        b
      ) => {

        if (
          a.side !==
          b.side
        ) {

          return a.side
            .localeCompare(
              b.side
            );
        }


        if (
          a.line === null &&
          b.line === null
        ) {
          return 0;
        }


        if (
          a.line === null
        ) {
          return -1;
        }


        if (
          b.line === null
        ) {
          return 1;
        }


        return (
          a.line -
          b.line
        );
      }
    );
}


function summarizeMarket(
  marketType,
  features,
  labels
) {

  const rows =
    features.filter(
      row =>
        norm(
          row
            ?.market_type
        ) ===
        marketType
    );


  if (
    !rows.length
  ) {
    return {};
  }


  const byBook =
    new Map();


  for (
    const row
    of rows
  ) {

    const book =
      String(
        row
          ?.sportsbook_key ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      !book
    ) {
      continue;
    }


    if (
      !byBook.has(
        book
      )
    ) {

      byBook.set(
        book,
        []
      );
    }


    byBook
      .get(
        book
      )
      .push(
        row
      );
  }


  const bookSummaries =
    [];


  for (
    const [
      book,
      bookRows
    ]
    of byBook.entries()
  ) {

    const summary =
      summarizeBook(
        marketType,
        book,
        bookRows
      );


    if (
      summary
    ) {

      bookSummaries.push(
        summary
      );
    }
  }


  bookSummaries.sort(
    (
      a,
      b
    ) =>
      a.sportsbook
        .localeCompare(
          b.sportsbook
        )
  );


  const directionCounts =
    {};


  for (
    const book
    of bookSummaries
  ) {

    const direction =
      book.net_direction ||
      "unknown";


    directionCounts[
      direction
    ] =
      Number(
        directionCounts[
          direction
        ] ||
        0
      ) +
      1;
  }


  const directional =
    Object.entries(
      directionCounts
    )
      .filter(
        ([
          direction
        ]) =>
          [
            "toward_home",
            "toward_away",
            "toward_over",
            "toward_under"
          ].includes(
            direction
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          b[1] -
          a[1]
      );


  let dominantDirection =
    "mixed";


  if (
    directional.length ===
    1
  ) {

    dominantDirection =
      directional[0][0];

  } else if (
    directional.length >
      1 &&
    directional[0][1] >
      directional[1][1]
  ) {

    dominantDirection =
      directional[0][0];

  } else if (
    !directional.length
  ) {

    dominantDirection =
      "no_change";
  }


  const timestamps =
    rows
      .map(
        row =>
          timeMs(
            row
              ?.as_of_time
          )
      )
      .filter(
        value =>
          value !== null
      );


  return {
    state_count:
      rows.length,

    book_count:
      bookSummaries.length,

    first_observed_at:
      timestamps.length
        ? new Date(
            Math.min(
              ...timestamps
            )
          )
            .toISOString()
        : null,

    last_observed_at:
      timestamps.length
        ? new Date(
            Math.max(
              ...timestamps
            )
          )
            .toISOString()
        : null,

    direction_by_book:
      directionCounts,

    dominant_direction:
      dominantDirection,

    reversal_count:
      bookSummaries
        .reduce(
          (
            total,
            book
          ) =>
            total +
            Number(
              book
                .reversal_count ||
              0
            ),
          0
        ),

    books:
      bookSummaries,

    historical_line_results:
      summarizeLineResults(
        marketType,
        labels
      )
  };
}


// ============================================================
// SPLITS STORY
// ============================================================

function summarizeSplits(
  rows
) {

  if (
    !rows.length
  ) {
    return {};
  }


  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      [
        norm(
          row
            ?.market_type
        ),

        String(
          row
            ?.selection_key ||
          ""
        )
          .trim(),

        String(
          row
            ?.split_source_key ||
          ""
        )
          .trim()
          .toLowerCase()
      ]
        .join("|");


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );
    }


    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  const signals =
    [];


  let globalMaxAbsGap =
    null;


  for (
    const list
    of groups.values()
  ) {

    list.sort(
      (
        a,
        b
      ) =>
        (
          timeMs(
            a
              ?.observed_at
          ) ||
          0
        ) -
        (
          timeMs(
            b
              ?.observed_at
          ) ||
          0
        )
    );


    const first =
      list[0];


    const last =
      list[
        list.length -
        1
      ];


    let maxAbsGap =
      null;


    let maxAbsGapAt =
      null;


    for (
      const row
      of list
    ) {

      const money =
        num(
          row
            ?.money_pct
        );


      const tickets =
        num(
          row
            ?.tickets_pct
        );


      if (
        money === null ||
        tickets === null
      ) {
        continue;
      }


      const gap =
        Math.abs(
          money -
          tickets
        );


      if (
        maxAbsGap === null ||
        gap >
          maxAbsGap
      ) {

        maxAbsGap =
          gap;

        maxAbsGapAt =
          row
            ?.observed_at ||
          null;
      }
    }


    if (
      maxAbsGap !==
        null &&
      (
        globalMaxAbsGap ===
          null ||
        maxAbsGap >
          globalMaxAbsGap
      )
    ) {

      globalMaxAbsGap =
        maxAbsGap;
    }


    signals.push({
      market_type:
        norm(
          first
            ?.market_type
        ),

      selection_key:
        String(
          first
            ?.selection_key ||
          ""
        )
          .trim(),

      source:
        String(
          first
            ?.split_source_key ||
          ""
        )
          .trim()
          .toLowerCase(),

      state_count:
        list.length,

      first: {
        at:
          first
            ?.observed_at ||
          null,

        money_pct:
          num(
            first
              ?.money_pct
          ),

        tickets_pct:
          num(
            first
              ?.tickets_pct
          ),

        gap:
          (
            num(
              first
                ?.money_pct
            ) !== null &&
            num(
              first
                ?.tickets_pct
            ) !== null
          )
            ? rnd(
                num(
                  first
                    .money_pct
                ) -
                num(
                  first
                    .tickets_pct
                ),
                4
              )
            : null
      },

      last: {
        at:
          last
            ?.observed_at ||
          null,

        money_pct:
          num(
            last
              ?.money_pct
          ),

        tickets_pct:
          num(
            last
              ?.tickets_pct
          ),

        gap:
          (
            num(
              last
                ?.money_pct
            ) !== null &&
            num(
              last
                ?.tickets_pct
            ) !== null
          )
            ? rnd(
                num(
                  last
                    .money_pct
                ) -
                num(
                  last
                    .tickets_pct
                ),
                4
              )
            : null
      },

      max_abs_gap:
        rnd(
          maxAbsGap,
          4
        ),

      max_abs_gap_at:
        maxAbsGapAt
    });
  }


  signals.sort(
    (
      a,
      b
    ) => {

      const left =
        `${a.market_type}|${a.selection_key}|${a.source}`;

      const right =
        `${b.market_type}|${b.selection_key}|${b.source}`;


      return left
        .localeCompare(
          right
        );
    }
  );


  return {
    state_count:
      rows.length,

    source_count:
      new Set(
        rows.map(
          row =>
            String(
              row
                ?.split_source_key ||
              ""
            )
              .trim()
              .toLowerCase()
        )
      )
        .size,

    max_abs_money_ticket_gap:
      rnd(
        globalMaxAbsGap,
        4
      ),

    signals
  };
}


// ============================================================
// CASHEDGE STORY
// ============================================================

function summarizeCashEdge(
  rows
) {

  const primary =
    rows
      .filter(
        row =>
          row
            ?.is_primary ===
          true
      )
      .sort(
        (
          a,
          b
        ) =>
          (
            timeMs(
              a
                ?.observed_at
            ) ||
            0
          ) -
          (
            timeMs(
              b
                ?.observed_at
            ) ||
            0
          )
      );


  if (
    !primary.length
  ) {
    return {};
  }


  const first =
    primary[0];


  const last =
    primary[
      primary.length -
      1
    ];


  let pickChanges =
    0;


  for (
    let index = 1;
    index <
      primary.length;
    index += 1
  ) {

    const previous =
      primary[
        index -
        1
      ];


    const current =
      primary[
        index
      ];


    if (
      norm(
        previous
          ?.market_type
      ) !==
        norm(
          current
            ?.market_type
        ) ||
      norm(
        previous
          ?.selection_key
      ) !==
        norm(
          current
            ?.selection_key
        ) ||
      num(
        previous
          ?.line
      ) !==
        num(
          current
            ?.line
        ) ||
      String(
        previous
          ?.pick_text ||
        ""
      ) !==
        String(
          current
            ?.pick_text ||
        ""
      )
    ) {

      pickChanges +=
        1;
    }
  }


  const edges =
    primary
      .map(
        row =>
          num(
            row
              ?.edge
          )
      )
      .filter(
        value =>
          value !== null
      );


  const confidences =
    primary
      .map(
        row =>
          num(
            row
              ?.confidence
          )
      )
      .filter(
        value =>
          value !== null
      );


  const compactState =
    row => ({
      at:
        row
          ?.observed_at ||
        null,

      market_type:
        norm(
          row
            ?.market_type
        ) ||
        null,

      selection_key:
        String(
          row
            ?.selection_key ||
          ""
        )
          .trim() ||
        null,

      pick_text:
        String(
          row
            ?.pick_text ||
          ""
        )
          .trim() ||
        null,

      line:
        num(
          row
            ?.line
        ),

      price_american:
        int(
          row
            ?.price_american
        ),

      projection:
        num(
          row
            ?.projection
        ),

      edge:
        num(
          row
            ?.edge
        ),

      confidence:
        num(
          row
            ?.confidence
        ),

      is_premium:
        typeof row
          ?.is_premium ===
        "boolean"
          ? row
              .is_premium
          : null,

      projected_home_score:
        num(
          row
            ?.projected_home_score
        ),

      projected_away_score:
        num(
          row
            ?.projected_away_score
        )
    });


  return {
    primary_state_count:
      primary.length,

    pick_change_count:
      pickChanges,

    premium_ever:
      primary.some(
        row =>
          row
            ?.is_premium ===
          true
      ),

    premium_at_end:
      last
        ?.is_premium ===
      true,

    max_edge:
      edges.length
        ? Math.max(
            ...edges
          )
        : null,

    min_edge:
      edges.length
        ? Math.min(
            ...edges
          )
        : null,

    max_confidence:
      confidences.length
        ? Math.max(
            ...confidences
          )
        : null,

    min_confidence:
      confidences.length
        ? Math.min(
            ...confidences
          )
        : null,

    first:
      compactState(
        first
      ),

    last:
      compactState(
        last
      )
  };
}


// ============================================================
// RESULT
// ============================================================

function buildFinalResult(
  result
) {

  if (
    !result
  ) {
    return {};
  }


  return {
    away_score:
      int(
        result
          ?.away_score
      ),

    home_score:
      int(
        result
          ?.home_score
      ),

    winner:
      String(
        result
          ?.winner ||
        ""
      )
        .trim()
        .toLowerCase() ||
      null,

    margin:
      num(
        result
          ?.margin
      ),

    total_points:
      num(
        result
          ?.total_points
      )
  };
}


// ============================================================
// WRITE
// ============================================================

async function upsertStories(
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
      "learning_game_stories",
      {
        method:
          "POST",

        params: {
          on_conflict:
            "cashedge_game_id"
        },

        extraHeaders: {
          Prefer:
            "resolution=merge-duplicates,return=minimal"
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
// BUILD DATE
// ============================================================

async function buildGameDateStories(
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

      gameDate,

      games:
        0,

      written:
        0
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

      completedGames:
        0,

      written:
        0
    };
  }


  const gameIds =
    games.map(
      game =>
        String(
          game
            .cashedge_game_id
        )
    );


  const [
    results,
    features,
    labels,
    splits,
    cashEdge
  ] =
    await Promise.all([

      loadChunked(
        "learning_game_results",
        gameIds,
        "cashedge_game_id,sport,away_score,home_score,winner,margin,total_points"
      ),

      loadChunked(
        "learning_feature_snapshots",
        gameIds,
        "market_state_id,cashedge_game_id,sport,sportsbook_key,market_type,selection_key,selection_side,as_of_time,current_line,current_price_american,current_implied_probability,previous_market_state_id,market_direction"
      ),

      loadChunked(
        "learning_labels",
        gameIds,
        "market_state_id,cashedge_game_id,market_type,selection_side,reference_line,bet_result"
      ),

      loadChunked(
        "learning_split_states",
        gameIds,
        "cashedge_game_id,market_type,selection_key,split_source_key,money_pct,tickets_pct,observed_at",
        "observed_at.asc,id.asc"
      ),

      loadChunked(
        "learning_cashedge_states",
        gameIds,
        "cashedge_game_id,market_type,selection_key,pick_text,line,price_american,projection,edge,confidence,is_premium,is_primary,projected_home_score,projected_away_score,observed_at",
        "observed_at.asc,id.asc"
      )
    ]);


  const resultByGame =
    new Map(
      results.map(
        row => [
          String(
            row
              .cashedge_game_id
          ),
          row
        ]
      )
    );


  const featuresByGame =
    groupByGame(
      features
    );


  const labelsByGame =
    groupByGame(
      labels
    );


  const splitsByGame =
    groupByGame(
      splits
    );


  const cashEdgeByGame =
    groupByGame(
      cashEdge
    );


  const now =
    new Date()
      .toISOString();


  const stories =
    [];


  for (
    const game
    of games
  ) {

    const gameId =
      String(
        game
          .cashedge_game_id
      );


    const result =
      resultByGame.get(
        gameId
      );


    /*
     * No final result = no completed story.
     */
    if (
      !result
    ) {
      continue;
    }


    const gameFeatures =
      featuresByGame.get(
        gameId
      ) ||
      [];


    const gameLabels =
      labelsByGame.get(
        gameId
      ) ||
      [];


    const gameSplits =
      splitsByGame.get(
        gameId
      ) ||
      [];


    const gameCashEdge =
      cashEdgeByGame.get(
        gameId
      ) ||
      [];


    stories.push({
      cashedge_game_id:
        gameId,

      sport:
        norm(
          game
            ?.sport
        ),

      game_date:
        game
          ?.game_date,

      game_time:
        game
          ?.game_time ||
        null,

      away_team:
        game
          ?.away_team ||
        null,

      home_team:
        game
          ?.home_team ||
        null,

      moneyline_story:
        summarizeMarket(
          "moneyline",
          gameFeatures,
          gameLabels
        ),

      spread_story:
        summarizeMarket(
          "spread",
          gameFeatures,
          gameLabels
        ),

      total_story:
        summarizeMarket(
          "total",
          gameFeatures,
          gameLabels
        ),

      splits_story:
        summarizeSplits(
          gameSplits
        ),

      cashedge_story:
        summarizeCashEdge(
          gameCashEdge
        ),

      final_result:
        buildFinalResult(
          result
        ),

      /*
       * These are pre-game feature-backed
       * market states used by the story.
       */
      market_state_count:
        gameFeatures.length,

      split_state_count:
        gameSplits.length,

      cashedge_state_count:
        gameCashEdge.length,

      story_version:
        STORY_VERSION,

      built_at:
        now,

      updated_at:
        now
    });
  }


  const written =
    await upsertStories(
      stories
    );


  return {
    ok:
      true,

    gameDate,

    games:
      games.length,

    completedGames:
      stories.length,

    written
  };
}


// ============================================================
// SAFE ENTRY
// ============================================================

async function buildGameDateStoriesSafe(
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

    return await buildGameDateStories(
      gameDate
    );

  } catch (error) {

    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );


    return {
      ok:
        false,

      gameDate,

      error:
        error
          ?.message ||
        String(
          error
        )
    };

  } finally {

    running =
      false;
  }
}


module.exports = {
  buildGameDateStoriesSafe
};

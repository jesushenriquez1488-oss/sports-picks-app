"use strict";

const PREFIX =
  "[learning-engine]";

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

let running =
  false;


// ============================================================
// HELPERS
// ============================================================

function norm(
  value
) {

  return String(
    value ||
    ""
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


  const parsed =
    Number(
      value
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function safeObject(
  value
) {

  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  )
    ? value
    : {};
}


function safeArray(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function median(
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
      )
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );


  if (
    !valid.length
  ) {
    return null;
  }


  const middle =
    Math.floor(
      valid.length /
      2
    );


  if (
    valid.length %
      2
  ) {

    return valid[
      middle
    ];
  }


  return (
    valid[
      middle -
      1
    ] +
    valid[
      middle
    ]
  ) /
  2;
}


function settleNumber(
  value
) {

  const EPSILON =
    0.0000001;


  if (
    value >
    EPSILON
  ) {
    return "win";
  }


  if (
    value <
    -EPSILON
  ) {
    return "loss";
  }


  return "push";
}


// ============================================================
// SUPABASE
// ============================================================

function authHeaders(
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


async function supabaseGet(
  table,
  params,
  range
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
      params ||
      {}
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
          headers:
            authHeaders({
              Range:
                range,

              "Range-Unit":
                "items"
            }),

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


    return Array.isArray(
      parsed
    )
      ? parsed
      : [];

  } finally {

    clearTimeout(
      timer
    );
  }
}


async function readStories(
  sport =
    null,
  gameDate =
    null
) {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const page =
      await supabaseGet(
        "learning_game_stories",
        {
          select:
            "cashedge_game_id,sport,game_date,away_team,home_team,moneyline_story,spread_story,total_story,splits_story,cashedge_story,final_result,story_version",

                    ...(
            sport
              ? {
                  sport:
                    `eq.${norm(
                      sport
                    )}`
                }
              : {}
          ),

          ...(
            gameDate
              ? {
                  game_date:
                    `eq.${gameDate}`
                }
              : {}
          ),

          order:
            "game_date.asc,cashedge_game_id.asc"
        },

        `${offset}-${offset + PAGE_SIZE - 1}`
      );


    rows.push(
      ...page
    );


    if (
      page.length <
      PAGE_SIZE
    ) {
      break;
    }


    offset +=
      PAGE_SIZE;
  }


  return rows;
}


// ============================================================
// STORY ACCESS
// ============================================================

function marketBlock(
  story,
  marketType
) {

  if (
    marketType ===
    "moneyline"
  ) {

    return safeObject(
      story
        .moneyline_story
    );
  }


  if (
    marketType ===
    "spread"
  ) {

    return safeObject(
      story
        .spread_story
    );
  }


  if (
    marketType ===
    "total"
  ) {

    return safeObject(
      story
        .total_story
    );
  }


  return {};
}


function directionToSide(
  direction
) {

  if (
    direction ===
    "toward_home"
  ) {
    return "home";
  }


  if (
    direction ===
    "toward_away"
  ) {
    return "away";
  }


  if (
    direction ===
    "toward_over"
  ) {
    return "over";
  }


  if (
    direction ===
    "toward_under"
  ) {
    return "under";
  }


  return null;
}


function selectionToSide(
  story,
  marketType,
  selectionKey
) {

  const selection =
    norm(
      selectionKey
    );


  if (
    marketType ===
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
    selection ===
    norm(
      story.home_team
    )
  ) {
    return "home";
  }


  if (
    selection ===
    norm(
      story.away_team
    )
  ) {
    return "away";
  }


  return null;
}


// ============================================================
// CONSENSUS CLOSE
// ============================================================

function consensusCloseLine(
  story,
  marketType
) {

  const books =
    safeArray(
      marketBlock(
        story,
        marketType
      )
        .books
    );


  if (
    marketType ===
    "spread"
  ) {

    return median(
      books.map(
        book => {

          const line =
            num(
              book
                ?.last
                ?.line
            );


          const side =
            String(
              book
                ?.tracked_side ||
              ""
            )
              .toLowerCase();


          if (
            line === null
          ) {
            return null;
          }


          if (
            side ===
            "home"
          ) {
            return line;
          }


          if (
            side ===
            "away"
          ) {
            return -line;
          }


          return null;
        }
      )
    );
  }


  if (
    marketType ===
    "total"
  ) {

    return median(
      books.map(
        book =>
          num(
            book
              ?.last
              ?.line
          )
      )
    );
  }


  return null;
}


// ============================================================
// SETTLE TARGET SIDE
// ============================================================

function settleSide(
  story,
  marketType,
  side
) {

  const result =
    safeObject(
      story
        .final_result
    );


  const winner =
    String(
      result.winner ||
      ""
    )
      .toLowerCase();


  const margin =
    num(
      result.margin
    );


  const total =
    num(
      result
        .total_points
    );


  if (
    marketType ===
    "moneyline"
  ) {

    if (
      ![
        "home",
        "away"
      ].includes(
        side
      ) ||
      !winner
    ) {
      return null;
    }


    if (
      winner ===
      "tie"
    ) {
      return "push";
    }


    return winner ===
      side
      ? "win"
      : "loss";
  }


  if (
    marketType ===
    "spread"
  ) {

    const homeLine =
      consensusCloseLine(
        story,
        "spread"
      );


    if (
      ![
        "home",
        "away"
      ].includes(
        side
      ) ||
      margin === null ||
      homeLine === null
    ) {
      return null;
    }


    return settleNumber(
      side ===
        "home"
        ? margin +
          homeLine
        : -margin -
          homeLine
    );
  }


  if (
    marketType ===
    "total"
  ) {

    const close =
      consensusCloseLine(
        story,
        "total"
      );


    if (
      ![
        "over",
        "under"
      ].includes(
        side
      ) ||
      total === null ||
      close === null
    ) {
      return null;
    }


    return settleNumber(
      side ===
        "over"
        ? total -
          close
        : close -
          total
    );
  }


  return null;
}


// ============================================================
// BUCKETS
// ============================================================

function breadthBucket(
  count
) {

  count =
    Number(
      count ||
      0
    );


  if (
    count >=
    6
  ) {
    return "6+";
  }


  if (
    count >=
    4
  ) {
    return "4-5";
  }


  if (
    count >=
    2
  ) {
    return "2-3";
  }


  if (
    count ===
    1
  ) {
    return "1";
  }


  return "0";
}


function gapBucket(
  value
) {

  const gap =
    Math.abs(
      num(
        value
      ) ||
      0
    );


  if (
    gap >=
    30
  ) {
    return "30+";
  }


  if (
    gap >=
    20
  ) {
    return "20-29.99";
  }


  if (
    gap >=
    10
  ) {
    return "10-19.99";
  }


  if (
    gap >=
    5
  ) {
    return "5-9.99";
  }


  return "0-4.99";
}


function edgeBucket(
  value
) {

  const edge =
    num(
      value
    );


  if (
    edge === null
  ) {
    return null;
  }


  if (
    edge >=
    30
  ) {
    return "30+";
  }


  if (
    edge >=
    20
  ) {
    return "20-29.99";
  }


  if (
    edge >=
    15
  ) {
    return "15-19.99";
  }


  if (
    edge >=
    10
  ) {
    return "10-14.99";
  }


  if (
    edge >=
    5
  ) {
    return "5-9.99";
  }


  return "under-5";
}


function confidenceBucket(
  value
) {

  const confidence =
    num(
      value
    );


  if (
    confidence === null
  ) {
    return null;
  }


  if (
    confidence >=
    95
  ) {
    return "95+";
  }


  if (
    confidence >=
    85
  ) {
    return "85-94.99";
  }


  if (
    confidence >=
    75
  ) {
    return "75-84.99";
  }


  return "under-75";
}


// ============================================================
// SPLITS
// ============================================================

function strongestSplit(
  story,
  marketType,
  requiredSide =
    null
) {

  const signals =
    safeArray(
      safeObject(
        story
          .splits_story
      )
        .signals
    );


  let best =
    null;


  let bestAbsGap =
    -1;


  for (
    const signal
    of signals
  ) {

    if (
      norm(
        signal
          ?.market_type
      ) !==
      marketType
    ) {
      continue;
    }


    const side =
      selectionToSide(
        story,
        marketType,
        signal
          ?.selection_key
      );


    const gap =
      num(
        signal
          ?.last
          ?.gap
      );


    if (
      !side ||
      gap === null
    ) {
      continue;
    }


    if (
      requiredSide &&
      side !==
      requiredSide
    ) {
      continue;
    }


    const absGap =
      Math.abs(
        gap
      );


    if (
      absGap >
      bestAbsGap
    ) {

      best = {
        side,
        gap,
        signal
      };


      bestAbsGap =
        absGap;
    }
  }


  return best;
}


// ============================================================
// CASHEDGE CONTEXT
// ============================================================

function cashEdgeContext(
  story,
  marketType,
  targetSide
) {

  const cash =
    safeObject(
      story
        .cashedge_story
    );


  const last =
    safeObject(
      cash.last
    );


  if (
    !Object.keys(
      last
    ).length
  ) {

    return {
      present:
        false
    };
  }


  const cashMarket =
    norm(
      last.market_type
    );


  const cashSide =
    selectionToSide(
      story,
      cashMarket,
      last.selection_key
    );


  return {
    present:
      true,

    alignment:
      (
        cashMarket ===
          marketType &&
        cashSide &&
        targetSide
      )
        ? (
            cashSide ===
            targetSide
              ? "aligned"
              : "against"
          )
        : "not_comparable",

    premiumEver:
      typeof cash
        .premium_ever ===
      "boolean"
        ? cash
            .premium_ever
        : null,

    premiumEnd:
      typeof cash
        .premium_at_end ===
      "boolean"
        ? cash
            .premium_at_end
        : null,

    edge:
      num(
        last.edge
      ),

    confidence:
      num(
        last.confidence
      )
  };
}


function addCashEdgeConditions(
  conditions,
  cash
) {

  /*
   * Missing CashEdge data is NOT a signal.
   *
   * If CashEdge was not observed for this game,
   * we simply do not add CashEdge conditions.
   */
  if (
    !cash.present
  ) {
    return;
  }


  conditions.push(
    `cashedge_alignment=${cash.alignment}`
  );


  if (
    cash.premiumEver !==
    null
  ) {

    conditions.push(
      `premium_ever=${cash.premiumEver}`
    );
  }


  if (
    cash.premiumEnd !==
    null
  ) {

    conditions.push(
      `premium_end=${cash.premiumEnd}`
    );
  }


  const edge =
    edgeBucket(
      cash.edge
    );


  const confidence =
    confidenceBucket(
      cash.confidence
    );


  if (
    edge
  ) {

    conditions.push(
      `edge=${edge}`
    );
  }


  if (
    confidence
  ) {

    conditions.push(
      `confidence=${confidence}`
    );
  }
}

// ============================================================
// MARKET CONDITIONS
// ============================================================

function marketConditions(
  story,
  marketType,
  targetSide
) {

  const block =
    marketBlock(
      story,
      marketType
    );


  const conditions =
    [
      `direction=${String(
        block
          .dominant_direction ||
        "unknown"
      )
        .toLowerCase()}`,

      `breadth=${breadthBucket(
        block.book_count
      )}`,

      `reversal=${
        Number(
          block
            .reversal_count ||
          0
        ) >
        0
          ? "yes"
          : "none"
      }`
    ];


  if (
    Number(
      block
        .reversal_count ||
      0
    ) >=
    2
  ) {

    conditions.push(
      "reversal_count=2+"
    );
  }


  const split =
    strongestSplit(
      story,
      marketType,
      targetSide
    );


  if (
    split &&
    split.gap !==
      0
  ) {

    conditions.push(
      `split_relation=${
        split.gap >
        0
          ? "money_gt_tickets"
          : "tickets_gt_money"
      }`
    );


    conditions.push(
      `split_gap=${gapBucket(
        split.gap
      )}`
    );
  }


  addCashEdgeConditions(
    conditions,
    cashEdgeContext(
      story,
      marketType,
      targetSide
    )
  );


  return [
    ...new Set(
      conditions
    )
  ]
    .sort();
}


// ============================================================
// SPLIT CONDITIONS
// ============================================================

function splitConditions(
  story,
  marketType,
  splitSide,
  gap
) {

  const block =
    marketBlock(
      story,
      marketType
    );


  const direction =
    String(
      block
        .dominant_direction ||
      "unknown"
    )
      .toLowerCase();


  const marketSide =
    directionToSide(
      direction
    );


  const conditions =
    [
      `split_relation=${
        gap >
        0
          ? "money_gt_tickets"
          : "tickets_gt_money"
      }`,

      `split_gap=${gapBucket(
        gap
      )}`,

      `breadth=${breadthBucket(
        block.book_count
      )}`,

      `reversal=${
        Number(
          block
            .reversal_count ||
          0
        ) >
        0
          ? "yes"
          : "none"
      }`
    ];


  if (
    marketSide
  ) {

    conditions.push(
      `market_direction=${direction}`
    );


    conditions.push(
      `market_vs_split=${
        marketSide ===
        splitSide
          ? "aligned"
          : "against"
      }`
    );
  }


  addCashEdgeConditions(
    conditions,
    cashEdgeContext(
      story,
      marketType,
      splitSide
    )
  );


  return [
    ...new Set(
      conditions
    )
  ]
    .sort();
}


// ============================================================
// BUILD GAME-LEVEL OBSERVATIONS
// ============================================================

function buildObservations(
  stories
) {

  const observations =
    [];


  for (
    const story
    of stories
  ) {

    const gameId =
      String(
        story
          .cashedge_game_id ||
        ""
      );


    const sport =
      norm(
        story.sport
      );


    if (
      !gameId ||
      !sport
    ) {
      continue;
    }


    for (
      const marketType
      of [
        "moneyline",
        "spread",
        "total"
      ]
    ) {

      const direction =
        String(
          marketBlock(
            story,
            marketType
          )
            .dominant_direction ||
          ""
        )
          .toLowerCase();


      const marketSide =
        directionToSide(
          direction
        );


      // ======================================================
      // FAMILY 1:
      // What happened to the side the MARKET moved toward?
      // ======================================================

      if (
        marketSide
      ) {

        const outcome =
          settleSide(
            story,
            marketType,
            marketSide
          );


        if (
          outcome
        ) {

          observations.push({
            family:
              "market",

            gameId,

            sport,

            marketType,

            outcome,

            conditions:
              marketConditions(
                story,
                marketType,
                marketSide
              )
          });
        }
      }


      // ======================================================
      // FAMILY 2:
      // What happened to the side represented by the
      // strongest Money/Tickets divergence?
      // ======================================================

      const split =
        strongestSplit(
          story,
          marketType
        );


      if (
        split &&
        split.gap !==
          0
      ) {

        const outcome =
          settleSide(
            story,
            marketType,
            split.side
          );


        if (
          outcome
        ) {

          observations.push({
            family:
              "split",

            gameId,

            sport,

            marketType,

            outcome,

            conditions:
              splitConditions(
                story,
                marketType,
                split.side,
                split.gap
              )
          });
        }
      }
    }
  }


  return observations;
}


// ============================================================
// COMBINATIONS
// ============================================================

function pairs(
  values
) {

  const output =
    [];


  for (
    let i = 0;
    i <
      values.length;
    i += 1
  ) {

    for (
      let j =
        i + 1;
      j <
        values.length;
      j += 1
    ) {

      output.push(
        [
          values[i],
          values[j]
        ]
      );
    }
  }


  return output;
}


// ============================================================
// PATTERN ACCUMULATION
// ============================================================

function addPattern(
  map,
  observation,
  conditions
) {

  const normalized =
    [
      ...conditions
    ]
      .sort();


  const key =
    [
      observation
        .family,

      observation
        .sport,

      observation
        .marketType,

      normalized
        .join("&")
    ]
      .join("|");


  if (
    !map.has(
      key
    )
  ) {

    map.set(
      key,
      {
        family:
          observation
            .family,

        sport:
          observation
            .sport,

        market_type:
          observation
            .marketType,

        conditions:
          normalized,

        games:
          new Map(),

        wins:
          0,

        losses:
          0,

        pushes:
          0
      }
    );
  }


  const item =
    map.get(
      key
    );


  /*
   * CRITICAL:
   *
   * One game can count only ONCE
   * inside the same exact pattern.
   *
   * 200 snapshots from one game
   * can never become 200 samples.
   */
  if (
    item.games.has(
      observation.gameId
    )
  ) {
    return;
  }


  item.games.set(
    observation.gameId,
    observation.outcome
  );


  if (
    observation.outcome ===
    "win"
  ) {
    item.wins += 1;
  }


  if (
    observation.outcome ===
    "loss"
  ) {
    item.losses += 1;
  }


  if (
    observation.outcome ===
    "push"
  ) {
    item.pushes += 1;
  }
}


function aggregate(
  observations
) {

  const map =
    new Map();


  for (
    const observation
    of observations
  ) {

    /*
     * Baseline for this
     * sport + market + family.
     */
    addPattern(
      map,
      observation,
      [
        "all"
      ]
    );


    /*
     * Individual conditions.
     */
    for (
      const condition
      of observation
        .conditions
    ) {

      addPattern(
        map,
        observation,
        [
          condition
        ]
      );
    }


    /*
     * Two-condition combinations.
     *
     * V1 intentionally stops at pairs.
     * No combinatorial explosion.
     */
    for (
      const pair
      of pairs(
        observation
          .conditions
      )
    ) {

      addPattern(
        map,
        observation,
        pair
      );
    }
  }


  return map;
}


function serialize(
  item
) {

  const games =
    item
      .games
      .size;


  const decisions =
    item.wins +
    item.losses;


  return {
    family:
      item.family,

    sport:
      item.sport,

    market_type:
      item.market_type,

    conditions:
      item.conditions,

    games,

    wins:
      item.wins,

    losses:
      item.losses,

    pushes:
      item.pushes,

    win_rate:
      decisions
        ? Number(
            (
              (
                item.wins /
                decisions
              ) *
              100
            )
              .toFixed(
                2
              )
          )
        : null
  };
}


// ============================================================
// MAIN ENGINE
// ============================================================

async function analyzeLearning({
  sport =
    null,

  gameDate =
    null,

  minGames =
    1,

  maxPatterns =
    200,

  returnAllPatterns =
    false
} = {}) {

  if (
    !ENABLED
  ) {

    return {
      ok:
        true,

      disabled:
        true,

      sport:
        sport || null,

      gameDate:
        gameDate || null,

      stories:
        0,

      uniqueGames:
        0,

      observations:
        0,

      patternCount:
        0,

      returnedPatterns:
        0,

      patterns:
        []
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
    gameDate &&
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        String(
          gameDate
        )
      )
  ) {

    throw new Error(
      `Invalid Learning game date: ${gameDate}`
    );
  }


  const stories =
    await readStories(
      sport,
      gameDate
    );


  const observations =
    buildObservations(
      stories
    );


  const patternMap =
    aggregate(
      observations
    );


  const allPatterns =
    [
      ...patternMap
        .values()
    ]
      .map(
        serialize
      )
      .filter(
        pattern =>
          pattern.games >=
          Number(
            minGames ||
            1
          )
      )
      .sort(
        (
          a,
          b
        ) => {

          if (
            b.games !==
            a.games
          ) {

            return (
              b.games -
              a.games
            );
          }


          if (
            (
              b.win_rate ??
              -1
            ) !==
            (
              a.win_rate ??
              -1
            )
          ) {

            return (
              (
                b.win_rate ??
                -1
              ) -
              (
                a.win_rate ??
                -1
              )
            );
          }


          return a
            .conditions
            .join("&")
            .localeCompare(
              b
                .conditions
                .join("&")
            );
        }
      );


  const patterns =
    returnAllPatterns ===
      true
      ? allPatterns
      : allPatterns.slice(
          0,
          Math.max(
            1,
            Number(
              maxPatterns ||
              200
            )
          )
        );


  return {
    ok:
      true,

    sport:
      sport
        ? norm(
            sport
          )
        : null,

    gameDate:
      gameDate ||
      null,

    stories:
      stories.length,

    uniqueGames:
      new Set(
        observations.map(
          row =>
            row.gameId
        )
      )
        .size,

    observations:
      observations.length,

    patternCount:
      patternMap.size,

    returnedPatterns:
      patterns.length,

    patterns
  };
}

// ============================================================
// SAFE PUBLIC ENTRY
// ============================================================

async function analyzeLearningSafe(
  options =
    {}
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
        "already-running"
    };
  }


  running =
    true;


  try {

    return await analyzeLearning(
      options
    );

  } catch (error) {

    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );


    return {
      ok:
        false,

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
  analyzeLearningSafe
};

"use strict";

const PREFIX =
  "[learning-market-feed]";

const CAPTURE_CHUNK_SIZE =
  500;

const MARKET_TYPES =
  new Map([
    ["h2h", "moneyline"],
    ["spreads", "spread"],
    ["totals", "total"]
  ]);

let processing =
  false;

let queuedRequest =
  null;


// ============================================================
// HELPERS
// ============================================================

function text(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const output =
    String(value)
      .trim();


  return output || null;
}


function number(value) {

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
}


function normalized(value) {

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


// ============================================================
// BUILD ONE LEARNING MARKET STATE
// ============================================================

function buildState({
  sport,
  tracked,
  event,
  bookmaker,
  market,
  outcome,
  marketType,
  sportsbookKey,
  boardTimestamp,
  observedAt,
  normalizeSelectionKey
}) {

  const price =
    number(
      outcome?.price
    );


  if (
    price === null
  ) {
    return null;
  }


  let selectionKey =
    null;

  let line =
    null;


  // ==========================================================
  // TOTAL
  // ==========================================================

  if (
    marketType === "total"
  ) {

    const totalSide =
      normalized(
        outcome?.name
      );


    if (
      totalSide !== "over" &&
      totalSide !== "under"
    ) {
      return null;
    }


    selectionKey =
      totalSide;


    line =
      number(
        outcome?.point
      );


    if (
      line === null
    ) {
      return null;
    }

  } else {

    // ========================================================
    // MONEYLINE / SPREAD
    // ========================================================

    const outcomeName =
      text(
        outcome?.name
      );


    if (
      !outcomeName
    ) {
      return null;
    }


    const selectionNormalizer =
      typeof normalizeSelectionKey ===
        "function"
        ? normalizeSelectionKey
        : normalized;


    selectionKey =
      selectionNormalizer(
        outcomeName
      );


    if (
      !selectionKey
    ) {
      return null;
    }


    /*
     * CashEdge sports currently use team-vs-team markets.
     *
     * Ignore any unrelated provider outcomes.
     */
    const awayKey =
      selectionNormalizer(
        event?.away_team
      );


    const homeKey =
      selectionNormalizer(
        event?.home_team
      );


    if (
      selectionKey !== awayKey &&
      selectionKey !== homeKey
    ) {
      return null;
    }


    // ========================================================
    // SPREAD
    // ========================================================

    if (
      marketType === "spread"
    ) {

      line =
        number(
          outcome?.point
        );


      if (
        line === null
      ) {
        return null;
      }
    }
  }


  // ==========================================================
  // FINAL CANONICAL STATE
  // ==========================================================

  return {

    cashedge_game_id:
      text(
        tracked
          ?.cashedge_game_id
      ),

    sport:
      sport,

    provider:
      "owls",

    provider_event_id:
      text(
        event?.id
      ),

    sportsbook_key:
      sportsbookKey,

    market_type:
      marketType,

    selection_key:
      selectionKey,

    /*
     * Moneyline has no line.
     *
     * Its American odds belong in price_american.
     */
    line:
      line,

    price_american:
      Math.round(
        price
      ),

    /*
     * Prefer the most specific provider time available.
     */
    provider_timestamp:
      text(
        market?.last_update ||
        bookmaker?.last_update ||
        boardTimestamp
      ),

    observed_at:
      observedAt
  };
}


// ============================================================
// CAPTURE FULL OWLS BOARD
//
// IMPORTANT:
//
// This does NOT:
// - call Vercel
// - modify Market Intelligence tables
// - modify daily_picks
// - run Premium Radar
// - run market evaluation
//
// It only converts the existing OWLS board into Learning
// states and passes them to learningCapture.js.
// ============================================================

async function captureBoard({
  data,
  learningCapture,
  resolveGame,
  normalizeSportsbookKey,
  normalizeSelectionKey,
  allowedSports,
  allowedBooks
}) {

  // ==========================================================
  // BASIC BOARD VALIDATION
  // ==========================================================

  if (
    !data ||
    typeof data !== "object" ||
    !data.sports ||
    typeof data.sports !== "object"
  ) {

    return {
      ok: true,
      skipped: true,
      reason:
        "invalid_board",
      written: 0
    };
  }


  // ==========================================================
  // REQUIRED DEPENDENCIES
  // ==========================================================

  if (
    !learningCapture ||
    typeof learningCapture
      .captureMarketStates !==
      "function" ||
    typeof learningCapture
      .getStatus !==
      "function" ||
    typeof resolveGame !==
      "function"
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "learning_market_dependencies_unavailable",
      written: 0
    };
  }


  // ==========================================================
  // LEARNING FEATURE FLAG
  // ==========================================================

  const status =
    learningCapture
      .getStatus();


  if (
    status?.active !== true
  ) {

    return {
      ok: true,
      skipped: true,
      reason:
        "learning_disabled",
      written: 0
    };
  }


  // ==========================================================
  // ALLOWED SPORTS / BOOKS
  // ==========================================================

  const sportSet =
    new Set(
      Array.isArray(
        allowedSports
      )
        ? allowedSports
            .map(
              normalized
            )
        : []
    );


  const bookSet =
    new Set(
      Array.isArray(
        allowedBooks
      )
        ? allowedBooks
            .map(
              normalized
            )
        : []
    );


  // ==========================================================
  // BOARD TIMES
  // ==========================================================

  const observedAt =
    new Date()
      .toISOString();


  const boardTimestamp =
    text(
      data.last_odds_change ||
      data.timestamp
    );


  /*
   * Prevent duplicate copies of the same identity
   * inside one OWLS board.
   *
   * identity =
   * sport
   * game
   * provider
   * sportsbook
   * market
   * selection
   */
  const stateMap =
    new Map();


  let matchedEvents =
    0;

  let unmatchedEvents =
    0;


  // ==========================================================
  // SPORTS
  // ==========================================================

  for (
    const [
      rawSport,
      rawEvents
    ]
    of Object.entries(
      data.sports
    )
  ) {

    const sport =
      normalized(
        rawSport
      );


    if (
      !sport ||
      (
        sportSet.size > 0 &&
        !sportSet.has(
          sport
        )
      ) ||
      !Array.isArray(
        rawEvents
      )
    ) {
      continue;
    }


    // ========================================================
    // EVENTS
    // ========================================================

    for (
      const event
      of rawEvents
    ) {

      const commenceMs =
        Date.parse(
          event?.commence_time
        );


      /*
       * Learning Intelligence is currently
       * PRE-GAME only.
       *
       * Never continue collecting game odds
       * after kickoff.
       */
      if (
        !Number.isFinite(
          commenceMs
        ) ||
        commenceMs <=
          Date.now()
      ) {
        continue;
      }


      // ======================================================
      // MATCH OWLS EVENT → CASHEDGE GAME
      // ======================================================

      let tracked =
        null;


      try {

        tracked =
          resolveGame({
            sport,
            event
          });

      } catch (error) {

        console.error(
          `${PREFIX} game resolver failed: ${error?.message || error}`
        );

        continue;
      }


      /*
       * Learning needs CashEdge's canonical game ID.
       *
       * If we cannot confidently match the event,
       * never invent an association.
       */
      if (
        !tracked
          ?.cashedge_game_id
      ) {

        unmatchedEvents +=
          1;

        continue;
      }


      matchedEvents +=
        1;


      // ======================================================
      // SPORTSBOOKS
      // ======================================================

      const bookmakers =
        Array.isArray(
          event?.bookmakers
        )
          ? event.bookmakers
          : [];


      for (
        const bookmaker
        of bookmakers
      ) {

        const rawBookKey =
          normalized(
            bookmaker?.key
          );


        if (
          !rawBookKey ||
          (
            bookSet.size > 0 &&
            !bookSet.has(
              rawBookKey
            )
          )
        ) {
          continue;
        }


        /*
         * Reuse CashEdge's existing sportsbook normalization.
         *
         * Examples:
         * Caesars → williamhill_us
         * Hard Rock → hardrockbet
         */
        const sportsbookKey =
          typeof normalizeSportsbookKey ===
            "function"
            ? normalizeSportsbookKey(
                rawBookKey
              )
            : rawBookKey;


        if (
          !sportsbookKey
        ) {
          continue;
        }


        // ====================================================
        // MARKETS
        // ====================================================

        const markets =
          Array.isArray(
            bookmaker?.markets
          )
            ? bookmaker.markets
            : [];


        for (
          const market
          of markets
        ) {

          const marketKey =
            normalized(
              market?.key
            );


          /*
           * OWLS:
           *
           * h2h     → moneyline
           * spreads → spread
           * totals  → total
           */
          const marketType =
            MARKET_TYPES.get(
              marketKey
            );


          /*
           * Ignore player props and any other market
           * for this Learning layer.
           */
          if (
            !marketType
          ) {
            continue;
          }


          const outcomes =
            Array.isArray(
              market?.outcomes
            )
              ? market.outcomes
              : [];


          // ==================================================
          // OUTCOMES
          // ==================================================

          for (
            const outcome
            of outcomes
          ) {

            const state =
              buildState({
                sport,
                tracked,
                event,
                bookmaker,
                market,
                outcome,
                marketType,
                sportsbookKey,
                boardTimestamp,
                observedAt,
                normalizeSelectionKey
              });


            if (
              !state
                ?.cashedge_game_id ||
              !state
                ?.selection_key
            ) {
              continue;
            }


            const identity =
              [
                state.sport,
                state
                  .cashedge_game_id,
                state.provider,
                state
                  .sportsbook_key,
                state
                  .market_type,
                state
                  .selection_key
              ]
                .join("|");


            /*
             * One canonical state per identity
             * inside this board.
             *
             * If OWLS repeats the same identity,
             * newest representation wins.
             */
            stateMap.set(
              identity,
              state
            );
          }
        }
      }
    }
  }


  // ==========================================================
  // FINAL BOARD
  // ==========================================================

  const states =
    Array.from(
      stateMap.values()
    );


  let written =
    0;


  // ==========================================================
  // BATCH WRITE
  //
  // Do NOT send thousands of states in one HTTP request.
  //
  // learningCapture.js itself:
  // - compares against learning_capture_heads
  // - ignores unchanged states
  // - stores only real line/price changes
  // ==========================================================

  for (
    let index = 0;
    index < states.length;
    index +=
      CAPTURE_CHUNK_SIZE
  ) {

    const chunk =
      states.slice(
        index,
        index +
          CAPTURE_CHUNK_SIZE
      );


    const result =
      await learningCapture
        .captureMarketStates(
          chunk
        );


    if (
      result?.ok !== true
    ) {

      return {
        ok: false,
        matchedEvents,
        unmatchedEvents,
        states:
          states.length,
        written
      };
    }


    written +=
      Number(
        result.written ||
        0
      );
  }


  return {
    ok: true,
    matchedEvents,
    unmatchedEvents,
    states:
      states.length,
    written
  };
}


// ============================================================
// INDEPENDENT LEARNING QUEUE
//
// IMPORTANT:
//
// This queue is completely separate from:
//
// queueOddsUpdate()
// processOddsUpdate()
//
// Market Intelligence does NOT wait for Learning.
//
// If Supabase Learning takes 5 seconds,
// OWLS / Premium Radar continue independently.
//
// If several OWLS boards arrive while Learning is writing,
// keep only the newest waiting board.
// ============================================================

function queueMarketBoardSafe(
  request
) {

  try {

    const learningCapture =
      request
        ?.learningCapture;


    const status =
      learningCapture
        ?.getStatus?.();


    /*
     * Zero work when Learning is disabled.
     */
    if (
      status?.active !== true
    ) {
      return;
    }


    /*
     * A Learning capture is already running.
     *
     * Do not build a backlog.
     * Keep only the newest board.
     */
    if (
      processing
    ) {

      queuedRequest =
        request;

      return;
    }


    processing =
      true;


    /*
     * Fire-and-forget.
     *
     * Nothing from this promise can block
     * Market Intelligence.
     */
    void (
      async () => {

        try {

          let current =
            request;


          while (
            current
          ) {

            /*
             * Clear waiting slot before
             * processing current board.
             *
             * If another board arrives during
             * processing, queueMarketBoardSafe()
             * will place it back here.
             */
            queuedRequest =
              null;


            const result =
              await captureBoard(
                current
              );


            if (
              result?.ok !== true
            ) {

              console.error(
                `${PREFIX} capture unsuccessful`
              );

            } else if (
              Number(
                result?.written ||
                0
              ) > 0
            ) {

              /*
               * Keep logs quiet.
               *
               * Only print when Learning actually
               * stored new market information.
               */
              console.log(
                `${PREFIX} matched events: ${Number(
                  result.matchedEvents ||
                  0
                )}, states: ${Number(
                  result.states ||
                  0
                )}, written: ${Number(
                  result.written ||
                  0
                )}`
              );
            }


            /*
             * If a newer board arrived while we
             * were writing, process that one now.
             */
            current =
              queuedRequest;
          }

        } catch (error) {

          /*
           * CRITICAL:
           *
           * Never propagate a Learning exception
           * into the production worker.
           */
          console.error(
            `${PREFIX} failed: ${error?.message || error}`
          );

        } finally {

          processing =
            false;
        }
      }
    )();

  } catch (error) {

    /*
     * Even queue/setup failures remain isolated.
     */
    console.error(
      `${PREFIX} queue failed: ${error?.message || error}`
    );
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  queueMarketBoardSafe,
  captureBoard
};

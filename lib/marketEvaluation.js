const crypto = require("crypto");


// ============================================================
// CONFIG — SHADOW / RESEARCH THRESHOLDS
// ============================================================

const MIN_BOOKS_FOR_MARKET = 2;

// Spread / Total
const LINE_MOVE_THRESHOLD = 0.5;

// Price movement when line is unchanged,
// and for Moneyline.
const IMPLIED_PROB_MOVE_THRESHOLD_PP = 1.5;


// ============================================================
// HELPERS
// ============================================================

function safeNum(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function americanToProbability(odds) {
  const n = safeNum(odds);

  if (
    n === null ||
    n === 0
  ) {
    return null;
  }

  if (n < 0) {
    return (
      Math.abs(n) /
      (
        Math.abs(n) +
        100
      )
    );
  }

  return (
    100 /
    (
      n +
      100
    )
  );
}


function probabilityToAmerican(probability) {
  const p =
    safeNum(probability);

  if (
    p === null ||
    p <= 0 ||
    p >= 1
  ) {
    return null;
  }

  if (p >= 0.5) {
    return Math.round(
      -100 *
      p /
      (1 - p)
    );
  }

  return Math.round(
    100 *
    (1 - p) /
    p
  );
}


function median(values) {
  const clean =
    values
      .map(Number)
      .filter(Number.isFinite)
      .sort(
        (a, b) =>
          a - b
      );

  if (!clean.length) {
    return null;
  }

  const middle =
    Math.floor(
      clean.length / 2
    );

  if (
    clean.length % 2
  ) {
    return clean[middle];
  }

  return (
    clean[middle - 1] +
    clean[middle]
  ) / 2;
}


function round2(value) {
  const n = safeNum(value);

  if (n === null) {
    return null;
  }

  return Number(
    n.toFixed(2)
  );
}


function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


// ============================================================
// BEST QUOTE
// ============================================================

function betterPrice(
  candidate,
  current
) {
  const a =
    safeNum(candidate);

  const b =
    safeNum(current);

  if (a === null) {
    return false;
  }

  if (b === null) {
    return true;
  }

  // Higher American number is better:
  // -105 > -120
  // +120 > +105
  return a > b;
}


function isBetterQuote(
  candidate,
  currentBest,
  marketType,
  selectionKey
) {

  if (!currentBest) {
    return true;
  }

  if (
    marketType === "moneyline"
  ) {
    return betterPrice(
      candidate.price_american,
      currentBest.price_american
    );
  }

  const candidateLine =
    safeNum(candidate.line);

  const bestLine =
    safeNum(
      currentBest.line
    );

  if (
    candidateLine === null
  ) {
    return false;
  }

  if (
    bestLine === null
  ) {
    return true;
  }


  // ==========================================================
  // TOTAL
  // ==========================================================

  if (
    marketType === "total"
  ) {

    if (
      selectionKey === "under"
    ) {

      // For bettor:
      // UNDER 8.5 is better than UNDER 8.0

      if (
        candidateLine >
        bestLine
      ) {
        return true;
      }

      if (
        candidateLine <
        bestLine
      ) {
        return false;
      }
    }


    if (
      selectionKey === "over"
    ) {

      // OVER 8.0 is better than OVER 8.5

      if (
        candidateLine <
        bestLine
      ) {
        return true;
      }

      if (
        candidateLine >
        bestLine
      ) {
        return false;
      }
    }


    return betterPrice(
      candidate.price_american,
      currentBest.price_american
    );
  }


  // ==========================================================
  // SPREAD / RUNLINE
  //
  // For bettor, bigger number is always better:
  //
  // +3.5 > +3
  // -2.5 > -3.5
  // ==========================================================

  if (
    marketType === "spread"
  ) {

    if (
      candidateLine >
      bestLine
    ) {
      return true;
    }

    if (
      candidateLine <
      bestLine
    ) {
      return false;
    }

    return betterPrice(
      candidate.price_american,
      currentBest.price_american
    );
  }


  return false;
}


// ============================================================
// MARKET CONSENSUS
// ============================================================

function calculateConsensus(
  quotes,
  marketType
) {

  if (
    quotes.length <
    MIN_BOOKS_FOR_MARKET
  ) {
    return {
      status: "no_data"
    };
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType === "moneyline"
  ) {

    const probabilities =
      quotes
        .map(
          quote =>
            americanToProbability(
              quote.price_american
            )
        )
        .filter(
          Number.isFinite
        );


    if (
      probabilities.length <
      MIN_BOOKS_FOR_MARKET
    ) {
      return {
        status: "no_data"
      };
    }


    const medianProbability =
      median(probabilities);


    return {
      status: "clear",

      line: null,

      price:
        probabilityToAmerican(
          medianProbability
        ),

      impliedProbability:
        medianProbability,

      totalBooks:
        probabilities.length,

      booksAtConsensus:
        probabilities.length,

      distribution: []
    };
  }


  // ==========================================================
  // SPREAD / TOTAL
  // ==========================================================

  const groups =
    new Map();


  for (
    const quote
    of quotes
  ) {

    const line =
      safeNum(
        quote.line
      );

    if (
      line === null
    ) {
      continue;
    }

    const key =
      String(line);


    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        {
          line,
          quotes: []
        }
      );
    }


    groups
      .get(key)
      .quotes
      .push(quote);
  }


  if (!groups.size) {
    return {
      status: "no_data"
    };
  }


  const distribution =
    Array.from(
      groups.values()
    )
      .map(
        group => {

          const prices =
            group.quotes
              .map(
                quote =>
                  safeNum(
                    quote
                      .price_american
                  )
              )
              .filter(
                Number.isFinite
              );


          return {
            line:
              group.line,

            books:
              group
                .quotes
                .length,

            price:
              prices.length
                ? Math.round(
                    median(prices)
                  )
                : null,

            sportsbooks:
              group
                .quotes
                .map(
                  quote =>
                    quote
                      .sportsbook_name ||
                    quote
                      .sportsbook_key
                )
          };
        }
      );


  const totalBooks =
    distribution
      .reduce(
        (
          total,
          item
        ) =>
          total +
          item.books,
        0
      );


  if (
    totalBooks <
    MIN_BOOKS_FOR_MARKET
  ) {
    return {
      status: "no_data"
    };
  }


  const maxBooks =
    Math.max(
      ...distribution
        .map(
          item =>
            item.books
        )
    );


  const leaders =
    distribution
      .filter(
        item =>
          item.books ===
          maxBooks
      );


  // No unique market line.
  if (
    leaders.length !== 1
  ) {

    return {
      status: "split",

      line: null,
      price: null,

      splitLines:
        leaders
          .map(
            item =>
              item.line
          )
          .sort(
            (a, b) =>
              a - b
          ),

      booksAtConsensus:
        maxBooks,

      totalBooks,

      distribution
    };
  }


  const winner =
    leaders[0];


  return {
    status: "clear",

    line:
      winner.line,

    price:
      winner.price,

    totalBooks,

    booksAtConsensus:
      winner.books,

    distribution
  };
}


// ============================================================
// ALIGNMENT CLASSIFICATION
// ============================================================

function classifyAlignment({
  marketType,
  selectionKey,

  baselineLine,
  baselinePrice,

  marketLine,
  marketPrice,

  consensusStatus
}) {

  // ==========================================================
  // NO DATA
  // ==========================================================

  if (
    consensusStatus ===
    "no_data"
  ) {
    return {
      state: "NO_DATA",

      lineMovement: null,

      baselineProbability: null,
      marketProbability: null,

      impliedProbabilityMovementPP:
        null,

      reason:
        "Not enough sportsbook data"
    };
  }


  // ==========================================================
  // SPLIT
  // ==========================================================

  if (
    consensusStatus ===
    "split"
  ) {
    return {
      state: "SPLIT",

      lineMovement: null,

      baselineProbability: null,
      marketProbability: null,

      impliedProbabilityMovementPP:
        null,

      reason:
        "Sportsbooks are split between multiple leading lines"
    };
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType ===
    "moneyline"
  ) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const marketProb =
      americanToProbability(
        marketPrice
      );


    if (
      baselineProb === null ||
      marketProb === null
    ) {
      return {
        state: "NO_DATA",

        lineMovement: null,

        baselineProbability:
          baselineProb,

        marketProbability:
          marketProb,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Moneyline probability could not be calculated"
      };
    }


    const probabilityMovePP =
      (
        marketProb -
        baselineProb
      ) * 100;


    if (
      probabilityMovePP >=
      IMPLIED_PROB_MOVE_THRESHOLD_PP
    ) {

      return {
        state: "ALIGNED",

        lineMovement: null,

        baselineProbability:
          baselineProb,

        marketProbability:
          marketProb,

        impliedProbabilityMovementPP:
          round2(
            probabilityMovePP
          ),

        reason:
          "Market probability increased for the CashEdge Moneyline pick"
      };
    }


    if (
      probabilityMovePP <=
      -IMPLIED_PROB_MOVE_THRESHOLD_PP
    ) {

      return {
        state: "AGAINST",

        lineMovement: null,

        baselineProbability:
          baselineProb,

        marketProbability:
          marketProb,

        impliedProbabilityMovementPP:
          round2(
            probabilityMovePP
          ),

        reason:
          "Market probability decreased for the CashEdge Moneyline pick"
      };
    }


    return {
      state: "NEUTRAL",

      lineMovement: null,

      baselineProbability:
        baselineProb,

      marketProbability:
        marketProb,

      impliedProbabilityMovementPP:
        round2(
          probabilityMovePP
        ),

      reason:
        "Moneyline movement is below the research threshold"
    };
  }


  // ==========================================================
  // SPREAD / TOTAL
  // ==========================================================

  const baseline =
    safeNum(
      baselineLine
    );

  const market =
    safeNum(
      marketLine
    );


  if (
    baseline === null ||
    market === null
  ) {

    return {
      state: "NO_DATA",

      lineMovement: null,

      baselineProbability: null,
      marketProbability: null,

      impliedProbabilityMovementPP:
        null,

      reason:
        "Market line could not be calculated"
    };
  }


  const lineMovement =
    market -
    baseline;


  // ==========================================================
  // TOTAL — UNDER
  //
  // UNDER 8.5 -> 8.0 = ALIGNED
  // ==========================================================

  if (
    marketType === "total" &&
    selectionKey === "under"
  ) {

    if (
      lineMovement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "ALIGNED",
        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Total moved down toward the CashEdge UNDER"
      };
    }


    if (
      lineMovement >=
      LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "AGAINST",
        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Total moved up against the CashEdge UNDER"
      };
    }
  }


  // ==========================================================
  // TOTAL — OVER
  //
  // OVER 8.5 -> 9.0 = ALIGNED
  // ==========================================================

  if (
    marketType === "total" &&
    selectionKey === "over"
  ) {

    if (
      lineMovement >=
      LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "ALIGNED",
        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Total moved up toward the CashEdge OVER"
      };
    }


    if (
      lineMovement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "AGAINST",
        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Total moved down against the CashEdge OVER"
      };
    }
  }


  // ==========================================================
  // SPREAD / RUNLINE
  //
  // Selected side:
  //
  // +3.5 -> +2.5 = ALIGNED
  // -8.5 -> -9.5 = ALIGNED
  //
  // In both cases the numerical line falls.
  // ==========================================================

  if (
    marketType === "spread"
  ) {

    if (
      lineMovement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "ALIGNED",

        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Spread moved toward the CashEdge selected team"
      };
    }


    if (
      lineMovement >=
      LINE_MOVE_THRESHOLD
    ) {
      return {
        state: "AGAINST",

        lineMovement:
          round2(lineMovement),

        baselineProbability: null,
        marketProbability: null,

        impliedProbabilityMovementPP:
          null,

        reason:
          "Spread moved against the CashEdge selected team"
      };
    }
  }


  // ==========================================================
  // LINE DID NOT MOVE ENOUGH.
  //
  // Price can still indicate pressure at the SAME line.
  //
  // Example:
  //
  // UNDER 8.5 -105
  // becomes
  // UNDER 8.5 -125
  //
  // That is meaningful support even though 8.5 did not move.
  // ==========================================================

  const sameLine =
    Math.abs(
      lineMovement
    ) <
    LINE_MOVE_THRESHOLD;


  if (sameLine) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const marketProb =
      americanToProbability(
        marketPrice
      );


    if (
      baselineProb !== null &&
      marketProb !== null
    ) {

      const probabilityMovePP =
        (
          marketProb -
          baselineProb
        ) * 100;


      if (
        probabilityMovePP >=
        IMPLIED_PROB_MOVE_THRESHOLD_PP
      ) {

        return {
          state: "ALIGNED",

          lineMovement:
            round2(lineMovement),

          baselineProbability:
            baselineProb,

          marketProbability:
            marketProb,

          impliedProbabilityMovementPP:
            round2(
              probabilityMovePP
            ),

          reason:
            "Line is stable but price moved toward the CashEdge selection"
        };
      }


      if (
        probabilityMovePP <=
        -IMPLIED_PROB_MOVE_THRESHOLD_PP
      ) {

        return {
          state: "AGAINST",

          lineMovement:
            round2(lineMovement),

          baselineProbability:
            baselineProb,

          marketProbability:
            marketProb,

          impliedProbabilityMovementPP:
            round2(
              probabilityMovePP
            ),

          reason:
            "Line is stable but price moved against the CashEdge selection"
        };
      }


      return {
        state: "NEUTRAL",

        lineMovement:
          round2(lineMovement),

        baselineProbability:
          baselineProb,

        marketProbability:
          marketProb,

        impliedProbabilityMovementPP:
          round2(
            probabilityMovePP
          ),

        reason:
          "No meaningful market movement detected"
      };
    }
  }


  return {
    state: "NEUTRAL",

    lineMovement:
      round2(lineMovement),

    baselineProbability: null,
    marketProbability: null,

    impliedProbabilityMovementPP:
      null,

    reason:
      "No meaningful market movement detected"
  };
}


// ============================================================
// SNAPSHOT FINGERPRINT
// ============================================================

function makeFingerprint(data) {

  const raw =
    JSON.stringify({
      gameId:
        data.gameId,

      state:
        data.state,

      marketLine:
        data.marketLine,

      marketPrice:
        data.marketPrice,

      bestBook:
        data.bestBook,

      bestLine:
        data.bestLine,

      bestPrice:
        data.bestPrice,

      moneyPct:
        data.moneyPct,

      ticketsPct:
        data.ticketsPct
    });


  return crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex");
}


// ============================================================
// MAIN EVALUATION FUNCTION
// ============================================================

async function evaluateMarketGame({
  supabaseAdmin,
  gameId
}) {

  // ==========================================================
  // CASHEDGE CONTEXT
  // ==========================================================

  const {
    data: context,
    error: contextError
  } =
    await supabaseAdmin
      .from(
        "market_pick_context"
      )
      .select("*")
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (contextError) {
    throw contextError;
  }


  if (!context) {
    return {
      ok: false,
      error:
        "Game not found in market_pick_context"
    };
  }


  if (
    context.current_is_premium !==
    true
  ) {
    return {
      ok: true,
      premium: false,
      evaluated: false
    };
  }


  const marketType =
    normalizeText(
      context.market_type
    );


  const selectionKey =
    normalizeText(
      context.selection_key
    );


  // ==========================================================
  // CURRENT QUOTES
  // ==========================================================

  const {
    data: quoteRows,
    error: quoteError
  } =
    await supabaseAdmin
      .from(
        "market_current_quotes"
      )
      .select(`
        sportsbook_key,
        sportsbook_name,
        provider,
        market_type,
        selection_key,
        selection_name,
        line,
        price_american,
        provider_timestamp,
        observed_at,
        updated_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "market_type",
        marketType
      )
      .eq(
        "selection_key",
        selectionKey
      );


  if (quoteError) {
    throw quoteError;
  }


  const quotes =
    (quoteRows || [])
      .filter(
        quote =>
          safeNum(
            quote
              .price_american
          ) !== null
      );


  // ==========================================================
  // BEST AVAILABLE QUOTE
  // ==========================================================

  let best = null;


  for (
    const quote
    of quotes
  ) {

    if (
      isBetterQuote(
        quote,
        best,
        marketType,
        selectionKey
      )
    ) {
      best = quote;
    }
  }


  // ==========================================================
  // CONSENSUS
  // ==========================================================

  const consensus =
    calculateConsensus(
      quotes,
      marketType
    );


  // ==========================================================
  // ALIGNMENT
  // ==========================================================

  const alignment =
    classifyAlignment({

      marketType,
      selectionKey,

      baselineLine:
        context
          .first_premium_line,

      baselinePrice:
        context
          .first_premium_price_american,

      marketLine:
        consensus?.line,

      marketPrice:
        consensus?.price,

      consensusStatus:
        consensus?.status ||
        "no_data"
    });


  // ==========================================================
  // LATEST MONEY / TICKETS
  // ==========================================================

  const {
    data: latestSplit,
    error: splitError
  } =
    await supabaseAdmin
      .from(
        "market_split_snapshots"
      )
      .select(`
        provider,
        line,
        price_american,
        money_pct,
        tickets_pct,
        observed_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "market_type",
        marketType
      )
      .eq(
        "selection_key",
        selectionKey
      )
      .order(
        "observed_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (splitError) {
    throw splitError;
  }


  const moneyPct =
    safeNum(
      latestSplit
        ?.money_pct
    );


  const ticketsPct =
    safeNum(
      latestSplit
        ?.tickets_pct
    );


  const divergence =
    (
      moneyPct !== null &&
      ticketsPct !== null
    )
      ? round2(
          moneyPct -
          ticketsPct
        )
      : null;


  // ==========================================================
  // GAME TIME
  //
  // Will start working automatically once a provider mapping
  // has game_time.
  // ==========================================================

  const {
    data: providerGame,
    error: providerGameError
  } =
    await supabaseAdmin
      .from(
        "market_provider_events"
      )
      .select(`
        game_time
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .not(
        "game_time",
        "is",
        null
      )
      .order(
        "updated_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (providerGameError) {
    throw providerGameError;
  }


  const gameTime =
    providerGame
      ?.game_time ||
    null;


  let minutesToStart =
    null;


  if (gameTime) {

    const gameMs =
      new Date(
        gameTime
      ).getTime();


    if (
      Number.isFinite(
        gameMs
      )
    ) {
      minutesToStart =
        round2(
          (
            gameMs -
            Date.now()
          ) /
          60000
        );
    }
  }


  // ==========================================================
  // IMPLIED MOVEMENT
  // ==========================================================

  const baselineProbability =
    alignment
      .baselineProbability;

  const marketProbability =
    alignment
      .marketProbability;

  const impliedMovePP =
    alignment
      .impliedProbabilityMovementPP;


  // ==========================================================
  // FINGERPRINT
  // ==========================================================

  const fingerprint =
    makeFingerprint({

      gameId,

      state:
        alignment.state,

      marketLine:
        consensus?.line ??
        null,

      marketPrice:
        consensus?.price ??
        null,

      bestBook:
        best
          ?.sportsbook_key ??
        null,

      bestLine:
        best?.line ??
        null,

      bestPrice:
        best
          ?.price_american ??
        null,

      moneyPct,
      ticketsPct
    });


  // ==========================================================
  // EXISTING GAME SUMMARY
  // ==========================================================

  const {
    data: existingSummary,
    error: summaryError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .select("*")
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (summaryError) {
    throw summaryError;
  }


  const now =
    new Date()
      .toISOString();


  // ==========================================================
  // INSERT SNAPSHOT
  // ==========================================================

  let snapshotCreated =
    false;


  const {
    error: snapshotError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_snapshots"
      )
      .insert({

        sport:
          context.sport,

        cashedge_game_id:
          gameId,

        canonical_pick:
          context
            .canonical_pick,

        market_type:
          marketType,

        selection_key:
          selectionKey,

        snapshot_reason:
          existingSummary
            ? "state_change"
            : "initial_evaluation",

        alignment_state:
          alignment.state,


        // CASHEDGE
        cashedge_confidence:
          context
            .current_confidence,

        baseline_line:
          context
            .first_premium_line,

        baseline_price_american:
          context
            .first_premium_price_american,


        // MARKET
        market_line:
          consensus?.line ??
          null,

        market_price_american:
          consensus?.price ??
          null,

        line_movement:
          alignment
            .lineMovement,

        baseline_implied_probability:
          baselineProbability,

        market_implied_probability:
          marketProbability,

        implied_probability_movement_pp:
          impliedMovePP,


        // BEST AVAILABLE
        best_sportsbook_key:
          best
            ?.sportsbook_key ??
          null,

        best_sportsbook_name:
          best
            ?.sportsbook_name ??
          null,

        best_line:
          best?.line ??
          null,

        best_price_american:
          best
            ?.price_american ??
          null,


        // MONEY / TICKETS
        money_pct:
          moneyPct,

        tickets_pct:
          ticketsPct,

        money_ticket_divergence:
          divergence,


        // DEPTH
        total_books:
          consensus
            ?.totalBooks ??
          quotes.length,

        books_at_consensus:
          consensus
            ?.booksAtConsensus ??
          null,

        split_lines:
          consensus
            ?.splitLines ??
          null,


        // TIMING
        game_time:
          gameTime,

        minutes_to_start:
          minutesToStart,


        // FUTURE / RESEARCH
        context_json: {

          classificationReason:
            alignment.reason,

          thresholds: {
            lineMove:
              LINE_MOVE_THRESHOLD,

            impliedProbabilityMovePP:
              IMPLIED_PROB_MOVE_THRESHOLD_PP,

            minimumBooks:
              MIN_BOOKS_FOR_MARKET
          },

          marketDistribution:
            consensus
              ?.distribution ??
            [],

          splitProvider:
            latestSplit
              ?.provider ??
            null,

          currentCashEdgeLine:
            context
              .current_cashedge_line,

          currentCashEdgePrice:
            context
              .current_cashedge_price_american
        },


        fingerprint,

        observed_at:
          now,

        created_at:
          now
      });


  if (
    !snapshotError
  ) {
    snapshotCreated =
      true;
  } else if (
    snapshotError.code !==
    "23505"
  ) {
    throw snapshotError;
  }


  // ==========================================================
  // CREATE SUMMARY IF FIRST TIME
  // ==========================================================

  if (!existingSummary) {

    const stateCounter = {
      aligned_count:
        alignment.state ===
        "ALIGNED"
          ? 1
          : 0,

      against_count:
        alignment.state ===
        "AGAINST"
          ? 1
          : 0,

      neutral_count:
        alignment.state ===
        "NEUTRAL"
          ? 1
          : 0,

      split_count:
        alignment.state ===
        "SPLIT"
          ? 1
          : 0,

      no_data_count:
        alignment.state ===
        "NO_DATA"
          ? 1
          : 0
    };


    const meaningful =
      (
        alignment.state ===
          "ALIGNED" ||
        alignment.state ===
          "AGAINST"
      );


    const shouldFinalizePregame =
      (
        minutesToStart !== null &&
        minutesToStart >= 0 &&
        minutesToStart <= 30
      );


    const {
      error: insertSummaryError
    } =
      await supabaseAdmin
        .from(
          "market_evaluation_games"
        )
        .insert({

          sport:
            context.sport,

          cashedge_game_id:
            gameId,

          canonical_pick:
            context
              .canonical_pick,

          market_type:
            marketType,

          selection_key:
            selectionKey,

          cashedge_confidence:
            context
              .current_confidence,

          first_premium_line:
            context
              .first_premium_line,

          first_premium_price_american:
            context
              .first_premium_price_american,


          latest_alignment_state:
            alignment.state,

          latest_market_line:
            consensus?.line ??
            null,

          latest_market_price_american:
            consensus?.price ??
            null,

          latest_best_sportsbook_key:
            best
              ?.sportsbook_key ??
            null,

          latest_best_sportsbook_name:
            best
              ?.sportsbook_name ??
            null,

          latest_best_line:
            best?.line ??
            null,

          latest_best_price_american:
            best
              ?.price_american ??
            null,

          latest_money_pct:
            moneyPct,

          latest_tickets_pct:
            ticketsPct,

          latest_money_ticket_divergence:
            divergence,


          first_meaningful_alignment:
            meaningful
              ? alignment.state
              : null,

          first_meaningful_alignment_at:
            meaningful
              ? now
              : null,


          pregame_final_alignment:
            shouldFinalizePregame
              ? alignment.state
              : null,

          pregame_finalized_at:
            shouldFinalizePregame
              ? now
              : null,


          snapshot_count:
            snapshotCreated
              ? 1
              : 0,

          ...stateCounter,


          max_abs_line_movement:
            alignment.lineMovement ===
            null
              ? null
              : Math.abs(
                  alignment
                    .lineMovement
                ),

          max_abs_implied_prob_movement_pp:
            impliedMovePP === null
              ? null
              : Math.abs(
                  impliedMovePP
                ),

          max_money_ticket_divergence:
            divergence === null
              ? null
              : Math.abs(
                  divergence
                ),


          created_at:
            now,

          updated_at:
            now
        });


    if (insertSummaryError) {
      throw insertSummaryError;
    }


  } else {

    // ========================================================
    // UPDATE EXISTING SUMMARY
    // ========================================================

    const updates = {

      canonical_pick:
        context
          .canonical_pick,

      cashedge_confidence:
        context
          .current_confidence,

      latest_alignment_state:
        alignment.state,

      latest_market_line:
        consensus?.line ??
        null,

      latest_market_price_american:
        consensus?.price ??
        null,

      latest_best_sportsbook_key:
        best
          ?.sportsbook_key ??
        null,

      latest_best_sportsbook_name:
        best
          ?.sportsbook_name ??
        null,

      latest_best_line:
        best?.line ??
        null,

      latest_best_price_american:
        best
          ?.price_american ??
        null,

      latest_money_pct:
        moneyPct,

      latest_tickets_pct:
        ticketsPct,

      latest_money_ticket_divergence:
        divergence,

      updated_at:
        now
    };


    // Only increment counters if a new unique snapshot was created.
    if (snapshotCreated) {

      updates.snapshot_count =
        Number(
          existingSummary
            .snapshot_count ||
          0
        ) + 1;


      const counterColumn = {

        ALIGNED:
          "aligned_count",

        AGAINST:
          "against_count",

        NEUTRAL:
          "neutral_count",

        SPLIT:
          "split_count",

        NO_DATA:
          "no_data_count"

      }[
        alignment.state
      ];


      if (counterColumn) {

        updates[counterColumn] =
          Number(
            existingSummary[
              counterColumn
            ] ||
            0
          ) + 1;
      }


      if (
        alignment.lineMovement !==
        null
      ) {

        updates.max_abs_line_movement =
          Math.max(

            Number(
              existingSummary
                .max_abs_line_movement ||
              0
            ),

            Math.abs(
              alignment
                .lineMovement
            )
          );
      }


      if (
        impliedMovePP !== null
      ) {

        updates.max_abs_implied_prob_movement_pp =
          Math.max(

            Number(
              existingSummary
                .max_abs_implied_prob_movement_pp ||
              0
            ),

            Math.abs(
              impliedMovePP
            )
          );
      }


      if (
        divergence !== null
      ) {

        updates.max_money_ticket_divergence =
          Math.max(

            Number(
              existingSummary
                .max_money_ticket_divergence ||
              0
            ),

            Math.abs(
              divergence
            )
          );
      }
    }


    // First real directional movement.
    if (
      !existingSummary
        .first_meaningful_alignment &&
      (
        alignment.state ===
          "ALIGNED" ||
        alignment.state ===
          "AGAINST"
      )
    ) {

      updates.first_meaningful_alignment =
        alignment.state;

      updates.first_meaningful_alignment_at =
        now;
    }


    // Freeze the pregame evaluation once.
    if (
      !existingSummary
        .pregame_final_alignment &&
      minutesToStart !== null &&
      minutesToStart >= 0 &&
      minutesToStart <= 30
    ) {

      updates.pregame_final_alignment =
        alignment.state;

      updates.pregame_finalized_at =
        now;
    }


    const {
      error: updateSummaryError
    } =
      await supabaseAdmin
        .from(
          "market_evaluation_games"
        )
        .update(
          updates
        )
        .eq(
          "id",
          existingSummary.id
        );


    if (updateSummaryError) {
      throw updateSummaryError;
    }
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    ok: true,

    premium: true,

    evaluated: true,

    gameId,

    pick:
      context
        .canonical_pick,

    alignment:
      alignment.state,

    reason:
      alignment.reason,

    marketType,
    selectionKey,


    cashedgeFound: {

      line:
        context
          .first_premium_line,

      price:
        context
          .first_premium_price_american,

      confidence:
        context
          .current_confidence
    },


    marketNow: {

      status:
        consensus?.status,

      line:
        consensus?.line ??
        null,

      price:
        consensus?.price ??
        null,

      books:
        consensus
          ?.totalBooks ??
        quotes.length
    },


    bestAvailable:
      best
        ? {
            sportsbook:
              best
                .sportsbook_name ||
              best
                .sportsbook_key,

            line:
              best.line,

            price:
              best
                .price_american
          }
        : null,


    moneyTickets: {

      moneyPct,
      ticketsPct,
      divergence
    },


    movement: {

      line:
        alignment
          .lineMovement,

      impliedProbabilityPP:
        alignment
          .impliedProbabilityMovementPP
    },


    timing: {

      gameTime,
      minutesToStart
    },


    snapshotCreated
  };
}


module.exports = {
  evaluateMarketGame
};

const {
  evaluateMarketGame
} = require("./marketEvaluation");


// ============================================================
// RESEARCH THRESHOLDS
//
// These are observation thresholds.
// They are NOT part of CashEdge Confidence.
// ============================================================

const MONEY_DIVERGENCE_MIN = 15;
const MONEY_DIVERGENCE_STRONG = 30;

const PUBLIC_TICKETS_MIN = 65;

const LINE_MOVE_THRESHOLD = 0.5;
const PRICE_PROBABILITY_THRESHOLD_PP = 1.5;


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


function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


function round2(value) {
  const n = safeNum(value);

  return n === null
    ? null
    : Number(n.toFixed(2));
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


// ============================================================
// MONEY / TICKETS — ONE SOURCE
// ============================================================

function classifySplitSource({
  moneyPct,
  ticketsPct
}) {

  const money =
    safeNum(moneyPct);

  const tickets =
    safeNum(ticketsPct);


  if (
    money === null ||
    tickets === null
  ) {
    return {
      signal: "NO_SPLIT_DATA",
      divergence: null,
      direction: "neutral",
      strength: 0
    };
  }


  const divergence =
    round2(
      money -
      tickets
    );


  // ==========================================================
  // STRONG MONEY WITH CASHEDGE
  // ==========================================================

  if (
    divergence >=
    MONEY_DIVERGENCE_STRONG
  ) {
    return {
      signal:
        "STRONG_MONEY_DIVERGENCE",

      divergence,

      direction:
        "aligned",

      strength: 2
    };
  }


  // ==========================================================
  // POTENTIAL SHARP MONEY WITH CASHEDGE
  // ==========================================================

  if (
    divergence >=
    MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "POTENTIAL_SHARP_MONEY",

      divergence,

      direction:
        "aligned",

      strength: 1
    };
  }


  // ==========================================================
  // STRONG MONEY AGAINST CASHEDGE
  // ==========================================================

  if (
    divergence <=
    -MONEY_DIVERGENCE_STRONG
  ) {
    return {
      signal:
        "STRONG_MONEY_AGAINST",

      divergence,

      direction:
        "against",

      strength: 2
    };
  }


  // ==========================================================
  // POTENTIAL MONEY AGAINST CASHEDGE
  // ==========================================================

  if (
    divergence <=
    -MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "POTENTIAL_SHARP_AGAINST",

      divergence,

      direction:
        "against",

      strength: 1
    };
  }


  // ==========================================================
  // PUBLIC HEAVY
  //
  // Lots of tickets, but no meaningful large-bet divergence.
  // This is descriptive only.
  // ==========================================================

  if (
    tickets >=
      PUBLIC_TICKETS_MIN &&
    Math.abs(divergence) <
      MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "PUBLIC_HEAVY",

      divergence,

      direction:
        "neutral",

      strength: 0
    };
  }


  return {
    signal:
      "MONEY_BALANCED",

    divergence,

    direction:
      "neutral",

    strength: 0
  };
}


// ============================================================
// QUOTE DIRECTION AGAINST CASHEDGE BASELINE
// ============================================================

function classifyBookMovement({
  marketType,
  selectionKey,

  baselineLine,
  baselinePrice,

  currentLine,
  currentPrice
}) {

  const type =
    normalize(marketType);

  const selection =
    normalize(selectionKey);


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    type === "moneyline"
  ) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const currentProb =
      americanToProbability(
        currentPrice
      );


    if (
      baselineProb === null ||
      currentProb === null
    ) {
      return "neutral";
    }


    const movePP =
      (
        currentProb -
        baselineProb
      ) * 100;


    if (
      movePP >=
      PRICE_PROBABILITY_THRESHOLD_PP
    ) {
      return "aligned";
    }


    if (
      movePP <=
      -PRICE_PROBABILITY_THRESHOLD_PP
    ) {
      return "against";
    }


    return "neutral";
  }


  const baseline =
    safeNum(
      baselineLine
    );

  const current =
    safeNum(
      currentLine
    );


  if (
    baseline === null ||
    current === null
  ) {
    return "neutral";
  }


  const movement =
    current -
    baseline;


  // ==========================================================
  // TOTAL UNDER
  //
  // 8.5 -> 8.0 supports UNDER.
  // ==========================================================

  if (
    type === "total" &&
    selection === "under"
  ) {

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // TOTAL OVER
  //
  // 8.5 -> 9.0 supports OVER.
  // ==========================================================

  if (
    type === "total" &&
    selection === "over"
  ) {

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // SPREAD
  //
  // +3.5 -> +2.5 supports selected team.
  // -2.5 -> -3.5 supports selected team.
  //
  // Both are numerical decreases.
  // ==========================================================

  if (
    type === "spread"
  ) {

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // SAME LINE — USE PRICE PRESSURE
  // ==========================================================

  if (
    Math.abs(movement) <
    LINE_MOVE_THRESHOLD
  ) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const currentProb =
      americanToProbability(
        currentPrice
      );


    if (
      baselineProb !== null &&
      currentProb !== null
    ) {

      const movePP =
        (
          currentProb -
          baselineProb
        ) * 100;


      if (
        movePP >=
        PRICE_PROBABILITY_THRESHOLD_PP
      ) {
        return "aligned";
      }


      if (
        movePP <=
        -PRICE_PROBABILITY_THRESHOLD_PP
      ) {
        return "against";
      }
    }
  }


  return "neutral";
}


// ============================================================
// LATEST SPLIT PER SOURCE
// ============================================================

function getLatestPerSplitSource(rows) {

  const map =
    new Map();


  for (
    const row
    of rows || []
  ) {

    const key =
      [
        normalize(row.provider),
        normalize(
          row.split_source_key
        )
      ].join("::");


    if (
      !map.has(key)
    ) {
      map.set(
        key,
        row
      );
    }
  }


  return Array.from(
    map.values()
  );
}


// ============================================================
// COMBINE MONEY SOURCES
//
// We DO NOT blindly average DraftKings and Circa.
//
// Every source is preserved independently.
// ============================================================

function combineMoneySignals(
  sourceSignals
) {

  const aligned =
    sourceSignals.filter(
      row =>
        row.direction ===
        "aligned"
    );


  const against =
    sourceSignals.filter(
      row =>
        row.direction ===
        "against"
    );


  // Sources materially disagree.
  if (
    aligned.length &&
    against.length
  ) {

    return {
      signal:
        "MONEY_CONFLICT",

      direction:
        "mixed",

      strength: 0
    };
  }


  if (aligned.length) {

    const strong =
      aligned.some(
        row =>
          row.strength >= 2
      );


    return {
      signal:
        strong
          ? "STRONG_MONEY_DIVERGENCE"
          : "POTENTIAL_SHARP_MONEY",

      direction:
        "aligned",

      strength:
        strong
          ? 2
          : 1
    };
  }


  if (against.length) {

    const strong =
      against.some(
        row =>
          row.strength >= 2
      );


    return {
      signal:
        strong
          ? "STRONG_MONEY_AGAINST"
          : "POTENTIAL_SHARP_AGAINST",

      direction:
        "against",

      strength:
        strong
          ? 2
          : 1
    };
  }


  const publicHeavy =
    sourceSignals.some(
      row =>
        row.signal ===
        "PUBLIC_HEAVY"
    );


  return {
    signal:
      publicHeavy
        ? "PUBLIC_HEAVY"
        : "MONEY_BALANCED",

    direction:
      "neutral",

    strength: 0
  };
}


// ============================================================
// FINAL SHARP / MARKET SIGNAL
// ============================================================

function determineSharpSignal({

  money,

  referenceAligned,
  referenceAgainst,

  retailAligned,
  retailAgainst

}) {

  let alignedScore = 0;
  let againstScore = 0;


  // ==========================================================
  // MONEY EVIDENCE
  // ==========================================================

  if (
    money.direction ===
    "aligned"
  ) {
    alignedScore +=
      money.strength;
  }


  if (
    money.direction ===
    "against"
  ) {
    againstScore +=
      money.strength;
  }


  // ==========================================================
  // REFERENCE BOOK EVIDENCE
  //
  // Max 2 points.
  // ==========================================================

  alignedScore +=
    Math.min(
      referenceAligned,
      2
    );


  againstScore +=
    Math.min(
      referenceAgainst,
      2
    );


  // ==========================================================
  // RETAIL FOLLOWING
  //
  // At least two retail books following = +1 evidence.
  // ==========================================================

  if (
    retailAligned >= 2
  ) {
    alignedScore += 1;
  }


  if (
    retailAgainst >= 2
  ) {
    againstScore += 1;
  }


  // ==========================================================
  // MATERIAL CONFLICT
  // ==========================================================

  if (
    alignedScore >= 2 &&
    againstScore >= 2
  ) {

    return {
      signal:
        "MIXED_SIGNAL",

      direction:
        "mixed",

      strength:
        Math.max(
          alignedScore,
          againstScore
        )
    };
  }


  // ==========================================================
  // CASHEDGE-SUPPORTIVE SIDE
  // ==========================================================

  if (
    alignedScore >
    againstScore
  ) {

    // Money + reference + market following.
    if (
      money.direction ===
        "aligned" &&
      referenceAligned >= 1 &&
      (
        retailAligned >= 2 ||
        referenceAligned >= 2
      ) &&
      alignedScore >= 4
    ) {

      return {
        signal:
          "STRONG_SHARP_SIGNAL",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // Money divergence confirmed by at least one
    // reference book.
    if (
      money.direction ===
        "aligned" &&
      referenceAligned >= 1
    ) {

      return {
        signal:
          "SHARP_SUPPORT",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // Money signal exists but market has not confirmed it.
    if (
      money.direction ===
      "aligned"
    ) {

      return {
        signal:
          "POTENTIAL_SHARP_MONEY",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // No Money/Tickets evidence.
    // Reference + retail move is MARKET SUPPORT,
    // not a sharp-money claim.
    if (
      referenceAligned >= 1 &&
      retailAligned >= 2
    ) {

      return {
        signal:
          "MARKET_SUPPORT",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }
  }


  // ==========================================================
  // CASHEDGE-CONFLICT SIDE
  // ==========================================================

  if (
    againstScore >
    alignedScore
  ) {

    if (
      money.direction ===
        "against" &&
      referenceAgainst >= 1 &&
      (
        retailAgainst >= 2 ||
        referenceAgainst >= 2
      ) &&
      againstScore >= 4
    ) {

      return {
        signal:
          "STRONG_SHARP_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      money.direction ===
        "against" &&
      referenceAgainst >= 1
    ) {

      return {
        signal:
          "SHARP_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      money.direction ===
      "against"
    ) {

      return {
        signal:
          "POTENTIAL_SHARP_AGAINST",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      referenceAgainst >= 1 &&
      retailAgainst >= 2
    ) {

      return {
        signal:
          "MARKET_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }
  }


  return {
    signal:
      "NO_SHARP_SIGNAL",

    direction:
      "neutral",

    strength: 0
  };
}


// ============================================================
// MAIN ENGINE
// ============================================================

async function evaluateSharpSignal({
  supabaseAdmin,
  gameId
}) {

  // First update normal Market Evaluation.
  const evaluation =
    await evaluateMarketGame({
      supabaseAdmin,
      gameId
    });


  if (
    evaluation?.ok !== true ||
    evaluation?.premium !== true
  ) {
    return evaluation;
  }


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
    throw new Error(
      "Missing market_pick_context"
    );
  }


  const marketType =
    normalize(
      context.market_type
    );

  const selectionKey =
    normalize(
      context.selection_key
    );


  // ==========================================================
  // SPLIT HISTORY
  //
  // Newest first. Then keep only latest row from each source.
  // ==========================================================

  const {
    data: splitRows,
    error: splitError
  } =
    await supabaseAdmin
      .from(
        "market_split_snapshots"
      )
      .select(`
        provider,
        split_source_key,
        split_source_name,
        money_pct,
        tickets_pct,
        line,
        price_american,
        provider_timestamp,
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
      .limit(100);


  if (splitError) {
    throw splitError;
  }


  const latestSplits =
    getLatestPerSplitSource(
      splitRows || []
    );


  const splitSourceSignals =
    latestSplits.map(
      row => {

        const classified =
          classifySplitSource({
            moneyPct:
              row.money_pct,

            ticketsPct:
              row.tickets_pct
          });


        return {

          provider:
            row.provider,

          sourceKey:
            row.split_source_key,

          sourceName:
            row.split_source_name,

          moneyPct:
            safeNum(
              row.money_pct
            ),

          ticketsPct:
            safeNum(
              row.tickets_pct
            ),

          providerTimestamp:
            row.provider_timestamp,

          observedAt:
            row.observed_at,

          ...classified
        };
      }
    );


  const money =
    combineMoneySignals(
      splitSourceSignals
    );


  // ==========================================================
  // CURRENT BOOK QUOTES
  // ==========================================================

  const {
    data: quotes,
    error: quoteError
  } =
    await supabaseAdmin
      .from(
        "market_current_quotes"
      )
      .select(`
        provider,
        sportsbook_key,
        sportsbook_name,
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


  // ==========================================================
  // SPORTSBOOK ROLES
  // ==========================================================

  const {
    data: roleRows,
    error: rolesError
  } =
    await supabaseAdmin
      .from(
        "market_sportsbook_roles"
      )
      .select(`
        provider,
        sportsbook_key,
        sportsbook_name,
        role,
        reference_weight
      `)
      .eq(
        "is_active",
        true
      );


  if (rolesError) {
    throw rolesError;
  }


  const roleMap =
    new Map();


  for (
    const role
    of roleRows || []
  ) {

    const key =
      [
        normalize(
          role.provider
        ),

        normalize(
          role.sportsbook_key
        )
      ].join("::");


    roleMap.set(
      key,
      role
    );
  }


  let referenceAligned = 0;
  let referenceAgainst = 0;

  let retailAligned = 0;
  let retailAgainst = 0;

  let referenceNeutral = 0;
  let retailNeutral = 0;

  const bookDetails = [];


  for (
    const quote
    of quotes || []
  ) {

    const roleKey =
      [
        normalize(
          quote.provider
        ),

        normalize(
          quote.sportsbook_key
        )
      ].join("::");


    const role =
      roleMap.get(
        roleKey
      );


    // Unknown books are intentionally NOT assumed to be
    // retail. We wait until their role is configured.
    if (!role) {
      continue;
    }


    const direction =
      classifyBookMovement({

        marketType,
        selectionKey,

        baselineLine:
          context
            .first_premium_line,

        baselinePrice:
          context
            .first_premium_price_american,

        currentLine:
          quote.line,

        currentPrice:
          quote.price_american
      });


    const bookRole =
      normalize(
        role.role
      );


    if (
      bookRole ===
      "reference"
    ) {

      if (
        direction ===
        "aligned"
      ) {
        referenceAligned += 1;
      }

      if (
        direction ===
        "against"
      ) {
        referenceAgainst += 1;
      }

      if (
        direction ===
        "neutral"
      ) {
        referenceNeutral += 1;
      }
    }


    if (
      bookRole ===
      "retail"
    ) {

      if (
        direction ===
        "aligned"
      ) {
        retailAligned += 1;
      }

      if (
        direction ===
        "against"
      ) {
        retailAgainst += 1;
      }

      if (
        direction ===
        "neutral"
      ) {
        retailNeutral += 1;
      }
    }


    bookDetails.push({

      provider:
        quote.provider,

      sportsbookKey:
        quote.sportsbook_key,

      sportsbookName:
        quote.sportsbook_name,

      role:
        bookRole,

      direction,

      line:
        safeNum(
          quote.line
        ),

      price:
        safeNum(
          quote.price_american
        ),

      providerTimestamp:
        quote.provider_timestamp
    });
  }


  // ==========================================================
  // FINAL SIGNAL
  // ==========================================================

  const sharp =
    determineSharpSignal({

      money,

      referenceAligned,
      referenceAgainst,

      retailAligned,
      retailAgainst
    });


  const now =
    new Date()
      .toISOString();


  // ==========================================================
  // SUMMARY ROW
  // ==========================================================

  const {
    data: summary,
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


  if (!summary) {
    throw new Error(
      "Missing market_evaluation_games row"
    );
  }


  const updates = {

    latest_money_signal:
      money.signal,

    latest_sharp_signal:
      sharp.signal,

    latest_sharp_strength:
      sharp.strength,

    updated_at:
      now
  };


  // ==========================================================
  // FIRST OCCURRENCE TIMESTAMPS
  // ==========================================================

  if (
    !summary
      .first_potential_sharp_at &&
    (
      sharp.signal ===
        "POTENTIAL_SHARP_MONEY" ||
      sharp.signal ===
        "SHARP_SUPPORT" ||
      sharp.signal ===
        "STRONG_SHARP_SIGNAL"
    )
  ) {

    updates
      .first_potential_sharp_at =
      now;
  }


  if (
    !summary
      .first_sharp_support_at &&
    (
      sharp.signal ===
        "SHARP_SUPPORT" ||
      sharp.signal ===
        "STRONG_SHARP_SIGNAL"
    )
  ) {

    updates
      .first_sharp_support_at =
      now;
  }


  if (
    !summary
      .first_strong_sharp_at &&
    sharp.signal ===
      "STRONG_SHARP_SIGNAL"
  ) {

    updates
      .first_strong_sharp_at =
      now;
  }


  if (
    !summary
      .first_potential_sharp_against_at &&
    (
      sharp.signal ===
        "POTENTIAL_SHARP_AGAINST" ||
      sharp.signal ===
        "SHARP_CONFLICT" ||
      sharp.signal ===
        "STRONG_SHARP_CONFLICT"
    )
  ) {

    updates
      .first_potential_sharp_against_at =
      now;
  }


  if (
    !summary
      .first_sharp_conflict_at &&
    (
      sharp.signal ===
        "SHARP_CONFLICT" ||
      sharp.signal ===
        "STRONG_SHARP_CONFLICT"
    )
  ) {

    updates
      .first_sharp_conflict_at =
      now;
  }


  if (
    !summary
      .first_strong_sharp_conflict_at &&
    sharp.signal ===
      "STRONG_SHARP_CONFLICT"
  ) {

    updates
      .first_strong_sharp_conflict_at =
      now;
  }


  // ==========================================================
  // FINAL PRE-GAME SHARP STATE
  //
  // Same 30-minute research freeze used by Evaluation Engine.
  // ==========================================================

  const minutesToStart =
    safeNum(
      evaluation
        ?.timing
        ?.minutesToStart
    );


  if (
    !summary
      .pregame_final_sharp_signal &&
    minutesToStart !== null &&
    minutesToStart >= 0 &&
    minutesToStart <= 30
  ) {

    updates
      .pregame_final_money_signal =
      money.signal;

    updates
      .pregame_final_sharp_signal =
      sharp.signal;

    updates
      .pregame_final_sharp_strength =
      sharp.strength;
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
        summary.id
      );


  if (updateSummaryError) {
    throw updateSummaryError;
  }


  // ==========================================================
  // UPDATE LATEST EVALUATION SNAPSHOT
  // ==========================================================

  const {
    data: latestSnapshot,
    error: latestSnapshotError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_snapshots"
      )
      .select(`
        id,
        context_json
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .order(
        "observed_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (latestSnapshotError) {
    throw latestSnapshotError;
  }


  if (latestSnapshot) {

    const oldContext =
      latestSnapshot
        .context_json &&
      typeof latestSnapshot
        .context_json ===
        "object"
          ? latestSnapshot
              .context_json
          : {};


    const {
      error: snapshotUpdateError
    } =
      await supabaseAdmin
        .from(
          "market_evaluation_snapshots"
        )
        .update({

          money_signal:
            money.signal,

          sharp_signal:
            sharp.signal,

          sharp_strength:
            sharp.strength,

          reference_aligned_count:
            referenceAligned,

          reference_against_count:
            referenceAgainst,

          retail_aligned_count:
            retailAligned,

          retail_against_count:
            retailAgainst,

          context_json: {

            ...oldContext,

            sharpResearch: {

              moneyDirection:
                money.direction,

              moneySignal:
                money.signal,

              splitSources:
                splitSourceSignals,

              referenceAligned,
              referenceAgainst,
              referenceNeutral,

              retailAligned,
              retailAgainst,
              retailNeutral,

              sharpDirection:
                sharp.direction,

              sharpSignal:
                sharp.signal,

              sharpStrength:
                sharp.strength,

              books:
                bookDetails
            }
          }
        })
        .eq(
          "id",
          latestSnapshot.id
        );


    if (snapshotUpdateError) {
      throw snapshotUpdateError;
    }
  }


  // ==========================================================
  // RESPONSE
  // ==========================================================

  return {

    ok: true,

    shadowMode: true,

    gameId,

    pick:
      context
        .canonical_pick,

    alignment:
      evaluation.alignment,

    money: {

      signal:
        money.signal,

      direction:
        money.direction,

      sources:
        splitSourceSignals
    },

    marketEvidence: {

      referenceAligned,
      referenceAgainst,

      retailAligned,
      retailAgainst
    },

    sharp: {

      signal:
        sharp.signal,

      direction:
        sharp.direction,

      strength:
        sharp.strength
    },

    timing:
      evaluation.timing
  };
}


module.exports = {
  evaluateSharpSignal
};

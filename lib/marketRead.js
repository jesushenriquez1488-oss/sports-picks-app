// ============================================================
// MARKET READ ENGINE
//
// Human interpretation layer for current Market Intelligence.
//
// IMPORTANT:
//
// - This is NOT another score.
// - It does NOT modify CashEdge Confidence.
// - It does NOT create Sharp evidence.
// - It interprets the already-calculated market state.
// - Opportunity can add context, but does not determine
//   directional market pressure.
// ============================================================


// ============================================================
// HELPERS
// ============================================================

function nowIso() {
  return new Date()
    .toISOString();
}


function safeNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const n =
    Number(value);


  return Number.isFinite(n)
    ? n
    : null;
}


function normalize(value) {

  return String(value || "")
    .trim()
    .toUpperCase();
}


function normalizeLower(value) {

  return String(value || "")
    .trim()
    .toLowerCase();
}


function safeObject(value) {

  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


// ============================================================
// EVIDENCE FAMILY
// ============================================================

function determineEvidenceFamily({
  sharpRead,
  sharpComponents
}) {

  const explicitFamily =
    normalizeLower(
      sharpComponents
        ?.evidenceFamily
    );


  if (
    explicitFamily === "sharp" ||
    explicitFamily === "market" ||
    explicitFamily === "neutral"
  ) {
    return explicitFamily;
  }


  const read =
    normalize(sharpRead);


  if (
    read.includes("SHARP")
  ) {
    return "sharp";
  }


  if (
    read.includes("MARKET")
  ) {
    return "market";
  }


  return "neutral";
}


// ============================================================
// SHARP EVIDENCE FLAG
// ============================================================

function determineHasSharpEvidence({
  sharpRead,
  sharpComponents
}) {

  if (
    sharpComponents
      ?.hasSharpEvidence === true
  ) {
    return true;
  }


  if (
    normalizeLower(
      sharpComponents
        ?.evidenceFamily
    ) === "sharp"
  ) {
    return true;
  }


  const read =
    normalize(sharpRead);


  return (
    read.includes("SHARP")
  );
}


// ============================================================
// EVIDENCE DESCRIPTION
// ============================================================

function directionalEvidence({
  components,
  direction
}) {

  const sign =
    direction === "with"
      ? 1
      : -1;


  const evidence = [];


  const moneyScore =
    safeNumber(
      components
        ?.moneyTickets
        ?.score
    ) || 0;


  const movementScore =
    safeNumber(
      components
        ?.marketMovement
        ?.score
    ) || 0;


  const breadthScore =
    safeNumber(
      components
        ?.breadth
        ?.score
    ) || 0;


  const reverseScore =
    safeNumber(
      components
        ?.reverseLine
        ?.score
    ) || 0;


  const persistenceScore =
    safeNumber(
      components
        ?.persistence
        ?.score
    ) || 0;


  if (
    moneyScore * sign > 0
  ) {
    evidence.push(
      "Money/Tickets"
    );
  }


  if (
    reverseScore * sign > 0 &&
    components
      ?.reverseLine
      ?.detected === true
  ) {
    evidence.push(
      "reverse line movement"
    );
  }


  if (
    movementScore * sign > 0
  ) {
    evidence.push(
      "market movement"
    );
  }


  if (
    breadthScore * sign > 0
  ) {
    evidence.push(
      "sportsbook breadth"
    );
  }


  if (
    persistenceScore * sign > 0
  ) {
    evidence.push(
      "persistent pressure"
    );
  }


  return evidence;
}


// ============================================================
// HUMAN LIST
// ============================================================

function humanList(items) {

  const clean =
    (items || [])
      .filter(Boolean);


  if (!clean.length) {
    return "";
  }


  if (clean.length === 1) {
    return clean[0];
  }


  if (clean.length === 2) {

    return (
      `${clean[0]} and ${clean[1]}`
    );
  }


  return (
    `${clean
      .slice(0, -1)
      .join(", ")}, and ${
        clean[
          clean.length - 1
        ]
      }`
  );
}


// ============================================================
// OPPORTUNITY NOTE
// ============================================================

function opportunityNote(summary) {

  const state =
    normalize(
      summary
        ?.latest_opportunity_state
    );


  const sportsbook =
    String(
      summary
        ?.latest_opportunity_book_name ||
      ""
    )
      .trim();


  if (
    state ===
    "VALUE_AVAILABLE"
  ) {

    return sportsbook
      ? `A materially better number is still available at ${sportsbook}.`
      : "A materially better market number is still available.";
  }


  if (
    state ===
    "WINDOW_CLOSING"
  ) {

    return sportsbook
      ? `The value window is still available at ${sportsbook}, but the advantage is deteriorating.`
      : "The value window is still available, but the advantage is deteriorating.";
  }


  return "";
}


// ============================================================
// MARKET READ CLASSIFICATION
// ============================================================

function classifyMarketRead({
  summary,
  sharpComponents
}) {

  const sharpRead =
    normalize(
      summary
        ?.latest_sharp_read
    );


  const score =
    safeNumber(
      summary
        ?.latest_sharp_score
    ) || 0;


  const alignment =
    normalize(
      summary
        ?.latest_alignment_state
    );


  const moneySignal =
    normalize(
      summary
        ?.latest_money_signal
    );


  const opportunityState =
    normalize(
      summary
        ?.latest_opportunity_state
    );


  const hasSharpEvidence =
    determineHasSharpEvidence({

      sharpRead,
      sharpComponents
    });


  const evidenceFamily =
    determineEvidenceFamily({

      sharpRead,
      sharpComponents
    });


  const moneyConflict =
    (
      moneySignal ===
        "MONEY_CONFLICT" ||
      sharpComponents
        ?.moneyTickets
        ?.conflict === true
    );


  // ==========================================================
  // LIMITED DATA
  // ==========================================================

  if (
    !sharpRead ||
    alignment === "NO_DATA"
  ) {

    return {

      read:
        "LIMITED_MARKET_DATA",

      family:
        "limited",

      direction:
        "neutral",

      explanation:
        "There is not enough fresh market information to produce a reliable Market Read.",

      hasSharpEvidence,
      evidenceFamily
    };
  }


  // ==========================================================
  // SPORTSBOOK CONSENSUS SPLIT
  // ==========================================================

  if (
    alignment === "SPLIT" ||
    opportunityState ===
      "MARKET_SPLIT"
  ) {

    return {

      read:
        "MIXED_MARKET",

      family:
        "mixed",

      direction:
        "mixed",

      explanation:
        "Sportsbooks are currently split and there is no single clear market consensus.",

      hasSharpEvidence,
      evidenceFamily
    };
  }


  // ==========================================================
  // MONEY SOURCES CONFLICT
  //
  // Do not turn a small split-source disagreement into a
  // Sharp signal.
  //
  // But Market Read should still tell the user that the
  // betting sources disagree.
  // ==========================================================

  if (
    moneyConflict &&
    Math.abs(score) < 30
  ) {

    return {

      read:
        "MIXED_MARKET",

      family:
        "mixed",

      direction:
        "mixed",

      explanation:
        "Betting split sources are materially conflicting, so there is no clear Money/Tickets direction right now.",

      hasSharpEvidence,
      evidenceFamily
    };
  }


  // ==========================================================
  // KNOWN SHARP / MARKET READS
  //
  // Sharp Score V2 already decided whether the evidence family
  // is truly Sharp or only sportsbook-market pressure.
  //
  // Market Read does NOT recalculate that decision.
  // ==========================================================

  const supportedReads =
    new Set([

      "STRONG_SHARP_SUPPORT",
      "SHARP_SUPPORT",
      "SHARP_LEAN_WITH_CASHEDGE",

      "STRONG_MARKET_SUPPORT",
      "MARKET_SUPPORT",

      "STRONG_MARKET_PRESSURE_AGAINST",
      "MARKET_PRESSURE_AGAINST",

      "SHARP_LEAN_AGAINST",
      "SHARP_PRESSURE_AGAINST",
      "STRONG_SHARP_PRESSURE_AGAINST"
    ]);


  if (
    supportedReads.has(
      sharpRead
    )
  ) {

    let family =
      evidenceFamily;


    if (
      sharpRead.includes(
        "SHARP"
      )
    ) {
      family =
        "sharp";
    }


    if (
      sharpRead.includes(
        "MARKET"
      )
    ) {
      family =
        "market";
    }


    const isWith =
      (
        sharpRead.includes(
          "SUPPORT"
        ) ||
        sharpRead.includes(
          "WITH_CASHEDGE"
        )
      );


    const direction =
      isWith
        ? "with_cashedge"
        : "against_cashedge";


    const evidence =
      directionalEvidence({

        components:
          sharpComponents,

        direction:
          isWith
            ? "with"
            : "against"
      });


    const evidenceText =
      humanList(
        evidence
      );


    let explanation;


    if (
      family === "sharp"
    ) {

      if (isWith) {

        explanation =
          evidenceText
            ? `${evidenceText} are supporting the CashEdge selection.`
            : "Current Sharp evidence is supporting the CashEdge selection.";

      } else {

        explanation =
          evidenceText
            ? `${evidenceText} are applying pressure against the CashEdge selection.`
            : "Current Sharp evidence is applying pressure against the CashEdge selection.";
      }

    } else {

      if (isWith) {

        explanation =
          evidenceText
            ? `${evidenceText} are supporting the CashEdge selection. No meaningful Sharp evidence is currently present.`
            : "Sportsbook movement is supporting the CashEdge selection. No meaningful Sharp evidence is currently present.";

      } else {

        explanation =
          evidenceText
            ? `${evidenceText} are moving against the CashEdge selection. No meaningful Sharp evidence is currently present.`
            : "Sportsbook movement is moving against the CashEdge selection. No meaningful Sharp evidence is currently present.";
      }
    }


    const opportunity =
      opportunityNote(
        summary
      );


    if (opportunity) {

      explanation =
        `${explanation} ${opportunity}`;
    }


    return {

      read:
        sharpRead,

      family,

      direction,

      explanation,

      hasSharpEvidence,
      evidenceFamily
    };
  }


  // ==========================================================
  // NEUTRAL / BELOW THRESHOLD
  // ==========================================================

  if (
    sharpRead ===
      "NO_CLEAR_SHARP_EDGE" ||
    sharpRead ===
      "NO_CLEAR_MARKET_EDGE"
  ) {

    return {

      read:
        "QUIET_MARKET",

      family:
        "quiet",

      direction:
        "neutral",

      explanation:
        Math.abs(score) > 0
          ? "Market evidence is currently below the threshold for a clear directional read."
          : "No meaningful directional market pressure is currently present.",

      hasSharpEvidence,
      evidenceFamily
    };
  }


  // ==========================================================
  // SAFE FALLBACK
  // ==========================================================

  return {

    read:
      "QUIET_MARKET",

    family:
      "quiet",

    direction:
      "neutral",

    explanation:
      "No clear directional Market Read is currently available.",

    hasSharpEvidence,
    evidenceFamily
  };
}


// ============================================================
// MAIN ENGINE
// ============================================================

async function evaluateMarketRead({

  supabaseAdmin,
  gameId

}) {

  if (
    !gameId ||
    !String(gameId).trim()
  ) {

    throw new Error(
      "gameId is required"
    );
  }


  const cleanGameId =
    String(gameId)
      .trim();


  // ==========================================================
  // CURRENT COMPLETE MARKET SUMMARY
  //
  // At pipeline level this runs AFTER:
  //
  // - Market Evaluation
  // - Sharp Score V2
  // - Opportunity
  //
  // Therefore this row represents the current combined state.
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
        cleanGameId
      )
      .maybeSingle();


  if (summaryError) {
    throw summaryError;
  }


  if (!summary) {

    return {

      ok: true,

      skipped: true,

      reason:
        "Market evaluation summary not available",

      gameId:
        cleanGameId
    };
  }


  const sharpComponents =
    safeObject(
      summary
        .latest_sharp_components
    );


  const classification =
    classifyMarketRead({

      summary,
      sharpComponents
    });


  const timestamp =
    nowIso();


  // ==========================================================
  // STRUCTURED READ COMPONENTS
  //
  // Preserve WHY the human Market Read was produced.
  // ==========================================================

  const components = {

    version:
      "market_read_v1",

    computedAt:
      timestamp,


    cashEdge: {

      pick:
        summary
          .canonical_pick ||
        null,

      confidence:
        safeNumber(
          summary
            .cashedge_confidence
        )
    },


    market: {

      alignment:
        summary
          .latest_alignment_state ||
        null,

      consensusLine:
        safeNumber(
          summary
            .latest_market_line
        ),

      consensusPrice:
        safeNumber(
          summary
            .latest_market_price_american
        ),

      bestAvailable: {

        sportsbook:
          summary
            .latest_best_sportsbook_name ||
          null,

        line:
          safeNumber(
            summary
              .latest_best_line
          ),

        price:
          safeNumber(
            summary
              .latest_best_price_american
          )
      }
    },


    sharp: {

      score:
        safeNumber(
          summary
            .latest_sharp_score
        ),

      read:
        summary
          .latest_sharp_read ||
        null,

      signal:
        summary
          .latest_sharp_signal ||
        null,

      strength:
        safeNumber(
          summary
            .latest_sharp_strength
        ),

      hasSharpEvidence:
        classification
          .hasSharpEvidence,

      evidenceFamily:
        classification
          .evidenceFamily,

      moneySignal:
        summary
          .latest_money_signal ||
        null,

      moneyTickets:
        sharpComponents
          .moneyTickets ||
        null,

      marketMovement:
        sharpComponents
          .marketMovement ||
        null,

      breadth:
        sharpComponents
          .breadth ||
        null,

      reverseLine:
        sharpComponents
          .reverseLine ||
        null,

      persistence:
        sharpComponents
          .persistence ||
        null,

      evidenceCount:
        safeNumber(
          sharpComponents
            .evidenceCount
        ),

      evidenceGroups:
        Array.isArray(
          sharpComponents
            .evidenceGroups
        )
          ? sharpComponents
              .evidenceGroups
          : []
    },


    opportunity: {

      state:
        summary
          .latest_opportunity_state ||
        null,

      type:
        summary
          .latest_opportunity_type ||
        null,

      sportsbook:
        summary
          .latest_opportunity_book_name ||
        null,

      lineValue:
        safeNumber(
          summary
            .latest_opportunity_line_value
        ),

      priceValueCents:
        safeNumber(
          summary
            .latest_opportunity_price_value_cents
        ),

      bestLine:
        safeNumber(
          summary
            .latest_opportunity_best_line
        ),

      bestPrice:
        safeNumber(
          summary
            .latest_opportunity_best_price
        )
    }
  };


  // ==========================================================
  // UPDATE CURRENT GAME SUMMARY
  // ==========================================================

  const {
    error: updateSummaryError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .update({

        latest_market_read:
          classification.read,

        latest_market_read_family:
          classification.family,

        latest_market_read_direction:
          classification.direction,

        latest_market_read_explanation:
          classification.explanation,

        latest_market_read_components:
          components,

        latest_market_read_updated_at:
          timestamp,

        updated_at:
          timestamp
      })
      .eq(
        "id",
        summary.id
      );


  if (updateSummaryError) {
    throw updateSummaryError;
  }


  // ==========================================================
  // UPDATE LATEST MARKET SNAPSHOT
  //
  // This preserves the Market Read alongside the exact
  // evaluation state that produced it.
  // ==========================================================

  const {
    data: latestSnapshot,
    error: snapshotError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_snapshots"
      )
      .select(`
        id
      `)
      .eq(
        "cashedge_game_id",
        cleanGameId
      )
      .order(
        "observed_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (snapshotError) {
    throw snapshotError;
  }


  if (latestSnapshot) {

    const {
      error: snapshotUpdateError
    } =
      await supabaseAdmin
        .from(
          "market_evaluation_snapshots"
        )
        .update({

          market_read:
            classification.read,

          market_read_family:
            classification.family,

          market_read_direction:
            classification.direction,

          market_read_explanation:
            classification.explanation,

          market_read_components:
            components
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
  // RESULT
  // ==========================================================

  return {

    ok: true,

    gameId:
      cleanGameId,

    pick:
      summary
        .canonical_pick ||
      null,

    read:
      classification.read,

    family:
      classification.family,

    direction:
      classification.direction,

    explanation:
      classification.explanation,

    components
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  evaluateMarketRead
};

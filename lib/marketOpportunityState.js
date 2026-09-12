const {
  calculateMarketOpportunity,
  safeNumber
} =
  require("./marketOpportunity");


// ============================================================
// RESEARCH THRESHOLDS
// ============================================================

const MATERIAL_LINE_VALUE = 0.5;
const MATERIAL_PRICE_VALUE_CENTS = 10;

const LINE_DETERIORATION_STEP = 0.5;
const PRICE_DETERIORATION_STEP_CENTS = 10;


// ============================================================
// HELPERS
// ============================================================

function nowIso() {
  return new Date()
    .toISOString();
}


function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}


function materialOpportunity(
  opportunity
) {

  if (
    !opportunity ||
    opportunity.actionable !== true
  ) {
    return false;
  }


  const lineValue =
    safeNumber(
      opportunity.lineValue
    ) || 0;


  const priceValue =
    safeNumber(
      opportunity
        .priceValueCents
    ) || 0;


  return (
    lineValue >=
      MATERIAL_LINE_VALUE ||
    priceValue >=
      MATERIAL_PRICE_VALUE_CENTS
  );
}


// ============================================================
// RESOLVE ACTIVE OPPORTUNITY STATE EVENTS
// ============================================================

async function resolveActiveOpportunityEvents({

  supabaseAdmin,
  gameId,
  resolvedAt

}) {

  const timestamp =
    resolvedAt ||
    nowIso();


  const {
    error
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .update({

        is_active:
          false,

        resolved_at:
          timestamp,

        updated_at:
          timestamp
      })
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "event_family",
        "opportunity"
      )
      .eq(
        "is_active",
        true
      );


  if (error) {
    throw error;
  }
}


// ============================================================
// CREATE OPPORTUNITY EVENT
// ============================================================

async function createOpportunityEvent({

  supabaseAdmin,

  context,
  summary,

  state,
  opportunityResult,

  timestamp

}) {

  let headline;
  let explanation;
  let severity = "LOW";
  let direction = "neutral";


  if (
    state ===
    "VALUE_AVAILABLE"
  ) {

    headline =
      "Value Available";

    explanation =
      opportunityResult
        ?.opportunity
        ?.headline ||
      "A materially better market number is still available.";

    severity =
      "MEDIUM";

    direction =
      "aligned";
  }


  if (
    state ===
    "WINDOW_CLOSING"
  ) {

    headline =
      "Value Window Closing";

    explanation =
      "The better number is still available, but the advantage has materially deteriorated.";

    severity =
      "HIGH";

    direction =
      "aligned";
  }


  if (
    state ===
    "OPPORTUNITY_CLOSED"
  ) {

    headline =
      "Opportunity Closed";

    explanation =
      "The previously available market advantage is no longer materially available.";

    severity =
      "MEDIUM";

    direction =
      "neutral";
  }


  if (
    state ===
    "MARKET_CONFLICT"
  ) {

    headline =
      "Market Conflict";

    explanation =
      "The market is moving materially against the CashEdge Premium selection.";

    severity =
      "MEDIUM";

    direction =
      "against";
  }


  const best =
    opportunityResult
      ?.bestLine ||
    null;


  const opportunity =
    opportunityResult
      ?.opportunity ||
    null;


  const fingerprint =
    [
      context.cashedge_game_id,
      "opportunity",
      state,
      timestamp
    ].join(":");


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .insert({

        sport:
          context.sport,

        cashedge_game_id:
          context
            .cashedge_game_id,

        market_type:
          context
            .market_type,

        selection_key:
          context
            .selection_key,

        event_family:
          "opportunity",

        event_type:
          state,

        direction,

        severity,

        signal_strength:
          0,

        is_important:
          false,

        is_active:
          state !==
          "OPPORTUNITY_CLOSED",

        headline,

        explanation,

        event_data: {

          opportunityType:
            opportunity?.type ||
            null,

          lineValue:
            safeNumber(
              opportunity
                ?.lineValue
            ) || 0,

          priceValueCents:
            safeNumber(
              opportunity
                ?.priceValueCents
            ) || 0,

          sportsbookKey:
            best
              ?.sportsbookKey ||
            null,

          sportsbook:
            best
              ?.sportsbook ||
            null,

          bestLine:
            safeNumber(
              best?.line
            ),

          bestPrice:
            safeNumber(
              best?.price
            ),

          marketNow:
            opportunityResult
              ?.marketNow ||
            null,

          previousState:
            summary
              ?.latest_opportunity_state ||
            null
        },

        fingerprint,

        first_detected_at:
          timestamp,

        last_detected_at:
          timestamp,

        resolved_at:
          state ===
          "OPPORTUNITY_CLOSED"
            ? timestamp
            : null,

        created_at:
          timestamp,

        updated_at:
          timestamp
      })
      .select(`
        id,
        event_type,
        first_detected_at,
        is_active
      `)
      .single();


  if (error) {
    throw error;
  }


  return data;
}


// ============================================================
// DETERMINE STATE
// ============================================================

function determineOpportunityState({

  opportunityResult,
  summary

}) {

  // ==========================================================
  // NO DATA
  // ==========================================================

  if (
    !opportunityResult ||
    opportunityResult.ok !==
      true ||
    opportunityResult
      .premium !== true ||
    !opportunityResult
      .opportunity
  ) {

    return {
      state:
        "NO_DATA",

      reason:
        "Opportunity data unavailable"
    };
  }


  const opportunity =
    opportunityResult
      .opportunity;


  // ==========================================================
  // SPLIT MARKET
  // ==========================================================

  if (
    opportunity.type ===
    "split_market"
  ) {

    return {
      state:
        "MARKET_SPLIT",

      reason:
        "No unique consensus market"
    };
  }


  // ==========================================================
  // MARKET CONFLICT HAS PRIORITY
  //
  // This comes from the independent Evaluation Engine.
  // ==========================================================

  if (
    normalize(
      summary
        ?.latest_alignment_state
    ) ===
    "AGAINST"
  ) {

    return {
      state:
        "MARKET_CONFLICT",

      reason:
        "Market movement is materially against CashEdge"
    };
  }


  const currentMaterial =
    materialOpportunity(
      opportunity
    );


  const previousState =
    normalize(
      summary
        ?.latest_opportunity_state
    );


  const currentLineValue =
    safeNumber(
      opportunity.lineValue
    ) || 0;


  const currentPriceValue =
    safeNumber(
      opportunity
        .priceValueCents
    ) || 0;


  const previousLineValue =
    safeNumber(
      summary
        ?.latest_opportunity_line_value
    ) || 0;


  const previousPriceValue =
    safeNumber(
      summary
        ?.latest_opportunity_price_value_cents
    ) || 0;


  // ==========================================================
  // WINDOW CLOSED
  // ==========================================================

  if (
    !currentMaterial &&
    (
      previousState ===
        "VALUE_AVAILABLE" ||
      previousState ===
        "WINDOW_CLOSING"
    )
  ) {

    return {

      state:
        "OPPORTUNITY_CLOSED",

      reason:
        "Previously material value is no longer available"
    };
  }


  // ==========================================================
  // NO MATERIAL VALUE
  // ==========================================================

  if (!currentMaterial) {

    return {

      state:
        "NO_VALUE",

      reason:
        "No material line or price advantage"
    };
  }


  // ==========================================================
  // WINDOW CLOSING
  //
  // Still actionable, but advantage deteriorated materially.
  // ==========================================================

  const lineDeteriorated =
    previousLineValue >=
      MATERIAL_LINE_VALUE &&
    currentLineValue >=
      MATERIAL_LINE_VALUE &&
    (
      previousLineValue -
      currentLineValue
    ) >=
      LINE_DETERIORATION_STEP;


  const priceDeteriorated =
    previousPriceValue >=
      MATERIAL_PRICE_VALUE_CENTS &&
    currentPriceValue >=
      MATERIAL_PRICE_VALUE_CENTS &&
    (
      previousPriceValue -
      currentPriceValue
    ) >=
      PRICE_DETERIORATION_STEP_CENTS;


  if (
    (
      previousState ===
        "VALUE_AVAILABLE" ||
      previousState ===
        "WINDOW_CLOSING"
    ) &&
    (
      lineDeteriorated ||
      priceDeteriorated
    )
  ) {

    return {

      state:
        "WINDOW_CLOSING",

      reason:
        lineDeteriorated
          ? "Line advantage materially deteriorated"
          : "Price advantage materially deteriorated"
    };
  }


  // ==========================================================
  // VALUE AVAILABLE
  // ==========================================================

  return {

    state:
      "VALUE_AVAILABLE",

    reason:
      "Material market value remains available"
  };
}


// ============================================================
// MAIN STATE MACHINE
// ============================================================

async function evaluateOpportunityState({

  supabaseAdmin,
  gameId

}) {

  // ==========================================================
  // SETTINGS
  // ==========================================================

  const {
    data: settings,
    error: settingsError
  } =
    await supabaseAdmin
      .from(
        "market_intelligence_settings"
      )
      .select(`
        shadow_mode,
        event_detection_enabled,
        notifications_enabled,
        frontend_enabled
      `)
      .eq(
        "id",
        1
      )
      .maybeSingle();


  if (settingsError) {
    throw settingsError;
  }


  // Dormant until shadow event tracking is activated.
  if (
    settings
      ?.event_detection_enabled !==
    true
  ) {

    return {

      ok: true,

      skipped:
        true,

      reason:
        "Opportunity state tracking disabled",

      shadowMode:
        settings
          ?.shadow_mode === true
    };
  }


  // ==========================================================
  // SHARED OPPORTUNITY ENGINE
  // ==========================================================

  const opportunityResult =
    await calculateMarketOpportunity({

      supabaseAdmin,
      gameId
    });


  if (
    opportunityResult?.ok !==
    true
  ) {
    return opportunityResult;
  }


  // ==========================================================
  // CONTEXT
  // ==========================================================

  const {
    data: context,
    error: contextError
  } =
    await supabaseAdmin
      .from(
        "market_pick_context"
      )
      .select(`
        sport,
        cashedge_game_id,
        canonical_pick,
        market_type,
        selection_key,
        current_is_premium
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (contextError) {
    throw contextError;
  }


  if (
    !context ||
    context
      .current_is_premium !==
      true
  ) {

    return {

      ok: true,

      skipped:
        true,

      reason:
        "Game is not currently Premium"
    };
  }


  // ==========================================================
  // CURRENT EVALUATION SUMMARY
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

    return {

      ok: true,

      skipped:
        true,

      reason:
        "Market evaluation summary not available yet"
    };
  }


  // ==========================================================
  // DETERMINE NEW STATE
  // ==========================================================

  const decision =
    determineOpportunityState({

      opportunityResult,
      summary
    });


  const newState =
    decision.state;


  const oldState =
    normalize(
      summary
        .latest_opportunity_state
    );


  const timestamp =
    nowIso();


  const opportunity =
    opportunityResult
      ?.opportunity ||
    {};


  const best =
    opportunityResult
      ?.bestLine ||
    {};


  const lineValue =
    safeNumber(
      opportunity
        .lineValue
    ) || 0;


  const priceValue =
    safeNumber(
      opportunity
        .priceValueCents
    ) || 0;


  // ==========================================================
  // EXTEND SAME ACTIVE STATE
  // ==========================================================

  if (
    oldState ===
    newState &&
    [
      "VALUE_AVAILABLE",
      "WINDOW_CLOSING",
      "MARKET_CONFLICT"
    ].includes(
      newState
    )
  ) {

    const {
      error: extendError
    } =
      await supabaseAdmin
        .from(
          "market_events"
        )
        .update({

          last_detected_at:
            timestamp,

          event_data: {

            opportunityType:
              opportunity.type ||
              null,

            lineValue,

            priceValueCents:
              priceValue,

            sportsbookKey:
              best
                .sportsbookKey ||
              null,

            sportsbook:
              best
                .sportsbook ||
              null,

            bestLine:
              safeNumber(
                best.line
              ),

            bestPrice:
              safeNumber(
                best.price
              ),

            marketNow:
              opportunityResult
                .marketNow ||
              null
          },

          updated_at:
            timestamp
        })
        .eq(
          "cashedge_game_id",
          gameId
        )
        .eq(
          "event_family",
          "opportunity"
        )
        .eq(
          "event_type",
          newState
        )
        .eq(
          "is_active",
          true
        );


    if (extendError) {
      throw extendError;
    }
  }


  // ==========================================================
  // STATE TRANSITION
  // ==========================================================

  let eventCreated =
    null;


  if (
    oldState !==
    newState
  ) {

    await resolveActiveOpportunityEvents({

      supabaseAdmin,
      gameId,

      resolvedAt:
        timestamp
    });


    if (
      [
        "VALUE_AVAILABLE",
        "WINDOW_CLOSING",
        "OPPORTUNITY_CLOSED",
        "MARKET_CONFLICT"
      ].includes(
        newState
      )
    ) {

      eventCreated =
        await createOpportunityEvent({

          supabaseAdmin,

          context,
          summary,

          state:
            newState,

          opportunityResult,

          timestamp
        });
    }
  }


  // ==========================================================
  // SUMMARY UPDATE
  // ==========================================================

  const updates = {

    latest_opportunity_state:
      newState,

    latest_opportunity_type:
      opportunity.type ||
      null,

    latest_opportunity_line_value:
      lineValue,

    latest_opportunity_price_value_cents:
      priceValue,

    latest_opportunity_book_key:
      best
        .sportsbookKey ||
      null,

    latest_opportunity_book_name:
      best
        .sportsbook ||
      null,

    latest_opportunity_best_line:
      safeNumber(
        best.line
      ),

    latest_opportunity_best_price:
      safeNumber(
        best.price
      ),

    max_opportunity_line_value:
      Math.max(
        safeNumber(
          summary
            .max_opportunity_line_value
        ) || 0,
        lineValue
      ),

    max_opportunity_price_value_cents:
      Math.max(
        safeNumber(
          summary
            .max_opportunity_price_value_cents
        ) || 0,
        priceValue
      ),

    updated_at:
      timestamp
  };


  if (
    oldState !==
    newState
  ) {

    updates
      .opportunity_state_started_at =
      timestamp;
  }


  if (
    newState ===
      "VALUE_AVAILABLE" &&
    !summary
      .first_value_available_at
  ) {

    updates
      .first_value_available_at =
      timestamp;
  }


  if (
    newState ===
      "WINDOW_CLOSING" &&
    !summary
      .first_window_closing_at
  ) {

    updates
      .first_window_closing_at =
      timestamp;
  }


  if (
    newState ===
      "OPPORTUNITY_CLOSED" &&
    !summary
      .first_opportunity_closed_at
  ) {

    updates
      .first_opportunity_closed_at =
      timestamp;
  }


  const {
    error: updateError
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


  if (updateError) {
    throw updateError;
  }


  return {

    ok: true,

    shadowMode:
      settings
        ?.shadow_mode === true,

    gameId,

    pick:
      context
        .canonical_pick,

    previousState:
      oldState ||
      null,

    state:
      newState,

    reason:
      decision.reason,

    opportunity: {

      type:
        opportunity.type ||
        null,

      lineValue,

      priceValueCents:
        priceValue,

      headline:
        opportunity.headline ||
        null
    },

    bestAvailable: {

      sportsbook:
        best
          .sportsbook ||
        null,

      line:
        safeNumber(
          best.line
        ),

      price:
        safeNumber(
          best.price
        )
    },

    eventCreated
  };
}


module.exports = {
  evaluateOpportunityState
};

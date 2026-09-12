const crypto =
  require("crypto");

const {
  evaluateSharpSignal
} =
  require("./marketSharpSignals");


// ============================================================
// MATERIAL SIGNAL STATES
// ============================================================

const MATERIAL_SIGNALS =
  new Set([
    "POTENTIAL_SHARP_MONEY",
    "POTENTIAL_SHARP_AGAINST",

    "SHARP_SUPPORT",
    "SHARP_CONFLICT",

    "STRONG_SHARP_SIGNAL",
    "STRONG_SHARP_CONFLICT",

    "MARKET_SUPPORT",
    "MARKET_CONFLICT",

    "MIXED_SIGNAL"
  ]);


// ============================================================
// RESEARCH MOVEMENT STEPS
// ============================================================

const LINE_STEP = 0.5;

const PRICE_PROBABILITY_STEP_PP = 1.5;


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

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function round2(value) {

  const n =
    safeNum(value);

  if (n === null) {
    return null;
  }

  return Number(
    n.toFixed(2)
  );
}


function makeFingerprint(value) {

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value)
    )
    .digest("hex");
}


function normalizeTimestamp(
  value
) {

  if (!value) {
    return new Date()
      .toISOString();
  }

  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return new Date()
      .toISOString();
  }

  return parsed
    .toISOString();
}


// ============================================================
// SEVERITY
// ============================================================

function signalSeverity(
  signal
) {

  if (
    signal ===
      "STRONG_SHARP_SIGNAL" ||
    signal ===
      "STRONG_SHARP_CONFLICT"
  ) {
    return "HIGH";
  }


  if (
    signal ===
      "SHARP_SUPPORT" ||
    signal ===
      "SHARP_CONFLICT" ||
    signal ===
      "MARKET_SUPPORT" ||
    signal ===
      "MARKET_CONFLICT" ||
    signal ===
      "MIXED_SIGNAL"
  ) {
    return "MEDIUM";
  }


  return "LOW";
}


function movementSeverity({
  metricType,
  level
}) {

  const amount =
    Math.abs(
      safeNum(level) || 0
    );


  if (
    metricType === "line"
  ) {

    if (amount >= 1.5) {
      return "HIGH";
    }

    if (amount >= 1.0) {
      return "MEDIUM";
    }

    return "LOW";
  }


  if (
    metricType ===
    "price_probability"
  ) {

    if (amount >= 4.5) {
      return "HIGH";
    }

    if (amount >= 3.0) {
      return "MEDIUM";
    }

    return "LOW";
  }


  return "LOW";
}


// ============================================================
// SIGNAL TEXT
// ============================================================

function getSignalText(
  signal
) {

  const map = {

    POTENTIAL_SHARP_MONEY: {
      headline:
        "Potential Sharp Money",

      explanation:
        "Money and ticket distribution shows meaningful larger-bet concentration on the CashEdge side, without enough reference-market confirmation yet."
    },


    POTENTIAL_SHARP_AGAINST: {
      headline:
        "Potential Sharp Money Against",

      explanation:
        "Money and ticket distribution shows meaningful larger-bet concentration against the CashEdge side, without enough reference-market confirmation yet."
    },


    SHARP_SUPPORT: {
      headline:
        "Sharp Support Detected",

      explanation:
        "Money/ticket divergence and reference-market movement are supporting the CashEdge Premium selection."
    },


    SHARP_CONFLICT: {
      headline:
        "Sharp Conflict Detected",

      explanation:
        "Money/ticket divergence and reference-market movement are pointing against the CashEdge Premium selection."
    },


    STRONG_SHARP_SIGNAL: {
      headline:
        "Strong Sharp Signal",

      explanation:
        "Multiple independent market signals are strongly aligned with the CashEdge Premium selection."
    },


    STRONG_SHARP_CONFLICT: {
      headline:
        "Strong Sharp Conflict",

      explanation:
        "Multiple independent market signals are strongly moving against the CashEdge Premium selection."
    },


    MARKET_SUPPORT: {
      headline:
        "Market Support",

      explanation:
        "Reference and retail sportsbooks are moving with CashEdge, without enough Money/Tickets evidence to label the move as sharp money."
    },


    MARKET_CONFLICT: {
      headline:
        "Market Conflict",

      explanation:
        "Reference and retail sportsbooks are moving against CashEdge, without enough Money/Tickets evidence to label the move as sharp money."
    },


    MIXED_SIGNAL: {
      headline:
        "Mixed Market Signal",

      explanation:
        "Material market evidence is currently pointing in both directions."
    }
  };


  return (
    map[signal] || {
      headline:
        signal,

      explanation:
        "Material market state detected."
    }
  );
}


// ============================================================
// MOVEMENT MILESTONE
//
// Example:
//
// 0.64 points = milestone 0.5
// 1.12 points = milestone 1.0
// 1.78 points = milestone 1.5
// ============================================================

function getMovementMilestone({
  alignment,
  lineMovement,
  impliedMovementPP
}) {

  if (
    alignment !== "ALIGNED" &&
    alignment !== "AGAINST"
  ) {
    return null;
  }


  const direction =
    alignment === "ALIGNED"
      ? "aligned"
      : "against";


  const line =
    safeNum(
      lineMovement
    );


  if (
    line !== null &&
    Math.abs(line) >=
      LINE_STEP
  ) {

    const absolute =
      Math.abs(line);


    const level =
      Math.floor(
        absolute /
        LINE_STEP
      ) *
      LINE_STEP;


    return {

      direction,

      metricType:
        "line",

      rawMovement:
        round2(line),

      level:
        round2(level)
    };
  }


  const implied =
    safeNum(
      impliedMovementPP
    );


  if (
    implied !== null &&
    Math.abs(implied) >=
      PRICE_PROBABILITY_STEP_PP
  ) {

    const absolute =
      Math.abs(implied);


    const level =
      Math.floor(
        absolute /
        PRICE_PROBABILITY_STEP_PP
      ) *
      PRICE_PROBABILITY_STEP_PP;


    return {

      direction,

      metricType:
        "price_probability",

      rawMovement:
        round2(implied),

      level:
        round2(level)
    };
  }


  return null;
}


// ============================================================
// CREATE MARKET EVENT
// ============================================================

async function createMarketEvent({

  supabaseAdmin,

  sport,
  gameId,

  marketType,
  selectionKey,

  eventFamily,
  eventType,

  direction,
  severity,

  signalStrength = 0,

  headline,
  explanation,

  sourceSnapshotId,

  eventData,

  isActive,

  detectedAt

}) {

  const timestamp =
    normalizeTimestamp(
      detectedAt
    );


  const fingerprint =
    makeFingerprint({

      gameId,

      eventFamily,

      eventType,

      sourceSnapshotId:
        sourceSnapshotId || null,

      eventData:
        eventData || {}
    });


  const payload = {

    sport,

    cashedge_game_id:
      gameId,

    market_type:
      marketType,

    selection_key:
      selectionKey,

    event_family:
      eventFamily,

    event_type:
      eventType,

    direction,

    severity,

    signal_strength:
      signalStrength,

    is_important:
      false,

    is_active:
      isActive === true,

    headline,

    explanation,

    event_data:
      eventData || {},

    source_snapshot_id:
      sourceSnapshotId ||
      null,

    fingerprint,

    first_detected_at:
      timestamp,

    last_detected_at:
      timestamp,

    resolved_at:
      isActive === true
        ? null
        : timestamp,

    created_at:
      timestamp,

    updated_at:
      timestamp
  };


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .insert(
        payload
      )
      .select(`
        id,
        event_type,
        event_family,
        severity,
        first_detected_at,
        last_detected_at,
        is_active
      `)
      .single();


  if (error) {

    if (
      error.code === "23505"
    ) {

      return {
        created: false,
        duplicate: true
      };
    }

    throw error;
  }


  return {
    created: true,
    event: data
  };
}


// ============================================================
// RESOLVE ACTIVE SIGNAL STATE
// ============================================================

async function resolveActiveSignals({

  supabaseAdmin,
  gameId,
  resolvedAt

}) {

  const timestamp =
    normalizeTimestamp(
      resolvedAt
    );


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
        "signal"
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
// SIGNAL STATE
// ============================================================

async function handleSignalState({

  supabaseAdmin,

  sport,
  gameId,

  marketType,
  selectionKey,

  snapshot,
  sharpResult

}) {

  const signal =
    String(
      sharpResult
        ?.sharp
        ?.signal ||
      "NO_SHARP_SIGNAL"
    );


  const detectedAt =
    normalizeTimestamp(
      snapshot
        .observed_at
    );


  // ==========================================================
  // FIND ACTIVE SIGNAL
  // ==========================================================

  const {
    data: activeSignal,
    error: activeError
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .select(`
        id,
        event_type,
        first_detected_at,
        last_detected_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "event_family",
        "signal"
      )
      .eq(
        "is_active",
        true
      )
      .order(
        "first_detected_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (activeError) {
    throw activeError;
  }


  // ==========================================================
  // CURRENT STATE IS NOT MATERIAL
  //
  // Close whatever material signal was previously active.
  // ==========================================================

  if (
    !MATERIAL_SIGNALS.has(
      signal
    )
  ) {

    if (activeSignal) {

      await resolveActiveSignals({

        supabaseAdmin,
        gameId,

        resolvedAt:
          detectedAt
      });
    }


    return {

      created: false,

      resolved:
        Boolean(activeSignal),

      signal
    };
  }


  // ==========================================================
  // SAME SIGNAL STILL ACTIVE
  //
  // Do not create another row.
  // Extend its life.
  // ==========================================================

  if (
    activeSignal
      ?.event_type ===
    signal
  ) {

    const strength =
      Number(
        sharpResult
          ?.sharp
          ?.strength ||
        0
      );


    const {
      error: updateError
    } =
      await supabaseAdmin
        .from(
          "market_events"
        )
        .update({

          last_detected_at:
            detectedAt,

          signal_strength:
            strength,

          source_snapshot_id:
            snapshot.id,

          event_data: {

            alignment:
              snapshot
                .alignment_state,

            moneySignal:
              sharpResult
                ?.money
                ?.signal ||
              null,

            sharpSignal:
              signal,

            sharpStrength:
              strength,

            moneyPct:
              snapshot.money_pct,

            ticketsPct:
              snapshot
                .tickets_pct,

            divergence:
              snapshot
                .money_ticket_divergence,

            marketLine:
              snapshot
                .market_line,

            marketPrice:
              snapshot
                .market_price_american,

            lineMovement:
              snapshot
                .line_movement,

            impliedProbabilityMovementPP:
              snapshot
                .implied_probability_movement_pp,

            minutesToStart:
              snapshot
                .minutes_to_start,

            referenceAligned:
              snapshot
                .reference_aligned_count,

            referenceAgainst:
              snapshot
                .reference_against_count,

            retailAligned:
              snapshot
                .retail_aligned_count,

            retailAgainst:
              snapshot
                .retail_against_count
          },

          updated_at:
            detectedAt
        })
        .eq(
          "id",
          activeSignal.id
        );


    if (updateError) {
      throw updateError;
    }


    return {

      created: false,

      extended: true,

      signal,

      eventId:
        activeSignal.id
    };
  }


  // ==========================================================
  // SIGNAL CHANGED
  // ==========================================================

  if (activeSignal) {

    await resolveActiveSignals({

      supabaseAdmin,
      gameId,

      resolvedAt:
        detectedAt
    });
  }


  const strength =
    Number(
      sharpResult
        ?.sharp
        ?.strength ||
      0
    );


  const text =
    getSignalText(
      signal
    );


  return createMarketEvent({

    supabaseAdmin,

    sport,
    gameId,

    marketType,
    selectionKey,

    eventFamily:
      "signal",

    eventType:
      signal,

    direction:
      sharpResult
        ?.sharp
        ?.direction ||
      "neutral",

    severity:
      signalSeverity(
        signal
      ),

    signalStrength:
      strength,

    headline:
      text.headline,

    explanation:
      text.explanation,

    sourceSnapshotId:
      snapshot.id,

    eventData: {

      alignment:
        snapshot
          .alignment_state,

      moneySignal:
        sharpResult
          ?.money
          ?.signal ||
        null,

      sharpSignal:
        signal,

      sharpStrength:
        strength,

      moneyPct:
        snapshot.money_pct,

      ticketsPct:
        snapshot.tickets_pct,

      divergence:
        snapshot
          .money_ticket_divergence,

      marketLine:
        snapshot.market_line,

      marketPrice:
        snapshot
          .market_price_american,

      lineMovement:
        snapshot.line_movement,

      impliedProbabilityMovementPP:
        snapshot
          .implied_probability_movement_pp,

      minutesToStart:
        snapshot.minutes_to_start,

      referenceAligned:
        snapshot
          .reference_aligned_count,

      referenceAgainst:
        snapshot
          .reference_against_count,

      retailAligned:
        snapshot
          .retail_aligned_count,

      retailAgainst:
        snapshot
          .retail_against_count
    },

    isActive:
      true,

    detectedAt
  });
}


// ============================================================
// PROGRESSIVE MARKET MOVEMENT
// ============================================================

async function handleMovementMilestone({

  supabaseAdmin,

  sport,
  gameId,

  marketType,
  selectionKey,

  snapshot

}) {

  const milestone =
    getMovementMilestone({

      alignment:
        snapshot
          .alignment_state,

      lineMovement:
        snapshot
          .line_movement,

      impliedMovementPP:
        snapshot
          .implied_probability_movement_pp
    });


  if (!milestone) {

    return {
      created: false,
      reason:
        "No material movement"
    };
  }


  const eventType =
    milestone.direction ===
    "aligned"
      ? "MARKET_MOVE_ALIGNED"
      : "MARKET_MOVE_AGAINST";


  // ==========================================================
  // FIND STRONGEST PREVIOUS MILESTONE
  // ==========================================================

  const {
    data: previous,
    error: previousError
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .select(`
        id,
        event_data
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "event_family",
        "movement"
      )
      .eq(
        "event_type",
        eventType
      )
      .order(
        "first_detected_at",
        {
          ascending: false
        }
      )
      .limit(100);


  if (previousError) {
    throw previousError;
  }


  const sameMetric =
    (previous || [])
      .filter(
        row =>
          row
            ?.event_data
            ?.metricType ===
          milestone.metricType
      );


  const previousMaximum =
    sameMetric.reduce(
      (
        currentMax,
        row
      ) => {

        const level =
          safeNum(
            row
              ?.event_data
              ?.movementLevel
          ) || 0;


        return Math.max(
          currentMax,
          level
        );
      },
      0
    );


  // Already recorded same or stronger movement.
  if (
    milestone.level <=
    previousMaximum
  ) {

    return {

      created: false,

      unchanged: true,

      milestone:
        milestone.level,

      previousMaximum
    };
  }


  // ==========================================================
  // HUMAN-READABLE TEXT
  // ==========================================================

  let headline;
  let explanation;


  if (
    milestone.metricType ===
    "line"
  ) {

    const label =
      milestone.level === 1
        ? "point"
        : "points";


    if (
      milestone.direction ===
      "aligned"
    ) {

      headline =
        `Market moved ${milestone.level} ${label} with CashEdge`;

      explanation =
        "The consensus market line has moved materially in the same direction as the CashEdge Premium selection.";

    } else {

      headline =
        `Market moved ${milestone.level} ${label} against CashEdge`;

      explanation =
        "The consensus market line has moved materially against the CashEdge Premium selection.";
    }


  } else {

    if (
      milestone.direction ===
      "aligned"
    ) {

      headline =
        "Market price strengthened with CashEdge";

      explanation =
        `Implied probability strengthened by at least ${milestone.level} percentage points for the CashEdge Premium selection.`;

    } else {

      headline =
        "Market price weakened against CashEdge";

      explanation =
        `Implied probability weakened by at least ${milestone.level} percentage points for the CashEdge Premium selection.`;
    }
  }


  const detectedAt =
    normalizeTimestamp(
      snapshot
        .observed_at
    );


  return createMarketEvent({

    supabaseAdmin,

    sport,
    gameId,

    marketType,
    selectionKey,

    eventFamily:
      "movement",

    eventType,

    direction:
      milestone.direction,

    severity:
      movementSeverity({

        metricType:
          milestone.metricType,

        level:
          milestone.level
      }),

    signalStrength:
      0,

    headline,
    explanation,

    sourceSnapshotId:
      snapshot.id,

    eventData: {

      metricType:
        milestone.metricType,

      movementLevel:
        milestone.level,

      rawMovement:
        milestone.rawMovement,

      alignment:
        snapshot
          .alignment_state,

      baselineLine:
        snapshot
          .baseline_line,

      marketLine:
        snapshot
          .market_line,

      baselinePrice:
        snapshot
          .baseline_price_american,

      marketPrice:
        snapshot
          .market_price_american,

      minutesToStart:
        snapshot
          .minutes_to_start
    },

    // Movement milestones are historical facts.
    // They are not persistent active states.
    isActive:
      false,

    detectedAt
  });
}


// ============================================================
// MAIN ENGINE
// ============================================================

async function evaluateMarketEvents({

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


  // ==========================================================
  // DORMANT UNTIL WE ENABLE SHADOW EVENT DETECTION
  // ==========================================================

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
        "Event detection disabled",

      shadowMode:
        settings
          ?.shadow_mode === true
    };
  }


  // ==========================================================
  // UPDATE EVALUATION + SHARP STATE
  // ==========================================================

  const sharpResult =
    await evaluateSharpSignal({

      supabaseAdmin,
      gameId
    });


  if (
    sharpResult?.ok !==
    true
  ) {
    return sharpResult;
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
  // LATEST EVALUATION SNAPSHOT
  // ==========================================================

  const {
    data: snapshot,
    error: snapshotError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_snapshots"
      )
      .select("*")
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


  if (snapshotError) {
    throw snapshotError;
  }


  if (!snapshot) {

    return {

      ok: true,

      skipped:
        true,

      reason:
        "No evaluation snapshot available"
    };
  }


  // ==========================================================
  // 1. PROGRESSIVE MARKET MOVEMENT
  // ==========================================================

  const movementResult =
    await handleMovementMilestone({

      supabaseAdmin,

      sport:
        context.sport,

      gameId,

      marketType:
        context.market_type,

      selectionKey:
        context.selection_key,

      snapshot
    });


  // ==========================================================
  // 2. SIGNAL STATE / LIFETIME
  // ==========================================================

  const signalResult =
    await handleSignalState({

      supabaseAdmin,

      sport:
        context.sport,

      gameId,

      marketType:
        context.market_type,

      selectionKey:
        context.selection_key,

      snapshot,

      sharpResult
    });


  return {

    ok: true,

    shadowMode:
      settings
        ?.shadow_mode === true,

    eventDetectionEnabled:
      true,

    notificationsEnabled:
      settings
        ?.notifications_enabled === true,

    frontendEnabled:
      settings
        ?.frontend_enabled === true,

    gameId,

    pick:
      context
        .canonical_pick,

    alignment:
      snapshot
        .alignment_state,

    sharp:
      sharpResult
        ?.sharp ||
      null,

    movementEvent:
      movementResult,

    signalEvent:
      signalResult
  };
}


module.exports = {
  evaluateMarketEvents
};

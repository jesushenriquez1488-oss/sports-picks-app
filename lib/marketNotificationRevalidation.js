const {
  calculateMarketOpportunity,
  safeNumber
} =
  require("./marketOpportunity");

const {
  classifyNotification,
  isStrongSharpWithCashEdgeEvent,
  isStaleLineOpportunity,
  isMaterialValue,
  isMaterialMoveEvent
} =
  require("./marketNotificationDecision");

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


function safeObject(value) {

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }


  return {};
}


function formatAmericanPrice(
  value
) {

  const number =
    safeNumber(value);


  if (number === null) {
    return null;
  }


  if (number > 0) {
    return `+${number}`;
  }


  return String(number);
}


function formatLine(
  value
) {

  const number =
    safeNumber(value);


  if (number === null) {
    return null;
  }


  if (number > 0) {
    return `+${number}`;
  }


  return String(number);
}


function formatMarketNumber({

  line,
  price,
  marketType

}) {

  const formattedPrice =
    formatAmericanPrice(
      price
    );


  if (
    marketType ===
    "moneyline"
  ) {

    return (
      formattedPrice ||
      "current price"
    );
  }


  const formattedLine =
    formatLine(
      line
    );


  if (
    formattedLine &&
    formattedPrice
  ) {

    return (
      `${formattedLine} (${formattedPrice})`
    );
  }


  return (
    formattedLine ||
    formattedPrice ||
    "current number"
  );
}


// ============================================================
// BEST BOOKS
//
// Spread / Total:
// marketOpportunity already gives every sportsbook at the
// exact BEST LINE, ordered by best price.
//
// Moneyline:
// every sportsbook tied at the exact best price.
// ============================================================

function getBestBooks(
  opportunityResult
) {

  const books =
    opportunityResult
      ?.bestBooks;


  if (
    Array.isArray(books) &&
    books.length
  ) {

    return books.map(
      book => ({

        sportsbookKey:
          book.sportsbookKey ||
          null,

        sportsbook:
          book.sportsbook ||
          book.sportsbookKey ||
          null,

        line:
          safeNumber(
            book.line
          ),

        price:
          safeNumber(
            book.price
          )
      })
    );
  }


  // Backward-compatible fallback.
  const best =
    opportunityResult
      ?.bestLine;


  if (!best) {
    return [];
  }


  return [
    {

      sportsbookKey:
        best.sportsbookKey ||
        null,

      sportsbook:
        best.sportsbook ||
        best.sportsbookKey ||
        null,

      line:
        safeNumber(
          best.line
        ),

      price:
        safeNumber(
          best.price
        )
    }
  ];
}


function formatBestBooksNames(
  opportunityResult
) {

  const books =
    getBestBooks(
      opportunityResult
    );


  const names =
    books
      .map(
        book =>
          String(
            book.sportsbook ||
            book.sportsbookKey ||
            ""
          )
            .trim()
      )
      .filter(Boolean);


  if (!names.length) {
    return "a sportsbook";
  }


  if (
    names.length === 1
  ) {

    return names[0];
  }


  if (
    names.length === 2
  ) {

    return (
      `${names[0]} and ${names[1]}`
    );
  }


  return (
    `${names
      .slice(
        0,
        -1
      )
      .join(", ")} and ${
        names[
          names.length - 1
        ]
      }`
  );
}


function formatBestBooksWithPrices(
  opportunityResult
) {

  const books =
    getBestBooks(
      opportunityResult
    );


  if (!books.length) {
    return null;
  }


  return books
    .map(
      book => {

        const name =
          book.sportsbook ||
          book.sportsbookKey ||
          "Sportsbook";


        const price =
          formatAmericanPrice(
            book.price
          );


        return price
          ? `${name} ${price}`
          : name;
      }
    )
    .join(" · ");
}


// ============================================================
// STABLE COMPARISON
// ============================================================

function stableValue(value) {

  if (
    Array.isArray(value)
  ) {

    return value.map(
      stableValue
    );
  }


  if (
    value &&
    typeof value ===
      "object"
  ) {

    const ordered = {};


    Object
      .keys(value)
      .sort()
      .forEach(
        key => {

          ordered[key] =
            stableValue(
              value[key]
            );
        }
      );


    return ordered;
  }


  return value;
}


function signature(value) {

  return JSON.stringify(
    stableValue(value)
  );
}


// ============================================================
// LOAD OUTBOX ROW
// ============================================================

async function loadNotification({

  supabaseAdmin,
  notificationId

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .select(`
        id,
        market_event_id,
        cashedge_game_id,
        notification_key,
        notification_kind,
        delivery_class,
        audience,
        title,
        body,
        deep_link,
        priority,
        expires_at,
        status,
        dispatch_enabled,
        notification_provider,
        payload,
        revalidation_required,
        last_validated_at,
        attempt_count,
        next_attempt_at,
        processing_started_at,
        lock_token,
        provider_message_id,
        cancelled_at,
        cancel_reason,
        source_event_at,
        created_at,
        sent_at,
        error_message
      `)
      .eq(
        "id",
        notificationId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// LOAD RULE
// ============================================================

async function loadRule({

  supabaseAdmin,
  kind

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_rules"
      )
      .select(`
        notification_kind,
        enabled,
        delivery_class,
        premium_only,
        daily_limit,
        cooldown_seconds,
        revalidation_required,
        minimum_importance_level,
        config
      `)
      .eq(
        "notification_kind",
        kind
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// LOAD CURRENT EVALUATION SUMMARY
// ============================================================

async function loadSummary({

  supabaseAdmin,
  gameId

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .select(`
        id,
        cashedge_game_id,
        latest_alignment_state,
        latest_opportunity_state,
        latest_opportunity_type,
        latest_opportunity_line_value,
        latest_opportunity_price_value_cents,
        latest_opportunity_book_key,
        latest_opportunity_book_name,
        latest_opportunity_best_line,
        latest_opportunity_best_price,
        opportunity_state_started_at,
        updated_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// LOAD LATEST IMPORTANT EVENT
// ============================================================

async function loadLatestImportantEvent({

  supabaseAdmin,
  gameId

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .select(`
        id,
        cashedge_game_id,
        event_family,
        event_type,
        direction,
        severity,
        event_data,
        importance_level,
        is_important,
        is_important_now,
        is_active,
        first_detected_at,
        last_detected_at,
        resolved_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "is_important_now",
        true
      )
      .gte(
        "importance_level",
        2
      )
      .order(
        "importance_level",
        {
          ascending:
            false
        }
      )
      .order(
        "last_detected_at",
        {
          ascending:
            false
        }
      )
      .limit(1)
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// LOAD ORIGINAL SOURCE EVENT
// ============================================================

async function loadSourceEvent({

  supabaseAdmin,
  eventId

}) {

  if (!eventId) {
    return null;
  }


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .select(`
        id,
        cashedge_game_id,
        event_family,
        event_type,
        direction,
        severity,
        event_data,
        importance_level,
        is_important,
        is_important_now,
        is_active,
        first_detected_at,
        last_detected_at,
        resolved_at
      `)
      .eq(
        "id",
        eventId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// OWNER-SAFE CANCEL
//
// Uses the RPC created in 14B.2b.
//
// A stale worker cannot cancel a notification owned by a newer
// worker because notification_id + lock_token must both match.
// ============================================================

async function cancelNotificationOwnerSafe({

  supabaseAdmin,
  notification,
  lockToken,
  reason

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .rpc(
        "cancel_market_notification_v1",
        {

          p_notification_id:
            notification.id,

          p_lock_token:
            lockToken,

          p_reason:
            reason
        }
      );


  if (error) {
    throw error;
  }


  const result =
    Array.isArray(data)
      ? data[0]
      : data;


  if (
    result
      ?.ownership_valid !==
    true
  ) {

    return {

      ok:
        true,

      result:
        "STALE_OWNER",

      valid:
        false,

      ownershipValid:
        false,

      reason:
        "Notification ownership changed before cancellation"
    };
  }


  return {

    ok:
      true,

    result:
      "CANCELLED",

    valid:
      false,

    ownershipValid:
      true,

    reason,

    notification: {

      id:
        result.notification_id,

      status:
        result.final_status,

      cancelledAt:
        result.final_cancelled_at,

      cancelReason:
        result.final_cancel_reason
    }
  };
}


// ============================================================
// BUILD CURRENT CONTENT
// ============================================================

function buildCurrentContent({

  kind,
  opportunityResult,
  sourceEvent

}) {

  const pick =
    String(
      opportunityResult
        ?.pick ||
      "CashEdge Premium"
    )
      .trim();


  const marketType =
    String(
      opportunityResult
        ?.marketType ||
      ""
    )
      .toLowerCase();


  const best =
    opportunityResult
      ?.bestLine ||
    {};


  const marketNow =
    opportunityResult
      ?.marketNow ||
    {};


  const bestBooksNames =
    formatBestBooksNames(
      opportunityResult
    );


  const booksWithPrices =
    formatBestBooksWithPrices(
      opportunityResult
    );


  const marketNumber =
    formatMarketNumber({

      line:
        marketNow.line,

      price:
        marketNow.price,

      marketType
    });


  const bestNumber =
    marketType ===
      "moneyline"
      ? formatAmericanPrice(
          best.price
        )
      : formatLine(
          best.line
        );

  if (
    kind ===
    "OPPORTUNITY_DETECTED"
  ) {

    return {

      title:
        "🚨 OPPORTUNITY DETECTED",

      body:
        `${pick}. Market ${marketNumber}. Best ${bestNumber}: ${booksWithPrices || bestBooksNames}.`
    };
  }
    if (
    kind ===
    "STRONG_SHARP_WITH_CASHEDGE"
  ) {

    return {

      title:
        "🔥 STRONG SHARP WITH CASHEDGE",

      body:
        `${pick}. Strong sharp action is confirmed by multiple sportsbooks moving with the CashEdge side. Open Premium Radar for the latest market state.`
    };
  }


  if (
    kind ===
    "STALE_LINE"
  ) {

    return {

      title:
        "🚨 BETTER LINE STILL AVAILABLE",

      body:
        `${pick}. Market ${marketNumber}. Best ${bestNumber}: ${booksWithPrices || bestBooksNames}.`
    };
  }


  if (
    kind ===
    "WINDOW_CLOSING"
  ) {

    return {

      title:
        "⏳ VALUE WINDOW CLOSING",

      body:
        `${pick}. Best ${bestNumber}: ${booksWithPrices || bestBooksNames}. The market advantage is shrinking.`
    };
  }


  if (
    kind ===
    "VALUE_AVAILABLE"
  ) {

    return {

      title:
        "⚡ VALUE AVAILABLE",

      body:
        `${pick}. Best ${bestNumber}: ${booksWithPrices || bestBooksNames}. Market ${marketNumber}.`
    };
  }


  if (
    kind ===
    "MATERIAL_MOVE"
  ) {

    const direction =
      normalize(
        sourceEvent
          ?.direction
      );


    let movementText =
      "The market has moved materially.";


    if (
      direction ===
      "ALIGNED"
    ) {

      movementText =
        "The market has moved materially with the CashEdge side.";
    }


    if (
      direction ===
      "AGAINST"
    ) {

      movementText =
        "The market has moved materially against the CashEdge side.";
    }


    return {

      title:
        "📈 IMPORTANT MARKET MOVE",

      body:
        `${pick}. ${movementText} Open Premium Radar for the latest market state.`
    };
  }


  return {

    title:
      "CashEdge Market Intelligence",

    body:
      `${pick}. A market update is available.`
  };
}


// ============================================================
// CURRENT SNAPSHOT
//
// last_detected_at is deliberately NOT included in the stable
// comparison because it can change on every pipeline refresh
// without the actual opportunity changing.
// ============================================================

function buildCurrentSnapshot({

  opportunityResult,
  summary,
  sourceEvent

}) {

  return {

    pick:
      opportunityResult
        ?.pick ||
      null,

    confidence:
      safeNumber(
        opportunityResult
          ?.confidence
      ),

    marketType:
      opportunityResult
        ?.marketType ||
      null,

    selectionKey:
      opportunityResult
        ?.selectionKey ||
      null,

    opportunityState:
      summary
        ?.latest_opportunity_state ||
      null,

    opportunity:
      opportunityResult
        ?.opportunity ||
      null,

    marketNow:
      opportunityResult
        ?.marketNow ||
      null,

    bestAvailable:
      opportunityResult
        ?.bestLine ||
      null,

    bestBooks:
      getBestBooks(
        opportunityResult
      ),

    sourceEvent:
      sourceEvent
        ? {

            id:
              sourceEvent.id,

            family:
              sourceEvent
                .event_family,

            type:
              sourceEvent
                .event_type,

            direction:
              sourceEvent
                .direction,

            severity:
              sourceEvent
                .severity,

            importanceLevel:
              Number(
                sourceEvent
                  .importance_level ||
                0
              ),

            firstDetectedAt:
              sourceEvent
                .first_detected_at
          }
        : null
  };
}


// ============================================================
// ORIGINAL SNAPSHOT
// ============================================================

function buildOriginalSnapshot(
  payload
) {

  const source =
    safeObject(
      payload
    );


  const sourceEvent =
    safeObject(
      source.sourceEvent
    );


  return {

    pick:
      source.pick ||
      null,

    confidence:
      safeNumber(
        source.confidence
      ),

    marketType:
      source.marketType ||
      null,

    selectionKey:
      source.selectionKey ||
      null,

    opportunityState:
      source.opportunityState ||
      null,

    opportunity:
      source.opportunity ||
      null,

    marketNow:
      source.marketNow ||
      null,

    bestAvailable:
      source.bestAvailable ||
      null,

    bestBooks:
      Array.isArray(
        source.bestBooks
      )
        ? source.bestBooks
        : [],

    sourceEvent:
      Object.keys(
        sourceEvent
      ).length
        ? {

            id:
              sourceEvent.id ||
              null,

            family:
              sourceEvent.family ||
              null,

            type:
              sourceEvent.type ||
              null,

            direction:
              sourceEvent.direction ||
              null,

            severity:
              sourceEvent.severity ||
              null,

            importanceLevel:
              Number(
                sourceEvent
                  .importanceLevel ||
                0
              ),

            firstDetectedAt:
              sourceEvent
                .firstDetectedAt ||
              null
          }
        : null
  };
}


// ============================================================
// OWNER-SAFE REFRESH
//
// IMPORTANT:
//
// This keeps:
// status = processing
// same lock_token
//
// The worker remains owner after successful revalidation.
//
// Only that worker may later call:
// sent / retry / cancel / release.
// ============================================================

async function refreshNotificationOwnerSafe({

  supabaseAdmin,
  notification,
  lockToken,
  updatePayload

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .update(
        updatePayload
      )
      .eq(
        "id",
        notification.id
      )
      .eq(
        "status",
        "processing"
      )
      .eq(
        "lock_token",
        lockToken
      )
      .select(`
        id,
        notification_kind,
        title,
        body,
        status,
        dispatch_enabled,
        payload,
        last_validated_at,
        expires_at,
        processing_started_at,
        lock_token
      `)
      .maybeSingle();


  if (error) {
    throw error;
  }


  if (!data) {

    return {

      ok:
        true,

      result:
        "STALE_OWNER",

      valid:
        false,

      ownershipValid:
        false,

      reason:
        "Notification ownership changed during revalidation"
    };
  }


  return {

    ok:
      true,

    ownershipValid:
      true,

    notification:
      data
  };
}


// ============================================================
// MAIN REVALIDATION ENGINE
// ============================================================

async function revalidateMarketNotification({

  supabaseAdmin,
  notificationId,
  lockToken

}) {

  if (!supabaseAdmin) {

    throw new Error(
      "supabaseAdmin is required"
    );
  }


  if (!notificationId) {

    throw new Error(
      "notificationId is required"
    );
  }


  if (
    !lockToken ||
    !String(
      lockToken
    ).trim()
  ) {

    throw new Error(
      "lockToken is required"
    );
  }


  const cleanLockToken =
    String(
      lockToken
    )
      .trim();


  const validatedAt =
    nowIso();


  // ==========================================================
  // 1. LOAD OUTBOX ITEM
  // ==========================================================

  const notification =
    await loadNotification({

      supabaseAdmin,
      notificationId
    });


  if (!notification) {

    return {

      ok:
        false,

      result:
        "NOT_FOUND",

      valid:
        false,

      reason:
        "Notification not found"
    };
  }


  const kind =
    normalize(
      notification
        .notification_kind
    );


  // ==========================================================
  // 2. TERMINAL STATES
  // ==========================================================

  if (
    notification.status ===
    "sent"
  ) {

    return {

      ok:
        true,

      result:
        "ALREADY_SENT",

      valid:
        false,

      ownershipValid:
        false,

      reason:
        "Notification has already been sent"
    };
  }


  if (
    notification.status ===
    "cancelled"
  ) {

    return {

      ok:
        true,

      result:
        "ALREADY_CANCELLED",

      valid:
        false,

      ownershipValid:
        false,

      reason:
        notification
          .cancel_reason ||
        "Notification already cancelled"
    };
  }


  // ==========================================================
  // 3. OWNERSHIP CHECK
  //
  // Revalidation is only valid after an atomic claim.
  // ==========================================================

  if (
    notification.status !==
      "processing" ||
    notification.lock_token !==
      cleanLockToken
  ) {

    return {

      ok:
        true,

      result:
        "STALE_OWNER",

      valid:
        false,

      ownershipValid:
        false,

      reason:
        "Notification is not owned by this worker"
    };
  }


  // ==========================================================
  // 4. PREMIUM AUDIENCE HARD SAFETY
  // ==========================================================

  if (
    normalize(
      notification.audience
    ) !==
    "PREMIUM"
  ) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Market Intelligence notifications are Premium-only"
    });
  }


  // ==========================================================
  // 5. EXPIRATION
  // ==========================================================

  if (
    notification.expires_at
  ) {

    const expiresMs =
      new Date(
        notification.expires_at
      )
        .getTime();


    if (
      Number.isFinite(
        expiresMs
      ) &&
      expiresMs <=
        Date.now()
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Notification opportunity expired before delivery"
      });
    }
  }


  // ==========================================================
  // 6. RULE MUST STILL EXIST + BE ENABLED
  // ==========================================================

  const rule =
    await loadRule({

      supabaseAdmin,
      kind
    });


  if (!rule) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Notification rule no longer exists"
    });
  }


  if (
    rule.enabled !==
    true
  ) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Notification rule was disabled before delivery"
    });
  }


  const config =
    safeObject(
      rule.config
    );


  // ==========================================================
  // 7. CURRENT MARKET OPPORTUNITY
  // ==========================================================

  const opportunityResult =
    await calculateMarketOpportunity({

      supabaseAdmin,

      gameId:
        notification
          .cashedge_game_id
    });


  if (
    opportunityResult?.ok !==
    true
  ) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Current market opportunity could not be verified"
    });
  }


  // ==========================================================
  // 8. PLAY MUST STILL BE PREMIUM
  //
  // User entitlement is checked later in 14C.
  // This verifies the PLAY itself.
  // ==========================================================

  if (
    opportunityResult
      ?.premium !==
    true
  ) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Game is no longer a current Premium selection"
    });
  }


  // ==========================================================
  // 9. CURRENT EVALUATION SUMMARY
  // ==========================================================

  const summary =
    await loadSummary({

      supabaseAdmin,

      gameId:
        notification
          .cashedge_game_id
    });


  if (!summary) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Current market evaluation is unavailable"
    });
  }
  // ==========================================================
  // NOTIFICATION MARKET CONTEXT
  //
  // Revalidation must use the same sport-specific
  // materiality rules as Notification Decision.
  // ==========================================================

  const {
    data: notificationContext,
    error: notificationContextError
  } =
    await supabaseAdmin
      .from(
        "market_pick_context"
      )
      .select(`
        sport,
        market_type,
        selection_key
      `)
      .eq(
        "cashedge_game_id",
        notification
          .cashedge_game_id
      )
      .maybeSingle();


  if (
    notificationContextError
  ) {
    throw notificationContextError;
  }


  if (!notificationContext) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "Notification market context unavailable"
    });
  }


  const notificationSport =
    String(
      notificationContext.sport ||
      ""
    )
      .trim()
      .toLowerCase();


  const notificationMarketType =
    String(
      notificationContext.market_type ||
      ""
    )
      .trim()
      .toLowerCase();


  // MLB Run Line remains part of Market Intelligence,
  // but it must NEVER survive notification revalidation.
  if (
    notificationSport === "mlb" &&
    notificationMarketType === "spread"
  ) {

    return cancelNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      reason:
        "MLB Run Line notifications are disabled"
    });
  }


  // ==========================================================
  // 10. CURRENT IMPORTANT EVENT + ORIGINAL SOURCE EVENT
  // ==========================================================

  const latestImportantEvent =
    await loadLatestImportantEvent({

      supabaseAdmin,

      gameId:
        notification
          .cashedge_game_id
    });


  const sourceEvent =
    await loadSourceEvent({

      supabaseAdmin,

      eventId:
        notification
          .market_event_id
    });


  // ==========================================================
  // 11. TYPE-SPECIFIC REVALIDATION
  // ==========================================================

  if (
    kind ===
    "STRONG_SHARP_WITH_CASHEDGE"
  ) {

    if (!sourceEvent) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Original Strong Sharp signal no longer exists"
      });
    }


    if (
      sourceEvent.is_active !==
      true
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Strong Sharp signal is no longer active"
      });
    }


    if (
      !isStrongSharpWithCashEdgeEvent(
        sourceEvent
      )
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Strong Sharp with CashEdge is no longer confirmed"
      });
    }
  }


  if (
    kind ===
    "OPPORTUNITY_DETECTED"
  ) {

    const currentOpportunityClassification =
      classifyNotification({

        opportunityResult,
        summary,
        latestImportantEvent,

        sport:
          notificationSport
      });


    if (
      !currentOpportunityClassification ||
      currentOpportunityClassification
        .source !==
        "opportunity"
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Opportunity is no longer notification-worthy"
      });
    }
  }


  if (
    kind ===
    "STALE_LINE"
  ) {

    if (
      !isStaleLineOpportunity(
        opportunityResult,
        config
      )
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Better-line opportunity is no longer available"
      });
    }
  }


  if (
    kind ===
    "VALUE_AVAILABLE"
  ) {

    if (
      !isMaterialValue(
        opportunityResult,
        config
      )
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Material market value is no longer available"
      });
    }
  }


  if (
    kind ===
    "WINDOW_CLOSING"
  ) {

    if (
      normalize(
        summary
          .latest_opportunity_state
      ) !==
      "WINDOW_CLOSING"
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Value window is no longer in WINDOW_CLOSING state"
      });
    }


    if (
      !isMaterialValue(
        opportunityResult,
        config
      )
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Value window closed before notification delivery"
      });
    }
  }


  if (
    kind !==
      "MATERIAL_MOVE" &&
    kind !==
      "OPPORTUNITY_DETECTED" &&
    kind !==
      "STRONG_SHARP_WITH_CASHEDGE"
  ) {

    if (!sourceEvent) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Original material-move event no longer exists"
      });
    }


    if (
      sourceEvent
        .is_important_now !==
      true
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Original material market move is no longer important now"
      });
    }


    if (
      !isMaterialMoveEvent(
        sourceEvent
      )
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Original market movement no longer qualifies for notification"
      });
    }
  }


  // ==========================================================
  // 12. SAME NOTIFICATION TYPE MUST STILL WIN
  //
  // Example:
  //
  // VALUE_AVAILABLE may later become STALE_LINE.
  //
  // We do NOT silently rewrite the old alert into another type.
  // Old alert is cancelled; Decision Engine can create the new
  // correct candidate.
  //
  // MATERIAL_MOVE preserves original source-event identity.
  // STRONG_SHARP uses its original active signal-event identity.
  // ==========================================================

  if (
    kind !==
      "MATERIAL_MOVE" &&
    kind !==
      "STRONG_SHARP_WITH_CASHEDGE"
  ) {

    const currentClassification =
      classifyNotification({

        opportunityResult,
        summary,
        latestImportantEvent,

        sport:
          notificationSport
      });


    if (!currentClassification) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          "Current market state no longer qualifies for an immediate alert"
      });
    }


    if (
      normalize(
        currentClassification.kind
      ) !==
      kind
    ) {

      return cancelNotificationOwnerSafe({

        supabaseAdmin,
        notification,

        lockToken:
          cleanLockToken,

        reason:
          `Notification condition changed to ${normalize(
            currentClassification.kind
          )}`
      });
    }
  }


  // ==========================================================
  // 13. BUILD CURRENT CONTENT
  // ==========================================================

  const content =
    buildCurrentContent({

      kind,
      opportunityResult,

      sourceEvent:
        sourceEvent ||
        latestImportantEvent
    });


  const currentSnapshot =
    buildCurrentSnapshot({

      opportunityResult,
      summary,

      sourceEvent:
        sourceEvent ||
        null
    });


  const oldPayload =
    safeObject(
      notification.payload
    );


  const originalSnapshot =
    buildOriginalSnapshot(
      oldPayload
    );


  const changed =
    signature(
      originalSnapshot
    ) !==
    signature(
      currentSnapshot
    ) ||
    notification.title !==
      content.title ||
    notification.body !==
      content.body;


  // ==========================================================
  // 14. REFRESH PAYLOAD
  // ==========================================================

  const refreshedPayload = {

    ...oldPayload,

    version:
      Math.max(
        Number(
          oldPayload.version ||
          0
        ),
        3
      ),

    notificationKind:
      kind,

    deliveryClass:
      rule.delivery_class,

    audience:
      "premium",

    gameId:
      notification
        .cashedge_game_id,

    pick:
      currentSnapshot.pick,

    confidence:
      currentSnapshot.confidence,

    marketType:
      currentSnapshot.marketType,

    selectionKey:
      currentSnapshot.selectionKey,

    opportunityState:
      currentSnapshot
        .opportunityState,

    opportunity:
      currentSnapshot
        .opportunity,

    marketNow:
      currentSnapshot
        .marketNow,

    bestAvailable:
      currentSnapshot
        .bestAvailable,

    bestBooks:
      currentSnapshot
        .bestBooks,

    bestBookCount:
      currentSnapshot
        .bestBooks
        .length,

    sourceEvent:
      currentSnapshot
        .sourceEvent,

    revalidatedAt:
      validatedAt
  };


  // ==========================================================
  // 15. OWNER-SAFE UPDATE
  //
  // Keeps status=processing and keeps the lock.
  // ==========================================================

  const updatePayload = {

    last_validated_at:
      validatedAt,

    payload:
      refreshedPayload,

    error_message:
      null
  };


  if (changed) {

    updatePayload.title =
      content.title;

    updatePayload.body =
      content.body;
  }


  const refreshed =
    await refreshNotificationOwnerSafe({

      supabaseAdmin,
      notification,

      lockToken:
        cleanLockToken,

      updatePayload
    });


  if (
    refreshed
      ?.ownershipValid !==
    true
  ) {

    return refreshed;
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    ok:
      true,

    result:
      changed
        ? "UPDATED"
        : "VALID",

    valid:
      true,

    ownershipValid:
      true,

    changed,

    kind,

    gameId:
      notification
        .cashedge_game_id,

    bestBooks:
      currentSnapshot
        .bestBooks,

    bestAvailable:
      currentSnapshot
        .bestAvailable,

    marketNow:
      currentSnapshot
        .marketNow,

    opportunity:
      currentSnapshot
        .opportunity,

    notification:
      refreshed.notification
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  revalidateMarketNotification
};

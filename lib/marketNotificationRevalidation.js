const {
  calculateMarketOpportunity,
  safeNumber
} =
  require("./marketOpportunity");

const {
  classifyNotification,
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
// CURRENT BEST BOOKS
//
// marketOpportunity.js already returns:
// - only books at the exact best line for Spread / Total
// - tied best price books for Moneyline
// - ordered by best American price
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
    typeof value === "object"
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
//
// Used mainly for MATERIAL_MOVE.
// A movement notification should not silently transform itself
// into a completely different market event.
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
// CANCEL NOTIFICATION
// ============================================================

async function cancelNotification({

  supabaseAdmin,
  notification,
  reason,
  validatedAt

}) {

  const timestamp =
    validatedAt ||
    nowIso();


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .update({

        status:
          "cancelled",

        dispatch_enabled:
          false,

        cancelled_at:
          timestamp,

        cancel_reason:
          reason,

        last_validated_at:
          timestamp,

        next_attempt_at:
          null,

        error_message:
          null
      })
      .eq(
        "id",
        notification.id
      )
      .select(`
        id,
        notification_kind,
        status,
        cancelled_at,
        cancel_reason
      `)
      .single();


  if (error) {
    throw error;
  }


  return {

    ok:
      true,

    result:
      "CANCELLED",

    valid:
      false,

    reason,

    notification:
      data
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


  const bestBooks =
    getBestBooks(
      opportunityResult
    );


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
    "STALE_LINE"
  ) {

    return {

      title:
        "🚨 BETTER LINE STILL AVAILABLE",

      body:
        `${pick}. Market ${marketNumber}. Best ${bestNumber} at ${bestBooksNames}. ${booksWithPrices || ""}`.trim(),

      bestBooks
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
        `${pick}. ${bestBooksNames} still offer ${bestNumber}, but the market advantage is shrinking. ${booksWithPrices || ""}`.trim(),

      bestBooks
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
        `${pick}. Best available ${bestNumber} at ${bestBooksNames}. Market ${marketNumber}. ${booksWithPrices || ""}`.trim(),

      bestBooks
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
        `${pick}. ${movementText} Open Premium Radar for the latest market state.`,

      bestBooks
    };
  }


  return {

    title:
      "CashEdge Market Intelligence",

    body:
      `${pick}. A market update is available.`,

    bestBooks
  };
}


// ============================================================
// CURRENT SNAPSHOT FOR CHANGE DETECTION
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
                .first_detected_at,

            lastDetectedAt:
              sourceEvent
                .last_detected_at
          }
        : null
  };
}


// ============================================================
// ORIGINAL SNAPSHOT FOR CHANGE DETECTION
// ============================================================

function buildOriginalSnapshot(
  payload
) {

  const source =
    safeObject(
      payload
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
      source.sourceEvent ||
      null
  };
}


// ============================================================
// MAIN REVALIDATION ENGINE
// ============================================================

async function revalidateMarketNotification({

  supabaseAdmin,
  notificationId

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

      reason:
        notification
          .cancel_reason ||
        "Notification already cancelled"
    };
  }


  // ==========================================================
  // 3. EXPIRATION
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
      expiresMs <= Date.now()
    ) {

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          "Notification opportunity expired before delivery"
      });
    }
  }


  // ==========================================================
  // 4. RULE MUST STILL EXIST AND BE ENABLED
  // ==========================================================

  const rule =
    await loadRule({

      supabaseAdmin,
      kind
    });


  if (!rule) {

    return cancelNotification({

      supabaseAdmin,
      notification,

      validatedAt,

      reason:
        "Notification rule no longer exists"
    });
  }


  if (
    rule.enabled !==
    true
  ) {

    return cancelNotification({

      supabaseAdmin,
      notification,

      validatedAt,

      reason:
        "Notification rule was disabled before delivery"
    });
  }


  const config =
    safeObject(
      rule.config
    );


  // ==========================================================
  // 5. CURRENT OPPORTUNITY
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

    return cancelNotification({

      supabaseAdmin,
      notification,

      validatedAt,

      reason:
        "Current market opportunity could not be verified"
    });
  }


  // ==========================================================
  // 6. GAME MUST STILL BE PREMIUM
  //
  // User-level Premium entitlement is checked later in 14C.
  // This check confirms the PLAY itself is still Premium.
  // ==========================================================

  if (
    opportunityResult
      ?.premium !==
    true
  ) {

    return cancelNotification({

      supabaseAdmin,
      notification,

      validatedAt,

      reason:
        "Game is no longer a current Premium selection"
    });
  }


  // ==========================================================
  // 7. CURRENT EVALUATION SUMMARY
  // ==========================================================

  const summary =
    await loadSummary({

      supabaseAdmin,

      gameId:
        notification
          .cashedge_game_id
    });


  if (!summary) {

    return cancelNotification({

      supabaseAdmin,
      notification,

      validatedAt,

      reason:
        "Current market evaluation is unavailable"
    });
  }


  // ==========================================================
  // 8. EVENTS
  // ==========================================================

  const latestImportantEvent =
    await loadLatestImportantEvent({

      supabaseAdmin,

      gameId:
        notification
          .cashedge_game_id
    });


  let sourceEvent =
    null;


  if (
    notification
      .market_event_id
  ) {

    sourceEvent =
      await loadSourceEvent({

        supabaseAdmin,

        eventId:
          notification
            .market_event_id
      });
  }


  // ==========================================================
  // 9. TYPE-SPECIFIC REVALIDATION
  // ==========================================================

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

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

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

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

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

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

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

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          "Value window closed before notification delivery"
      });
    }
  }


  if (
    kind ===
    "MATERIAL_MOVE"
  ) {

    if (
      !sourceEvent
    ) {

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          "Original material-move event no longer exists"
      });
    }


    if (
      sourceEvent
        .is_important_now !==
      true
    ) {

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          "Original material market move is no longer important now"
      });
    }


    if (
      !isMaterialMoveEvent(
        sourceEvent
      )
    ) {

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          "Original market movement no longer qualifies for notification"
      });
    }
  }


  // ==========================================================
  // 10. CONFIRM THE CURRENT CONDITION STILL CLASSIFIES
  //     AS THE SAME NOTIFICATION TYPE
  //
  // MATERIAL_MOVE uses its original source event instead.
  // We intentionally do not let an old movement alert silently
  // become a different market event.
  // ==========================================================

  if (
    kind !==
    "MATERIAL_MOVE"
  ) {

    const currentClassification =
      classifyNotification({

        opportunityResult,
        summary,
        latestImportantEvent
      });


    if (
      !currentClassification
    ) {

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

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

      return cancelNotification({

        supabaseAdmin,
        notification,

        validatedAt,

        reason:
          `Notification condition changed to ${normalize(
            currentClassification.kind
          )}`
      });
    }
  }


  // ==========================================================
  // 11. BUILD CURRENT CONTENT
  //
  // For opportunity notifications, use latest market state.
  //
  // For MATERIAL_MOVE, preserve original event identity.
  // ==========================================================

  const currentSourceEvent =
    kind ===
      "MATERIAL_MOVE"
      ? sourceEvent
      : latestImportantEvent;


  const content =
    buildCurrentContent({

      kind,
      opportunityResult,

      sourceEvent:
        currentSourceEvent
    });


  const currentSnapshot =
    buildCurrentSnapshot({

      opportunityResult,
      summary,

      sourceEvent:
        currentSourceEvent
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
  // 12. REFRESH PAYLOAD
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
  // 13. UPDATE OUTBOX
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


  const {
    data: updated,
    error: updateError
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
      .select(`
        id,
        notification_kind,
        title,
        body,
        status,
        dispatch_enabled,
        payload,
        last_validated_at,
        expires_at
      `)
      .single();


  if (updateError) {
    throw updateError;
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
      updated
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  revalidateMarketNotification
};

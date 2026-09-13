const crypto =
  require("crypto");

const {
  calculateMarketOpportunity,
  safeNumber
} =
  require("./marketOpportunity");


// ============================================================
// DEFAULTS
//
// These are fallback values only.
// Every notification rule can override them through
// market_notification_rules.config.
// ============================================================

const DEFAULT_COOLDOWN_SECONDS = 900;

const DEFAULT_IMMEDIATE_EXPIRY_SECONDS = 600;

const DEFAULT_STALE_MIN_TOTAL_BOOKS = 3;

const DEFAULT_STALE_MIN_CONSENSUS_BOOKS = 2;

const DEFAULT_STALE_MIN_LINE_VALUE = 0.5;

const DEFAULT_VALUE_MIN_LINE = 0.5;

const DEFAULT_VALUE_MIN_PRICE_CENTS = 10;


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


function safeInteger(
  value,
  fallback
) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }


  return Math.max(
    0,
    Math.floor(number)
  );
}


function safeConfigNumber(
  config,
  key,
  fallback
) {

  const value =
    safeNumber(
      config?.[key]
    );


  return value === null
    ? fallback
    : value;
}


function addSeconds(
  iso,
  seconds
) {

  const base =
    new Date(iso)
      .getTime();


  return new Date(
    base +
    (
      Number(seconds || 0) *
      1000
    )
  )
    .toISOString();
}


function buildHash(value) {

  return crypto
    .createHash("sha256")
    .update(
      String(value || "")
    )
    .digest("hex")
    .slice(0, 24);
}


function buildNotificationKey({
  gameId,
  kind,
  fingerprint
}) {

  const raw =
    [
      "mi",
      gameId,
      kind,
      fingerprint
    ].join("|");


  return [
    "mi",
    normalize(kind)
      .toLowerCase(),
    buildHash(raw)
  ].join(":");
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

    return formattedPrice ||
      "current price";
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
// MATERIAL VALUE
// ============================================================

function isMaterialValue(
  opportunityResult,
  config = {}
) {

  const opportunity =
    opportunityResult
      ?.opportunity;


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
      opportunity.priceValueCents
    ) || 0;


  const minLine =
    safeConfigNumber(
      config,
      "minLineValue",
      DEFAULT_VALUE_MIN_LINE
    );


  const minPrice =
    safeConfigNumber(
      config,
      "minPriceValueCents",
      DEFAULT_VALUE_MIN_PRICE_CENTS
    );


  return (
    lineValue >= minLine ||
    priceValue >= minPrice
  );
}


// ============================================================
// STALE LINE DETECTION
//
// IMPORTANT:
//
// "Stale" here does NOT mean we claim the sportsbook
// definitely made a mistake.
//
// It means:
//
// - CashEdge Premium selection exists
// - market consensus is clear
// - enough books support the consensus
// - one sportsbook still offers a materially better line
//
// We do NOT say "X books moved" unless market history proves it.
// ============================================================

function isStaleLineOpportunity(
  opportunityResult,
  config = {}
) {

  const opportunity =
    opportunityResult
      ?.opportunity;


  const marketNow =
    opportunityResult
      ?.marketNow;


  const best =
    opportunityResult
      ?.bestLine;


  if (
    !opportunity ||
    !marketNow ||
    !best
  ) {
    return false;
  }


  if (
    opportunity.type !==
      "better_line"
  ) {
    return false;
  }


  if (
    opportunity.actionable !== true
  ) {
    return false;
  }


  const lineValue =
    safeNumber(
      opportunity.lineValue
    ) || 0;


  const totalBooks =
    safeInteger(
      marketNow.totalBooks,
      0
    );


  const consensusBooks =
    safeInteger(
      marketNow.booksAtLine,
      0
    );


  const minTotalBooks =
    safeInteger(
      config.minTotalBooks,
      DEFAULT_STALE_MIN_TOTAL_BOOKS
    );


  const minConsensusBooks =
    safeInteger(
      config.minConsensusBooks,
      DEFAULT_STALE_MIN_CONSENSUS_BOOKS
    );


  const minLineValue =
    safeConfigNumber(
      config,
      "minLineValue",
      DEFAULT_STALE_MIN_LINE_VALUE
    );


  return (
    lineValue >= minLineValue &&
    totalBooks >= minTotalBooks &&
    consensusBooks >= minConsensusBooks
  );
}


// ============================================================
// IMPORTANT MOVEMENT DETECTION
// ============================================================

function isMaterialMoveEvent(
  event
) {

  if (!event) {
    return false;
  }


  const level =
    Number(
      event.importance_level || 0
    );


  if (level < 2) {
    return false;
  }


  if (
    event.is_important_now !== true
  ) {
    return false;
  }


  const family =
    normalize(
      event.event_family
    );


  const type =
    normalize(
      event.event_type
    );


  return (
    family.includes(
      "MOVE"
    ) ||
    family.includes(
      "MOVEMENT"
    ) ||
    type.includes(
      "MOVE"
    ) ||
    type.includes(
      "MOVEMENT"
    )
  );
}


// ============================================================
// CLASSIFY CURRENT SITUATION
//
// Priority:
//
// 1. WINDOW_CLOSING
// 2. STALE_LINE
// 3. VALUE_AVAILABLE
// 4. MATERIAL_MOVE
//
// We intentionally prioritize actionable opportunity alerts
// over generic market-movement alerts.
// ============================================================

function classifyNotification({
  opportunityResult,
  summary,
  latestImportantEvent
}) {

  const opportunityState =
    normalize(
      summary
        ?.latest_opportunity_state
    );


  if (
    opportunityState ===
      "WINDOW_CLOSING" &&
    isMaterialValue(
      opportunityResult
    )
  ) {

    return {
      kind:
        "WINDOW_CLOSING",

      source:
        "opportunity"
    };
  }


  if (
    isStaleLineOpportunity(
      opportunityResult
    )
  ) {

    return {
      kind:
        "STALE_LINE",

      source:
        "opportunity"
    };
  }


  if (
    opportunityState ===
      "VALUE_AVAILABLE" &&
    isMaterialValue(
      opportunityResult
    )
  ) {

    return {
      kind:
        "VALUE_AVAILABLE",

      source:
        "opportunity"
    };
  }


  if (
    isMaterialMoveEvent(
      latestImportantEvent
    )
  ) {

    return {
      kind:
        "MATERIAL_MOVE",

      source:
        "market_event"
    };
  }


  return null;
}


// ============================================================
// PRIORITY
// ============================================================

function getPriority({
  kind,
  event
}) {

  if (
    kind === "STALE_LINE" ||
    kind === "WINDOW_CLOSING"
  ) {

    return "urgent";
  }


  if (
    kind === "MATERIAL_MOVE" &&
    Number(
      event
        ?.importance_level ||
      0
    ) >= 3
  ) {

    return "urgent";
  }


  if (
    kind === "VALUE_AVAILABLE" ||
    kind === "MATERIAL_MOVE"
  ) {

    return "high";
  }


  return "normal";
}


// ============================================================
// DEFAULT EXPIRATION
// ============================================================

function getExpirySeconds({
  kind,
  config
}) {

  const configured =
    safeInteger(
      config?.expirySeconds,
      0
    );


  if (
    configured > 0
  ) {
    return configured;
  }


  if (
    kind ===
    "MARKET_PULSE"
  ) {

    return 12 * 60 * 60;
  }


  return DEFAULT_IMMEDIATE_EXPIRY_SECONDS;
}


// ============================================================
// NOTIFICATION COPY
// ============================================================

function buildNotificationContent({
  kind,
  opportunityResult,
  latestImportantEvent
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


  const sportsbook =
    best.sportsbook ||
    best.sportsbookKey ||
    "A sportsbook";


  const bestNumber =
    formatMarketNumber({

      line:
        best.line,

      price:
        best.price,

      marketType
    });


  const marketNumber =
    formatMarketNumber({

      line:
        marketNow.line,

      price:
        marketNow.price,

      marketType
    });


  if (
    kind ===
    "STALE_LINE"
  ) {

    return {

      title:
        "🚨 BETTER LINE STILL AVAILABLE",

      body:
        `${pick}. ${sportsbook} still offers ${bestNumber} while the current market consensus is ${marketNumber}.`
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
        `${pick}. ${sportsbook} still offers ${bestNumber}, but the market advantage is shrinking.`
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
        `${pick}. ${sportsbook} currently offers ${bestNumber} versus market ${marketNumber}.`
    };
  }


  if (
    kind ===
    "MATERIAL_MOVE"
  ) {

    const direction =
      normalize(
        latestImportantEvent
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
      `${pick}. A new market update is available.`
  };
}


// ============================================================
// LOAD LATEST OPPORTUNITY EVENT
// ============================================================

async function loadLatestOpportunityEvent({
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
        event_family,
        event_type,
        direction,
        severity,
        event_data,
        importance_level,
        is_important_now,
        is_active,
        first_detected_at,
        last_detected_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "event_family",
        "opportunity"
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
        event_family,
        event_type,
        direction,
        severity,
        event_data,
        importance_level,
        is_important_now,
        is_active,
        first_detected_at,
        last_detected_at
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
// COOLDOWN CHECK
// ============================================================

async function isInsideCooldown({
  supabaseAdmin,
  gameId,
  kind,
  cooldownSeconds
}) {

  const seconds =
    safeInteger(
      cooldownSeconds,
      DEFAULT_COOLDOWN_SECONDS
    );


  if (
    seconds <= 0
  ) {
    return false;
  }


  const cutoff =
    new Date(
      Date.now() -
      (
        seconds *
        1000
      )
    )
      .toISOString();


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
        status,
        created_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
        "notification_kind",
        kind
      )
      .gte(
        "created_at",
        cutoff
      )
      .order(
        "created_at",
        {
          ascending:
            false
        }
      )
      .limit(1);


  if (error) {
    throw error;
  }


  return (
    Array.isArray(data) &&
    data.length > 0
  );
}


// ============================================================
// MAIN DECISION ENGINE
// ============================================================

async function evaluateNotificationDecision({

  supabaseAdmin,
  gameId

}) {

  if (
    !supabaseAdmin
  ) {
    throw new Error(
      "supabaseAdmin is required"
    );
  }


  if (
    !gameId
  ) {
    throw new Error(
      "gameId is required"
    );
  }


  const timestamp =
    nowIso();


  // ==========================================================
  // MARKET INTELLIGENCE SETTINGS
  //
  // notifications_enabled controls DISPATCH,
  // not whether we may evaluate decisions.
  //
  // This lets us later run the system in shadow mode:
  //
  // rules enabled + notifications_enabled false
  // = create shadow decisions without sending pushes.
  // ==========================================================

  const {
    data: intelligenceSettings,
    error: intelligenceSettingsError
  } =
    await supabaseAdmin
      .from(
        "market_intelligence_settings"
      )
      .select(`
        shadow_mode,
        notifications_enabled
      `)
      .eq(
        "id",
        1
      )
      .maybeSingle();


  if (
    intelligenceSettingsError
  ) {
    throw intelligenceSettingsError;
  }


  // ==========================================================
  // GLOBAL NOTIFICATION SETTINGS
  // ==========================================================

  const {
    data: notificationSettings,
    error: notificationSettingsError
  } =
    await supabaseAdmin
      .from(
        "market_notification_settings"
      )
      .select(`
        premium_only,
        immediate_daily_limit,
        digest_daily_limit,
        default_cooldown_seconds,
        revalidate_before_send
      `)
      .eq(
        "id",
        1
      )
      .maybeSingle();


  if (
    notificationSettingsError
  ) {
    throw notificationSettingsError;
  }


  // ==========================================================
  // CURRENT MARKET OPPORTUNITY
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

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "Market opportunity unavailable"
    };
  }


  // ==========================================================
  // GAME MUST CURRENTLY BE PREMIUM
  // ==========================================================

  if (
    opportunityResult
      ?.premium !== true
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "Game is not currently Premium"
    };
  }


  // ==========================================================
  // EVALUATION SUMMARY
  // ==========================================================

  const {
    data: summary,
    error: summaryError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .select(`
        id,
        cashedge_game_id,
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


  if (
    summaryError
  ) {
    throw summaryError;
  }


  if (!summary) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "Evaluation summary unavailable"
    };
  }


  // ==========================================================
  // SOURCE EVENTS
  // ==========================================================

  const [
    latestOpportunityEvent,
    latestImportantEvent
  ] =
    await Promise.all([

      loadLatestOpportunityEvent({
        supabaseAdmin,
        gameId
      }),

      loadLatestImportantEvent({
        supabaseAdmin,
        gameId
      })
    ]);


  // ==========================================================
  // CLASSIFY
  // ==========================================================

  const classification =
    classifyNotification({

      opportunityResult,
      summary,
      latestImportantEvent
    });


  if (!classification) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "No immediate notification-worthy condition"
    };
  }


  const kind =
    classification.kind;


  // ==========================================================
  // LOAD RULE
  // ==========================================================

  const {
    data: rule,
    error: ruleError
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


  if (
    ruleError
  ) {
    throw ruleError;
  }


  if (!rule) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      reason:
        "Notification rule not found"
    };
  }


  // ==========================================================
  // RULE DISABLED
  //
  // Right now every rule is false.
  // Therefore NOTHING will be inserted yet.
  // ==========================================================

  if (
    rule.enabled !== true
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      reason:
        "Notification rule disabled"
    };
  }


  const config =
    rule.config &&
    typeof rule.config ===
      "object"
      ? rule.config
      : {};


  // ==========================================================
  // RECHECK KIND-SPECIFIC THRESHOLD USING RULE CONFIG
  // ==========================================================

  if (
    kind ===
      "STALE_LINE" &&
    !isStaleLineOpportunity(
      opportunityResult,
      config
    )
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      reason:
        "Stale-line thresholds not met"
    };
  }


  if (
    (
      kind ===
        "VALUE_AVAILABLE" ||
      kind ===
        "WINDOW_CLOSING"
    ) &&
    !isMaterialValue(
      opportunityResult,
      config
    )
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      reason:
        "Material value thresholds not met"
    };
  }


  // ==========================================================
  // PREMIUM AUDIENCE
  //
  // If either global policy OR individual rule requires Premium,
  // audience remains Premium.
  //
  // Under current settings BOTH are true.
  // ==========================================================

  const premiumOnly =
    notificationSettings
      ?.premium_only === true ||
    rule.premium_only === true;


  const audience =
    premiumOnly
      ? "premium"
      : "all";


  // ==========================================================
  // COOLDOWN
  // ==========================================================

  const cooldownSeconds =
    safeInteger(
      rule.cooldown_seconds,
      safeInteger(
        notificationSettings
          ?.default_cooldown_seconds,
        DEFAULT_COOLDOWN_SECONDS
      )
    );


  const insideCooldown =
    await isInsideCooldown({

      supabaseAdmin,
      gameId,
      kind,
      cooldownSeconds
    });


  if (
    insideCooldown
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      reason:
        "Notification cooldown active"
    };
  }


  // ==========================================================
  // SELECT SOURCE EVENT
  // ==========================================================

  const sourceEvent =
    classification.source ===
      "market_event"
      ? latestImportantEvent
      : latestOpportunityEvent;


  const sourceEventId =
    sourceEvent?.id ||
    null;


  const sourceEventAt =
    sourceEvent
      ?.first_detected_at ||
    summary
      ?.opportunity_state_started_at ||
    timestamp;


  // ==========================================================
  // FINGERPRINT
  //
  // The active source event gives us a stable identity.
  // Same event = same key.
  // New event/state transition = new possible notification.
  // ==========================================================

  const fingerprint =
    sourceEventId
      ? `event:${sourceEventId}`
      : [
          kind,
          summary
            ?.opportunity_state_started_at ||
          summary
            ?.updated_at ||
          timestamp,

          opportunityResult
            ?.bestLine
            ?.sportsbookKey ||
          "",

          opportunityResult
            ?.bestLine
            ?.line ??
          "",

          opportunityResult
            ?.bestLine
            ?.price ??
          ""
        ].join("|");


  const notificationKey =
    buildNotificationKey({

      gameId,
      kind,
      fingerprint
    });


  // ==========================================================
  // EXACT DUPLICATE CHECK
  // ==========================================================

  const {
    data: existing,
    error: existingError
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .select(`
        id,
        status,
        created_at
      `)
      .eq(
        "notification_key",
        notificationKey
      )
      .maybeSingle();


  if (
    existingError
  ) {
    throw existingError;
  }


  if (existing) {

    return {
      ok: true,
      created: false,
      skipped: true,
      kind,
      notificationKey,
      reason:
        "Notification already exists"
    };
  }


  // ==========================================================
  // CONTENT
  // ==========================================================

  const content =
    buildNotificationContent({

      kind,
      opportunityResult,
      latestImportantEvent
    });


  const priority =
    getPriority({

      kind,
      event:
        sourceEvent
    });


  // ==========================================================
  // EXPIRATION
  // ==========================================================

  const expirySeconds =
    getExpirySeconds({

      kind,
      config
    });


  const expiresAt =
    addSeconds(
      timestamp,
      expirySeconds
    );


  // ==========================================================
  // REVALIDATION
  // ==========================================================

  const revalidationRequired =
    rule
      .revalidation_required ===
      true ||
    notificationSettings
      ?.revalidate_before_send ===
      true;


  // ==========================================================
  // DISPATCH MODE
  //
  // IMPORTANT:
  //
  // Even with a rule enabled later,
  // notifications_enabled=false means:
  //
  // status = shadow
  // dispatch_enabled = false
  //
  // This allows safe production observation before any push.
  // ==========================================================

  const dispatchEnabled =
    intelligenceSettings
      ?.notifications_enabled ===
      true;


  const status =
    dispatchEnabled
      ? "pending"
      : "shadow";


  // ==========================================================
  // PAYLOAD SNAPSHOT
  // ==========================================================

  const payload = {

    version:
      1,

    notificationKind:
      kind,

    deliveryClass:
      rule.delivery_class,

    audience,

    gameId,

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

    sourceEvent: sourceEvent
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
      : null,

    generatedAt:
      timestamp
  };


  // ==========================================================
  // INTERNAL DEEP LINK TARGET
  //
  // The actual Web / Android / iOS handling is built later.
  // Nothing is being sent yet.
  // ==========================================================

  const deepLink =
    `/premium-radar?game_id=${encodeURIComponent(
      gameId
    )}`;


  // ==========================================================
  // INSERT OUTBOX
  // ==========================================================

  const {
    data: inserted,
    error: insertError
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .insert({

        market_event_id:
          sourceEventId,

        cashedge_game_id:
          gameId,

        notification_key:
          notificationKey,

        notification_kind:
          kind,

        delivery_class:
          rule.delivery_class,

        audience,

        title:
          content.title,

        body:
          content.body,

        deep_link:
          deepLink,

        priority,

        expires_at:
          expiresAt,

        status,

        dispatch_enabled:
          dispatchEnabled,

        notification_provider:
          null,

        payload,

        revalidation_required:
          revalidationRequired,

        last_validated_at:
          null,

        attempt_count:
          0,

        next_attempt_at:
          dispatchEnabled
            ? timestamp
            : null,

        processing_started_at:
          null,

        lock_token:
          null,

        provider_message_id:
          null,

        cancelled_at:
          null,

        cancel_reason:
          null,

        source_event_at:
          sourceEventAt,

        created_at:
          timestamp,

        sent_at:
          null,

        error_message:
          null
      })
      .select(`
        id,
        notification_key,
        notification_kind,
        delivery_class,
        audience,
        title,
        body,
        priority,
        expires_at,
        status,
        dispatch_enabled,
        created_at
      `)
      .single();


  if (
    insertError
  ) {

    // Unique notification_key race protection.
    if (
      String(
        insertError.code ||
        ""
      ) === "23505"
    ) {

      return {

        ok: true,

        created: false,

        skipped:
          true,

        kind,

        notificationKey,

        reason:
          "Notification duplicate prevented"
      };
    }


    throw insertError;
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    ok:
      true,

    created:
      true,

    shadow:
      !dispatchEnabled,

    kind,

    notification:
      inserted
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  evaluateNotificationDecision,

  classifyNotification,

  isStaleLineOpportunity,

  isMaterialValue,

  isMaterialMoveEvent
};

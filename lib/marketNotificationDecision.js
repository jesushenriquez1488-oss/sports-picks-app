const crypto =
  require("crypto");

const {
  calculateMarketOpportunity,
  safeNumber
} =
  require("./marketOpportunity");


// ============================================================
// DEFAULTS
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
// BEST BOOKS HELPERS
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

    return books;
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


  if (names.length === 1) {
    return names[0];
  }


  if (names.length === 2) {

    return (
      `${names[0]} and ${names[1]}`
    );
  }


  return (
    `${names
      .slice(0, -1)
      .join(", ")} and ${
        names[names.length - 1]
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


        if (!price) {
          return name;
        }


        return `${name} ${price}`;
      }
    )
    .join(" · ");
}
// ============================================================
// FOOTBALL IMPORTANT SPREAD NUMBERS
//
// Used only by the Notification Materiality layer.
// Does NOT change CashEdge analysis, Opportunity Engine,
// Market Intelligence, or Confidence.
// ============================================================

const FOOTBALL_IMPORTANT_SPREAD_NUMBERS = [
  3,
  7,
  10,
  14,
  17,
  21,
  24,
  27,
  30,
  31,
  33,
  34,
  37
];


function getCrossedFootballImportantNumber({
  bestLine,
  marketLine
}) {

  const best =
    safeNumber(
      bestLine
    );

  const market =
    safeNumber(
      marketLine
    );


  if (
    best === null ||
    market === null
  ) {
    return null;
  }


  const low =
    Math.min(
      Math.abs(best),
      Math.abs(market)
    );

  const high =
    Math.max(
      Math.abs(best),
      Math.abs(market)
    );


  for (
    const importantNumber
    of FOOTBALL_IMPORTANT_SPREAD_NUMBERS
  ) {

    if (
      importantNumber >= low &&
      importantNumber <= high
    ) {
      return importantNumber;
    }
  }


  return null;
}
// ============================================================
// FOOTBALL SPREAD OPPORTUNITY MATERIALITY
//
// NFL / NCAAF notification rule:
//
// - 0.5 points alone is NOT notification material.
// - Minimum line advantage: 1.0 point.
// - Market must be clearly confirmed by multiple books.
// - Important football numbers add context / importance,
//   but do NOT create a push by themselves.
// ============================================================

function evaluateFootballSpreadOpportunityMateriality({
  opportunityResult,
  sport
}) {

  const sportKey =
    String(
      sport || ""
    )
      .trim()
      .toLowerCase();


  if (
    sportKey !== "nfl" &&
    sportKey !== "ncaaf"
  ) {

    return {
      applies: false,
      qualifies: false,
      reason:
        "Not an NFL/NCAAF opportunity"
    };
  }


  if (
    String(
      opportunityResult
        ?.marketType ||
      ""
    )
      .trim()
      .toLowerCase() !==
    "spread"
  ) {

    return {
      applies: false,
      qualifies: false,
      reason:
        "Not a football spread"
    };
  }


  const opportunity =
    opportunityResult
      ?.opportunity;


  if (
    !opportunity ||
    opportunity.actionable !== true ||
    opportunity.type !==
      "better_line"
  ) {

    return {
      applies: true,
      qualifies: false,
      reason:
        "No actionable better-line opportunity"
    };
  }


  const lineValue =
    safeNumber(
      opportunity.lineValue
    ) || 0;


  const marketNow =
    opportunityResult
      ?.marketNow ||
    {};


  const importantNumber =
    getCrossedFootballImportantNumber({

      bestLine:
        opportunityResult
          ?.bestLine
          ?.line,

      marketLine:
        marketNow.line
    });


  // Less than 0.5 is never enough.
  if (
    lineValue < 0.5
  ) {

    return {
      applies: true,
      qualifies: false,
      lineValue,
      importantNumber,
      reason:
        "Football spread advantage below 0.5 point"
    };
  }


  // A 0.5 advantage only matters when it reaches
  // or crosses an important football number.
  if (
    lineValue < 1.0 &&
    importantNumber === null
  ) {

    return {
      applies: true,
      qualifies: false,
      lineValue,
      importantNumber,
      reason:
        "0.5 football move does not reach or cross an important number"
    };
  }


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


  // Market must be confirmed by multiple sportsbooks.
  if (
    totalBooks < 3 ||
    consensusBooks < 2
  ) {

    return {
      applies: true,
      qualifies: false,
      lineValue,
      importantNumber,
      totalBooks,
      consensusBooks,
      reason:
        "Football market is not sufficiently confirmed"
    };
  }


  return {
    applies: true,
    qualifies: true,

    lineValue,

    totalBooks,
    consensusBooks,

    importantNumber,

    crossesImportantNumber:
      importantNumber !== null,

    reason:
      importantNumber !== null
        ? `Confirmed football opportunity crossing/reaching ${importantNumber}`
        : "Confirmed football opportunity with at least 1.0 point advantage"
  };
}
// ============================================================
// AMERICAN ODDS -> IMPLIED PROBABILITY
// ============================================================

function americanOddsToImpliedProbabilityPercent(
  value
) {

  const odds =
    safeNumber(
      value
    );


  if (
    odds === null ||
    odds === 0
  ) {
    return null;
  }


  if (odds < 0) {

    const absolute =
      Math.abs(odds);


    return (
      absolute /
      (
        absolute +
        100
      )
    ) * 100;
  }


  return (
    100 /
    (
      odds +
      100
    )
  ) * 100;
}


// ============================================================
// MLB MONEYLINE OPPORTUNITY MATERIALITY
//
// Run Line is blocked separately.
// MLB Total can still use the normal 0.5-point rule.
// Moneyline is evaluated in implied-probability points instead
// of raw American-odds cents.
// ============================================================

function evaluateMlbMoneylineOpportunityMateriality({
  opportunityResult,
  sport,
  config = {}
}) {

  const sportKey =
    String(
      sport || ""
    )
      .trim()
      .toLowerCase();


  const marketType =
    String(
      opportunityResult
        ?.marketType ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    sportKey !== "mlb" ||
    marketType !== "moneyline"
  ) {

    return {
      applies: false,
      qualifies: false,
      reason:
        "Not an MLB moneyline opportunity"
    };
  }


  const opportunity =
    opportunityResult
      ?.opportunity;


  if (
    !opportunity ||
    opportunity.actionable !== true
  ) {

    return {
      applies: true,
      qualifies: false,
      reason:
        "No actionable MLB moneyline opportunity"
    };
  }


  const marketProbability =
    americanOddsToImpliedProbabilityPercent(
      opportunityResult
        ?.marketNow
        ?.price
    );


  const bestProbability =
    americanOddsToImpliedProbabilityPercent(
      opportunityResult
        ?.bestLine
        ?.price
    );


  if (
    marketProbability === null ||
    bestProbability === null
  ) {

    return {
      applies: true,
      qualifies: false,
      reason:
        "MLB moneyline implied probability unavailable"
    };
  }


  const probabilityValuePP =
    Math.abs(
      marketProbability -
      bestProbability
    );


  const minProbabilityValuePP =
    safeConfigNumber(
      config,
      "minProbabilityValuePP",
      1.5
    );


  return {
    applies: true,

    qualifies:
      probabilityValuePP >=
      minProbabilityValuePP,

    probabilityValuePP,

    minProbabilityValuePP,

    reason:
      probabilityValuePP >=
      minProbabilityValuePP
        ? "MLB moneyline opportunity meets implied-probability threshold"
        : "MLB moneyline opportunity below implied-probability threshold"
  };
}


// ============================================================
// OPPORTUNITY NOTIFICATION MATERIALITY
//
// Central notification-only router.
// Does NOT change Opportunity Engine / Premium / Confidence.
// ============================================================

function evaluateOpportunityNotificationMateriality({
  opportunityResult,
  sport,
  config = {}
}) {

  const footballSpread =
    evaluateFootballSpreadOpportunityMateriality({

      opportunityResult,
      sport
    });


  if (
    footballSpread.applies ===
    true
  ) {
    return footballSpread;
  }


  const mlbMoneyline =
    evaluateMlbMoneylineOpportunityMateriality({

      opportunityResult,
      sport,
      config
    });


  if (
    mlbMoneyline.applies ===
    true
  ) {
    return mlbMoneyline;
  }


  const qualifies =
    isMaterialValue(
      opportunityResult,
      config
    );


  return {
    applies: true,
    qualifies,
    reason:
      qualifies
        ? "Opportunity meets current notification materiality threshold"
        : "Opportunity below current notification materiality threshold"
  };
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
      opportunity
        .priceValueCents
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
// This does NOT claim a sportsbook made a mistake.
//
// It means:
//
// - current CashEdge pick is Premium
// - market consensus is clear
// - enough books support that consensus
// - one OR MORE sportsbooks still offer the exact best line
// - that best line is materially better than consensus
//
// All books at the exact best line are preserved in bestBooks.
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


  const bestBooks =
    getBestBooks(
      opportunityResult
    );


  if (
    !opportunity ||
    !marketNow ||
    !best ||
    !bestBooks.length
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
// STRONG SHARP WITH CASHEDGE — PUSH MATERIALITY
//
// A Strong Sharp push requires:
//
// 1. Real Strong Sharp state.
// 2. Direction aligned WITH CashEdge.
// 3. Material market movement.
// 4. Multiple sportsbooks confirming the move.
// 5. At least one reference sportsbook participating.
//
// Money / Tickets evidence alone is NOT enough.
// ============================================================

function isStrongSharpWithCashEdgeEvent(
  event
) {

  if (!event) {
    return false;
  }


  if (
    normalize(
      event.event_family
    ) !== "SIGNAL"
  ) {
    return false;
  }


  if (
    normalize(
      event.event_type
    ) !== "STRONG_SHARP_SIGNAL"
  ) {
    return false;
  }


  if (
    normalize(
      event.direction
    ) !== "ALIGNED"
  ) {
    return false;
  }


  const data =
    event.event_data &&
    typeof event.event_data ===
      "object"
      ? event.event_data
      : {};


  const marketAlignment =
    normalize(
      data.alignment ||
      data.alignmentState ||
      data.alignment_state
    );


  // The actual sportsbook movement must be WITH CashEdge.
  if (
    marketAlignment !==
    "ALIGNED"
  ) {
    return false;
  }


  const lineMovement =
    Math.abs(
      safeNumber(
        data.lineMovement
      ) || 0
    );


  const probabilityMovement =
    Math.abs(
      safeNumber(
        data.impliedProbabilityMovementPP
      ) || 0
    );


  const hasMaterialMovement =
    lineMovement >= 0.5 ||
    probabilityMovement >= 1.5;


  if (!hasMaterialMovement) {
    return false;
  }


  const referenceAligned =
    safeInteger(
      data.referenceAligned,
      0
    );


  const retailAligned =
    safeInteger(
      data.retailAligned,
      0
    );


  const alignedBooks =
    referenceAligned +
    retailAligned;


  if (
    referenceAligned < 1 ||
    alignedBooks < 3
  ) {
    return false;
  }


  return true;
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
// CLASSIFY NOTIFICATION CANDIDATES
//
// Notification families are evaluated independently.
//
// This prevents:
// - Opportunity cooldown blocking Sharp
// - Sharp duplicate blocking Opportunity
// - one notification family hiding another
//
// IMPORTANT:
// This function only BUILDS candidates.
// It does not insert notifications.
// ============================================================

function classifyNotificationCandidates({
  opportunityResult,
  summary,
  latestImportantEvent,
  latestActiveSignalEvent,
  sport
}) {

  const candidates = [];


  // ==========================================================
  // 1. STRONG SHARP WITH CASHEDGE
  // ==========================================================

  if (
    isStrongSharpWithCashEdgeEvent(
      latestActiveSignalEvent
    )
  ) {

    candidates.push({
      kind:
        "STRONG_SHARP_WITH_CASHEDGE",

      source:
        "signal_event"
    });
  }


  // ==========================================================
  // 2. OPPORTUNITY DETECTED
  // ==========================================================

  const opportunityMateriality =
    evaluateOpportunityNotificationMateriality({

      opportunityResult,
      sport
    });


  if (
    opportunityMateriality
      .qualifies === true
  ) {

    candidates.push({
      kind:
        "OPPORTUNITY_DETECTED",

      source:
        "opportunity",

      materiality:
        opportunityMateriality
    });
  }


  // ==========================================================
  // 3. TEMPORARY LEGACY MATERIAL MOVE
  //
  // This stays only until MARKET_REVERSAL is implemented.
  // ==========================================================

  if (
    candidates.length === 0 &&
    isMaterialMoveEvent(
      latestImportantEvent
    )
  ) {

    candidates.push({
      kind:
        "MATERIAL_MOVE",

      source:
        "market_event"
    });
  }


  return candidates;
}


function classifyNotification({
  opportunityResult,
  summary,
  latestImportantEvent,
  latestActiveSignalEvent,
  sport
}) {

  const opportunityMateriality =
    evaluateOpportunityNotificationMateriality({

      opportunityResult,
      sport
    });


  // ==========================================================
  // OPPORTUNITY DETECTED
  //
  // STALE_LINE / VALUE_AVAILABLE / WINDOW_CLOSING remain useful
  // internal Market Intelligence states, but they are no longer
  // separate push-notification families.
  // ==========================================================

  if (
    opportunityMateriality
      .qualifies === true
  ) {

    return {
      kind:
        "OPPORTUNITY_DETECTED",

      source:
        "opportunity",

      materiality:
        opportunityMateriality
    };
  }


  // ==========================================================
  // TEMPORARY LEGACY MARKET MOVE
  // ==========================================================

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
    kind ===
      "STRONG_SHARP_WITH_CASHEDGE"
  ) {

    return "urgent";
  }


  if (
    kind ===
      "OPPORTUNITY_DETECTED"
  ) {

    return "high";
  }


  // Legacy notification families.
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


  const bestBooks =
    getBestBooks(
      opportunityResult
    );


  const bestBooksNames =
    formatBestBooksNames(
      opportunityResult
    );


  const bestBooksWithPrices =
    formatBestBooksWithPrices(
      opportunityResult
    );


  const bestNumber =
    formatMarketNumber({

      line:
        best.line,

      price:
        best.price,

      marketType
    });


  const bestLineOnly =
    marketType ===
      "moneyline"
      ? formatAmericanPrice(
          best.price
        )
      : formatLine(
          best.line
        );


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
    "OPPORTUNITY_DETECTED"
  ) {

    return {

      title:
        "🚨 OPPORTUNITY DETECTED",

      body:
        `${pick}. Market ${marketNumber}. Best available ${bestLineOnly} at ${bestBooksNames}. ${bestBooksWithPrices || ""}`.trim(),

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks
      }
    };
  }
  if (
    kind ===
    "STALE_LINE"
  ) {

    const bookWord =
      bestBooks.length === 1
        ? "sportsbook"
        : "sportsbooks";


    return {

      title:
        "🚨 BETTER LINE STILL AVAILABLE",

      body:
        `${pick}. Market ${marketNumber}. Best ${bestLineOnly} at ${bestBooksNames}. ${bestBooksWithPrices || ""}`.trim(),

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks,

        bookWord
      }
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
        `${pick}. ${bestBooksNames} still offer ${bestLineOnly}, but the market advantage is shrinking. ${bestBooksWithPrices || ""}`.trim(),

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks
      }
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
        `${pick}. Best available ${bestLineOnly} at ${bestBooksNames}. Market ${marketNumber}. ${bestBooksWithPrices || ""}`.trim(),

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks
      }
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
        `${pick}. Strong sharp action is confirmed by multiple sportsbooks moving with the CashEdge side. Open Premium Radar for the latest market state.`,

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks
      }
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
        `${pick}. ${movementText} Open Premium Radar for the latest market state.`,

      metadata: {

        bestBookCount:
          bestBooks.length,

        bestBooks
      }
    };
  }


  return {

    title:
      "CashEdge Market Intelligence",

    body:
      `${pick}. A new market update is available.`,

    metadata: {

      bestBookCount:
        bestBooks.length,

      bestBooks
    }
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
// LOAD LATEST ACTIVE SIGNAL EVENT
//
// Used by Sharp notification policy.
// We intentionally read the active SIGNAL event directly
// instead of assuming the latest important event is Sharp.
// ============================================================

async function loadLatestActiveSignalEvent({
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
        signal_strength,
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
        "event_family",
        "signal"
      )
      .eq(
        "is_active",
        true
      )
      .order(
        "last_detected_at",
        {
          ascending: false
        }
      )
      .limit(20);


  if (error) {
    throw error;
  }


  if (
    !Array.isArray(data) ||
    !data.length
  ) {
    return null;
  }


  return (
    data.find(
      event =>
        normalize(
          event.event_type
        ) ===
        "STRONG_SHARP_SIGNAL"
    ) ||
    null
  );
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
  // notifications_enabled controls actual dispatch.
  //
  // Rules can later be enabled while notifications_enabled
  // remains false so we can observe shadow decisions safely.
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
  // NOTIFICATION MARKET CONTEXT
  //
  // Notification policy is sport / market specific.
  // This does NOT modify Market Intelligence or Opportunity.
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
        gameId
      )
      .maybeSingle();


  if (
    notificationContextError
  ) {
    throw notificationContextError;
  }


  if (!notificationContext) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "Notification market context unavailable"
    };
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
  // but it must NEVER create a push notification.
  if (
    notificationSport === "mlb" &&
    notificationMarketType === "spread"
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "MLB Run Line notifications are disabled"
    };
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
    latestImportantEvent,
    latestActiveSignalEvent
  ] =
    await Promise.all([

      loadLatestOpportunityEvent({
        supabaseAdmin,
        gameId
      }),

      loadLatestImportantEvent({
        supabaseAdmin,
        gameId
      }),

      loadLatestActiveSignalEvent({
        supabaseAdmin,
        gameId
      })
    ]);

   // ==========================================================
  // CLASSIFY CANDIDATES
  // ==========================================================

  const candidates =
    classifyNotificationCandidates({

      opportunityResult,
      summary,
      latestImportantEvent,
      latestActiveSignalEvent,
      sport: notificationSport
    });


  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {

    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "No immediate notification-worthy condition"
    };
  }


  const candidateResults = [];
  const createdNotifications = [];


  const dispatchEnabled =
    intelligenceSettings
      ?.notifications_enabled ===
      true;


  const status =
    dispatchEnabled
      ? "pending"
      : "shadow";


  const bestBooks =
    getBestBooks(
      opportunityResult
    );


  // ==========================================================
  // PROCESS EACH FAMILY INDEPENDENTLY
  //
  // A disabled / duplicate / cooldown candidate must NOT block
  // another valid family for the same game.
  // ==========================================================

  for (
    const classification
    of candidates
  ) {

    const kind =
      classification.kind;


    // ========================================================
    // LOAD RULE
    // ========================================================

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


    if (ruleError) {
      throw ruleError;
    }


    if (!rule) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        reason:
          "Notification rule not found"
      });

      continue;
    }


    if (
      rule.enabled !== true
    ) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        reason:
          "Notification rule disabled"
      });

      continue;
    }


    const config =
      rule.config &&
      typeof rule.config ===
        "object"
        ? rule.config
        : {};


    // ========================================================
    // REVALIDATE CANDIDATE MATERIALITY BEFORE OUTBOX
    // ========================================================

        if (
      kind ===
        "OPPORTUNITY_DETECTED"
    ) {

      const currentOpportunityMateriality =
        evaluateOpportunityNotificationMateriality({

          opportunityResult,
          sport: notificationSport,
          config
        });


      if (
        currentOpportunityMateriality
          .qualifies !== true
      ) {

        candidateResults.push({
          kind,
          created: false,
          skipped: true,
          reason:
            "Opportunity is no longer notification-worthy"
        });

        continue;
      }
    }


    if (
      kind ===
        "STRONG_SHARP_WITH_CASHEDGE" &&
      !isStrongSharpWithCashEdgeEvent(
        latestActiveSignalEvent
      )
    ) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        reason:
          "Strong Sharp condition is no longer valid"
      });

      continue;
    }


    if (
      kind ===
        "MATERIAL_MOVE" &&
      !isMaterialMoveEvent(
        latestImportantEvent
      )
    ) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        reason:
          "Material move is no longer valid"
      });

      continue;
    }


    // ========================================================
    // PREMIUM AUDIENCE
    // ========================================================

    const premiumOnly =
      notificationSettings
        ?.premium_only === true ||
      rule.premium_only === true;


    const audience =
      premiumOnly
        ? "premium"
        : "all";


    // ========================================================
    // COOLDOWN — SAME GAME + SAME FAMILY
    // ========================================================

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


    if (insideCooldown) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        reason:
          "Notification cooldown active"
      });

      continue;
    }


    // ========================================================
    // SELECT SOURCE EVENT
    // ========================================================

    const sourceEvent =
      classification.source ===
        "signal_event"
        ? latestActiveSignalEvent
        : classification.source ===
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


    // ========================================================
    // FINGERPRINT
    // ========================================================

        const opportunityPriceValue =
      safeNumber(
        opportunityResult
          ?.opportunity
          ?.priceValueCents
      ) || 0;


    const opportunityPriceStep =
      Math.floor(
        opportunityPriceValue / 10
      ) * 10;


    const marketPrice =
      safeNumber(
        opportunityResult
          ?.marketNow
          ?.price
      );


    const bestPrice =
      safeNumber(
        opportunityResult
          ?.bestLine
          ?.price
      );


    const marketPriceStep =
      marketPrice === null
        ? ""
        : Math.round(
            marketPrice / 10
          ) * 10;


    const bestPriceStep =
      bestPrice === null
        ? ""
        : Math.round(
            bestPrice / 10
          ) * 10;


    const fingerprint =
      kind ===
        "OPPORTUNITY_DETECTED"
        ? [
            kind,

            opportunityResult
              ?.marketType ||
            "",

            opportunityResult
              ?.selectionKey ||
            "",

            opportunityResult
              ?.opportunity
              ?.type ||
            "",

            // New lifecycle = genuinely reopened opportunity.
            summary
              ?.opportunity_state_started_at ||
            "",

            opportunityResult
              ?.marketNow
              ?.line ??
            "",

            opportunityResult
              ?.bestLine
              ?.line ??
            "",

            // Avoid 1-2 cent noise, but preserve real price steps.
            marketPriceStep,

            bestPriceStep,

            opportunityPriceStep
          ].join("|")

        : sourceEventId
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
                ?.line ??
              "",

              opportunityResult
                ?.bestLine
                ?.price ??
              "",

              getBestBooks(
                opportunityResult
              )
                .map(
                  book =>
                    book.sportsbookKey ||
                    book.sportsbook ||
                    ""
                )
                .sort()
                .join(",")
            ].join("|");


    const notificationKey =
      buildNotificationKey({

        gameId,
        kind,
        fingerprint
      });


    // ========================================================
    // EXACT DUPLICATE CHECK
    // ========================================================

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


    if (existingError) {
      throw existingError;
    }


    if (existing) {

      candidateResults.push({
        kind,
        created: false,
        skipped: true,
        notificationKey,
        reason:
          "Notification already exists"
      });

      continue;
    }


    // ========================================================
    // CONTENT / PRIORITY / EXPIRATION
    // ========================================================

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


    const revalidationRequired =
      rule
        .revalidation_required ===
        true ||
      notificationSettings
        ?.revalidate_before_send ===
        true;


    // ========================================================
    // PAYLOAD SNAPSHOT
    // ========================================================

    const payload = {

      version:
        2,

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

      bestBooks,

      bestBookCount:
        bestBooks.length,

      notificationMetadata:
        content.metadata ||
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


    // ========================================================
    // INTERNAL DEEP LINK TARGET
    // ========================================================

    const deepLink =
      `/premium-radar?game_id=${encodeURIComponent(
        gameId
      )}`;


    // ========================================================
    // INSERT OUTBOX
    // ========================================================

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


    if (insertError) {

      if (
        String(
          insertError.code ||
          ""
        ) === "23505"
      ) {

        candidateResults.push({
          kind,
          created: false,
          skipped: true,
          notificationKey,
          reason:
            "Notification duplicate prevented"
        });

        continue;
      }


      throw insertError;
    }


    createdNotifications.push(
      inserted
    );


    candidateResults.push({
      kind,
      created: true,
      skipped: false,
      notificationKey,
      notification:
        inserted
    });
  }


  // ==========================================================
  // FINAL RESULT
  // ==========================================================

  if (
    createdNotifications.length > 0
  ) {

    return {

      ok: true,

      created: true,

      shadow:
        !dispatchEnabled,

      kind:
        createdNotifications[0]
          ?.notification_kind ||
        null,

      kinds:
        createdNotifications
          .map(
            row =>
              row.notification_kind
          ),

      bestBooks,

      notifications:
        createdNotifications,

      candidates:
        candidateResults
    };
  }


  return {

    ok: true,

    created: false,

    skipped: true,

    candidates:
      candidateResults,

    reason:
      "No notification candidate created"
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  evaluateNotificationDecision,

  classifyNotification,

  classifyNotificationCandidates,

  isStrongSharpWithCashEdgeEvent,

  isStaleLineOpportunity,

  isMaterialValue,

  isMaterialMoveEvent,

  isInsideCooldown
};

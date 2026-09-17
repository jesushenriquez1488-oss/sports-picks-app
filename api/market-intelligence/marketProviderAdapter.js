// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// PROVIDER-NEUTRAL MARKET QUOTE ADAPTER
// ============================================================
//
// Every external odds provider must eventually be converted
// into this canonical CashEdge contract.
//
// IMPORTANT:
// - No provider-specific business logic belongs in ingest-quote.js.
// - Provider adapters normalize only.
// - Market Intelligence decides meaning AFTER normalization.
// ============================================================


function safeText(value) {
  const text =
    String(value ?? "").trim();

  return text || null;
}


function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function safeAmericanPrice(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number);
}


function normalizeMarketType(value) {
  const marketType =
    safeText(value)
      ?.toLowerCase();

  if (
    marketType === "moneyline" ||
    marketType === "spread" ||
    marketType === "total"
  ) {
    return marketType;
  }

  return null;
}


function normalizeProviderTimestamp(value) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toISOString();
}


// ============================================================
// CANONICAL CASHEDGE QUOTE
// ============================================================

function buildCanonicalMarketQuote({
  sport,
  cashedgeGameId,

  provider,
  providerEventId,

  sportsbookKey,
  sportsbookName,

  marketType,

  selectionKey,
  selectionName,

  line,
  priceAmerican,

  providerTimestamp,

  rawPayload = null
}) {
  const normalizedMarketType =
    normalizeMarketType(
      marketType
    );

  let normalizedLine =
    safeNumber(line);

  /*
   * Moneyline has no spread/total line.
   *
   * Example:
   * Yankees ML -125
   *
   * line = null
   * price_american = -125
   */
  if (
    normalizedMarketType ===
    "moneyline"
  ) {
    normalizedLine = null;
  }

  return {
    sport:
      safeText(sport)
        ?.toLowerCase() ||
      null,

    cashedge_game_id:
      safeText(
        cashedgeGameId
      ),

    provider:
      safeText(provider),

    provider_event_id:
      safeText(
        providerEventId
      ),

    sportsbook_key:
      safeText(
        sportsbookKey
      )
        ?.toLowerCase() ||
      null,

    sportsbook_name:
      safeText(
        sportsbookName
      ),

    market_type:
      normalizedMarketType,

    selection_key:
      safeText(
        selectionKey
      )
        ?.toLowerCase() ||
      null,

    selection_name:
      safeText(
        selectionName
      ),

    line:
      normalizedLine,

    price_american:
      safeAmericanPrice(
        priceAmerican
      ),

    provider_timestamp:
      normalizeProviderTimestamp(
        providerTimestamp
      ),

    raw_payload:
      rawPayload
  };
}


// ============================================================
// VALIDATION
// ============================================================

function validateCanonicalMarketQuote(
  quote
) {
  const errors = [];

  if (!quote?.sport) {
    errors.push("sport");
  }

  if (!quote?.cashedge_game_id) {
    errors.push(
      "cashedge_game_id"
    );
  }

  if (!quote?.provider) {
    errors.push("provider");
  }

  if (!quote?.sportsbook_key) {
    errors.push(
      "sportsbook_key"
    );
  }

  if (!quote?.market_type) {
    errors.push(
      "market_type"
    );
  }

  if (!quote?.selection_key) {
    errors.push(
      "selection_key"
    );
  }

  if (
    quote?.price_american ===
    null
  ) {
    errors.push(
      "price_american"
    );
  }

  if (
    quote?.market_type !==
      "moneyline" &&
    quote?.line === null
  ) {
    errors.push("line");
  }

  return {
    valid:
      errors.length === 0,

    missing:
      errors
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  buildCanonicalMarketQuote,
  validateCanonicalMarketQuote
};

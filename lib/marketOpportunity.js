function safeNumber(value) {
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


function americanToCents(odds) {

  const n =
    safeNumber(odds);

  if (n === null) {
    return null;
  }

  return n < 0
    ? n + 100
    : n - 100;
}


function priceCentsBetter(
  betterPrice,
  referencePrice
) {

  const better =
    americanToCents(
      betterPrice
    );

  const reference =
    americanToCents(
      referencePrice
    );

  if (
    better === null ||
    reference === null
  ) {
    return null;
  }

  return Number(
    (
      better -
      reference
    ).toFixed(2)
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


function americanToProbability(
  odds
) {

  const n =
    safeNumber(odds);


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


function probabilityToAmerican(
  probability
) {

  const p =
    safeNumber(
      probability
    );


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


function betterAmericanPrice(
  candidate,
  current
) {

  const a =
    safeNumber(candidate);

  const b =
    safeNumber(current);


  if (a === null) {
    return false;
  }


  if (b === null) {
    return true;
  }


  return (
    americanToCents(a) >
    americanToCents(b)
  );
}


function isBetterQuote(
  candidate,
  best,
  marketType,
  selectionKey
) {

  if (!best) {
    return true;
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType ===
    "moneyline"
  ) {

    return betterAmericanPrice(
      candidate.price_american,
      best.price_american
    );
  }


  const candidateLine =
    safeNumber(
      candidate.line
    );

  const bestLine =
    safeNumber(
      best.line
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
    marketType ===
    "total"
  ) {

    // UNDER:
    // Higher number is better.
    if (
      selectionKey ===
      "under"
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
    }


    // OVER:
    // Lower number is better.
    if (
      selectionKey ===
      "over"
    ) {

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


    return betterAmericanPrice(
      candidate.price_american,
      best.price_american
    );
  }


  // ==========================================================
  // SPREAD
  //
  // +3.5 > +3
  // -2.5 > -3.5
  // ==========================================================

  if (
    marketType ===
    "spread"
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


    return betterAmericanPrice(
      candidate.price_american,
      best.price_american
    );
  }


  return false;
}


function calculateConsensus(
  quotes,
  marketType
) {

  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType ===
    "moneyline"
  ) {

    const probabilities =
      quotes
        .map(
          quote =>
            americanToProbability(
              quote
                .price_american
            )
        )
        .filter(
          Number.isFinite
        );


    if (
      !probabilities.length
    ) {
      return null;
    }


    const medianProbability =
      median(
        probabilities
      );


    return {

      status:
        "clear",

      line:
        null,

      price:
        probabilityToAmerican(
          medianProbability
        ),

      books:
        probabilities.length
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
      safeNumber(
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


  const distribution =
    Array
      .from(
        groups.values()
      )
      .map(
        group => {

          const prices =
            group
              .quotes
              .map(
                quote =>
                  safeNumber(
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
                    median(
                      prices
                    )
                  )
                : null
          };
        }
      );


  if (
    !distribution.length
  ) {
    return null;
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


  if (
    leaders.length !== 1
  ) {

    return {

      status:
        "split",

      line:
        null,

      price:
        null,

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

      booksPerLine:
        maxBooks,

      totalBooks:
        quotes.length
    };
  }


  return {

    status:
      "clear",

    line:
      leaders[0]
        .line,

    price:
      leaders[0]
        .price,

    booksAtLine:
      leaders[0]
        .books,

    totalBooks:
      quotes.length
  };
}


function calculateLineAdvantage(
  bestLine,
  marketLine,
  marketType,
  selectionKey
) {

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


  let value = 0;


  if (
    marketType ===
    "total"
  ) {

    if (
      selectionKey ===
      "under"
    ) {

      value =
        best -
        market;
    }


    if (
      selectionKey ===
      "over"
    ) {

      value =
        market -
        best;
    }
  }


  if (
    marketType ===
    "spread"
  ) {

    value =
      best -
      market;
  }


  return Math.max(
    0,

    Number(
      value
        .toFixed(2)
    )
  );
}


// ============================================================
// MAIN SHARED OPPORTUNITY ENGINE
// ============================================================

async function calculateMarketOpportunity({

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
      .select(`
        sport,
        cashedge_game_id,
        canonical_pick,
        market_type,
        selection_key,
        first_premium_line,
        first_premium_price_american,
        current_cashedge_line,
        current_cashedge_price_american,
        current_confidence,
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


  if (!context) {

    return {
      ok: false,
      statusCode: 404,
      error:
        "Game not found"
    };
  }


  if (
    context
      .current_is_premium !==
    true
  ) {

    return {

      ok: true,

      premium:
        false,

      opportunity:
        null
    };
  }


  const marketType =
    String(
      context.market_type ||
      ""
    )
      .toLowerCase();


  const selectionKey =
    String(
      context.selection_key ||
      ""
    )
      .toLowerCase();


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
        market_type,
        selection_key,
        selection_name,
        line,
        price_american,
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
          safeNumber(
            quote
              .price_american
          ) !== null
      );


  if (!quotes.length) {

    return {

      ok: true,

      premium:
        true,

      pick:
        context
          .canonical_pick,

      opportunity:
        null,

      message:
        "No sportsbook quotes available yet"
    };
  }


  // ==========================================================
  // BEST QUOTE
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

      best =
        quote;
    }
  }


  // ==========================================================
  // MARKET NOW
  // ==========================================================

  const consensus =
    calculateConsensus(
      quotes,
      marketType
    );


  if (!consensus) {

    return {

      ok: true,

      premium:
        true,

      pick:
        context
          .canonical_pick,

      bestLine:
        best,

      opportunity:
        null,

      message:
        "Unable to calculate market consensus"
    };
  }


  // ==========================================================
  // SPLIT MARKET
  // ==========================================================

  if (
    consensus.status ===
    "split"
  ) {

    return {

      ok: true,

      premium:
        true,

      pick:
        context
          .canonical_pick,

      confidence:
        context
          .current_confidence,

      marketType,
      selectionKey,

      marketNow: {

        status:
          "split",

        lines:
          consensus
            .splitLines,

        totalBooks:
          consensus
            .totalBooks
      },

      bestLine: {

        sportsbookKey:
          best
            .sportsbook_key,

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
      },

      opportunity: {

        type:
          "split_market",

        actionable:
          false,

        headline:
          "MARKET SPLIT",

        explanation:
          "Sportsbooks are currently divided between multiple market lines."
      }
    };
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    marketType ===
    "moneyline"
  ) {

    const centsBetter =
      priceCentsBetter(
        best
          .price_american,

        consensus.price
      );


    const hasValue =
      centsBetter !== null &&
      centsBetter > 0;


    return {

      ok: true,

      premium:
        true,

      pick:
        context
          .canonical_pick,

      confidence:
        context
          .current_confidence,

      marketType,
      selectionKey,

      cashedgeFound: {

        line:
          null,

        price:
          context
            .first_premium_price_american
      },

      marketNow: {

        line:
          null,

        price:
          consensus.price,

        books:
          consensus.books
      },

      bestLine: {

        sportsbookKey:
          best
            .sportsbook_key,

        sportsbook:
          best
            .sportsbook_name ||
          best
            .sportsbook_key,

        line:
          null,

        price:
          best
            .price_american
      },

      opportunity: {

        type:
          hasValue
            ? "better_price"
            : "market_equal",

        actionable:
          hasValue,

        lineValue:
          null,

        priceValueCents:
          hasValue
            ? centsBetter
            : 0,

        headline:
          hasValue
            ? `${centsBetter}¢ BETTER PRICE`
            : "AT MARKET PRICE",

        explanation:
          hasValue
            ? `${best.sportsbook_name || best.sportsbook_key} currently offers the best Moneyline price.`
            : "The best available Moneyline is currently close to the market price."
      }
    };
  }


  // ==========================================================
  // SPREAD / TOTAL
  // ==========================================================

  const lineValue =
    calculateLineAdvantage(
      best.line,
      consensus.line,
      marketType,
      selectionKey
    );


  const sameLine =
    safeNumber(
      best.line
    ) ===
    safeNumber(
      consensus.line
    );


  // Price only matters at identical line.
  const centsBetter =
    sameLine
      ? priceCentsBetter(
          best
            .price_american,

          consensus.price
        )
      : null;


  const hasLineValue =
    lineValue !== null &&
    lineValue > 0;


  const hasPriceValue =
    sameLine &&
    centsBetter !== null &&
    centsBetter > 0;


  let type =
    "market_equal";


  let headline =
    "AT MARKET";


  let explanation =
    "The best available number is currently aligned with the market.";


  if (hasLineValue) {

    type =
      "better_line";


    headline =
      `${lineValue} POINT${
        lineValue === 1
          ? ""
          : "S"
      } BETTER`;


    explanation =
      `${best.sportsbook_name || best.sportsbook_key} still offers a better number than the current market.`;

  } else if (
    hasPriceValue
  ) {

    type =
      "better_price";


    headline =
      `${centsBetter}¢ BETTER PRICE`;


    explanation =
      `${best.sportsbook_name || best.sportsbook_key} has the same line as the market but a better price.`;
  }


  return {

    ok: true,

    premium:
      true,

    pick:
      context
        .canonical_pick,

    confidence:
      context
        .current_confidence,

    marketType,
    selectionKey,

    cashedgeFound: {

      line:
        context
          .first_premium_line,

      price:
        context
          .first_premium_price_american
    },

    marketNow: {

      line:
        consensus.line,

      price:
        consensus.price,

      booksAtLine:
        consensus
          .booksAtLine,

      totalBooks:
        consensus
          .totalBooks
    },

    bestLine: {

      sportsbookKey:
        best
          .sportsbook_key,

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
    },

    opportunity: {

      type,

      actionable:
        (
          hasLineValue ||
          hasPriceValue
        ),

      lineValue:
        hasLineValue
          ? lineValue
          : 0,

      priceValueCents:
        hasPriceValue
          ? centsBetter
          : 0,

      headline,

      explanation
    }
  };
}


module.exports = {

  calculateMarketOpportunity,

  safeNumber,
  priceCentsBetter,
  calculateLineAdvantage
};

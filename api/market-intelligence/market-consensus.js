const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// SECURITY
// ============================================================

function secureEqual(
  supplied,
  expected
) {

  if (
    !supplied ||
    !expected
  ) {
    return false;
  }


  const a =
    crypto
      .createHash("sha256")
      .update(
        String(supplied)
      )
      .digest();


  const b =
    crypto
      .createHash("sha256")
      .update(
        String(expected)
      )
      .digest();


  return crypto
    .timingSafeEqual(
      a,
      b
    );
}


// ============================================================
// HELPERS
// ============================================================

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


// ============================================================
// AMERICAN ODDS → IMPLIED PROBABILITY
// ============================================================

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


  if (
    n < 0
  ) {

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
// IMPLIED PROBABILITY → AMERICAN ODDS
// ============================================================

function probabilityToAmerican(
  prob
) {

  const p =
    safeNumber(prob);


  if (
    p === null ||
    p <= 0 ||
    p >= 1
  ) {
    return null;
  }


  if (
    p >= 0.5
  ) {

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


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    if (
      req.method !== "GET"
    ) {

      res.setHeader(
        "Allow",
        "GET"
      );


      return res
        .status(405)
        .json({
          ok: false,
          error:
            "GET required"
        });
    }


    try {

      // ======================================================
      // SERVER-ONLY AUTH
      //
      // MARKET_PIPELINE_SECRET only.
      // No query-string secrets.
      // ======================================================

      const expectedSecret =
        process.env
          .MARKET_PIPELINE_SECRET;


      if (!expectedSecret) {

        return res
          .status(500)
          .json({
            ok: false,
            error:
              "MARKET_PIPELINE_SECRET is not configured"
          });
      }


      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );


      const bearer =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader
              .slice(7)
              .trim()
          : "";


      if (
        !secureEqual(
          bearer,
          expectedSecret
        )
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // GAME
      //
      // game_id may stay in query string.
      // It is not a secret.
      // ======================================================

      const gameId =
        String(
          req.query.game_id ||
          ""
        )
          .trim();


      if (!gameId) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "game_id is required"
          });
      }


      // ======================================================
      // CASHEDGE PREMIUM CONTEXT
      // ======================================================

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


      if (
        contextError
      ) {
        throw contextError;
      }


      if (
        !context
      ) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Game not found in Market Intelligence"
          });
      }


      if (
        context.current_is_premium !== true
      ) {

        return res
          .status(200)
          .json({
            ok: true,
            premium: false,
            marketNow: null
          });
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


      // ======================================================
      // CURRENT SPORTSBOOK QUOTES
      // ======================================================

      const {
        data: quotes,
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


      if (
        quoteError
      ) {
        throw quoteError;
      }


      const validQuotes =
        (quotes || [])
          .filter(
            quote =>
              safeNumber(
                quote.price_american
              ) !== null
          );


      if (
        !validQuotes.length
      ) {

        return res
          .status(200)
          .json({
            ok: true,

            premium: true,

            pick:
              context.canonical_pick,

            confidence:
              context.current_confidence,

            marketType,
            selectionKey,

            marketNow: null,

            message:
              "No sportsbook quotes available yet"
          });
      }


      // ======================================================
      // MONEYLINE CONSENSUS
      // ======================================================

      if (
        marketType === "moneyline"
      ) {

        const probabilities =
          validQuotes
            .map(
              quote =>
                americanToProbability(
                  quote.price_american
                )
            )
            .filter(
              Number.isFinite
            );


        const medianProbability =
          median(
            probabilities
          );


        const consensusPrice =
          probabilityToAmerican(
            medianProbability
          );


        return res
          .status(200)
          .json({
            ok: true,

            premium: true,

            pick:
              context.canonical_pick,

            confidence:
              context.current_confidence,

            marketType,
            selectionKey,

            marketNow: {

              status:
                "clear",

              line:
                null,

              price:
                consensusPrice,

              books:
                validQuotes.length,

              impliedProbability:
                medianProbability === null
                  ? null
                  : Number(
                      (
                        medianProbability *
                        100
                      )
                        .toFixed(2)
                    )
            },

            distribution:
              validQuotes.map(
                quote => ({

                  sportsbook:
                    quote.sportsbook_name ||
                    quote.sportsbook_key,

                  price:
                    quote.price_american
                })
              )
          });
      }


      // ======================================================
      // SPREAD / TOTAL
      // ======================================================

      const lineQuotes =
        validQuotes
          .filter(
            quote =>
              safeNumber(
                quote.line
              ) !== null
          );


      if (
        !lineQuotes.length
      ) {

        return res
          .status(200)
          .json({
            ok: true,

            premium: true,

            pick:
              context.canonical_pick,

            marketType,
            selectionKey,

            marketNow: null,

            message:
              "No valid market lines available"
          });
      }


      // ======================================================
      // GROUP BOOKS BY LINE
      // ======================================================

      const groups =
        new Map();


      for (
        const quote
        of lineQuotes
      ) {

        const line =
          Number(
            quote.line
          );


        const key =
          String(line);


        if (
          !groups.has(
            key
          )
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
                group.quotes
                  .map(
                    quote =>
                      safeNumber(
                        quote.price_american
                      )
                  )
                  .filter(
                    Number.isFinite
                  );


              return {

                line:
                  group.line,

                books:
                  group.quotes.length,

                representativePrice:
                  Math.round(
                    median(prices)
                  ),

                sportsbooks:
                  group.quotes
                    .map(
                      quote =>
                        quote.sportsbook_name ||
                        quote.sportsbook_key
                    )
              };
            }
          )
          .sort(
            (a, b) => {

              if (
                b.books !==
                a.books
              ) {

                return (
                  b.books -
                  a.books
                );
              }


              return (
                a.line -
                b.line
              );
            }
          );


      // ======================================================
      // DETERMINE MARKET MODE
      // ======================================================

      const maxBooks =
        Math.max(
          ...distribution.map(
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


      // ======================================================
      // CLEAR CONSENSUS
      // ======================================================

      if (
        leaders.length === 1
      ) {

        const winner =
          leaders[0];


        const firstLine =
          safeNumber(
            context
              .first_premium_line
          );


        const currentCashEdgeLine =
          safeNumber(
            context
              .current_cashedge_line
          );


        return res
          .status(200)
          .json({
            ok: true,

            premium: true,

            pick:
              context.canonical_pick,

            confidence:
              context.current_confidence,

            marketType,
            selectionKey,

            marketNow: {

              status:
                "clear",

              line:
                winner.line,

              price:
                winner
                  .representativePrice,

              booksAtLine:
                winner.books,

              totalBooks:
                lineQuotes.length,

              movementFromCashEdgeFound:
                firstLine === null
                  ? null
                  : Number(
                      (
                        winner.line -
                        firstLine
                      )
                        .toFixed(2)
                    ),

              movementFromCurrentCashEdge:
                currentCashEdgeLine === null
                  ? null
                  : Number(
                      (
                        winner.line -
                        currentCashEdgeLine
                      )
                        .toFixed(2)
                    )
            },

            distribution
          });
      }


      // ======================================================
      // SPLIT MARKET
      //
      // Example:
      //
      // 2 books = 7.5
      // 2 books = 8.0
      //
      // We DO NOT invent 7.75.
      // ======================================================

      return res
        .status(200)
        .json({
          ok: true,

          premium: true,

          pick:
            context.canonical_pick,

          confidence:
            context.current_confidence,

          marketType,
          selectionKey,

          marketNow: {

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

            booksPerLeadingLine:
              maxBooks,

            totalBooks:
              lineQuotes.length
          },

          distribution
        });


    } catch (error) {

      console.error(
        "MARKET CONSENSUS ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  };

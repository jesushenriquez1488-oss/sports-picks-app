const { createClient } =
  require("@supabase/supabase-js");

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


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

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function betterAmericanPrice(
  candidate,
  current
) {
  /*
   * With American odds, the numerically larger value
   * is always the better payout:
   *
   * -105 > -120
   * +120 > +105
   * +105 > -110
   */

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

  return a > b;
}


// ============================================================
// QUOTE COMPARISON
// ============================================================

function isBetterQuote(
  candidate,
  currentBest,
  marketType,
  selectionKey
) {

  if (!currentBest) {
    return true;
  }


  const candidatePrice =
    safeNumber(
      candidate.price_american
    );

  const bestPrice =
    safeNumber(
      currentBest.price_american
    );


  // ==========================================================
  // MONEYLINE
  // Only price matters.
  // ==========================================================

  if (
    marketType === "moneyline"
  ) {

    return betterAmericanPrice(
      candidatePrice,
      bestPrice
    );
  }


  const candidateLine =
    safeNumber(candidate.line);

  const bestLine =
    safeNumber(
      currentBest.line
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
  //
  // UNDER:
  // 8.5 is better than 8.0
  //
  // OVER:
  // 8.0 is better than 8.5
  // ==========================================================

  if (
    marketType === "total"
  ) {

    if (
      selectionKey === "under"
    ) {

      if (
        candidateLine > bestLine
      ) {
        return true;
      }

      if (
        candidateLine < bestLine
      ) {
        return false;
      }
    }


    if (
      selectionKey === "over"
    ) {

      if (
        candidateLine < bestLine
      ) {
        return true;
      }

      if (
        candidateLine > bestLine
      ) {
        return false;
      }
    }


    // Same total line:
    // better price wins.

    return betterAmericanPrice(
      candidatePrice,
      bestPrice
    );
  }


  // ==========================================================
  // SPREAD / RUNLINE
  //
  // Bigger number is always more favorable
  // for the selected side.
  //
  // +3.5 > +3
  // -2.5 > -3.5
  // ==========================================================

  if (
    marketType === "spread"
  ) {

    if (
      candidateLine > bestLine
    ) {
      return true;
    }

    if (
      candidateLine < bestLine
    ) {
      return false;
    }


    // Same spread:
    // better price wins.

    return betterAmericanPrice(
      candidatePrice,
      bestPrice
    );
  }


  return false;
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
      // SECURITY
      // ======================================================

      const secret =
        String(
          req.query.secret || ""
        );

      const validSecret =
        process.env.CRON_SECRET ||
        process.env.GENERATE_DAILY_SECRET;

      if (!validSecret) {
        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Missing server secret"
          });
      }


      if (
        secret !== validSecret
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
      // ======================================================

      const gameId =
        String(
          req.query.game_id || ""
        ).trim();


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
      // GET CASHEDGE PREMIUM CONTEXT
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


      if (contextError) {
        throw contextError;
      }


      if (!context) {
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
            tracked: true,
            premium: false,
            bestLine: null
          });
      }


      const marketType =
        String(
          context.market_type || ""
        ).toLowerCase();

      const selectionKey =
        String(
          context.selection_key || ""
        ).toLowerCase();


      // ======================================================
      // GET ALL SPORTSBOOK QUOTES
      // FOR THIS EXACT PREMIUM SELECTION
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
            provider,
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


      if (quoteError) {
        throw quoteError;
      }


      const validQuotes =
        (quotes || [])
          .filter(
            quote => {

              const price =
                safeNumber(
                  quote.price_american
                );

              if (
                price === null
              ) {
                return false;
              }


              if (
                marketType ===
                "moneyline"
              ) {
                return true;
              }


              return (
                safeNumber(
                  quote.line
                ) !== null
              );
            }
          );


      // ======================================================
      // NO MARKET DATA YET
      // ======================================================

      if (
        validQuotes.length === 0
      ) {
        return res
          .status(200)
          .json({
            ok: true,

            tracked: true,
            premium: true,

            pick:
              context.canonical_pick,

            marketType,
            selectionKey,

            confidence:
              context.current_confidence,

            bestLine: null,

            message:
              "No sportsbook quotes available yet"
          });
      }


      // ======================================================
      // FIND BEST
      // ======================================================

      let best = null;

      for (
        const quote
        of validQuotes
      ) {

        if (
          isBetterQuote(
            quote,
            best,
            marketType,
            selectionKey
          )
        ) {
          best = quote;
        }
      }


      // ======================================================
      // SORT ALL QUOTES BEST → WORST
      // ======================================================

      const ranked =
        [...validQuotes]
          .sort(
            (a, b) => {

              if (
                isBetterQuote(
                  a,
                  b,
                  marketType,
                  selectionKey
                )
              ) {
                return -1;
              }

              if (
                isBetterQuote(
                  b,
                  a,
                  marketType,
                  selectionKey
                )
              ) {
                return 1;
              }

              return 0;
            }
          );


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          tracked: true,
          premium: true,

          pick:
            context.canonical_pick,

          confidence:
            context.current_confidence,

          marketType,
          selectionKey,


          cashedge: {

            firstFound: {
              line:
                context
                  .first_premium_line,

              price:
                context
                  .first_premium_price_american
            },

            current: {
              line:
                context
                  .current_cashedge_line,

              price:
                context
                  .current_cashedge_price_american
            }
          },


          bestLine: {

            sportsbookKey:
              best.sportsbook_key,

            sportsbook:
              best.sportsbook_name ||
              best.sportsbook_key,

            line:
              best.line,

            price:
              best.price_american,

            observedAt:
              best.observed_at
          },


          booksChecked:
            ranked.length,


          rankedBooks:
            ranked.map(
              quote => ({
                sportsbook:
                  quote.sportsbook_name ||
                  quote.sportsbook_key,

                line:
                  quote.line,

                price:
                  quote.price_american,

                observedAt:
                  quote.observed_at
              })
            )
        });


    } catch (error) {

      console.error(
        "BEST LINE ENGINE ERROR:",
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

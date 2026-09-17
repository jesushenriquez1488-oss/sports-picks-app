const crypto = require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  runMarketPipeline
} =
  require("../../lib/marketPipeline");
const {
  buildCanonicalMarketQuote,
  validateCanonicalMarketQuote
} =
  require("./marketProviderAdapter");

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// HELPERS
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
// PIPELINE
//
// IMPORTANT:
//
// The market quote is stored FIRST.
//
// If Market Intelligence fails afterwards,
// the quote is NOT lost.
// ============================================================

async function runPipelineSafely({

  gameId,
  sport,

  providerTimestamp,
  receivedAt

}) {

  try {

    return await runMarketPipeline({

      supabaseAdmin,

      gameId,
      sport,

      providerTimestamp,
      receivedAt
    });


  } catch (error) {

    console.error(
      "MARKET PIPELINE AFTER QUOTE INGEST ERROR:",
      error
    );


    return {

      ok: false,

      error:
        error.message ||
        String(error)
    };
  }
}


// ============================================================
// SAFE TEXT
// ============================================================

function safeText(value) {

  const text =
    String(
      value ?? ""
    )
      .trim();


  return text || null;
}


// ============================================================
// SAFE LINE
// ============================================================

function safeLine(value) {

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


// ============================================================
// SAFE AMERICAN PRICE
// ============================================================

function safeAmericanPrice(value) {

  const n =
    Number(value);


  if (
    !Number.isFinite(n)
  ) {
    return null;
  }


  return Math.round(n);
}


// ============================================================
// SAME NUMBER
// ============================================================

function sameNumber(
  a,
  b
) {

  const aNull =
    a === null ||
    a === undefined;


  const bNull =
    b === null ||
    b === undefined;


  if (
    aNull &&
    bNull
  ) {
    return true;
  }


  if (
    aNull ||
    bNull
  ) {
    return false;
  }


  return (
    Number(a) ===
    Number(b)
  );
}


// ============================================================
// DEDUPE KEY
// ============================================================

function makeDedupeKey({

  cashedgeGameId,
  sportsbookKey,

  marketType,
  selectionKey,

  previousLine,
  newLine,

  previousPrice,
  newPrice,

  providerTimestamp,
  observedAt

}) {

  const raw =
    JSON.stringify({

      cashedgeGameId,
      sportsbookKey,

      marketType,
      selectionKey,

      previousLine,
      newLine,

      previousPrice,
      newPrice,

      /*
       * Provider timestamp is preferred.
       * observedAt is fallback only.
       */

      movementTime:
        providerTimestamp ||
        observedAt
    });


  return crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex");
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    // ========================================================
    // POST ONLY
    // ========================================================

    if (
      req.method !== "POST"
    ) {

      return res
        .status(405)
        .json({

          ok: false,

          error:
            "POST required"
        });
    }


    try {

      // ======================================================
      // AUTH
      //
      // MARKET_INGEST_SECRET only.
      //
      // No query string secret.
      // ======================================================

      const configuredSecret =
        process.env
          .MARKET_INGEST_SECRET;


      if (
        !configuredSecret
      ) {

        return res
          .status(500)
          .json({

            ok: false,

            error:
              "MARKET_INGEST_SECRET is not configured"
          });
      }


      const authHeader =
        String(
          req.headers
            .authorization ||
          ""
        );


      const bearer =
        authHeader
          .startsWith(
            "Bearer "
          )
          ? authHeader
              .slice(7)
              .trim()
          : "";


      if (
        !secureEqual(
          bearer,
          configuredSecret
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
      // SETTINGS
      // ======================================================

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
            ingestion_enabled
          `)
          .eq(
            "id",
            1
          )
          .maybeSingle();


      if (
        settingsError
      ) {
        throw settingsError;
      }


      if (
        settings
          ?.ingestion_enabled !==
        true
      ) {

        return res
          .status(503)
          .json({

            ok: false,

            error:
              "Market ingestion is disabled"
          });
      }


const body =
  req.body || {};

const canonicalQuote =
  buildCanonicalMarketQuote({
    sport:
      body.sport,

    cashedgeGameId:
      body.cashedge_game_id,

    provider:
      body.provider,

    providerEventId:
      body.provider_event_id,

    sportsbookKey:
      body.sportsbook_key,

    sportsbookName:
      body.sportsbook_name,

    marketType:
      body.market_type,

    selectionKey:
      body.selection_key,

    selectionName:
      body.selection_name,

    line:
      body.line,

    priceAmerican:
      body.price_american,

    providerTimestamp:
      body.provider_timestamp,

    rawPayload:
      body.raw_payload ||
      body
  });

const validation =
  validateCanonicalMarketQuote(
    canonicalQuote
  );

if (!validation.valid) {
  return res
    .status(400)
    .json({
      ok: false,
      error:
        "Invalid canonical market quote",
      missing:
        validation.missing
    });
}

const sport =
  canonicalQuote.sport;

const cashedgeGameId =
  canonicalQuote.cashedge_game_id;

const provider =
  canonicalQuote.provider;

const providerEventId =
  canonicalQuote.provider_event_id;

const sportsbookKey =
  canonicalQuote.sportsbook_key;

const sportsbookName =
  canonicalQuote.sportsbook_name;

const marketType =
  canonicalQuote.market_type;

const selectionKey =
  canonicalQuote.selection_key;

const selectionName =
  canonicalQuote.selection_name;

const line =
  canonicalQuote.line;

const priceAmerican =
  canonicalQuote.price_american;

const providerTimestamp =
  canonicalQuote.provider_timestamp;

const observedAt =
  new Date().toISOString();

      // ======================================================
      // VERIFY CASHEDGE GAME EXISTS
      // ======================================================

      const {
        data: pickContext,
        error: contextError
      } =
        await supabaseAdmin
          .from(
            "market_pick_context"
          )
          .select(`
            id,
            sport,
            current_is_premium
          `)
          .eq(
            "cashedge_game_id",
            cashedgeGameId
          )
          .maybeSingle();


      if (
        contextError
      ) {
        throw contextError;
      }


      if (
        !pickContext
      ) {

        return res
          .status(404)
          .json({

            ok: false,

            error:
              "CashEdge game is not being tracked by Market Intelligence"
          });
      }


      // ======================================================
      // GET CURRENT QUOTE
      //
      // One current state per:
      //
      // game
      // sportsbook
      // market
      // selection
      // ======================================================

      const {
        data: existing,
        error: existingError
      } =
        await supabaseAdmin
          .from(
            "market_current_quotes"
          )
          .select("*")
          .eq(
            "cashedge_game_id",
            cashedgeGameId
          )
          .eq(
            "sportsbook_key",
            sportsbookKey
          )
          .eq(
            "market_type",
            marketType
          )
          .eq(
            "selection_key",
            selectionKey
          )
          .maybeSingle();


      if (
        existingError
      ) {
        throw existingError;
      }


      // ======================================================
      // FIRST OBSERVATION = BASELINE
      // ======================================================

      if (
        !existing
      ) {

        const {
          data: created,
          error: insertError
        } =
          await supabaseAdmin
            .from(
              "market_current_quotes"
            )
            .insert({

              sport,

              cashedge_game_id:
                cashedgeGameId,

              provider,

              provider_event_id:
                providerEventId,

              sportsbook_key:
                sportsbookKey,

              sportsbook_name:
                sportsbookName,

              market_type:
                marketType,

              selection_key:
                selectionKey,

              selection_name:
                selectionName,

              line,

              price_american:
                priceAmerican,

              provider_timestamp:
                providerTimestamp,

              observed_at:
                observedAt,

              updated_at:
                observedAt
            })
            .select()
            .single();


        if (
          insertError
        ) {
          throw insertError;
        }


        // ====================================================
        // PIPELINE
        //
        // A first quote is not a movement for this book,
        // but a NEW sportsbook can change:
        //
        // - consensus
        // - best line
        // - opportunity
        // - Important Moves
        //
        // Therefore baseline DOES trigger the pipeline.
        // ====================================================

        const pipeline =
          await runPipelineSafely({

            gameId:
              cashedgeGameId,

            sport,

            providerTimestamp,

            receivedAt:
              observedAt
          });


        return res
          .status(200)
          .json({

            ok: true,

            shadowMode:
              settings
                ?.shadow_mode ===
              true,

            result:
              "baseline",

            changed:
              false,

            pipeline,

            quote: {

              sportsbook:
                created
                  .sportsbook_name ||
                created
                  .sportsbook_key,

              marketType:
                created
                  .market_type,

              selection:
                created
                  .selection_name ||
                created
                  .selection_key,

              line:
                created.line,

              price:
                created
                  .price_american
            }
          });
      }


      // ======================================================
      // DID LINE OR PRICE ACTUALLY CHANGE?
      // ======================================================

      const lineChanged =
        !sameNumber(
          existing.line,
          line
        );


      const priceChanged =
        Number(
          existing
            .price_american
        ) !==
        Number(
          priceAmerican
        );


      const actuallyChanged =
        lineChanged ||
        priceChanged;


      // ======================================================
      // SAME QUOTE
      //
      // Refresh freshness timestamps only.
      //
      // DO NOT run Market Pipeline.
      // ======================================================

      if (
        !actuallyChanged
      ) {

        const {
          error: refreshError
        } =
          await supabaseAdmin
            .from(
              "market_current_quotes"
            )
            .update({

              provider,

              provider_event_id:
                providerEventId,

              sportsbook_name:
                sportsbookName ||
                existing
                  .sportsbook_name,

              selection_name:
                selectionName ||
                existing
                  .selection_name,

              provider_timestamp:
                providerTimestamp,

              observed_at:
                observedAt,

              updated_at:
                observedAt
            })
            .eq(
              "id",
              existing.id
            );


        if (
          refreshError
        ) {
          throw refreshError;
        }


        return res
          .status(200)
          .json({

            ok: true,

            shadowMode:
              settings
                ?.shadow_mode ===
              true,

            result:
              "unchanged",

            changed:
              false,

            lineChanged:
              false,

            priceChanged:
              false,

            pipeline: {

              triggered:
                false,

              reason:
                "Quote unchanged"
            }
          });
      }


      // ======================================================
      // REAL MARKET CHANGE
      // ======================================================

      const dedupeKey =
        makeDedupeKey({

          cashedgeGameId,
          sportsbookKey,

          marketType,
          selectionKey,

          previousLine:
            existing.line,

          newLine:
            line,

          previousPrice:
            existing
              .price_american,

          newPrice:
            priceAmerican,

          providerTimestamp,
          observedAt
        });


      // ======================================================
      // STORE MARKET MOVEMENT HISTORY
      // ======================================================

      const {
        error: historyError
      } =
        await supabaseAdmin
          .from(
            "market_odds_updates"
          )
          .insert({

            sport,

            cashedge_game_id:
              cashedgeGameId,

            provider,

            provider_event_id:
              providerEventId,

            sportsbook_key:
              sportsbookKey,

            sportsbook_name:
              sportsbookName ||
              existing
                .sportsbook_name,

            market_type:
              marketType,

            selection_key:
              selectionKey,

            selection_name:
              selectionName ||
              existing
                .selection_name,

            previous_line:
              existing.line,

            new_line:
              line,

            previous_price_american:
              existing
                .price_american,

            new_price_american:
              priceAmerican,

            provider_timestamp:
              providerTimestamp,

            observed_at:
              observedAt,

            dedupe_key:
              dedupeKey,

            raw_payload:
              body.raw_payload ||
              body
          });


      // A duplicate historical update is acceptable.
      // Anything else is a real database failure.

      if (
        historyError &&
        historyError.code !==
          "23505"
      ) {

        throw historyError;
      }


      // ======================================================
      // UPDATE CURRENT MARKET STATE
      // ======================================================

      const {
        error: currentError
      } =
        await supabaseAdmin
          .from(
            "market_current_quotes"
          )
          .update({

            provider,

            provider_event_id:
              providerEventId,

            sportsbook_name:
              sportsbookName ||
              existing
                .sportsbook_name,

            selection_name:
              selectionName ||
              existing
                .selection_name,

            line,

            price_american:
              priceAmerican,

            provider_timestamp:
              providerTimestamp,

            observed_at:
              observedAt,

            updated_at:
              observedAt
          })
          .eq(
            "id",
            existing.id
          );


      if (
        currentError
      ) {
        throw currentError;
      }


      // ======================================================
      // RUN MARKET INTELLIGENCE
      //
      // IMPORTANT:
      //
      // The quote and movement have ALREADY been stored.
      //
      // A downstream Intelligence error must never cause
      // CashEdge to lose provider market data.
      // ======================================================

      const pipeline =
        await runPipelineSafely({

          gameId:
            cashedgeGameId,

          sport,

          providerTimestamp,

          receivedAt:
            observedAt
        });


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          shadowMode:
            settings
              ?.shadow_mode ===
            true,

          result:
            "changed",

          changed:
            true,

          pipeline,

          lineChanged,
          priceChanged,

          previous: {

            line:
              existing.line,

            price:
              existing
                .price_american
          },

          current: {

            line,

            price:
              priceAmerican
          }
        });


    } catch (error) {

      console.error(
        "MARKET QUOTE INGEST ERROR:",
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

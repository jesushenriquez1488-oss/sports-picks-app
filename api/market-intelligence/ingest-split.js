const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  runMarketPipeline
} =
  require("../../lib/marketPipeline");

const {
  buildCanonicalMarketSplit,
  validateCanonicalMarketSplit
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
// Split data is stored FIRST.
//
// Market Intelligence is executed afterwards so a pipeline
// failure can never cause CashEdge to lose provider data.
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
      "MARKET PIPELINE AFTER SPLIT INGEST ERROR:",
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
// TEXT
// ============================================================





// ============================================================
// NUMBER
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


// ============================================================
// PERCENTAGE
// ============================================================



// ============================================================
// HASH
// ============================================================

function makeHash(value) {

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value)
    )
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
      req.method !==
      "POST"
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
      // SECURITY
      //
      // MARKET_INGEST_SECRET only.
      //
      // No secret in URL.
      // ======================================================

      const auth =
        String(
          req.headers
            .authorization ||
          ""
        );


      const token =
        auth
          .startsWith(
            "Bearer "
          )
          ? auth
              .slice(7)
              .trim()
          : "";


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
              "MARKET_INGEST_SECRET is missing"
          });
      }


      if (
        !secureEqual(
          token,
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
          .status(200)
          .json({

            ok: true,

            skipped:
              true,

            reason:
              "Market ingestion disabled"
          });
      }


  // ======================================================
// PAYLOAD
// ======================================================

const body =
  req.body || {};

const canonicalSplit =
  buildCanonicalMarketSplit({
    sport:
      body.sport,

    cashedgeGameId:
      body.cashedge_game_id,

    provider:
      body.provider,

    splitSourceKey:
      body.split_source_key,

    splitSourceName:
      body.split_source_name ||
      body.split_source_key,

    marketType:
      body.market_type,

    selectionKey:
      body.selection_key,

    line:
      body.line,

    priceAmerican:
      body.price_american,

    moneyPct:
      body.money_pct,

    ticketsPct:
      body.tickets_pct,

    providerTimestamp:
      body.provider_timestamp,

    rawPayload:
      body.raw_payload ||
      body
  });

const validation =
  validateCanonicalMarketSplit(
    canonicalSplit
  );

if (!validation.valid) {
  return res
    .status(400)
    .json({
      ok: false,
      error:
        "Invalid canonical market split",
      missing:
        validation.missing
    });
}

const sport =
  canonicalSplit.sport;

const gameId =
  canonicalSplit
    .cashedge_game_id;

const provider =
  canonicalSplit.provider;

const splitSourceKey =
  canonicalSplit
    .split_source_key;

const splitSourceName =
  canonicalSplit
    .split_source_name;

const marketType =
  canonicalSplit.market_type;

const selectionKey =
  canonicalSplit
    .selection_key;

const line =
  canonicalSplit.line;

const price =
  canonicalSplit
    .price_american;

const moneyPct =
  canonicalSplit.money_pct;

const ticketsPct =
  canonicalSplit
    .tickets_pct;

const providerTimestamp =
  canonicalSplit
    .provider_timestamp;

const observedAt =
  new Date()
    .toISOString();

      // ======================================================
      // VERIFY THAT CASHEDGE IS TRACKING THIS PREMIUM
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
            cashedge_game_id,
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
              "Game not tracked by CashEdge Market Intelligence"
          });
      }


      if (
        context
          .current_is_premium !==
        true
      ) {

        return res
          .status(200)
          .json({

            ok: true,

            skipped:
              true,

            reason:
              "Game is not currently Premium"
          });
      }


      // ======================================================
      // LATEST SNAPSHOT FROM THE SAME SPLIT SOURCE
      //
      // DraftKings must never overwrite or compare itself
      // against Circa.
      //
      // Scope:
      //
      // game
      // provider
      // split source
      // market
      // selection
      // ======================================================

      const {
        data: previous,
        error: previousError
      } =
        await supabaseAdmin
          .from(
            "market_split_snapshots"
          )
          .select(`
            id,
            line,
            price_american,
            money_pct,
            tickets_pct,
            provider_timestamp,
            observed_at
          `)
          .eq(
            "cashedge_game_id",
            gameId
          )
          .eq(
            "provider",
            provider
          )
          .eq(
            "split_source_key",
            splitSourceKey
          )
          .eq(
            "market_type",
            marketType
          )
          .eq(
            "selection_key",
            selectionKey
          )
          .order(
            "observed_at",
            {
              ascending:
                false
            }
          )
          .limit(1)
          .maybeSingle();


      if (
        previousError
      ) {
        throw previousError;
      }


      // ======================================================
      // IDENTICAL STATE
      //
      // No new snapshot.
      // No Market Pipeline execution.
      // ======================================================

      const unchanged =
        previous &&

        safeNumber(
          previous.line
        ) ===
          line &&

        safeNumber(
          previous
            .price_american
        ) ===
          price &&

        safeNumber(
          previous
            .money_pct
        ) ===
          moneyPct &&

        safeNumber(
          previous
            .tickets_pct
        ) ===
          ticketsPct;


      if (
        unchanged
      ) {

        return res
          .status(200)
          .json({

            ok: true,

            shadowMode:
              settings
                ?.shadow_mode ===
              true,

            created:
              false,

            unchanged:
              true,

            provider,

            splitSource:
              splitSourceKey,

            gameId,

            marketType,

            selectionKey,

            moneyPct,

            ticketsPct,

            divergence:
              Number(
                (
                  moneyPct -
                  ticketsPct
                )
                  .toFixed(2)
              ),

            pipeline: {

              triggered:
                false,

              reason:
                "Split unchanged"
            }
          });
      }


      // ======================================================
      // DEDUPE
      // ======================================================

      const dedupeKey =
        makeHash({

          gameId,

          provider,

          splitSourceKey,

          marketType,

          selectionKey,

          line,

          price,

          moneyPct,

          ticketsPct,

          providerTimestamp
        });


      // ======================================================
      // INSERT NEW SNAPSHOT
      // ======================================================

      const {
        error: insertError
      } =
        await supabaseAdmin
          .from(
            "market_split_snapshots"
          )
          .insert({

            sport,

            cashedge_game_id:
              gameId,

            provider,

            split_source_key:
              splitSourceKey,

            split_source_name:
              splitSourceName,

            market_type:
              marketType,

            selection_key:
              selectionKey,

            line,

            price_american:
              price,

            money_pct:
              moneyPct,

            tickets_pct:
              ticketsPct,

            provider_timestamp:
              providerTimestamp,

            dedupe_key:
              dedupeKey,

           raw_payload:
  canonicalSplit.raw_payload,

            observed_at:
              observedAt
          });


      if (
        insertError
      ) {

        // ====================================================
        // UNIQUE DEDUPE COLLISION
        //
        // Snapshot already exists.
        //
        // Do not run Pipeline again.
        // ====================================================

        if (
          insertError.code ===
          "23505"
        ) {

          return res
            .status(200)
            .json({

              ok: true,

              created:
                false,

              duplicate:
                true,

              pipeline: {

                triggered:
                  false,

                reason:
                  "Split snapshot already stored"
              }
            });
        }


        throw insertError;
      }


      // ======================================================
      // RUN MARKET INTELLIGENCE
      //
      // IMPORTANT:
      //
      // The split snapshot has already been persisted.
      //
      // If the Intelligence layer fails, CashEdge still
      // retains the provider snapshot.
      // ======================================================

      const pipeline =
        await runPipelineSafely({

          gameId,

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

          created:
            true,

          provider,

          splitSource:
            splitSourceKey,

          gameId,

          marketType,

          selectionKey,

          moneyPct,

          ticketsPct,

          divergence:
            Number(
              (
                moneyPct -
                ticketsPct
              )
                .toFixed(2)
            ),

          providerTimestamp,

          pipeline
        });


    } catch (error) {

      console.error(
        "MARKET SPLIT INGEST ERROR:",
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

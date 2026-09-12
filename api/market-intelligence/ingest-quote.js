const crypto = require("crypto");
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

function safeText(value) {
  const text =
    String(value ?? "").trim();

  return text || null;
}


function safeLine(value) {
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


function safeAmericanPrice(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Math.round(n);
}


function sameNumber(a, b) {
  const aNull =
    a === null ||
    a === undefined;

  const bNull =
    b === null ||
    b === undefined;

  if (aNull && bNull) {
    return true;
  }

  if (aNull || bNull) {
    return false;
  }

  return Number(a) === Number(b);
}


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

  const raw = JSON.stringify({
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
  async function handler(req, res) {

    if (req.method !== "POST") {
      return res
        .status(405)
        .json({
          ok: false,
          error: "POST required"
        });
    }

    try {

      // ======================================================
      // AUTH
      // ======================================================

      const configuredSecret =
        process.env.MARKET_INGEST_SECRET;

      if (!configuredSecret) {
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
          req.headers.authorization ||
          ""
        );

      const bearer =
        authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : "";

      if (bearer !== configuredSecret) {
        return res
          .status(401)
          .json({
            ok: false,
            error: "Unauthorized"
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
          .eq("id", 1)
          .maybeSingle();

      if (settingsError) {
        throw settingsError;
      }

      if (
        settings?.ingestion_enabled !== true
      ) {
        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Market ingestion is disabled"
          });
      }


      // ======================================================
      // PAYLOAD
      // ======================================================

      const body =
        req.body || {};

      const sport =
        safeText(body.sport)
          ?.toLowerCase();

      const cashedgeGameId =
        safeText(
          body.cashedge_game_id
        );

      const provider =
        safeText(body.provider);

      const providerEventId =
        safeText(
          body.provider_event_id
        );

      const sportsbookKey =
        safeText(
          body.sportsbook_key
        )?.toLowerCase();

      const sportsbookName =
        safeText(
          body.sportsbook_name
        );

      const marketType =
        safeText(
          body.market_type
        )?.toLowerCase();

      const selectionKey =
        safeText(
          body.selection_key
        )?.toLowerCase();

      const selectionName =
        safeText(
          body.selection_name
        );

      let line =
        safeLine(body.line);

      const priceAmerican =
        safeAmericanPrice(
          body.price_american
        );

      const providerTimestamp =
        body.provider_timestamp
          ? new Date(
              body.provider_timestamp
            ).toISOString()
          : null;

      const observedAt =
        new Date().toISOString();


      // ======================================================
      // REQUIRED VALUES
      // ======================================================

      if (
        !sport ||
        !cashedgeGameId ||
        !provider ||
        !sportsbookKey ||
        !marketType ||
        !selectionKey
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Missing required market quote fields"
          });
      }


      const allowedMarkets =
        new Set([
          "moneyline",
          "spread",
          "total"
        ]);

      if (
        !allowedMarkets.has(
          marketType
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Unsupported market_type"
          });
      }


      /*
       * Moneyline has PRICE but no spread/total LINE.
       *
       * Cubs ML -122:
       * line  = null
       * price = -122
       */
      if (
        marketType === "moneyline"
      ) {
        line = null;
      }


      if (priceAmerican === null) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Valid price_american is required"
          });
      }


      if (
        marketType !== "moneyline" &&
        line === null
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Spread/total requires line"
          });
      }


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

      if (contextError) {
        throw contextError;
      }

      if (!pickContext) {
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

      if (existingError) {
        throw existingError;
      }


      // ======================================================
      // FIRST OBSERVATION = BASELINE
      // ======================================================

      if (!existing) {

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

        if (insertError) {
          throw insertError;
        }

        return res
          .status(200)
          .json({
            ok: true,
            shadowMode:
              settings?.shadow_mode === true,

            result: "baseline",

            changed: false,

            quote: {
              sportsbook:
                created.sportsbook_name ||
                created.sportsbook_key,

              marketType:
                created.market_type,

              selection:
                created.selection_name ||
                created.selection_key,

              line:
                created.line,

              price:
                created.price_american
            }
          });
      }


      // ======================================================
      // DID ANYTHING ACTUALLY CHANGE?
      // ======================================================

      const lineChanged =
        !sameNumber(
          existing.line,
          line
        );

      const priceChanged =
        Number(
          existing.price_american
        ) !== Number(
          priceAmerican
        );

      const actuallyChanged =
        lineChanged ||
        priceChanged;


      // ======================================================
      // SAME QUOTE — ONLY REFRESH FRESHNESS
      // ======================================================

      if (!actuallyChanged) {

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
                existing.sportsbook_name,

              selection_name:
                selectionName ||
                existing.selection_name,

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

        if (refreshError) {
          throw refreshError;
        }

        return res
          .status(200)
          .json({
            ok: true,
            shadowMode:
              settings?.shadow_mode === true,

            result: "unchanged",

            changed: false,

            lineChanged: false,
            priceChanged: false
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
            existing.price_american,

          newPrice:
            priceAmerican,

          providerTimestamp,
          observedAt
        });


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
              existing.sportsbook_name,

            market_type:
              marketType,

            selection_key:
              selectionKey,

            selection_name:
              selectionName ||
              existing.selection_name,

            previous_line:
              existing.line,

            new_line:
              line,

            previous_price_american:
              existing.price_american,

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

      if (
        historyError &&
        historyError.code !== "23505"
      ) {
        throw historyError;
      }


      // ======================================================
      // UPDATE CURRENT STATE
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
              existing.sportsbook_name,

            selection_name:
              selectionName ||
              existing.selection_name,

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

      if (currentError) {
        throw currentError;
      }


      return res
        .status(200)
        .json({
          ok: true,

          shadowMode:
            settings?.shadow_mode === true,

          result: "changed",

          changed: true,

          lineChanged,
          priceChanged,

          previous: {
            line:
              existing.line,

            price:
              existing.price_american
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

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


function safePercent(value) {
  const n =
    safeNumber(value);

  if (
    n === null ||
    n < 0 ||
    n > 100
  ) {
    return null;
  }

  return Number(
    n.toFixed(2)
  );
}


function safeAmericanPrice(value) {
  const n =
    safeNumber(value);

  if (n === null) {
    return null;
  }

  return Math.round(n);
}


function sameNumber(a, b) {
  const x =
    safeNumber(a);

  const y =
    safeNumber(b);

  if (
    x === null &&
    y === null
  ) {
    return true;
  }

  if (
    x === null ||
    y === null
  ) {
    return false;
  }

  return x === y;
}


function makeDedupeKey({
  cashedgeGameId,
  provider,
  marketType,
  selectionKey,
  moneyPct,
  ticketsPct,
  line,
  priceAmerican,
  providerTimestamp
}) {

  const raw =
    JSON.stringify({
      cashedgeGameId,
      provider,
      marketType,
      selectionKey,
      moneyPct,
      ticketsPct,
      line,
      priceAmerican,
      providerTimestamp:
        providerTimestamp || null
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
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : "";


      if (
        bearer !==
        configuredSecret
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
          .eq("id", 1)
          .maybeSingle();


      if (settingsError) {
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


      // ======================================================
      // PAYLOAD
      // ======================================================

      const body =
        req.body || {};


      const sport =
        safeText(
          body.sport
        )?.toLowerCase();


      const cashedgeGameId =
        safeText(
          body.cashedge_game_id
        );


      const provider =
        safeText(
          body.provider
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


      const moneyPct =
        safePercent(
          body.money_pct
        );


      const ticketsPct =
        safePercent(
          body.tickets_pct
        );


      let line =
        safeNumber(
          body.line
        );


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


      // ======================================================
      // VALIDATION
      // ======================================================

      if (
        !sport ||
        !cashedgeGameId ||
        !provider ||
        !marketType ||
        !selectionKey
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Missing required split fields"
          });
      }


      if (
        moneyPct === null ||
        ticketsPct === null
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "money_pct and tickets_pct must be between 0 and 100"
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


      if (
        marketType ===
        "moneyline"
      ) {
        line = null;
      }


      // ======================================================
      // VERIFY CASHEDGE IS TRACKING GAME
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
            id,
            sport,
            market_type,
            selection_key,
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


      if (!context) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Game is not tracked by Market Intelligence"
          });
      }


      if (
        context
          .current_is_premium !==
        true
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "Game is not currently Premium"
          });
      }


      // ======================================================
      // GET LATEST SNAPSHOT
      // ======================================================

      const {
        data: latest,
        error: latestError
      } =
        await supabaseAdmin
          .from(
            "market_split_snapshots"
          )
          .select("*")
          .eq(
            "cashedge_game_id",
            cashedgeGameId
          )
          .eq(
            "provider",
            provider
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
              ascending: false
            }
          )
          .limit(1)
          .maybeSingle();


      if (latestError) {
        throw latestError;
      }


      // ======================================================
      // SAME STATE = NO NEW SNAPSHOT
      // ======================================================

      if (
        latest &&
        sameNumber(
          latest.money_pct,
          moneyPct
        ) &&
        sameNumber(
          latest.tickets_pct,
          ticketsPct
        ) &&
        sameNumber(
          latest.line,
          line
        ) &&
        sameNumber(
          latest.price_american,
          priceAmerican
        )
      ) {

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

            snapshotCreated:
              false,

            moneyPct,
            ticketsPct,

            divergence:
              Number(
                (
                  moneyPct -
                  ticketsPct
                ).toFixed(2)
              )
          });
      }


      // ======================================================
      // NEW SNAPSHOT
      // ======================================================

      const observedAt =
        new Date()
          .toISOString();


      const dedupeKey =
        makeDedupeKey({
          cashedgeGameId,
          provider,
          marketType,
          selectionKey,
          moneyPct,
          ticketsPct,
          line,
          priceAmerican,
          providerTimestamp
        });


      const {
        data: created,
        error: insertError
      } =
        await supabaseAdmin
          .from(
            "market_split_snapshots"
          )
          .insert({

            sport,

            cashedge_game_id:
              cashedgeGameId,

            provider,

            market_type:
              marketType,

            selection_key:
              selectionKey,

            selection_name:
              selectionName,

            line,

            price_american:
              priceAmerican,

            money_pct:
              moneyPct,

            tickets_pct:
              ticketsPct,

            observed_at:
              observedAt,

            dedupe_key:
              dedupeKey,

            raw_payload:
              body.raw_payload ||
              body
          })
          .select()
          .single();


      if (
        insertError &&
        insertError.code !==
        "23505"
      ) {
        throw insertError;
      }


      if (
        insertError?.code ===
        "23505"
      ) {
        return res
          .status(200)
          .json({
            ok: true,

            shadowMode:
              settings
                ?.shadow_mode ===
              true,

            result:
              "duplicate",

            snapshotCreated:
              false
          });
      }


      // ======================================================
      // SIMPLE INFORMATIONAL READ
      //
      // NOT YET A SHARP SIGNAL.
      // ======================================================

      const divergence =
        Number(
          (
            moneyPct -
            ticketsPct
          ).toFixed(2)
        );


      return res
        .status(200)
        .json({

          ok: true,

          shadowMode:
            settings
              ?.shadow_mode ===
            true,

          result:
            latest
              ? "changed"
              : "baseline",

          snapshotCreated:
            true,

          snapshot: {

            id:
              created.id,

            marketType,

            selectionKey,

            line:
              created.line,

            price:
              created
                .price_american,

            moneyPct:
              created.money_pct,

            ticketsPct:
              created.tickets_pct,

            divergence,

            observedAt:
              created.observed_at
          }
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

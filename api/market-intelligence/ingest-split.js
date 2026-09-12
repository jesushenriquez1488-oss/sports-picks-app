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
// HELPERS
// ============================================================

function cleanText(value) {
  return String(value || "")
    .trim();
}


function normalizeText(value) {
  return cleanText(value)
    .toLowerCase();
}


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


function pct(value) {

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
      // SECURITY
      // ======================================================

      const auth =
        String(
          req.headers.authorization ||
          ""
        );


      const token =
        auth.startsWith("Bearer ")
          ? auth.slice(7)
          : "";


      if (
        !process.env.MARKET_INGEST_SECRET
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
        token !==
        process.env.MARKET_INGEST_SECRET
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


      if (settingsError) {
        throw settingsError;
      }


      if (
        settings?.ingestion_enabled !==
        true
      ) {
        return res
          .status(200)
          .json({
            ok: true,
            skipped: true,
            reason:
              "Market ingestion disabled"
          });
      }


      // ======================================================
      // PAYLOAD
      // ======================================================

      const body =
        req.body || {};


      const sport =
        normalizeText(
          body.sport
        );


      const gameId =
        cleanText(
          body.cashedge_game_id
        );


      const provider =
        normalizeText(
          body.provider
        );


      // IMPORTANT:
      //
      // provider = Owls
      //
      // split_source = DraftKings / Circa / etc.
      //
      // We intentionally keep these separate.
      const splitSourceKey =
        normalizeText(
          body.split_source_key
        );


      const splitSourceName =
        cleanText(
          body.split_source_name ||
          body.split_source_key
        );


      const marketType =
        normalizeText(
          body.market_type
        );


      const selectionKey =
        normalizeText(
          body.selection_key
        );


      const line =
        safeNumber(
          body.line
        );


      const price =
        safeNumber(
          body.price_american
        );


      const moneyPct =
        pct(
          body.money_pct
        );


      const ticketsPct =
        pct(
          body.tickets_pct
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
        !gameId ||
        !provider ||
        !splitSourceKey ||
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
        ![
          "moneyline",
          "spread",
          "total"
        ].includes(
          marketType
        )
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Invalid market_type"
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


      if (contextError) {
        throw contextError;
      }


      if (!context) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Game not tracked by CashEdge Market Intelligence"
          });
      }


      if (
        context.current_is_premium !==
        true
      ) {

        return res
          .status(200)
          .json({
            ok: true,
            skipped: true,
            reason:
              "Game is not currently Premium"
          });
      }


      // ======================================================
      // LATEST SNAPSHOT FROM THE SAME SPLIT SOURCE
      //
      // DraftKings must never overwrite / compare itself
      // against Circa.
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
              ascending: false
            }
          )
          .limit(1)
          .maybeSingle();


      if (previousError) {
        throw previousError;
      }


      // ======================================================
      // IDENTICAL STATE
      // ======================================================

      const unchanged =
        previous &&
        safeNumber(
          previous.line
        ) === line &&
        safeNumber(
          previous.price_american
        ) === price &&
        safeNumber(
          previous.money_pct
        ) === moneyPct &&
        safeNumber(
          previous.tickets_pct
        ) === ticketsPct;


      if (unchanged) {

        return res
          .status(200)
          .json({

            ok: true,

            shadowMode:
              settings
                ?.shadow_mode === true,

            created: false,

            unchanged: true,

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
                ).toFixed(2)
              )
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
              body,

            observed_at:
              new Date()
                .toISOString()
          });


      if (insertError) {

        // Unique dedupe collision = already stored.
        if (
          insertError.code ===
          "23505"
        ) {

          return res
            .status(200)
            .json({
              ok: true,
              created: false,
              duplicate: true
            });
        }

        throw insertError;
      }


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          shadowMode:
            settings
              ?.shadow_mode === true,

          created: true,

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
              ).toFixed(2)
            ),

          providerTimestamp
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

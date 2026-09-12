const { createClient } =
  require("@supabase/supabase-js");

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// CENTRAL DATE
// ============================================================

function getCentralDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}


function addDays(dateString, days) {
  const [year, month, day] =
    String(dateString)
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day + days,
      12,
      0,
      0
    )
  )
    .toISOString()
    .slice(0, 10);
}


// ============================================================
// HELPERS
// ============================================================

function safeNum(value) {
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


function normalizeSelection(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


// ============================================================
// MLB
// ============================================================

function extractMLB(row) {
  const analysis =
    row.analysis_json || {};

  const card =
    analysis?.premium
      ?.recommendedCards?.[0] ||
    null;

  const isPremium =
    analysis?.isPremiumPick === true &&
    !!card;

  if (!card) {
    return {
      isPremium: false
    };
  }

  let marketType = null;
  let selectionKey = null;
  let line = null;

  if (
    card.type === "OVER" ||
    card.type === "UNDER"
  ) {
    marketType = "total";
    selectionKey =
      String(card.type).toLowerCase();

    line =
      safeNum(
        analysis?.premium?.totalLine
      );

  } else if (
    card.type === "RUNLINE"
  ) {
    marketType = "spread";

    selectionKey =
      normalizeSelection(
        card.team ||
        card.play
      );

    line =
      safeNum(card.spread);

  } else if (
    card.type === "ML"
  ) {
    marketType = "moneyline";

    selectionKey =
      normalizeSelection(
        card.team ||
        card.play
      );

    /*
     * IMPORTANT:
     * Moneyline does NOT have a spread/total line.
     *
     * -125 / +140 is PRICE, not line.
     */
    line = null;
  }

  return {
    isPremium,

    pick:
      card.play || null,

    confidence:
      safeNum(card.percentage),

    marketType,

    selectionKey,

    line,

    priceAmerican:
      safeAmericanPrice(
        card.odds_american
      )
  };
}


// ============================================================
// FOOTBALL — NFL / NCAAF
// ============================================================

function extractFootball(row) {
  const analysis =
    row.analysis_json || {};

  const premium =
    analysis?.premium || null;

  const isPremium =
    analysis?.isPremiumPick === true &&
    !!premium;

  if (!premium) {
    return {
      isPremium: false
    };
  }

  const pick =
    String(
      premium.pick || ""
    ).trim();

  const normalized =
    pick.toLowerCase();

  const odds =
    premium.odds || {};

  let marketType = null;
  let selectionKey = null;
  let line = null;

  if (
    normalized.includes("over") ||
    normalized.includes("under")
  ) {
    marketType = "total";

    selectionKey =
      normalized.includes("over")
        ? "over"
        : "under";

    line =
      safeNum(
        odds.totalLine
      );

  } else {
    marketType = "spread";

    if (
      row.away_team &&
      pick.includes(row.away_team)
    ) {
      selectionKey =
        normalizeSelection(
          row.away_team
        );

      line =
        safeNum(
          odds.spreadLineA
        );

    } else if (
      row.home_team &&
      pick.includes(row.home_team)
    ) {
      selectionKey =
        normalizeSelection(
          row.home_team
        );

      line =
        safeNum(
          odds.spreadLineB
        );

    } else {
      selectionKey =
        normalizeSelection(pick);
    }
  }

  return {
    isPremium,

    pick,

    confidence:
      safeNum(
        premium.confidence
      ),

    marketType,

    selectionKey,

    line,

    priceAmerican:
      safeAmericanPrice(
        premium.odds_american
      )
  };
}


// ============================================================
// BASKETBALL — NBA / WNBA / NCAAB
// ============================================================

function extractBasketball(row) {
  const analysis =
    row.analysis_json || {};

  const premium =
    analysis?.premium || null;

  const isPremium =
    analysis?.isPremiumPick === true &&
    !!premium;

  if (!premium) {
    return {
      isPremium: false
    };
  }

  const pick =
    String(
      premium.pick || ""
    ).trim();

  const normalized =
    pick.toLowerCase();

  const market =
    analysis?.marketSnapshot || {};

  let marketType = null;
  let selectionKey = null;
  let line = null;

  if (
    normalized === "over" ||
    normalized.startsWith("over ")
  ) {
    marketType = "total";
    selectionKey = "over";

    line =
      safeNum(
        market.total
      );

  } else if (
    normalized === "under" ||
    normalized.startsWith("under ")
  ) {
    marketType = "total";
    selectionKey = "under";

    line =
      safeNum(
        market.total
      );

  } else {
    marketType = "spread";

    if (
      row.away_team &&
      pick.includes(row.away_team)
    ) {
      selectionKey =
        normalizeSelection(
          row.away_team
        );

      line =
        safeNum(
          market.awaySpread
        );

    } else if (
      row.home_team &&
      pick.includes(row.home_team)
    ) {
      selectionKey =
        normalizeSelection(
          row.home_team
        );

      line =
        safeNum(
          market.homeSpread
        );

    } else {
      selectionKey =
        normalizeSelection(pick);
    }
  }

  return {
    isPremium,

    pick,

    confidence:
      safeNum(
        premium.confidence
      ),

    marketType,

    selectionKey,

    line,

    priceAmerican:
      safeAmericanPrice(
        premium.odds_american
      )
  };
}


// ============================================================
// SPORT ROUTER
// ============================================================

function extractCanonicalPick(row) {

  if (row.sport === "mlb") {
    return extractMLB(row);
  }

  if (
    row.sport === "nfl" ||
    row.sport === "ncaaf"
  ) {
    return extractFootball(row);
  }

  if (
    row.sport === "nba" ||
    row.sport === "wnba" ||
    row.sport === "ncaab"
  ) {
    return extractBasketball(row);
  }

  return {
    isPremium: false
  };
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
      req.method !== "GET" &&
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });
    }

    try {

      // ======================================================
      // SECURITY
      // ======================================================

      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );

      const bearerToken =
        authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : "";

      const querySecret =
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
              "Missing CRON_SECRET / GENERATE_DAILY_SECRET"
          });
      }

      if (
        bearerToken !== validSecret &&
        querySecret !== validSecret
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
          .select("*")
          .eq("id", 1)
          .maybeSingle();

      if (settingsError) {
        throw settingsError;
      }

      /*
       * This endpoint is allowed in shadow mode.
       *
       * It does NOT require ingestion_enabled yet because
       * we are only copying CashEdge's own canonical pick.
       */


      // ======================================================
      // DATE WINDOW
      // ======================================================

      const today =
        getCentralDate();

      const footballEndDate =
        addDays(
          today,
          6
        );


      // ======================================================
      // READ DAILY SPORTS
      // ======================================================

      const {
        data: dailyRows,
        error: dailyError
      } =
        await supabaseAdmin
          .from("daily_picks")
          .select(`
            id,
            sport,
            game_id,
            game_date,
            away_team,
            home_team,
            analysis_json,
            updated_at
          `)
          .in(
            "sport",
            [
              "mlb",
              "nba",
              "wnba",
              "ncaab"
            ]
          )
          .eq(
            "game_date",
            today
          );

      if (dailyError) {
        throw dailyError;
      }


      // ======================================================
      // READ FOOTBALL
      // ======================================================

      const {
        data: footballRows,
        error: footballError
      } =
        await supabaseAdmin
          .from("daily_picks")
          .select(`
            id,
            sport,
            game_id,
            game_date,
            away_team,
            home_team,
            analysis_json,
            updated_at
          `)
          .in(
            "sport",
            [
              "nfl",
              "ncaaf"
            ]
          )
          .gte(
            "game_date",
            today
          )
          .lte(
            "game_date",
            footballEndDate
          );

      if (footballError) {
        throw footballError;
      }


      const rows = [
        ...(dailyRows || []),
        ...(footballRows || [])
      ];


      // ======================================================
      // REPORT
      // ======================================================

      const report = {
        ok: true,

        shadowMode:
          settings?.shadow_mode !== false,

        checked:
          0,

        created:
          0,

        updated:
          0,

        skipped:
          0,

        deactivated:
          0,

        errors:
          0,

        details:
          []
      };


      // ======================================================
      // SYNC
      // ======================================================

      for (const row of rows) {

        report.checked += 1;

        try {

          const canonical =
            extractCanonicalPick(row);


          const {
            data: existing,
            error: existingError
          } =
            await supabaseAdmin
              .from(
                "market_pick_context"
              )
              .select("*")
              .eq(
                "cashedge_game_id",
                row.game_id
              )
              .maybeSingle();

          if (existingError) {
            throw existingError;
          }


          // ==================================================
          // NEVER PREMIUM
          // ==================================================

          if (
            !existing &&
            canonical.isPremium !== true
          ) {

            report.skipped += 1;

            continue;
          }


          // ==================================================
          // WAS TRACKED, NOW NOT PREMIUM
          // ==================================================

          if (
            existing &&
            canonical.isPremium !== true
          ) {

            const {
              error: deactivateError
            } =
              await supabaseAdmin
                .from(
                  "market_pick_context"
                )
                .update({
                  current_is_premium:
                    false,

                  source_updated_at:
                    row.updated_at || null,

                  last_synced_at:
                    new Date()
                      .toISOString(),

                  updated_at:
                    new Date()
                      .toISOString()
                })
                .eq(
                  "id",
                  existing.id
                );

            if (deactivateError) {
              throw deactivateError;
            }

            report.deactivated += 1;

            continue;
          }


          const now =
            new Date()
              .toISOString();


          // ==================================================
          // FIRST PREMIUM
          // ==================================================

          if (!existing) {

            const {
              error: insertError
            } =
              await supabaseAdmin
                .from(
                  "market_pick_context"
                )
                .insert({

                  sport:
                    row.sport,

                  cashedge_game_id:
                    row.game_id,

                  canonical_pick:
                    canonical.pick ||
                    null,

                  market_type:
                    canonical.marketType ||
                    null,

                  selection_key:
                    canonical.selectionKey ||
                    null,

                  first_premium_line:
                    canonical.line,

                  first_premium_price_american:
                    canonical.priceAmerican,

                  current_cashedge_line:
                    canonical.line,

                  current_cashedge_price_american:
                    canonical.priceAmerican,

                  current_confidence:
                    canonical.confidence,

                  current_is_premium:
                    true,

                  source_updated_at:
                    row.updated_at ||
                    null,

                  last_synced_at:
                    now,

                  created_at:
                    now,

                  updated_at:
                    now
                });

            if (insertError) {
              throw insertError;
            }

            report.created += 1;

          } else {

            // =================================================
            // UPDATE CURRENT CASHEDGE STATE
            //
            // NEVER overwrite first_premium_*.
            // =================================================

            const {
              error: updateError
            } =
              await supabaseAdmin
                .from(
                  "market_pick_context"
                )
                .update({

                  canonical_pick:
                    canonical.pick ||
                    existing.canonical_pick ||
                    null,

                  market_type:
                    canonical.marketType ||
                    existing.market_type ||
                    null,

                  selection_key:
                    canonical.selectionKey ||
                    existing.selection_key ||
                    null,

                  current_cashedge_line:
                    canonical.line,

                  current_cashedge_price_american:
                    canonical.priceAmerican,

                  current_confidence:
                    canonical.confidence,

                  current_is_premium:
                    true,

                  source_updated_at:
                    row.updated_at ||
                    null,

                  last_synced_at:
                    now,

                  updated_at:
                    now
                })
                .eq(
                  "id",
                  existing.id
                );

            if (updateError) {
              throw updateError;
            }

            report.updated += 1;
          }


          report.details.push({
            sport:
              row.sport,

            gameId:
              row.game_id,

            pick:
              canonical.pick,

            marketType:
              canonical.marketType,

            line:
              canonical.line,

            price:
              canonical.priceAmerican,

            confidence:
              canonical.confidence
          });


        } catch (rowError) {

          report.errors += 1;

          report.details.push({
            sport:
              row.sport,

            gameId:
              row.game_id,

            error:
              rowError.message
          });
        }
      }


      return res
        .status(200)
        .json(report);


    } catch (error) {

      console.error(
        "MARKET PICK CONTEXT SYNC ERROR:",
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

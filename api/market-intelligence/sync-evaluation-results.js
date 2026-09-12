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


function calculateUnits(
  result,
  americanOdds
) {

  const normalized =
    String(result || "")
      .toLowerCase()
      .trim();

  if (
    normalized === "push"
  ) {
    return 0;
  }

  if (
    normalized === "loss"
  ) {
    return -1;
  }

  if (
    normalized !== "win"
  ) {
    return null;
  }


  const odds =
    safeNumber(
      americanOdds
    );


  if (
    odds === null ||
    odds === 0
  ) {
    return null;
  }


  // Risking 1 unit.
  //
  // -120 -> +0.8333u
  // -110 -> +0.9091u
  // +120 -> +1.20u

  if (odds < 0) {
    return Number(
      (
        100 /
        Math.abs(odds)
      ).toFixed(4)
    );
  }


  return Number(
    (
      odds /
      100
    ).toFixed(4)
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
      req.method !== "GET" &&
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          ok: false,
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


      const bearer =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : "";


      const querySecret =
        String(
          req.query.secret ||
          ""
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
        bearer !== validSecret &&
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
      // EVALUATION ROWS WAITING FOR RESULTS
      // ======================================================

      const {
        data: evaluationRows,
        error: evaluationError
      } =
        await supabaseAdmin
          .from(
            "market_evaluation_games"
          )
          .select(`
            id,
            sport,
            cashedge_game_id,
            canonical_pick,
            first_premium_price_american,
            result
          `)
          .is(
            "result",
            null
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          )
          .limit(500);


      if (evaluationError) {
        throw evaluationError;
      }


      const report = {

        ok: true,

        checked:
          0,

        graded:
          0,

        stillPending:
          0,

        noPrice:
          0,

        errors:
          0,

        details:
          []
      };


      // ======================================================
      // SYNC EACH GAME
      // ======================================================

      for (
        const row
        of evaluationRows || []
      ) {

        report.checked += 1;


        try {

          // ==================================================
          // FIND CANONICAL SETTLED CASHEDGE PICK
          // ==================================================

          const {
            data: settledPick,
            error: settledError
          } =
            await supabaseAdmin
              .from(
                "picks_history"
              )
              .select(`
                id,
                game_id,
                sport,
                pick,
                result,
                odds_american,
                graded_at,
                created_at
              `)
              .eq(
                "sport",
                row.sport
              )
              .eq(
                "game_id",
                row.cashedge_game_id
              )
              .eq(
                "is_premium",
                true
              )
              .in(
                "result",
                [
                  "win",
                  "loss",
                  "push"
                ]
              )
              .order(
                "graded_at",
                {
                  ascending: false,
                  nullsFirst: false
                }
              )
              .order(
                "created_at",
                {
                  ascending: false
                }
              )
              .limit(1)
              .maybeSingle();


          if (settledError) {
            throw settledError;
          }


          // ==================================================
          // GAME NOT GRADED YET
          // ==================================================

          if (!settledPick) {

            report.stillPending += 1;

            continue;
          }


          // ==================================================
          // CURRENT PRICE FROM MARKET PICK CONTEXT
          //
          // Used only as fallback if picks_history does not
          // contain odds_american for that sport.
          // ==================================================

          const {
            data: pickContext,
            error: contextError
          } =
            await supabaseAdmin
              .from(
                "market_pick_context"
              )
              .select(`
                current_cashedge_price_american
              `)
              .eq(
                "cashedge_game_id",
                row.cashedge_game_id
              )
              .maybeSingle();


          if (contextError) {
            throw contextError;
          }


          // ==================================================
          // PRICE PRIORITY
          //
          // 1. Actual settled picks_history price
          // 2. Last canonical CashEdge price
          // 3. First Premium price
          // ==================================================

          const historyPrice =
            safeNumber(
              settledPick
                .odds_american
            );


          const currentPrice =
            safeNumber(
              pickContext
                ?.current_cashedge_price_american
            );


          const firstPrice =
            safeNumber(
              row
                .first_premium_price_american
            );


          const gradedPrice =
            historyPrice ??
            currentPrice ??
            firstPrice ??
            null;


          // ==================================================
          // UNITS
          // ==================================================

          const units =
            calculateUnits(
              settledPick.result,
              gradedPrice
            );


          if (
            units === null &&
            settledPick.result === "win"
          ) {
            report.noPrice += 1;
          }


          const gradedAt =
            settledPick
              .graded_at ||
            new Date()
              .toISOString();


          // ==================================================
          // UPDATE INVISIBLE EVALUATION DATASET
          // ==================================================

          const {
            error: updateError
          } =
            await supabaseAdmin
              .from(
                "market_evaluation_games"
              )
              .update({

                result:
                  settledPick.result,

                units,

                graded_at:
                  gradedAt,

                graded_pick:
                  settledPick.pick ||
                  row.canonical_pick ||
                  null,

                graded_odds_american:
                  gradedPrice,

                result_source_pick_id:
                  settledPick.id,

                updated_at:
                  new Date()
                    .toISOString()
              })
              .eq(
                "id",
                row.id
              );


          if (updateError) {
            throw updateError;
          }


          report.graded += 1;


          report.details.push({

            sport:
              row.sport,

            gameId:
              row.cashedge_game_id,

            alignment:
              undefined,

            pick:
              settledPick.pick,

            result:
              settledPick.result,

            odds:
              gradedPrice,

            units
          });


        } catch (rowError) {

          report.errors += 1;


          report.details.push({

            sport:
              row.sport,

            gameId:
              row.cashedge_game_id,

            error:
              rowError.message
          });
        }
      }


      // ======================================================
      // INTERNAL COUNTER
      // ======================================================

      const {
        data: counter,
        error: counterError
      } =
        await supabaseAdmin
          .from(
            "market_evaluation_counter"
          )
          .select("*");


      if (counterError) {
        throw counterError;
      }


      return res
        .status(200)
        .json({

          ...report,

          counter:
            counter || []
        });


    } catch (error) {

      console.error(
        "MARKET EVALUATION RESULT SYNC ERROR:",
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

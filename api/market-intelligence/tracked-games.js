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

      // ========================================================
      // AUTH
      // ========================================================

      const configuredSecret =
        process.env
          .MARKET_INGEST_SECRET;

      if (!configuredSecret) {
        return res
          .status(500)
          .json({
            ok: false,
            error:
              "MARKET_INGEST_SECRET is not configured"
          });
      }


      const auth =
        String(
          req.headers
            .authorization ||
          ""
        );

      const token =
        auth.startsWith(
          "Bearer "
        )
          ? auth.slice(7)
          : "";


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


      // ========================================================
      // ACTIVE MARKET INTELLIGENCE GAMES
      // ========================================================

      const {
        data: contexts,
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
            current_cashedge_line,
            current_cashedge_price_american,
            current_confidence,
            current_is_premium
          `)
          .eq(
            "current_is_premium",
            true
          );


      if (contextError) {
        throw contextError;
      }


      if (
        !Array.isArray(contexts) ||
        contexts.length === 0
      ) {
        return res
          .status(200)
          .json({
            ok: true,
            games: []
          });
      }


      const gameIds =
        contexts
          .map(
            row =>
              String(
                row
                  .cashedge_game_id ||
                ""
              ).trim()
          )
          .filter(Boolean);


      if (!gameIds.length) {
        return res
          .status(200)
          .json({
            ok: true,
            games: []
          });
      }


      // ========================================================
      // CANONICAL CASHEDGE GAME DATA
      // ========================================================

      const {
        data: dailyRows,
        error: dailyError
      } =
        await supabaseAdmin
          .from(
            "daily_picks"
          )
          .select(`
            game_id,
            sport,
            game_date,
            away_team,
            home_team
          `)
          .in(
            "game_id",
            gameIds
          );


      if (dailyError) {
        throw dailyError;
      }


      const gameMap =
        new Map(
          (dailyRows || [])
            .map(
              row => [
                String(
                  row.game_id
                ),
                row
              ]
            )
        );


      // ========================================================
      // PROVIDER-NEUTRAL TRACKED GAME CONTRACT
      // ========================================================

      const games =
        contexts
          .map(
            context => {

              const game =
                gameMap.get(
                  String(
                    context
                      .cashedge_game_id
                  )
                );

              if (!game) {
                return null;
              }


              return {
                sport:
                  String(
                    context.sport ||
                    game.sport ||
                    ""
                  )
                    .trim()
                    .toLowerCase(),

                cashedge_game_id:
                  String(
                    context
                      .cashedge_game_id
                  ),

                game_date:
                  game.game_date ||
                  null,

                away_team:
                  game.away_team ||
                  null,

                home_team:
                  game.home_team ||
                  null,

                canonical_pick:
                  context
                    .canonical_pick ||
                  null,

                market_type:
                  context
                    .market_type ||
                  null,

                selection_key:
                  context
                    .selection_key ||
                  null,

                line:
                  context
                    .current_cashedge_line ??
                  null,

                price_american:
                  context
                    .current_cashedge_price_american ??
                  null,

                confidence:
                  context
                    .current_confidence ??
                  null
              };
            }
          )
          .filter(Boolean);


      return res
        .status(200)
        .json({
          ok: true,
          count:
            games.length,
          games
        });


    } catch (error) {

      console.error(
        "TRACKED MARKET GAMES ERROR:",
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

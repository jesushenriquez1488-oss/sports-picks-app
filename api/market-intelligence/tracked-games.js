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
// CENTRAL DATE
// ============================================================

function getCentralDate() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Chicago",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
      .formatToParts(
        new Date()
      );

  const map =
    Object.fromEntries(
      parts.map(
        part => [
          part.type,
          part.value
        ]
      )
    );

  return (
    `${map.year}-${map.month}-${map.day}`
  );
}


function addDays(
  dateString,
  days
) {
  const [
    year,
    month,
    day
  ] =
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
      // DATE WINDOW
      // ========================================================

      const today =
        getCentralDate();

      const footballEndDate =
        addDays(
          today,
          6
        );


      // ========================================================
      // DAILY SPORTS
      // MLB / NBA / WNBA / NCAAB
      // TODAY ONLY
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


      // ========================================================
      // FOOTBALL
      // NFL / NCAAF
      // TODAY + NEXT 6 DAYS
      // ========================================================

      const {
        data: footballRows,
        error: footballError
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


      const currentGames = [
        ...(dailyRows || []),
        ...(footballRows || [])
      ];


      if (!currentGames.length) {
        return res
          .status(200)
          .json({
            ok: true,
            count: 0,
            premiumCount: 0,
            games: []
          });
      }


      // ========================================================
      // CURRENT MARKET CONTEXT
      // LEFT JOIN — CONTEXT IS OPTIONAL
      // ========================================================

      const gameIds =
        currentGames
          .map(
            game =>
              String(
                game.game_id ||
                ""
              ).trim()
          )
          .filter(Boolean);


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
          .in(
            "cashedge_game_id",
            gameIds
          );


      if (contextError) {
        throw contextError;
      }


      const contextMap =
        new Map(
          (contexts || [])
            .map(
              row => [
                String(
                  row
                    .cashedge_game_id
                ),
                row
              ]
            )
        );


      // ========================================================
      // PROVIDER-NEUTRAL TRACKED GAME CONTRACT
      // ========================================================

      const games =
        currentGames
          .map(
            game => {

              const gameId =
                String(
                  game.game_id ||
                  ""
                ).trim();

              if (!gameId) {
                return null;
              }


              const context =
                contextMap.get(
                  gameId
                ) ||
                null;


              return {
                sport:
                  String(
                    game.sport ||
                    ""
                  )
                    .trim()
                    .toLowerCase(),

                cashedge_game_id:
                  gameId,

                game_date:
                  game.game_date ||
                  null,

                away_team:
                  game.away_team ||
                  null,

                home_team:
                  game.home_team ||
                  null,

                current_is_premium:
                  context
                    ?.current_is_premium ===
                  true,

                canonical_pick:
                  context
                    ?.canonical_pick ||
                  null,

                market_type:
                  context
                    ?.market_type ||
                  null,

                selection_key:
                  context
                    ?.selection_key ||
                  null,

                line:
                  context
                    ?.current_cashedge_line ??
                  null,

                price_american:
                  context
                    ?.current_cashedge_price_american ??
                  null,

                confidence:
                  context
                    ?.current_confidence ??
                  null
              };
            }
          )
          .filter(Boolean);


      const premiumCount =
        games.filter(
          game =>
            game
              .current_is_premium ===
            true
        ).length;


      return res
        .status(200)
        .json({
          ok: true,

          date:
            today,

          count:
            games.length,

          premiumCount,

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

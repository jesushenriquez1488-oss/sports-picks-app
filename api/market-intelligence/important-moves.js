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

      res.setHeader(
        "Allow",
        "GET"
      );


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
      // SERVER-ONLY AUTH
      //
      // MARKET_PIPELINE_SECRET only.
      // No query-string secrets.
      // ======================================================

      const expectedSecret =
        process.env
          .MARKET_PIPELINE_SECRET;


      if (!expectedSecret) {

        return res
          .status(500)
          .json({
            ok: false,
            error:
              "MARKET_PIPELINE_SECRET is not configured"
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
          ? authHeader
              .slice(7)
              .trim()
          : "";


      if (
        !secureEqual(
          bearer,
          expectedSecret
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
      // IMPORTANT EVENTS
      // ======================================================

      const {
        data: events,
        error
      } =
        await supabaseAdmin
          .from(
            "market_events"
          )
          .select(`
            id,
            sport,
            cashedge_game_id,
            market_type,
            selection_key,
            event_family,
            event_type,
            direction,
            severity,
            headline,
            explanation,
            event_data,
            importance_level,
            importance_reason,
            first_detected_at,
            last_detected_at
          `)
          .eq(
            "is_important_now",
            true
          )
          .gte(
            "importance_level",
            2
          )
          .order(
            "importance_level",
            {
              ascending: false
            }
          )
          .order(
            "first_detected_at",
            {
              ascending: false
            }
          )
          .limit(500);


      if (error) {
        throw error;
      }


      const rows =
        events || [];


      const gameIds =
        [
          ...new Set(
            rows.map(
              row =>
                row
                  .cashedge_game_id
            )
          )
        ];


      if (!gameIds.length) {

        return res
          .status(200)
          .json({

            ok: true,

            count: 0,

            games: []
          });
      }


      // ======================================================
      // PREMIUM CONTEXT
      // ======================================================

      const {
        data: contexts,
        error: contextError
      } =
        await supabaseAdmin
          .from(
            "market_pick_context"
          )
          .select(`
            cashedge_game_id,
            sport,
            canonical_pick,
            market_type,
            selection_key,
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
              context => [
                String(
                  context
                    .cashedge_game_id
                ),
                context
              ]
            )
        );


      // ======================================================
      // GROUP EVENTS BY GAME
      // ======================================================

      const groups =
        new Map();


      for (
        const event
        of rows
      ) {

        const gameId =
          String(
            event
              .cashedge_game_id
          );


        const context =
          contextMap.get(
            gameId
          );


        // Never surface a game that is no longer Premium.
        if (
          context
            ?.current_is_premium !==
          true
        ) {
          continue;
        }


        if (
          !groups.has(
            gameId
          )
        ) {

          groups.set(
            gameId,
            {

              gameId,

              sport:
                context.sport ||
                event.sport,

              pick:
                context
                  .canonical_pick,

              confidence:
                context
                  .current_confidence,

              marketType:
                context
                  .market_type,

              selectionKey:
                context
                  .selection_key,

              importanceLevel:
                0,

              events:
                []
            }
          );
        }


        const group =
          groups.get(
            gameId
          );


        group.importanceLevel =
          Math.max(
            group.importanceLevel,

            Number(
              event
                .importance_level ||
              0
            )
          );


        group.events.push({

          id:
            event.id,

          family:
            event
              .event_family,

          type:
            event
              .event_type,

          direction:
            event.direction,

          level:
            event
              .importance_level,

          headline:
            event.headline,

          explanation:
            event.explanation,

          reason:
            event
              .importance_reason,

          data:
            event.event_data,

          firstDetectedAt:
            event
              .first_detected_at,

          lastDetectedAt:
            event
              .last_detected_at
        });
      }


      // ======================================================
      // SORT GAMES
      // ======================================================

      const games =
        Array
          .from(
            groups.values()
          )
          .sort(
            (a, b) => {

              if (
                b.importanceLevel !==
                a.importanceLevel
              ) {

                return (
                  b.importanceLevel -
                  a.importanceLevel
                );
              }


              const aTime =
                new Date(
                  a.events?.[0]
                    ?.firstDetectedAt ||
                  0
                )
                  .getTime();


              const bTime =
                new Date(
                  b.events?.[0]
                    ?.firstDetectedAt ||
                  0
                )
                  .getTime();


              return (
                bTime -
                aTime
              );
            }
          );


      return res
        .status(200)
        .json({

          ok: true,

          // IMPORTANT:
          // This is number of GAMES,
          // not number of events.
          count:
            games.length,

          games
        });


    } catch (error) {

      console.error(
        "IMPORTANT MOVES LIST ERROR:",
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

const {
  createClient
} =
  require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


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


      if (
        !validSecret ||
        (
          bearer !== validSecret &&
          querySecret !== validSecret
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

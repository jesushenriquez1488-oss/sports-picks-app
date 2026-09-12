const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  evaluateImportantMoves
} =
  require("../../lib/marketImportance");


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


      const gameId =
        String(
          req.query.game_id ||
          ""
        )
          .trim();


      if (!gameId) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "game_id is required"
          });
      }


      const result =
        await evaluateImportantMoves({

          supabaseAdmin,
          gameId
        });


      return res
        .status(200)
        .json(result);


    } catch (error) {

      console.error(
        "IMPORTANT MOVES ERROR:",
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

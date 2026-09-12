const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  evaluateSharpSignal
} =
  require("../../lib/marketSharpSignals");


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

      // ======================================================
      // SECURITY
      // ======================================================

      const secret =
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
        secret !==
        validSecret
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
      // GAME
      // ======================================================

      const gameId =
        String(
          req.query.game_id ||
          ""
        ).trim();


      if (!gameId) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "game_id is required"
          });
      }


      // ======================================================
      // SHARP ENGINE
      // ======================================================

      const result =
        await evaluateSharpSignal({

          supabaseAdmin,
          gameId
        });


      return res
        .status(
          result.ok
            ? 200
            : 400
        )
        .json(result);


    } catch (error) {

      console.error(
        "SHARP SIGNAL ENGINE ERROR:",
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

const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  evaluateMarketGame
} =
  require("../../lib/marketEvaluation");


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
        process.env
          .MARKET_PIPELINE_SECRET;


      if (!configuredSecret) {

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


      // ======================================================
      // GAME
      // ======================================================

      const body =
        req.body || {};


      const gameId =
        String(
          body.game_id ||
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


      // ======================================================
      // EVALUATE
      // ======================================================

      const result =
        await evaluateMarketGame({

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
        "MARKET EVALUATION ERROR:",
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

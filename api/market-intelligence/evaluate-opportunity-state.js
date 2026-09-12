const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  evaluateOpportunityState
} =
  require("../../lib/marketOpportunityState");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


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
      .update(String(supplied))
      .digest();

  const b =
    crypto
      .createHash("sha256")
      .update(String(expected))
      .digest();

  return crypto
    .timingSafeEqual(
      a,
      b
    );
}


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


      const auth =
        String(
          req.headers.authorization ||
          ""
        );


      const bearer =
        auth.startsWith("Bearer ")
          ? auth.slice(7).trim()
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


      const gameId =
        String(
          req.body?.game_id ||
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
        await evaluateOpportunityState({

          supabaseAdmin,
          gameId
        });


      return res
        .status(200)
        .json(result);


    } catch (error) {

      console.error(
        "OPPORTUNITY STATE ERROR:",
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

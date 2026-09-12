const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  runMarketPipeline
} =
  require("../../lib/marketPipeline");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// CONSTANT-TIME SECRET COMPARISON
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
    Buffer.from(
      String(supplied)
    );

  const b =
    Buffer.from(
      String(expected)
    );


  if (
    a.length !==
    b.length
  ) {
    return false;
  }


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
      req.method !==
      "POST"
    ) {

      res.setHeader(
        "Allow",
        "POST"
      );


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
      // SERVER-ONLY AUTH
      //
      // NO query-string secrets.
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
              "Market pipeline secret is not configured"
          });
      }


      const auth =
        String(
          req.headers
            .authorization ||
          ""
        );


      if (
        !auth.startsWith(
          "Bearer "
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


      const suppliedSecret =
        auth
          .slice(7)
          .trim();


      if (
        !secureEqual(
          suppliedSecret,
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
      // BODY
      // ======================================================

      const gameId =
        String(
          req.body
            ?.game_id ||
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


      const sport =
        req.body
          ?.sport
          ? String(
              req.body.sport
            )
          : null;


      const providerTimestamp =
        req.body
          ?.provider_timestamp ||
        null;


      const receivedAt =
        req.body
          ?.received_at ||
        new Date()
          .toISOString();


      // ======================================================
      // PIPELINE
      // ======================================================

      const result =
        await runMarketPipeline({

          supabaseAdmin,

          gameId,
          sport,

          providerTimestamp,
          receivedAt
        });


      return res
        .status(200)
        .json(result);


    } catch (error) {

      console.error(
        "MARKET PIPELINE ERROR:",
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

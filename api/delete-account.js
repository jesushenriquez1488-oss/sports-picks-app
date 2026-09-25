const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const Stripe =
  require("stripe");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


const stripe =
  new Stripe(
    process.env.STRIPE_SECRET_KEY
  );


// ============================================================
// APPLE CLIENT SECRET
// ============================================================

function base64url(value) {

  return Buffer
    .from(value)
    .toString("base64url");
}


function createAppleClientSecret() {

  const teamId =
    process.env.APPLE_TEAM_ID;

  const keyId =
    process.env.APPLE_KEY_ID;

  const clientId =
    process.env.APPLE_CLIENT_ID;

  const privateKey =
    String(
      process.env.APPLE_PRIVATE_KEY ||
      ""
    )
      .replace(
        /\\n/g,
        "\n"
      );


  if (
    !teamId ||
    !keyId ||
    !clientId ||
    !privateKey
  ) {

    throw new Error(
      "Apple server credentials are missing."
    );
  }


  const now =
    Math.floor(
      Date.now() / 1000
    );


  const header = {
    alg:
      "ES256",

    kid:
      keyId,

    typ:
      "JWT"
  };


  const payload = {

    iss:
      teamId,

    iat:
      now,

    exp:
      now +
      (
        60 *
        60 *
        24 *
        30
      ),

    aud:
      "https://appleid.apple.com",

    sub:
      clientId
  };


  const encodedHeader =
    base64url(
      JSON.stringify(
        header
      )
    );


  const encodedPayload =
    base64url(
      JSON.stringify(
        payload
      )
    );


  const signingInput =
    `${encodedHeader}.${encodedPayload}`;


  const signature =
    crypto.sign(
      "sha256",

      Buffer.from(
        signingInput
      ),

      {
        key:
          privateKey,

        dsaEncoding:
          "ieee-p1363"
      }
    );


  return (
    signingInput +
    "." +
    signature.toString(
      "base64url"
    )
  );
}


// ============================================================
// REVOKE APPLE TOKEN
// ============================================================

async function revokeAppleToken(
  refreshToken
) {

  if (!refreshToken) {
    return;
  }


  const clientSecret =
    createAppleClientSecret();


  const body =
    new URLSearchParams({

      client_id:
        process.env.APPLE_CLIENT_ID,

      client_secret:
        clientSecret,

      token:
        refreshToken,

      token_type_hint:
        "refresh_token"
    });


  const response =
    await fetch(
      "https://appleid.apple.com/auth/revoke",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          body.toString()
      }
    );


  if (!response.ok) {

    let appleError =
      "APPLE_REVOKE_FAILED";


    try {

      const data =
        await response.json();

      appleError =
        data?.error ||
        appleError;

    } catch (_) {}


    throw new Error(
      `Apple token revocation failed: ${appleError}`
    );
  }


  console.log(
    "Apple authorization revoked."
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

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );


    if (
      req.method ===
      "OPTIONS"
    ) {

      return res
        .status(200)
        .end();
    }


    if (
      req.method !==
      "POST"
    ) {

      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });
    }


    try {

      // ======================================================
      // AUTHENTICATE USER
      // ======================================================

      const authHeader =
        String(
          req.headers
            .authorization ||
          ""
        );


      const token =
        authHeader
          .startsWith(
            "Bearer "
          )
          ? authHeader
              .slice(7)
              .trim()
          : null;


      if (!token) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const {
        data: authData,
        error: authError
      } =
        await supabaseAdmin
          .auth
          .getUser(
            token
          );


      const user =
        authData?.user;


      if (
        authError ||
        !user?.id
      ) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const userId =
        user.id;


      // ======================================================
      // LOAD CASHEDGE PROFILE
      // ======================================================

      const {
        data: profile,
        error: profileError
      } =
        await supabaseAdmin
          .from("users")
          .select(
            "id, stripe_customer_id"
          )
          .eq(
            "id",
            userId
          )
          .maybeSingle();


      if (profileError) {
        throw profileError;
      }


      // ======================================================
      // LOAD APPLE REFRESH TOKEN
      // ======================================================

      const {
        data: appleAuth,
        error: appleAuthError
      } =
        await supabaseAdmin
          .from(
            "apple_auth_tokens"
          )
          .select(
            "refresh_token"
          )
          .eq(
            "user_id",
            userId
          )
          .maybeSingle();


      if (appleAuthError) {
        throw appleAuthError;
      }


      // ======================================================
      // CANCEL STRIPE SUBSCRIPTIONS
      // ======================================================

      if (
        profile
          ?.stripe_customer_id
      ) {

        const subscriptions =
          await stripe
            .subscriptions
            .list({

              customer:
                profile
                  .stripe_customer_id,

              status:
                "all",

              limit:
                100
            });


        for (
          const subscription
          of subscriptions.data
        ) {

          if (
            subscription.status !==
              "canceled" &&

            subscription.status !==
              "incomplete_expired"
          ) {

            await stripe
              .subscriptions
              .cancel(
                subscription.id
              );
          }
        }
      }


      // ======================================================
      // REVOKE SIGN IN WITH APPLE
      // ======================================================

      if (
        appleAuth
          ?.refresh_token
      ) {

        await revokeAppleToken(
          appleAuth.refresh_token
        );
      }


      // ======================================================
      // DELETE ANALYSIS USAGE
      // ======================================================

      const {
        error: analysisError
      } =
        await supabaseAdmin
          .from(
            "analysis_usage"
          )
          .delete()
          .eq(
            "user_id",
            userId
          );


      if (analysisError) {
        throw analysisError;
      }


      // ======================================================
      // DELETE USER TRACKING
      // ======================================================

      const {
        error: trackingError
      } =
        await supabaseAdmin
          .from(
            "user_tracking"
          )
          .delete()
          .eq(
            "user_id",
            userId
          );


      if (trackingError) {
        throw trackingError;
      }


      // ======================================================
      // ANONYMIZE AFFILIATE SALES
      // ======================================================

      const {
        error: affiliateError
      } =
        await supabaseAdmin
          .from(
            "affiliate_sales"
          )
          .update({

            user_id:
              null,

            stripe_customer_id:
              null,

            stripe_session_id:
              null
          })
          .eq(
            "user_id",
            userId
          );


      if (affiliateError) {
        throw affiliateError;
      }


      // ======================================================
      // DELETE PUBLIC USER
      //
      // CASCADE also removes:
      // - apple_auth_tokens
      // - push_devices
      // - market_notification_deliveries
      // ======================================================

      const {
        error: userDeleteError
      } =
        await supabaseAdmin
          .from(
            "users"
          )
          .delete()
          .eq(
            "id",
            userId
          );


      if (userDeleteError) {
        throw userDeleteError;
      }


      // ======================================================
      // DELETE SUPABASE AUTH USER
      // ======================================================

      const {
        error: authDeleteError
      } =
        await supabaseAdmin
          .auth
          .admin
          .deleteUser(
            userId
          );


      if (authDeleteError) {
        throw authDeleteError;
      }


      return res
        .status(200)
        .json({
          success:
            true
        });


    } catch (error) {

      console.error(
        "DELETE ACCOUNT ERROR:",
        error?.message ||
        error
      );


      return res
        .status(500)
        .json({
          error:
            "Unable to delete account."
        });
    }
  };

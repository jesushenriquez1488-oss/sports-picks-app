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
    alg: "ES256",
    kid: keyId,
    typ: "JWT"
  };


  const payload = {
    iss: teamId,
    iat: now,

    // 30 days
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
      JSON.stringify(header)
    );


  const encodedPayload =
    base64url(
      JSON.stringify(payload)
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
// DECODE APPLE ID TOKEN
// ============================================================

function decodeJwtPayload(token) {

  const parts =
    String(token || "")
      .split(".");


  if (parts.length !== 3) {
    return null;
  }


  try {

    return JSON.parse(
      Buffer
        .from(
          parts[1],
          "base64url"
        )
        .toString(
          "utf8"
        )
    );

  } catch (_) {

    return null;
  }
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
      // AUTHENTICATE CASHEDGE USER
      // ======================================================

      const authHeader =
        String(
          req.headers
            .authorization ||
          ""
        );


      const accessToken =
        authHeader
          .startsWith(
            "Bearer "
          )
          ? authHeader
              .slice(7)
              .trim()
          : null;


      if (!accessToken) {

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
            accessToken
          );


      if (
        authError ||
        !authData?.user?.id
      ) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const userId =
        authData.user.id;


      // ======================================================
      // GET APPLE IDENTITY
      // ======================================================

      const {
        data: adminUserData,
        error: adminUserError
      } =
        await supabaseAdmin
          .auth
          .admin
          .getUserById(
            userId
          );


      if (
        adminUserError ||
        !adminUserData?.user
      ) {
        throw new Error(
          "Unable to load user."
        );
      }


      const appleIdentity =
        (
          adminUserData
            .user
            .identities ||
          []
        )
          .find(
            identity =>
              identity
                ?.provider ===
              "apple"
          );


      if (!appleIdentity) {

        return res
          .status(400)
          .json({
            error:
              "This account is not linked to Apple."
          });
      }


      const expectedAppleSub =
        appleIdentity
          ?.identity_data
          ?.sub;


      if (!expectedAppleSub) {

        throw new Error(
          "Apple identity is missing."
        );
      }


      // ======================================================
      // AUTHORIZATION CODE
      // ======================================================

      const authorizationCode =
        String(
          req.body
            ?.authorizationCode ||
          ""
        )
          .trim();


      if (!authorizationCode) {

        return res
          .status(400)
          .json({
            error:
              "Apple authorization code is required."
          });
      }


      // ======================================================
      // EXCHANGE CODE WITH APPLE
      // ======================================================

      const clientSecret =
        createAppleClientSecret();


      const body =
        new URLSearchParams({
          client_id:
            process.env
              .APPLE_CLIENT_ID,

          client_secret:
            clientSecret,

          code:
            authorizationCode,

          grant_type:
            "authorization_code"
        });


      const appleResponse =
        await fetch(
          "https://appleid.apple.com/auth/token",
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


      const appleData =
        await appleResponse
          .json();


      if (
        !appleResponse.ok ||
        !appleData
          ?.refresh_token ||
        !appleData
          ?.id_token
      ) {

        console.error(
          "Apple token exchange failed:",
          {
            status:
              appleResponse.status,

            error:
              appleData?.error ||
              "UNKNOWN_APPLE_ERROR"
          }
        );


        return res
          .status(400)
          .json({
            error:
              "Unable to validate Apple authorization."
          });
      }


      // ======================================================
      // VERIFY APPLE USER MATCHES CASHEDGE USER
      // ======================================================

      const applePayload =
        decodeJwtPayload(
          appleData.id_token
        );


      if (
        !applePayload?.sub ||
        applePayload.sub !==
          expectedAppleSub
      ) {

        return res
          .status(403)
          .json({
            error:
              "Apple identity mismatch."
          });
      }


      // ======================================================
      // STORE REFRESH TOKEN
      // ======================================================

      const {
        error: saveError
      } =
        await supabaseAdmin
          .from(
            "apple_auth_tokens"
          )
          .upsert(
            {
              user_id:
                userId,

              refresh_token:
                appleData
                  .refresh_token,

              updated_at:
                new Date()
                  .toISOString()
            },
            {
              onConflict:
                "user_id"
            }
          );


      if (saveError) {
        throw saveError;
      }


      return res
        .status(200)
        .json({
          success:
            true
        });


    } catch (error) {

      console.error(
        "APPLE AUTH TOKEN ERROR:",
        error?.message ||
        error
      );


      return res
        .status(500)
        .json({
          error:
            "Unable to save Apple authorization."
        });
    }
  };

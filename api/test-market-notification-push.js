// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// CONTROLLED ANDROID PUSH TEST
//
// POST /api/test-market-notification-push
//
// PURPOSE:
// - Test server -> OneSignal -> ONE exact Android device.
//
// DOES NOT:
// - enable Market Intelligence notifications
// - touch notification outbox
// - create deliveries
// - run fanout
// - use OneSignal segments
// - accept arbitrary device ids
//
// SECURITY:
// Authorization: Bearer CRON_SECRET
// ============================================================

const {
  timingSafeEqual
} = require("crypto");

const {
  createClient
} = require("@supabase/supabase-js");

const {
  sendOneSignalPush
} = require(
  "../lib/marketNotificationProvider"
);


// ============================================================
// FIXED CONTROLLED TEST DEVICE
// ============================================================

const TEST_PUSH_DEVICE_ID =
  "06803a07-6e7c-4608-b6a5-94c3afa5b943";


// ============================================================
// FIXED IDEMPOTENCY KEY
//
// If the endpoint is accidentally called twice,
// OneSignal should not create a duplicate test notification.
// ============================================================

const TEST_IDEMPOTENCY_KEY =
  "7c24a55d-56d7-4bb7-9b91-f5f38aa70317";


// ============================================================
// SUPABASE ADMIN
// ============================================================

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );


// ============================================================
// HELPERS
// ============================================================

function cleanString(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function safeSecretEqual(
  provided,
  expected
) {

  const providedBuffer =
    Buffer.from(
      cleanString(provided)
    );

  const expectedBuffer =
    Buffer.from(
      cleanString(expected)
    );


  if (
    providedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }


  if (
    providedBuffer.length === 0
  ) {
    return false;
  }


  try {

    return timingSafeEqual(
      providedBuffer,
      expectedBuffer
    );

  } catch (_) {

    return false;
  }
}


function getBearerToken(req) {

  const authorization =
    cleanString(
      req.headers?.authorization
    );


  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return "";
  }


  return authorization
    .slice(7)
    .trim();
}


// ============================================================
// AUTHORIZATION
// ============================================================

function authorizeRequest(req) {

  const expected =
    cleanString(
      process.env.CRON_SECRET
    );


  if (!expected) {

    return {
      ok: false,
      status: 500,
      error:
        "CRON_SECRET_NOT_CONFIGURED"
    };
  }


  const provided =
    getBearerToken(req);


  if (
    !safeSecretEqual(
      provided,
      expected
    )
  ) {

    return {
      ok: false,
      status: 401,
      error:
        "UNAUTHORIZED"
    };
  }


  return {
    ok: true
  };
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
      "Cache-Control",
      "no-store"
    );


    res.setHeader(
      "Content-Type",
      "application/json"
    );


    // ========================================================
    // POST ONLY
    // ========================================================

    if (
      req.method !== "POST"
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
            "METHOD_NOT_ALLOWED"
        });
    }


    // ========================================================
    // AUTH
    // ========================================================

    const authorization =
      authorizeRequest(req);


    if (!authorization.ok) {

      return res
        .status(
          authorization.status
        )
        .json({
          ok: false,
          error:
            authorization.error
        });
    }


    try {

      // ======================================================
      // LOAD ONLY THE FIXED TEST DEVICE
      // ======================================================

      const {
        data: device,
        error: deviceError
      } =
        await supabaseAdmin
          .from(
            "push_devices"
          )
          .select(`
            id,
            user_id,
            platform,
            provider,
            provider_subscription_id,
            permission_state,
            push_enabled,
            is_active,
            updated_at
          `)
          .eq(
            "id",
            TEST_PUSH_DEVICE_ID
          )
          .maybeSingle();


      if (deviceError) {

        throw new Error(
          `DEVICE_LOOKUP_FAILED: ${deviceError.message}`
        );
      }


      if (!device) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_NOT_FOUND"
          });
      }


      // ======================================================
      // HARD SAFETY CHECKS
      // ======================================================

      if (
        cleanString(
          device.platform
        ).toLowerCase() !==
        "android"
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_IS_NOT_ANDROID"
          });
      }


      if (
        cleanString(
          device.provider
        ).toLowerCase() !==
        "onesignal"
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_PROVIDER_INVALID"
          });
      }


      if (
        cleanString(
          device.permission_state
        ).toLowerCase() !==
        "granted"
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_PERMISSION_NOT_GRANTED"
          });
      }


      if (
        device.push_enabled !==
        true
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_PUSH_DISABLED"
          });
      }


      if (
        device.is_active !==
        true
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_INACTIVE"
          });
      }


      const subscriptionId =
        cleanString(
          device.provider_subscription_id
        );


      if (!subscriptionId) {

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "TEST_DEVICE_SUBSCRIPTION_MISSING"
          });
      }


      // ======================================================
      // SEND EXACTLY ONE TEST PUSH
      // ======================================================

      const providerResult =
        await sendOneSignalPush({

          subscriptionId,

          title:
            "CashEdge Push Test",

          message:
            "Market Intelligence notifications are connected successfully.",

          url:
            null,

          data: {
            test:
              true,

            source:
              "market_intelligence",

            type:
              "controlled_android_test"
          },

          priority:
            10,

          collapseId:
            "cashedge-mi-android-test",

          idempotencyKey:
            TEST_IDEMPOTENCY_KEY
        });


      // ======================================================
      // PROVIDER FAILED
      // ======================================================

      if (
        providerResult?.ok !==
        true
      ) {

        return res
          .status(502)
          .json({

            ok:
              false,

            test:
              "controlled_android_push",

            provider:
              providerResult
                ?.provider ||
              "onesignal",

            retryable:
              providerResult
                ?.retryable ===
              true,

            category:
              providerResult
                ?.category ||
              null,

            errorCode:
              providerResult
                ?.errorCode ||
              null,

            errorMessage:
              providerResult
                ?.errorMessage ||
              "OneSignal push test failed.",

            httpStatus:
              providerResult
                ?.httpStatus ??
              null
          });
      }


      // ======================================================
      // SUCCESS
      //
      // We intentionally do NOT return:
      // - provider_subscription_id
      // - user email
      // - secrets
      // ======================================================

      return res
        .status(200)
        .json({

          ok:
            true,

          test:
            "controlled_android_push",

          deviceId:
            device.id,

          platform:
            device.platform,

          provider:
            providerResult.provider,

          providerMessageId:
            providerResult
              .providerMessageId ||
            null,

          message:
            "Controlled Android push accepted by OneSignal."
        });


    } catch (error) {

      return res
        .status(500)
        .json({

          ok:
            false,

          test:
            "controlled_android_push",

          error:
            cleanString(
              error?.message ||
              error
            ).slice(
              0,
              2000
            )
        });
    }
  };

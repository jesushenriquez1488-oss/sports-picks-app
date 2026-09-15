// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// CONTROLLED DELIVERY QUEUE TEST
//
// POST /api/test-market-notification-delivery
//
// PURPOSE:
// - Create ONE synthetic parent.
// - Create ONE delivery for the fixed Android test device.
// - Temporarily enable notification delivery.
// - Process through the REAL Delivery Worker.
// - Verify final delivery status.
// - Disable notifications again.
// - Remove synthetic test rows.
//
// DOES NOT:
// - run fanout
// - notify other users
// - enable event detection
// - enable frontend MI
// - touch analyzers
// - touch Premium Radar
//
// SECURITY:
// Authorization: Bearer CRON_SECRET
// ============================================================

const {
  randomUUID,
  timingSafeEqual
} = require("crypto");

const {
  createClient
} = require("@supabase/supabase-js");

const {
  processOneMarketNotificationDelivery
} = require(
  "../lib/marketNotificationDeliveryWorker"
);


// ============================================================
// FIXED TEST DEVICE
// ============================================================

const TEST_PUSH_DEVICE_ID =
  "06803a07-6e7c-4608-b6a5-94c3afa5b943";


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
// COUNT ACTIVE DELIVERIES
// ============================================================

async function countActiveDeliveries() {

  const {
    count,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_deliveries"
      )
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .in(
        "status",
        [
          "pending",
          "processing",
          "retry"
        ]
      );


  if (error) {

    throw new Error(
      `DELIVERY_QUEUE_CHECK_FAILED: ${error.message}`
    );
  }


  return Number(
    count || 0
  );
}


// ============================================================
// COUNT ACTIVE / CLAIMABLE PARENTS
// ============================================================

async function countActiveParents() {

  const {
    count,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .in(
        "status",
        [
          "pending",
          "retry",
          "processing"
        ]
      );


  if (error) {

    throw new Error(
      `PARENT_QUEUE_CHECK_FAILED: ${error.message}`
    );
  }


  return Number(
    count || 0
  );
}


// ============================================================
// SET NOTIFICATION KILL SWITCH
// ============================================================

async function setNotificationsEnabled(
  enabled
) {

  const {
    error
  } =
    await supabaseAdmin
      .from(
        "market_intelligence_settings"
      )
      .update({
        notifications_enabled:
          enabled === true
      })
      .eq(
        "id",
        1
      );


  if (error) {

    throw new Error(
      `NOTIFICATION_SWITCH_UPDATE_FAILED: ${error.message}`
    );
  }
}


// ============================================================
// CLEANUP TEST DATA
// ============================================================

async function cleanupSyntheticRows({
  deliveryId,
  parentId
}) {

  const cleanup = {
    deliveryDeleted: false,
    parentDeleted: false,
    errors: []
  };


  if (deliveryId) {

    const {
      error
    } =
      await supabaseAdmin
        .from(
          "market_notification_deliveries"
        )
        .delete()
        .eq(
          "id",
          deliveryId
        );


    if (error) {

      cleanup.errors.push(
        `DELIVERY_CLEANUP_FAILED: ${error.message}`
      );

    } else {

      cleanup.deliveryDeleted =
        true;
    }
  }


  if (parentId) {

    const {
      error
    } =
      await supabaseAdmin
        .from(
          "market_notification_outbox"
        )
        .delete()
        .eq(
          "id",
          parentId
        );


    if (error) {

      cleanup.errors.push(
        `PARENT_CLEANUP_FAILED: ${error.message}`
      );

    } else {

      cleanup.parentDeleted =
        true;
    }
  }


  return cleanup;
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


    // ========================================================
    // TEST STATE
    // ========================================================

    let parentId =
      null;

    let deliveryId =
      null;

    let notificationsTemporarilyEnabled =
      false;

    let responseStatus =
      500;

    let responsePayload = {
      ok: false,
      test:
        "controlled_delivery_queue"
    };

    let cleanupResult =
      null;


    try {

      // ======================================================
      // 1. SETTINGS PREFLIGHT
      // ======================================================

      const {
        data: settings,
        error: settingsError
      } =
        await supabaseAdmin
          .from(
            "market_intelligence_settings"
          )
          .select(`
            notifications_enabled,
            event_detection_enabled,
            frontend_enabled
          `)
          .eq(
            "id",
            1
          )
          .maybeSingle();


      if (settingsError) {

        throw new Error(
          `SETTINGS_LOOKUP_FAILED: ${settingsError.message}`
        );
      }


      if (!settings) {

        throw new Error(
          "MARKET_INTELLIGENCE_SETTINGS_NOT_FOUND"
        );
      }


      // Test must begin with notifications OFF.
      if (
        settings.notifications_enabled ===
        true
      ) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "NOTIFICATIONS_ALREADY_ENABLED",
          message:
            "Test refused because notifications_enabled was already true."
        };

        return;
      }


      // Extra isolation:
      // real event detection must still be OFF.
      if (
        settings.event_detection_enabled ===
        true
      ) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "EVENT_DETECTION_ALREADY_ENABLED",
          message:
            "Test refused because event_detection_enabled was already true."
        };

        return;
      }


      // ======================================================
      // 2. QUEUE MUST BE COMPLETELY CLEAN
      // ======================================================

      const activeDeliveries =
        await countActiveDeliveries();

      const activeParents =
        await countActiveParents();


      if (
        activeDeliveries !== 0 ||
        activeParents !== 0
      ) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "QUEUE_NOT_EMPTY",
          activeDeliveries,
          activeParents
        };

        return;
      }


      // ======================================================
      // 3. LOAD FIXED ANDROID DEVICE
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
            is_active
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

        responseStatus =
          404;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "TEST_DEVICE_NOT_FOUND"
        };

        return;
      }


      if (
        cleanString(
          device.platform
        ).toLowerCase() !==
        "android" ||

        cleanString(
          device.provider
        ).toLowerCase() !==
        "onesignal" ||

        cleanString(
          device.permission_state
        ).toLowerCase() !==
        "granted" ||

        device.push_enabled !==
        true ||

        device.is_active !==
        true ||

        !cleanString(
          device.provider_subscription_id
        )
      ) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "TEST_DEVICE_NOT_ELIGIBLE"
        };

        return;
      }


      // ======================================================
      // 4. VERIFY REAL STRIPE PREMIUM ELIGIBILITY
      //
      // Same policy used by the production validator.
      // ======================================================

      const {
        data: user,
        error: userError
      } =
        await supabaseAdmin
          .from(
            "users"
          )
          .select(`
            id,
            is_premium,
            subscription_status,
            stripe_customer_id
          `)
          .eq(
            "id",
            device.user_id
          )
          .maybeSingle();


      if (userError) {

        throw new Error(
          `USER_LOOKUP_FAILED: ${userError.message}`
        );
      }


      const eligiblePremium =
        user?.is_premium ===
          true &&

        cleanString(
          user?.subscription_status
        ).toLowerCase() ===
          "premium" &&

        Boolean(
          cleanString(
            user?.stripe_customer_id
          )
        );


      if (!eligiblePremium) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "TEST_USER_NOT_ELIGIBLE_STRIPE_PREMIUM"
        };

        return;
      }


      // ======================================================
      // 5. CREATE SYNTHETIC PARENT
      //
      // status = fanout_ready means:
      // - Parent Worker will not claim it.
      // - Delivery Worker can still validate its child.
      //
      // revalidation_required = false because this test is
      // validating the delivery queue, not a market condition.
      // ======================================================

      const syntheticKey =
        `synthetic-delivery-test:${randomUUID()}`;

      const expiresAt =
        new Date(
          Date.now() +
          10 * 60 * 1000
        ).toISOString();


      const {
        data: parent,
        error: parentError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .insert({

            cashedge_game_id:
              `synthetic-delivery-test-${Date.now()}`,

            notification_key:
              syntheticKey,

            notification_kind:
              "VALUE_AVAILABLE",

            delivery_class:
              "immediate",

            audience:
              "premium",

            title:
              "CashEdge Queue Test",

            body:
              "The Market Intelligence delivery queue is working correctly.",

            deep_link:
              null,

            expires_at:
              expiresAt,

            status:
              "fanout_ready",

            dispatch_enabled:
              false,

            notification_provider:
              "onesignal",

            payload: {
              synthetic:
                true,

              test:
                "controlled_delivery_queue",

              targetDeviceId:
                TEST_PUSH_DEVICE_ID
            },

            revalidation_required:
              false,

            attempt_count:
              0,

            next_attempt_at:
              null,

            processing_started_at:
              null,

            lock_token:
              null,

            provider_message_id:
              null,

            cancelled_at:
              null,

            cancel_reason:
              null,

            sent_at:
              null,

            error_message:
              null
          })
          .select(
            "id"
          )
          .single();


      if (parentError) {

        throw new Error(
          `SYNTHETIC_PARENT_INSERT_FAILED: ${parentError.message}`
        );
      }


      parentId =
        parent.id;


      // ======================================================
      // 6. CREATE EXACTLY ONE DELIVERY
      // ======================================================

      const {
        data: delivery,
        error: deliveryError
      } =
        await supabaseAdmin
          .from(
            "market_notification_deliveries"
          )
          .insert({

            notification_id:
              parentId,

            user_id:
              device.user_id,

            push_device_id:
              device.id,

            platform:
              device.platform,

            provider:
              device.provider,

            provider_subscription_id:
              device.provider_subscription_id,

            status:
              "pending",

            attempt_count:
              0,

            next_attempt_at:
              new Date()
                .toISOString(),

            processing_started_at:
              null,

            lock_token:
              null,

            provider_message_id:
              null,

            sent_at:
              null,

            cancelled_at:
              null,

            cancel_reason:
              null,

            eligibility_checked_at:
              new Date()
                .toISOString(),

            eligibility_result:
              "eligible",

            eligibility_reason:
              "Controlled delivery queue test",

            last_error:
              null
          })
          .select(
            "id"
          )
          .single();


      if (deliveryError) {

        throw new Error(
          `SYNTHETIC_DELIVERY_INSERT_FAILED: ${deliveryError.message}`
        );
      }


      deliveryId =
        delivery.id;


      // ======================================================
      // 7. ISOLATION CHECK
      //
      // There must now be EXACTLY ONE active delivery,
      // and it must be the row we just created.
      // ======================================================

      const {
        data: activeRows,
        error: activeRowsError
      } =
        await supabaseAdmin
          .from(
            "market_notification_deliveries"
          )
          .select(
            "id"
          )
          .in(
            "status",
            [
              "pending",
              "processing",
              "retry"
            ]
          );


      if (activeRowsError) {

        throw new Error(
          `QUEUE_ISOLATION_CHECK_FAILED: ${activeRowsError.message}`
        );
      }


      if (
        !Array.isArray(
          activeRows
        ) ||

        activeRows.length !==
          1 ||

        Number(
          activeRows[0]?.id
        ) !==
        Number(
          deliveryId
        )
      ) {

        responseStatus =
          409;

        responsePayload = {
          ok: false,
          test:
            "controlled_delivery_queue",
          error:
            "QUEUE_ISOLATION_LOST"
        };

        return;
      }


      // ======================================================
      // 8. TEMPORARILY ENABLE DELIVERY
      // ======================================================

      await setNotificationsEnabled(
        true
      );


      notificationsTemporarilyEnabled =
        true;


      // ======================================================
      // 9. RUN THE REAL DELIVERY WORKER
      // ======================================================

      const workerLockToken =
        randomUUID();


      const workerResult =
        await processOneMarketNotificationDelivery({

          lockToken:
            workerLockToken,

          leaseSeconds:
            30,

          // For this controlled test we do not want
          // repeated provider retries.
          maxAttempts:
            1
        });


      // ======================================================
      // 10. READ FINAL DELIVERY STATE
      // ======================================================

      const {
        data: finalDelivery,
        error: finalDeliveryError
      } =
        await supabaseAdmin
          .from(
            "market_notification_deliveries"
          )
          .select(`
            id,
            status,
            attempt_count,
            provider_message_id,
            sent_at,
            eligibility_result,
            eligibility_reason,
            last_error
          `)
          .eq(
            "id",
            deliveryId
          )
          .maybeSingle();


      if (finalDeliveryError) {

        throw new Error(
          `FINAL_DELIVERY_READ_FAILED: ${finalDeliveryError.message}`
        );
      }


      const sentSuccessfully =
        workerResult?.sent ===
          true &&

        finalDelivery?.status ===
          "sent" &&

        Boolean(
          finalDelivery?.sent_at
        );


      if (!sentSuccessfully) {

        responseStatus =
          502;

        responsePayload = {

          ok:
            false,

          test:
            "controlled_delivery_queue",

          error:
            "DELIVERY_QUEUE_TEST_DID_NOT_REACH_SENT",

          worker: {
            ok:
              workerResult?.ok ??
              null,

            processed:
              workerResult
                ?.processed ??
              null,

            sent:
              workerResult?.sent ??
              null,

            reason:
              workerResult?.reason ||
              null
          },

          delivery: {
            id:
              finalDelivery?.id ||
              deliveryId,

            status:
              finalDelivery?.status ||
              null,

            attempts:
              finalDelivery
                ?.attempt_count ??
              null,

            providerMessageId:
              finalDelivery
                ?.provider_message_id ||
              null,

            sentAt:
              finalDelivery?.sent_at ||
              null,

            eligibilityResult:
              finalDelivery
                ?.eligibility_result ||
              null,

            eligibilityReason:
              finalDelivery
                ?.eligibility_reason ||
              null,

            lastError:
              finalDelivery
                ?.last_error ||
              null
          }
        };

        return;
      }


      // ======================================================
      // SUCCESS
      // ======================================================

      responseStatus =
        200;

      responsePayload = {

        ok:
          true,

        test:
          "controlled_delivery_queue",

        worker:
          "market_notification_delivery",

        deviceId:
          TEST_PUSH_DEVICE_ID,

        delivery: {
          id:
            finalDelivery.id,

          status:
            finalDelivery.status,

          attempts:
            finalDelivery.attempt_count,

          providerMessageId:
            finalDelivery.provider_message_id,

          sentAt:
            finalDelivery.sent_at,

          eligibilityResult:
            finalDelivery.eligibility_result
        },

        message:
          "Real delivery queue test completed successfully."
      };


    } catch (error) {

      responseStatus =
        500;

      responsePayload = {

        ok:
          false,

        test:
          "controlled_delivery_queue",

        error:
          cleanString(
            error?.message ||
            error
          ).slice(
            0,
            2000
          )
      };


    } finally {

      // ======================================================
      // ABSOLUTE SAFETY:
      // ALWAYS RETURN notifications_enabled TO FALSE.
      // ======================================================

      try {

        await setNotificationsEnabled(
          false
        );

      } catch (switchError) {

        responsePayload
          .switchResetError =
          cleanString(
            switchError?.message ||
            switchError
          ).slice(
            0,
            1000
          );
      }


      notificationsTemporarilyEnabled =
        false;


      // ======================================================
      // REMOVE ONLY THE SYNTHETIC ROWS CREATED BY THIS TEST.
      //
      // This prevents the synthetic notification from:
      // - consuming the daily limit
      // - remaining in the production queue
      // - polluting notification history
      // ======================================================

      try {

        cleanupResult =
          await cleanupSyntheticRows({
            deliveryId,
            parentId
          });


        responsePayload.cleanup =
          cleanupResult;

      } catch (cleanupError) {

        responsePayload
          .cleanup = {
            error:
              cleanString(
                cleanupError?.message ||
                cleanupError
              ).slice(
                0,
                1000
              )
          };
      }


      responsePayload
        .notificationsEnabledAfterTest =
        false;
    }


    return res
      .status(
        responseStatus
      )
      .json(
        responsePayload
      );
  };

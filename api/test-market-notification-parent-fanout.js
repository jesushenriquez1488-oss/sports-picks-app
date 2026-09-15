// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// CONTROLLED PARENT + FANOUT TEST
//
// POST /api/test-market-notification-parent-fanout
//
// PURPOSE:
// - Create ONE synthetic parent.
// - Temporarily enable notifications.
// - Run the REAL Parent Worker.
// - Run the REAL fanout_market_notification_v1.
// - Verify pending child deliveries were created.
// - Disable notifications IMMEDIATELY after fanout.
// - NEVER execute Delivery Worker.
// - Delete all synthetic deliveries + parent.
//
// DOES NOT:
// - send pushes
// - call OneSignal
// - process child deliveries
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
  processOneMarketNotificationParent
} = require(
  "../lib/marketNotificationParentWorker"
);


// ============================================================
// SUPABASE
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
// SETTINGS
// ============================================================

async function loadSettings() {

  const {
    data,
    error
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


  if (error) {

    throw new Error(
      `SETTINGS_LOOKUP_FAILED: ${error.message}`
    );
  }


  return data || null;
}


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
// QUEUE PREFLIGHT
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
          "processing",
          "retry"
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
// CLEANUP
// ============================================================

async function cleanupSyntheticRows(
  parentId
) {

  const cleanup = {

    deliveriesDeleted:
      0,

    parentDeleted:
      false,

    errors:
      []
  };


  if (!parentId) {
    return cleanup;
  }


  // ==========================================================
  // CHILDREN FIRST
  // ==========================================================

  try {

    const {
      data,
      error
    } =
      await supabaseAdmin
        .from(
          "market_notification_deliveries"
        )
        .delete()
        .eq(
          "notification_id",
          parentId
        )
        .select(
          "id"
        );


    if (error) {

      cleanup.errors.push(
        `DELIVERY_CLEANUP_FAILED: ${error.message}`
      );

    } else {

      cleanup.deliveriesDeleted =
        Array.isArray(data)
          ? data.length
          : 0;
    }

  } catch (error) {

    cleanup.errors.push(
      `DELIVERY_CLEANUP_FAILED: ${
        cleanString(
          error?.message ||
          error
        )
      }`
    );
  }


  // ==========================================================
  // PARENT SECOND
  // ==========================================================

  try {

    const {
      data,
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
        )
        .select(
          "id"
        )
        .maybeSingle();


    if (error) {

      cleanup.errors.push(
        `PARENT_CLEANUP_FAILED: ${error.message}`
      );

    } else {

      cleanup.parentDeleted =
        Boolean(
          data?.id
        );
    }

  } catch (error) {

    cleanup.errors.push(
      `PARENT_CLEANUP_FAILED: ${
        cleanString(
          error?.message ||
          error
        )
      }`
    );
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

    let responseStatus =
      500;

    let responsePayload = {

      ok:
        false,

      test:
        "controlled_parent_fanout"
    };


    try {

      // ======================================================
      // 1. SETTINGS PREFLIGHT
      // ======================================================

      const settings =
        await loadSettings();


      if (!settings) {

        throw new Error(
          "MARKET_INTELLIGENCE_SETTINGS_NOT_FOUND"
        );
      }


      // Must begin OFF.
      if (
        settings.notifications_enabled ===
        true
      ) {

        responseStatus =
          409;

        responsePayload = {

          ok:
            false,

          test:
            "controlled_parent_fanout",

          error:
            "NOTIFICATIONS_ALREADY_ENABLED"
        };

        return;
      }


      // Real market events must remain OFF.
      if (
        settings.event_detection_enabled ===
        true
      ) {

        responseStatus =
          409;

        responsePayload = {

          ok:
            false,

          test:
            "controlled_parent_fanout",

          error:
            "EVENT_DETECTION_ALREADY_ENABLED"
        };

        return;
      }


      // ======================================================
      // 2. QUEUES MUST START EMPTY
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

          ok:
            false,

          test:
            "controlled_parent_fanout",

          error:
            "QUEUE_NOT_EMPTY",

          activeDeliveries,
          activeParents
        };

        return;
      }


      // ======================================================
      // 3. CREATE ONE SYNTHETIC CLAIMABLE PARENT
      //
      // Exact requirements from claim_market_notification_v1:
      //
      // status = pending
      // dispatch_enabled = true
      // audience = premium
      // sent_at = null
      // cancelled_at = null
      // expires_at > now()
      // next_attempt_at <= now() or null
      // ======================================================

      const testUuid =
        randomUUID();

      const now =
        new Date();

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

            market_event_id:
              null,

            cashedge_game_id:
              `synthetic-parent-fanout-${testUuid}`,

            notification_key:
              `synthetic-parent-fanout:${testUuid}`,

            notification_kind:
              "VALUE_AVAILABLE",

            delivery_class:
              "immediate",

            audience:
              "premium",

            title:
              "CashEdge Fanout Test",

            body:
              "Synthetic Market Intelligence fanout test.",

            deep_link:
              null,

            priority:
              "urgent",

            expires_at:
              expiresAt,

            status:
              "pending",

            dispatch_enabled:
              true,

            notification_provider:
              "onesignal",

            payload: {

              synthetic:
                true,

              test:
                "controlled_parent_fanout",

              noProviderSend:
                true
            },

            revalidation_required:
              false,

            last_validated_at:
              null,

            attempt_count:
              0,

            next_attempt_at:
              now.toISOString(),

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

            source_event_at:
              now.toISOString(),

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
      // 4. ISOLATION CHECK
      //
      // There must be exactly ONE active parent now,
      // and it must be ours.
      // ======================================================

      const {
        data: activeParentRows,
        error: activeParentRowsError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .select(`
            id,
            status,
            dispatch_enabled
          `)
          .in(
            "status",
            [
              "pending",
              "processing",
              "retry"
            ]
          );


      if (activeParentRowsError) {

        throw new Error(
          `PARENT_ISOLATION_CHECK_FAILED: ${activeParentRowsError.message}`
        );
      }


      if (
        !Array.isArray(
          activeParentRows
        ) ||

        activeParentRows.length !==
          1 ||

        Number(
          activeParentRows[0]?.id
        ) !==
        Number(
          parentId
        )
      ) {

        responseStatus =
          409;

        responsePayload = {

          ok:
            false,

          test:
            "controlled_parent_fanout",

          error:
            "PARENT_QUEUE_ISOLATION_LOST"
        };

        return;
      }


      // ======================================================
      // 5. ENABLE MASTER SWITCH TEMPORARILY
      // ======================================================

      await setNotificationsEnabled(
        true
      );


      // ======================================================
      // 6. RUN REAL PARENT WORKER
      //
      // This will:
      //
      // claim_market_notification_v1
      //        ↓
      // fanout_market_notification_v1
      //        ↓
      // pending child deliveries
      //
      // NO DELIVERY WORKER IS CALLED.
      // ======================================================

      const workerResult =
        await processOneMarketNotificationParent({

          lockToken:
            randomUUID(),

          leaseSeconds:
            30
        });


      // ======================================================
      // 7. KILL SWITCH OFF IMMEDIATELY
      //
      // Do this BEFORE reading/verifying anything else.
      //
      // Once false, child deliveries cannot be claimed
      // by the normal Delivery Worker.
      // ======================================================

      await setNotificationsEnabled(
        false
      );


      // ======================================================
      // 8. READ FINAL PARENT
      // ======================================================

      const {
        data: finalParent,
        error: finalParentError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .select(`
            id,
            status,
            dispatch_enabled,
            lock_token,
            processing_started_at,
            sent_at,
            cancelled_at,
            error_message
          `)
          .eq(
            "id",
            parentId
          )
          .maybeSingle();


      if (finalParentError) {

        throw new Error(
          `FINAL_PARENT_READ_FAILED: ${finalParentError.message}`
        );
      }


      // ======================================================
      // 9. READ CHILD DELIVERIES
      // ======================================================

      const {
        data: deliveries,
        error: deliveriesError
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
            eligibility_reason
          `)
          .eq(
            "notification_id",
            parentId
          )
          .order(
            "id",
            {
              ascending:
                true
            }
          );


      if (deliveriesError) {

        throw new Error(
          `FANOUT_DELIVERY_READ_FAILED: ${deliveriesError.message}`
        );
      }


      const childDeliveries =
        Array.isArray(
          deliveries
        )
          ? deliveries
          : [];


      const pendingCount =
        childDeliveries
          .filter(
            row =>
              row.status ===
              "pending"
          )
          .length;


      const processingCount =
        childDeliveries
          .filter(
            row =>
              row.status ===
              "processing"
          )
          .length;


      const sentCount =
        childDeliveries
          .filter(
            row =>
              row.status ===
              "sent" ||
              Boolean(
                row.sent_at
              ) ||
              Boolean(
                row.provider_message_id
              )
          )
          .length;


      // ======================================================
      // 10. VERIFY REAL FANOUT
      // ======================================================

      const workerInserted =
        Number(
          workerResult
            ?.insertedDeliveries ||
          0
        );


      const workerExisting =
        Number(
          workerResult
            ?.existingDeliveries ||
          0
        );


      const fanoutSucceeded =
        workerResult?.ok ===
          true &&

        workerResult?.processed ===
          true &&

        workerResult?.fanout ===
          true &&

        Number(
          workerResult
            ?.notificationId
        ) ===
          Number(
            parentId
          ) &&

        finalParent?.status ===
          "fanout_ready" &&

        finalParent
          ?.dispatch_enabled ===
          false &&

        childDeliveries.length >
          0 &&

        pendingCount ===
          childDeliveries.length &&

        processingCount ===
          0 &&

        sentCount ===
          0 &&

        workerInserted ===
          childDeliveries.length &&

        workerExisting ===
          0;


      if (!fanoutSucceeded) {

        responseStatus =
          502;

        responsePayload = {

          ok:
            false,

          test:
            "controlled_parent_fanout",

          error:
            "PARENT_FANOUT_TEST_DID_NOT_COMPLETE_AS_EXPECTED",

          worker: {

            ok:
              workerResult?.ok ??
              null,

            processed:
              workerResult
                ?.processed ??
              null,

            fanout:
              workerResult
                ?.fanout ??
              null,

            notificationId:
              workerResult
                ?.notificationId ??
              null,

            parentStatus:
              workerResult
                ?.parentStatus ||
              null,

            premiumUsers:
              workerResult
                ?.premiumUsers ??
              null,

            recipientUsers:
              workerResult
                ?.recipientUsers ??
              null,

            eligibleDevices:
              workerResult
                ?.eligibleDevices ??
              null,

            insertedDeliveries:
              workerInserted,

            existingDeliveries:
              workerExisting,

            reason:
              workerResult
                ?.reason ||
              null
          },

          parent: {

            id:
              finalParent?.id ||
              parentId,

            status:
              finalParent
                ?.status ||
              null,

            dispatchEnabled:
              finalParent
                ?.dispatch_enabled ??
              null
          },

          deliveries: {

            total:
              childDeliveries.length,

            pending:
              pendingCount,

            processing:
              processingCount,

            sent:
              sentCount
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
          "controlled_parent_fanout",

        worker:
          "market_notification_parent",

        parent: {

          id:
            parentId,

          status:
            finalParent.status,

          dispatchEnabled:
            finalParent
              .dispatch_enabled
        },

        fanout: {

          premiumUsers:
            workerResult
              .premiumUsers,

          recipientUsers:
            workerResult
              .recipientUsers,

          eligibleDevices:
            workerResult
              .eligibleDevices,

          insertedDeliveries:
            workerInserted,

          existingDeliveries:
            workerExisting
        },

        deliveries: {

          total:
            childDeliveries.length,

          pending:
            pendingCount,

          processing:
            processingCount,

          sent:
            sentCount
        },

        providerSend:
          false,

        message:
          "Real Parent Worker and fanout completed successfully. No push provider was called."
      };


    } catch (error) {

      responseStatus =
        500;

      responsePayload = {

        ok:
          false,

        test:
          "controlled_parent_fanout",

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
      // 11. ABSOLUTE KILL SWITCH SAFETY
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


      // ======================================================
      // 12. DELETE SYNTHETIC CHILDREN + PARENT
      //
      // This also prevents the temporary pending deliveries
      // from counting toward today's notification limit.
      // ======================================================

      try {

        const cleanup =
          await cleanupSyntheticRows(
            parentId
          );


        responsePayload.cleanup =
          cleanup;

      } catch (cleanupError) {

        responsePayload.cleanup = {

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

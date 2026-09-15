const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  revalidateMarketNotification
} =
  require("../lib/marketNotificationRevalidation");


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
// CLEANUP
// ============================================================

async function cleanup(
  notificationKey
) {

  if (!notificationKey) {
    return;
  }

  await supabaseAdmin
    .from(
      "market_notification_outbox"
    )
    .delete()
    .eq(
      "notification_key",
      notificationKey
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
      req.method !==
      "POST"
    ) {

      return res
        .status(405)
        .json({
          ok: false,
          error:
            "POST required"
        });
    }


    // ========================================================
    // AUTH
    // ========================================================

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


    const secret =
      process.env.CRON_SECRET;


    if (!secret) {

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "CRON_SECRET is not configured"
        });
    }


    if (
      !secureEqual(
        bearer,
        secret
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


    // ========================================================
    // UNIQUE SYNTHETIC TEST DATA
    // ========================================================

    const testId =
      Date.now() +
      "-" +
      crypto
        .randomBytes(6)
        .toString("hex");


    const fakeGameId =
      `synthetic-revalidation-game-${testId}`;


    const notificationKey =
      `synthetic-revalidation-${testId}`;


    const lockToken =
      `synthetic-revalidation-lock-${crypto
        .randomBytes(12)
        .toString("hex")}`;


    let parentId =
      null;


    try {

      // ======================================================
      // 1. SAFETY SETTINGS
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
        throw settingsError;
      }


      if (
        settings
          ?.notifications_enabled ===
        true
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            stage:
              "preflight",
            error:
              "notifications_enabled must be false before this test"
          });
      }


      // ======================================================
      // 2. VALUE_AVAILABLE RULE MUST EXIST
      // ======================================================

      const {
        data: rule,
        error: ruleError
      } =
        await supabaseAdmin
          .from(
            "market_notification_rules"
          )
          .select(`
            notification_kind,
            enabled,
            revalidation_required
          `)
          .eq(
            "notification_kind",
            "VALUE_AVAILABLE"
          )
          .maybeSingle();


      if (ruleError) {
        throw ruleError;
      }


      if (!rule) {

        return res
          .status(409)
          .json({
            ok: false,
            stage:
              "preflight",
            error:
              "VALUE_AVAILABLE rule not found"
          });
      }


      if (
        rule.enabled !==
        true
      ) {

        return res
          .status(409)
          .json({
            ok: false,
            stage:
              "preflight",
            error:
              "VALUE_AVAILABLE rule must be enabled for this test"
          });
      }


      // ======================================================
      // 3. CREATE SYNTHETIC OWNED PARENT
      //
      // Fake game intentionally has NO valid current market
      // opportunity.
      //
      // Revalidation must cancel it before fanout.
      // ======================================================

      const now =
        new Date()
          .toISOString();


      const expiresAt =
        new Date(
          Date.now() +
          10 * 60 * 1000
        )
          .toISOString();


      const {
        data: inserted,
        error: insertError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .insert({

            market_event_id:
              null,

            cashedge_game_id:
              fakeGameId,

            notification_key:
              notificationKey,

            notification_kind:
              "VALUE_AVAILABLE",

            delivery_class:
              "immediate",

            audience:
              "premium",

            title:
              "Synthetic Revalidation Test",

            body:
              "This synthetic alert must be cancelled.",

            deep_link:
              `/premium-radar?game_id=${encodeURIComponent(
                fakeGameId
              )}`,

            priority:
              "high",

            expires_at:
              expiresAt,

            status:
              "processing",

            dispatch_enabled:
              false,

            notification_provider:
              null,

            payload: {
              synthetic: true,
              revalidationTest: true,
              gameId:
                fakeGameId
            },

            revalidation_required:
              true,

            last_validated_at:
              null,

            attempt_count:
              0,

            next_attempt_at:
              null,

            processing_started_at:
              now,

            lock_token:
              lockToken,

            provider_message_id:
              null,

            cancelled_at:
              null,

            cancel_reason:
              null,

            source_event_at:
              now,

            created_at:
              now,

            sent_at:
              null,

            error_message:
              null
          })
          .select(`
            id,
            status,
            lock_token,
            notification_kind,
            cashedge_game_id
          `)
          .single();


      if (insertError) {
        throw insertError;
      }


      parentId =
        inserted.id;


      // ======================================================
      // 4. CALL REAL REVALIDATION ENGINE
      // ======================================================

      const revalidation =
        await revalidateMarketNotification({

          supabaseAdmin,

          notificationId:
            parentId,

          lockToken
        });


      // ======================================================
      // 5. READ FINAL PARENT STATE
      // ======================================================

      const {
        data: parentAfter,
        error: parentAfterError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .select(`
            id,
            status,
            dispatch_enabled,
            cancelled_at,
            cancel_reason,
            lock_token,
            processing_started_at,
            last_validated_at
          `)
          .eq(
            "id",
            parentId
          )
          .maybeSingle();


      if (parentAfterError) {
        throw parentAfterError;
      }


      // ======================================================
      // 6. VERIFY NO DELIVERY WAS CREATED
      // ======================================================

      const {
        count: deliveryCount,
        error: deliveryError
      } =
        await supabaseAdmin
          .from(
            "market_notification_deliveries"
          )
          .select(
            "id",
            {
              count:
                "exact",
              head:
                true
            }
          )
          .eq(
            "notification_id",
            parentId
          );


      if (deliveryError) {
        throw deliveryError;
      }


      // ======================================================
      // 7. VALID REASONS
      //
      // The normal expected reason for a fake game is:
      //
      // Current market opportunity could not be verified
      //
      // The other two are also safe invalidation outcomes if
      // calculateMarketOpportunity returns a partial state.
      // ======================================================

      const validCancelReasons =
        [
          "Current market opportunity could not be verified",
          "Game is no longer a current Premium selection",
          "Current market evaluation is unavailable"
        ];


      const cancelledCorrectly =
        revalidation
          ?.result ===
          "CANCELLED" &&
        revalidation
          ?.valid ===
          false &&
        revalidation
          ?.ownershipValid ===
          true &&
        parentAfter
          ?.status ===
          "cancelled" &&
        parentAfter
          ?.cancelled_at != null &&
        validCancelReasons
          .includes(
            parentAfter
              ?.cancel_reason
          );


      const noFanout =
        Number(
          deliveryCount || 0
        ) === 0;


      // ======================================================
      // 8. CLEANUP
      // ======================================================

      await cleanup(
        notificationKey
      );


      const {
        count: remainingRows,
        error: remainingError
      } =
        await supabaseAdmin
          .from(
            "market_notification_outbox"
          )
          .select(
            "id",
            {
              count:
                "exact",
              head:
                true
            }
          )
          .eq(
            "notification_key",
            notificationKey
          );


      if (remainingError) {
        throw remainingError;
      }


      // ======================================================
      // RESULT
      // ======================================================

      return res
        .status(200)
        .json({

          ok:
            cancelledCorrectly &&
            noFanout &&
            Number(
              remainingRows || 0
            ) === 0,

          test:
            "notification_revalidation_invalid_opportunity",

          syntheticGameId:
            fakeGameId,

          revalidation: {

            result:
              revalidation
                ?.result ||
              null,

            valid:
              revalidation
                ?.valid ??
              null,

            ownershipValid:
              revalidation
                ?.ownershipValid ??
              null,

            reason:
              revalidation
                ?.reason ||
              null
          },

          parentAfterRevalidation: {

            status:
              parentAfter
                ?.status ||
              null,

            dispatchEnabled:
              parentAfter
                ?.dispatch_enabled ===
              true,

            cancelled:
              parentAfter
                ?.cancelled_at !=
              null,

            cancelReason:
              parentAfter
                ?.cancel_reason ||
              null,

            lockCleared:
              parentAfter
                ?.lock_token ==
              null,

            processingCleared:
              parentAfter
                ?.processing_started_at ==
              null
          },

          fanout: {

            deliveriesCreated:
              Number(
                deliveryCount || 0
              )
          },

          cleanup: {

            remainingSyntheticRows:
              Number(
                remainingRows || 0
              )
          },

          settings: {

            notificationsEnabled:
              settings
                ?.notifications_enabled ===
              true,

            eventDetectionEnabled:
              settings
                ?.event_detection_enabled ===
              true,

            frontendEnabled:
              settings
                ?.frontend_enabled ===
              true
          }
        });


    } catch (error) {

      // ======================================================
      // EMERGENCY CLEANUP
      // ======================================================

      try {

        await cleanup(
          notificationKey
        );

      } catch (
        cleanupError
      ) {

        console.error(
          "REVALIDATION TEST CLEANUP ERROR:",
          cleanupError
        );
      }


      console.error(
        "MARKET NOTIFICATION REVALIDATION TEST ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          test:
            "notification_revalidation_invalid_opportunity",
          error:
            error.message ||
            String(error)
        });
    }
  };

const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  isInsideCooldown
} =
  require("../lib/marketNotificationDecision");


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
// UNIQUE TEST PREFIX
// ============================================================

function makeTestPrefix() {

  return (
    "synthetic-cooldown-" +
    Date.now() +
    "-" +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}


// ============================================================
// INSERT SYNTHETIC PARENT
// ============================================================

async function insertSyntheticParent({
  prefix,
  gameId,
  kind,
  createdAt
}) {

  const notificationKey =
    `${prefix}-${kind}-${crypto
      .randomBytes(6)
      .toString("hex")}`;

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .insert({

        market_event_id:
          null,

        cashedge_game_id:
          gameId,

        notification_key:
          notificationKey,

        notification_kind:
          kind,

        delivery_class:
          "immediate",

        audience:
          "premium",

        title:
          "Synthetic Cooldown Test",

        body:
          "Synthetic test notification.",

        deep_link:
          null,

        priority:
          "normal",

        expires_at:
          new Date(
            Date.now() +
            60 * 60 * 1000
          )
            .toISOString(),

        status:
          "shadow",

        dispatch_enabled:
          false,

        notification_provider:
          null,

        payload: {
          synthetic: true,
          cooldownTest: true,
          prefix
        },

        revalidation_required:
          false,

        last_validated_at:
          null,

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

        source_event_at:
          createdAt,

        created_at:
          createdAt,

        sent_at:
          null,

        error_message:
          null
      })
      .select(`
        id,
        notification_key,
        cashedge_game_id,
        notification_kind,
        created_at
      `)
      .single();


  if (error) {
    throw error;
  }


  return data;
}


// ============================================================
// CLEANUP
// ============================================================

async function cleanupSyntheticRows(
  prefix
) {

  const {
    error
  } =
    await supabaseAdmin
      .from(
        "market_notification_outbox"
      )
      .delete()
      .like(
        "notification_key",
        `${prefix}%`
      );


  if (error) {
    throw error;
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


    const prefix =
      makeTestPrefix();


    const recentGameId =
      `${prefix}-game-recent`;

    const oldGameId =
      `${prefix}-game-old`;

    const otherGameId =
      `${prefix}-game-other`;


    try {

      // ======================================================
      // SAFETY CHECK
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
            error:
              "notifications_enabled must be false before this test"
          });
      }


      // ======================================================
      // TIMES
      // ======================================================

      const now =
        Date.now();

      const recentCreatedAt =
        new Date(
          now -
          60 * 1000
        )
          .toISOString();

      const oldCreatedAt =
        new Date(
          now -
          20 * 60 * 1000
        )
          .toISOString();


      // ======================================================
      // CREATE RECENT VALUE_AVAILABLE
      //
      // 1 minute ago.
      // Must trigger the 15-minute cooldown.
      // ======================================================

      const recentParent =
        await insertSyntheticParent({

          prefix,

          gameId:
            recentGameId,

          kind:
            "VALUE_AVAILABLE",

          createdAt:
            recentCreatedAt
        });


      // ======================================================
      // CREATE OLD VALUE_AVAILABLE
      //
      // 20 minutes ago.
      // Must NOT trigger the 15-minute cooldown.
      // ======================================================

      const oldParent =
        await insertSyntheticParent({

          prefix,

          gameId:
            oldGameId,

          kind:
            "VALUE_AVAILABLE",

          createdAt:
            oldCreatedAt
        });


      // ======================================================
      // TEST 1
      //
      // SAME GAME + SAME KIND + 1 MINUTE AGO
      // EXPECTED: TRUE
      // ======================================================

      const sameGameSameKind =
        await isInsideCooldown({

          supabaseAdmin,

          gameId:
            recentGameId,

          kind:
            "VALUE_AVAILABLE",

          cooldownSeconds:
            900
        });


      // ======================================================
      // TEST 2
      //
      // SAME GAME + DIFFERENT KIND
      // EXPECTED: FALSE
      // ======================================================

      const sameGameDifferentKind =
        await isInsideCooldown({

          supabaseAdmin,

          gameId:
            recentGameId,

          kind:
            "STALE_LINE",

          cooldownSeconds:
            900
        });


      // ======================================================
      // TEST 3
      //
      // DIFFERENT GAME + SAME KIND
      // EXPECTED: FALSE
      // ======================================================

      const differentGameSameKind =
        await isInsideCooldown({

          supabaseAdmin,

          gameId:
            otherGameId,

          kind:
            "VALUE_AVAILABLE",

          cooldownSeconds:
            900
        });


      // ======================================================
      // TEST 4
      //
      // SAME KIND BUT CREATED 20 MINUTES AGO
      // EXPECTED: FALSE
      // ======================================================

      const expiredCooldown =
        await isInsideCooldown({

          supabaseAdmin,

          gameId:
            oldGameId,

          kind:
            "VALUE_AVAILABLE",

          cooldownSeconds:
            900
        });


      // ======================================================
      // TEST 5
      //
      // COOLDOWN DISABLED
      // EXPECTED: FALSE
      // ======================================================

      const zeroCooldown =
        await isInsideCooldown({

          supabaseAdmin,

          gameId:
            recentGameId,

          kind:
            "VALUE_AVAILABLE",

          cooldownSeconds:
            0
        });


      // ======================================================
      // RESULT BEFORE CLEANUP
      // ======================================================

      const passed =
        sameGameSameKind === true &&
        sameGameDifferentKind === false &&
        differentGameSameKind === false &&
        expiredCooldown === false &&
        zeroCooldown === false;


      // ======================================================
      // CLEANUP
      // ======================================================

      await cleanupSyntheticRows(
        prefix
      );


      const {
        count: remaining,
        error: remainingError
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
          .like(
            "notification_key",
            `${prefix}%`
          );


      if (remainingError) {
        throw remainingError;
      }


      return res
        .status(200)
        .json({

          ok:
            passed &&
            Number(
              remaining || 0
            ) === 0,

          test:
            "notification_cooldown",

          cooldownSeconds:
            900,

          recentParent: {
            id:
              recentParent.id,

            ageSeconds:
              60
          },

          oldParent: {
            id:
              oldParent.id,

            ageSeconds:
              1200
          },

          checks: {

            sameGameSameKind: {
              expected:
                true,
              actual:
                sameGameSameKind
            },

            sameGameDifferentKind: {
              expected:
                false,
              actual:
                sameGameDifferentKind
            },

            differentGameSameKind: {
              expected:
                false,
              actual:
                differentGameSameKind
            },

            expiredCooldown: {
              expected:
                false,
              actual:
                expiredCooldown
            },

            zeroCooldown: {
              expected:
                false,
              actual:
                zeroCooldown
            }
          },

          cleanup: {
            remainingSyntheticRows:
              Number(
                remaining || 0
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

        await cleanupSyntheticRows(
          prefix
        );

      } catch (
        cleanupError
      ) {

        console.error(
          "COOLDOWN TEST CLEANUP ERROR:",
          cleanupError
        );
      }


      console.error(
        "MARKET NOTIFICATION COOLDOWN TEST ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          test:
            "notification_cooldown",
          error:
            error.message ||
            String(error)
        });
    }
  };

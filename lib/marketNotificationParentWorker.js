// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// PARENT NOTIFICATION WORKER
//
// Flujo:
// 1. Claim de UNA notificación padre.
// 2. Revalidación owner-safe.
// 3. Fanout a usuarios/dispositivos elegibles.
// 4. Si ocurre un error interno antes del fanout,
//    libera el parent para retry.
//
// IMPORTANTE:
// - NO envía pushes.
// - NO llama OneSignal.
// - NO procesa deliveries.
// - NO crea market events.
// - NO activa notifications_enabled.
// ============================================================

const {
  createClient
} = require("@supabase/supabase-js");

const {
  revalidateMarketNotification
} = require("./marketNotificationRevalidation");


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
// CONSTANTS
// ============================================================

const DEFAULT_LEASE_SECONDS = 30;

const MAX_LEASE_SECONDS = 120;

const DEFAULT_RELEASE_DELAY_SECONDS = 10;

const MAX_RELEASE_DELAY_SECONDS = 300;


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


function safeInteger(
  value,
  fallback
) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.floor(number);
}


function firstRpcRow(data) {

  if (
    Array.isArray(data)
  ) {
    return data[0] || null;
  }

  return data || null;
}


// ============================================================
// CLAIM PARENT
// ============================================================

async function claimParentNotification({
  lockToken,
  leaseSeconds
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "claim_market_notification_v1",
      {
        p_lock_token:
          lockToken,

        p_lease_seconds:
          leaseSeconds
      }
    );


  if (error) {

    throw new Error(
      `PARENT_CLAIM_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// FANOUT
//
// El RPC ya es responsable de:
//
// - verificar ownership
// - verificar Premium recipients
// - localizar push_devices elegibles
// - crear deliveries idempotentemente
// - actualizar parent_status
// ============================================================

async function fanoutParentNotification({
  notificationId,
  lockToken
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "fanout_market_notification_v1",
      {
        p_notification_id:
          notificationId,

        p_lock_token:
          lockToken
      }
    );


  if (error) {

    throw new Error(
      `PARENT_FANOUT_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// RELEASE PARENT
//
// Solo se usa para errores internos temporales.
//
// Nunca intentamos liberar una notificación que la
// revalidación ya canceló o cuyo ownership se perdió.
// ============================================================

async function releaseParentNotification({
  notificationId,
  lockToken,
  delaySeconds =
    DEFAULT_RELEASE_DELAY_SECONDS,
  reason
}) {

  const safeDelaySeconds =
    Math.max(
      1,
      Math.min(
        safeInteger(
          delaySeconds,
          DEFAULT_RELEASE_DELAY_SECONDS
        ),
        MAX_RELEASE_DELAY_SECONDS
      )
    );


  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "release_market_notification_v1",
      {
        p_notification_id:
          notificationId,

        p_lock_token:
          lockToken,

        p_delay_seconds:
          safeDelaySeconds,

        p_reason:
          cleanString(
            reason
          ).slice(
            0,
            2000
          ) ||
          "parent_worker_release"
      }
    );


  if (error) {

    throw new Error(
      `PARENT_RELEASE_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// PROCESS ONE PARENT NOTIFICATION
// ============================================================

async function processOneMarketNotificationParent({
  lockToken,
  leaseSeconds =
    DEFAULT_LEASE_SECONDS
} = {}) {

  const cleanLockToken =
    cleanString(
      lockToken
    );


  if (!cleanLockToken) {

    throw new Error(
      "LOCK_TOKEN_REQUIRED"
    );
  }


  const safeLeaseSeconds =
    Math.max(
      10,
      Math.min(
        safeInteger(
          leaseSeconds,
          DEFAULT_LEASE_SECONDS
        ),
        MAX_LEASE_SECONDS
      )
    );


  // ==========================================================
  // 1. CLAIM
  // ==========================================================

  const claimed =
    await claimParentNotification({
      lockToken:
        cleanLockToken,

      leaseSeconds:
        safeLeaseSeconds
    });


  // No hay ninguna notificación lista.
  if (
    !claimed?.id
  ) {

    return {
      ok: true,
      processed: false,
      reason:
        "NO_PARENT_NOTIFICATION_AVAILABLE"
    };
  }


  const notificationId =
    claimed.id;


  try {

    // ========================================================
    // 2. REVALIDATION
    //
    // Solo cuando el parent lo requiere.
    //
    // La revalidación puede:
    //
    // VALID
    // UPDATED
    // CANCELLED
    // STALE_OWNER
    // ALREADY_SENT
    // ALREADY_CANCELLED
    //
    // Si actualiza title/body/payload, el fanout posterior
    // leerá ya la versión nueva del parent.
    // ========================================================

    let revalidation =
      null;


    if (
      claimed
        .revalidation_required ===
      true
    ) {

      revalidation =
        await revalidateMarketNotification({
          supabaseAdmin,

          notificationId,

          lockToken:
            cleanLockToken
        });


      // ======================================================
      // OWNERSHIP LOST
      // ======================================================

      if (
        revalidation
          ?.ownershipValid ===
        false
      ) {

        return {
          ok: false,
          processed: true,
          notificationId,
          stage:
            "revalidation",
          reason:
            revalidation.result ||
            "STALE_OWNER",
          detail:
            revalidation.reason ||
            null
        };
      }


      // ======================================================
      // REVALIDATION INVALIDATED THE ALERT
      //
      // No fanout.
      // No release.
      //
      // La propia revalidación ya hizo el cambio terminal
      // cuando correspondía.
      // ======================================================

      if (
        revalidation
          ?.valid !==
        true
      ) {

        return {
          ok: true,
          processed: true,
          notificationId,
          fanout: false,
          stage:
            "revalidation",
          reason:
            revalidation?.result ||
            "NOTIFICATION_NO_LONGER_VALID",
          detail:
            revalidation?.reason ||
            null
        };
      }
    }


    // ========================================================
    // 3. FANOUT
    //
    // Aquí se convierten:
    //
    // 1 parent notification
    //
    // en:
    //
    // N market_notification_deliveries
    //
    // una por dispositivo elegible.
    // ========================================================

    const fanout =
      await fanoutParentNotification({
        notificationId,

        lockToken:
          cleanLockToken
      });


    if (!fanout) {

      const released =
        await releaseParentNotification({
          notificationId,

          lockToken:
            cleanLockToken,

          delaySeconds:
            DEFAULT_RELEASE_DELAY_SECONDS,

          reason:
            "FANOUT_RETURNED_NO_ROW"
        });


      return {
        ok: false,
        processed: true,
        notificationId,
        stage:
          "fanout",
        reason:
          "FANOUT_RETURNED_NO_ROW",
        released:
          released?.updated ===
          true,
        finalStatus:
          released?.final_status ||
          null
      };
    }


    // ========================================================
    // FANOUT OWNERSHIP
    // ========================================================

    if (
      fanout
        .ownership_valid ===
      false
    ) {

      return {
        ok: false,
        processed: true,
        notificationId,
        stage:
          "fanout",
        reason:
          "LOCK_OWNERSHIP_LOST",
        parentStatus:
          fanout.parent_status ||
          null
      };
    }


    // ========================================================
    // FANOUT REJECTED / NO ACTION
    // ========================================================

    if (
      fanout.ok !==
      true
    ) {

      return {
        ok: false,
        processed: true,
        notificationId,
        stage:
          "fanout",
        reason:
          fanout.reason ||
          "FANOUT_NOT_COMPLETED",
        parentStatus:
          fanout.parent_status ||
          null,

        premiumUsers:
          fanout.premium_users ??
          null,

        recipientUsers:
          fanout.recipient_users ??
          null,

        eligibleDevices:
          fanout.eligible_devices ??
          null,

        insertedDeliveries:
          fanout.inserted_deliveries ??
          null,

        existingDeliveries:
          fanout.existing_deliveries ??
          null
      };
    }


    // ========================================================
    // SUCCESS
    // ========================================================

    return {
      ok: true,
      processed: true,
      notificationId,

      revalidated:
        claimed
          .revalidation_required ===
        true,

      revalidationResult:
        revalidation?.result ||
        null,

      fanout:
        true,

      parentStatus:
        fanout.parent_status ||
        null,

      premiumUsers:
        Number(
          fanout.premium_users ||
          0
        ),

      recipientUsers:
        Number(
          fanout.recipient_users ||
          0
        ),

      eligibleDevices:
        Number(
          fanout.eligible_devices ||
          0
        ),

      insertedDeliveries:
        Number(
          fanout.inserted_deliveries ||
          0
        ),

      existingDeliveries:
        Number(
          fanout.existing_deliveries ||
          0
        ),

      reason:
        fanout.reason ||
        null
    };


  } catch (error) {

    // ========================================================
    // INTERNAL ERROR
    //
    // Intentamos liberar el parent para que pueda ser
    // reclamado nuevamente más adelante.
    // ========================================================

    const errorMessage =
      cleanString(
        error?.message ||
        error
      ).slice(
        0,
        2000
      );


    try {

      const released =
        await releaseParentNotification({
          notificationId,

          lockToken:
            cleanLockToken,

          delaySeconds:
            DEFAULT_RELEASE_DELAY_SECONDS,

          reason:
            errorMessage ||
            "PARENT_WORKER_INTERNAL_ERROR"
        });


      return {
        ok: false,
        processed: true,
        notificationId,
        stage:
          "parent_worker",

        reason:
          errorMessage ||
          "PARENT_WORKER_INTERNAL_ERROR",

        released:
          released?.updated ===
          true,

        ownershipValid:
          released?.ownership_valid ??
          null,

        finalStatus:
          released?.final_status ||
          null,

        attempts:
          released?.attempts ??
          claimed?.attempt_count ??
          null,

        nextRetryAt:
          released?.next_retry_at ||
          null
      };


    } catch (releaseError) {

      return {
        ok: false,
        processed: true,
        notificationId,
        stage:
          "parent_worker",

        reason:
          errorMessage ||
          "PARENT_WORKER_INTERNAL_ERROR",

        releaseError:
          cleanString(
            releaseError?.message ||
            releaseError
          ).slice(
            0,
            1000
          )
      };
    }
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  processOneMarketNotificationParent
};

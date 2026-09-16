// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// NOTIFICATION DELIVERY WORKER
//
// Flujo:
// 1. Claim de UNA delivery.
// 2. JIT validation.
// 3. Envío exacto por OneSignal.
// 4. Sent / Retry / Failed.
//
// IMPORTANTE:
// - No crea notificaciones.
// - No hace fanout.
// - No decide Premium.
// - No usa segmentos de OneSignal.
// - No activa notifications_enabled.
// ============================================================

const {
  createClient
} = require("@supabase/supabase-js");

const {
  createHash
} = require("crypto");

const {
  sendOneSignalPush
} = require("./marketNotificationProvider");


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

const DEFAULT_RETRY_SECONDS = 60;

const MAX_RETRY_SECONDS = 15 * 60;

const DEFAULT_MAX_ATTEMPTS = 5;

const CASHEDGE_WEB_ORIGIN =
  "https://www.cashedgeapp.com";


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
// PROVIDER CLICK URL
//
// Web:
// /premium-radar?game_id=123
//        ↓
// https://www.cashedgeapp.com/premium-radar?game_id=123
//
// Android:
// No external URL.
// Android reads data.deepLink from the notification click.
//
// IMPORTANT:
// The original internal deepLink is NEVER modified.
// ============================================================

function buildProviderClickUrl({
  platform,
  deepLink
}) {

  const cleanPlatform =
    cleanString(platform)
      .toLowerCase();

  const cleanDeepLink =
    cleanString(deepLink);


  if (!cleanDeepLink) {
    return null;
  }


  // ----------------------------------------------------------
  // Native platforms must handle navigation internally.
  // ----------------------------------------------------------

  if (
    cleanPlatform !==
    "web"
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // Already absolute.
  // ----------------------------------------------------------

  if (
    /^https?:\/\//i.test(
      cleanDeepLink
    )
  ) {
    return cleanDeepLink;
  }


  // ----------------------------------------------------------
  // Normal CashEdge internal path.
  // ----------------------------------------------------------

  if (
    cleanDeepLink.startsWith("/")
  ) {

    return (
      CASHEDGE_WEB_ORIGIN +
      cleanDeepLink
    );
  }


  // ----------------------------------------------------------
  // Defensive fallback.
  // ----------------------------------------------------------

  return (
    CASHEDGE_WEB_ORIGIN +
    "/" +
    cleanDeepLink.replace(
      /^\/+/,
      ""
    )
  );
}


// ============================================================
// STABLE IDEMPOTENCY UUID
//
// Cada delivery siempre genera la misma UUID.
//
// Así:
//
// intento 1
//   ↓
// OneSignal envía
//   ↓
// timeout antes de recibir respuesta
//   ↓
// retry
//
// OneSignal recibe exactamente la misma idempotency_key.
// ============================================================

function getDeliveryIdempotencyKey(
  deliveryId
) {

  const source =
    `cashedge-market-notification-delivery:${deliveryId}`;

  const bytes =
    Buffer.from(
      createHash("sha256")
        .update(source)
        .digest()
        .subarray(0, 16)
    );


  // UUID version 5 bits.
  bytes[6] =
    (
      bytes[6] &
      0x0f
    ) |
    0x50;


  // RFC 4122 variant.
  bytes[8] =
    (
      bytes[8] &
      0x3f
    ) |
    0x80;


  const hex =
    bytes.toString("hex");


  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}


// ============================================================
// ONESIGNAL PRIORITY
// ============================================================

function normalizePriority(
  value
) {

  const raw =
    cleanString(value)
      .toLowerCase();


  if (!raw) {
    return null;
  }


  if (
    raw === "10" ||
    raw === "high" ||
    raw === "urgent" ||
    raw === "immediate" ||
    raw === "critical"
  ) {
    return 10;
  }


  if (
    raw === "5" ||
    raw === "normal" ||
    raw === "default"
  ) {
    return 5;
  }


  const numeric =
    Number(raw);


  if (
    Number.isFinite(numeric)
  ) {

    return numeric >= 10
      ? 10
      : 5;
  }


  return null;
}


// ============================================================
// RETRY DELAY
// ============================================================

function calculateRetrySeconds({
  attemptCount,
  providerRetryAfter
}) {

  const providerSeconds =
    safeInteger(
      providerRetryAfter,
      0
    );


  if (
    providerSeconds > 0
  ) {

    return Math.max(
      1,
      Math.min(
        providerSeconds,
        MAX_RETRY_SECONDS
      )
    );
  }


  const attempts =
    Math.max(
      1,
      safeInteger(
        attemptCount,
        1
      )
    );


  // 60s → 120s → 240s → 480s → máximo 900s

  const exponential =
    DEFAULT_RETRY_SECONDS *
    Math.pow(
      2,
      Math.max(
        0,
        attempts - 1
      )
    );


  return Math.min(
    exponential,
    MAX_RETRY_SECONDS
  );
}


// ============================================================
// FORMAT ERROR
// ============================================================

function buildProviderErrorMessage(
  result
) {

  const pieces = [
    cleanString(
      result?.errorCode
    ),
    cleanString(
      result?.errorMessage
    )
  ].filter(Boolean);


  const message =
    pieces.length
      ? pieces.join(": ")
      : "Unknown OneSignal provider error";


  return message.slice(
    0,
    2000
  );
}


// ============================================================
// CLAIM ONE DELIVERY
// ============================================================

async function claimDelivery({
  lockToken,
  leaseSeconds
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "claim_market_notification_delivery_v1",
      {
        p_lock_token:
          lockToken,

        p_lease_seconds:
          leaseSeconds
      }
    );


  if (error) {

    throw new Error(
      `DELIVERY_CLAIM_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// JIT VALIDATION
// ============================================================

async function validateDelivery({
  deliveryId,
  lockToken
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "validate_market_notification_delivery_v1",
      {
        p_delivery_id:
          deliveryId,

        p_lock_token:
          lockToken
      }
    );


  if (error) {

    throw new Error(
      `DELIVERY_VALIDATION_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// COMPLETE SENT
// ============================================================

async function completeSent({
  deliveryId,
  lockToken,
  providerMessageId
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "complete_market_notification_delivery_sent_v1",
      {
        p_delivery_id:
          deliveryId,

        p_lock_token:
          lockToken,

        p_provider_message_id:
          providerMessageId ||
          null
      }
    );


  if (error) {

    throw new Error(
      `DELIVERY_COMPLETE_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// RETRY / FAIL
// ============================================================

async function markRetry({
  deliveryId,
  lockToken,
  errorMessage,
  retryAfterSeconds,
  maxAttempts
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "retry_market_notification_delivery_v1",
      {
        p_delivery_id:
          deliveryId,

        p_lock_token:
          lockToken,

        p_error_message:
          errorMessage,

        p_retry_after_seconds:
          retryAfterSeconds,

        p_max_attempts:
          maxAttempts
      }
    );


  if (error) {

    throw new Error(
      `DELIVERY_RETRY_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// RELEASE
//
// Usamos release solamente para fallos internos temporales
// ANTES de haber entregado el mensaje al provider.
// ============================================================

async function releaseDelivery({
  deliveryId,
  lockToken,
  delaySeconds = 5,
  reason
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin.rpc(
      "release_market_notification_delivery_v1",
      {
        p_delivery_id:
          deliveryId,

        p_lock_token:
          lockToken,

        p_delay_seconds:
          delaySeconds,

        p_reason:
          cleanString(reason)
            .slice(
              0,
              2000
            ) ||
          "worker_release"
      }
    );


  if (error) {

    throw new Error(
      `DELIVERY_RELEASE_FAILED: ${error.message}`
    );
  }


  return firstRpcRow(
    data
  );
}


// ============================================================
// PROCESS ONE DELIVERY
// ============================================================

async function processOneMarketNotificationDelivery({
  lockToken,
  leaseSeconds =
    DEFAULT_LEASE_SECONDS,
  maxAttempts =
    DEFAULT_MAX_ATTEMPTS
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
        120
      )
    );


  const safeMaxAttempts =
    Math.max(
      1,
      Math.min(
        safeInteger(
          maxAttempts,
          DEFAULT_MAX_ATTEMPTS
        ),
        10
      )
    );


  // ==========================================================
  // 1. CLAIM
  // ==========================================================

  const claimed =
    await claimDelivery({
      lockToken:
        cleanLockToken,

      leaseSeconds:
        safeLeaseSeconds
    });


  // Nada pendiente.
  if (
    !claimed?.delivery_id
  ) {

    return {
      ok: true,
      processed: false,
      reason:
        "NO_DELIVERY_AVAILABLE"
    };
  }


  const deliveryId =
    claimed.delivery_id;


  const notificationId =
    claimed.notification_id;


  try {

    // ========================================================
    // 2. JIT VALIDATION
    //
    // Esta función vuelve a comprobar:
    //
    // - notifications_enabled
    // - parent vigente
    // - expiración
    // - Stripe Premium real
    // - dispositivo activo
    // - push_enabled
    // - subscription actual
    //
    // Además puede actualizar destination si OneSignal cambió
    // la subscription del dispositivo.
    // ========================================================

    const validated =
      await validateDelivery({
        deliveryId,
        lockToken:
          cleanLockToken
      });


    if (!validated) {

      const released =
        await releaseDelivery({
          deliveryId,
          lockToken:
            cleanLockToken,
          delaySeconds:
            10,
          reason:
            "VALIDATION_RETURNED_NO_ROW"
        });


      return {
        ok: false,
        processed: true,
        deliveryId,
        notificationId,
        stage:
          "validate",
        reason:
          "VALIDATION_RETURNED_NO_ROW",
        release:
          released
      };
    }


    // ========================================================
    // OWNERSHIP LOST
    // ========================================================

    if (
      validated
        .ownership_valid ===
      false
    ) {

      return {
        ok: false,
        processed: true,
        deliveryId,
        notificationId,
        stage:
          "validate",
        reason:
          "LOCK_OWNERSHIP_LOST",
        finalStatus:
          validated.final_status ||
          null
      };
    }


    // ========================================================
    // INVALID / CANCELLED / SKIPPED
    // ========================================================

    if (
      validated.valid !==
      true
    ) {

      return {
        ok: true,
        processed: true,
        sent: false,
        deliveryId,
        notificationId,
        stage:
          "validate",
        reason:
          validated.reason ||
          "DELIVERY_NOT_VALID",
        finalStatus:
          validated.final_status ||
          null
      };
    }


    // ========================================================
    // 3. PROVIDER
    // ========================================================

    const provider =
      cleanString(
        validated.provider ||
        claimed.provider
      ).toLowerCase();


    if (
      provider !==
      "onesignal"
    ) {

      const result =
        await markRetry({
          deliveryId,
          lockToken:
            cleanLockToken,
          errorMessage:
            `UNSUPPORTED_PROVIDER: ${provider || "missing"}`,
          retryAfterSeconds:
            0,
          maxAttempts:
            1
        });


      return {
        ok: false,
        processed: true,
        sent: false,
        deliveryId,
        notificationId,
        stage:
          "provider",
        reason:
          "UNSUPPORTED_PROVIDER",
        finalStatus:
          result?.final_status ||
          null
      };
    }


    const subscriptionId =
      cleanString(
        validated
          .provider_subscription_id ||
        claimed
          .provider_subscription_id
      );


    const title =
      cleanString(
        validated.title ||
        claimed.title
      );


    const body =
      cleanString(
        validated.body ||
        claimed.body
      );


    const deepLink =
      cleanString(
        validated.deep_link ||
        claimed.deep_link
      );


    // ========================================================
    // PLATFORM
    //
    // web
    // android
    // future: ios
    // ========================================================

    const platform =
      cleanString(
        validated.platform ||
        claimed.platform
      )
        .toLowerCase();


    // ========================================================
    // PROVIDER CLICK URL
    //
    // WEB:
    // OneSignal receives a complete https:// URL.
    //
    // ANDROID:
    // url = null
    // Navigation happens from data.deepLink inside the app.
    // ========================================================

    const providerClickUrl =
      buildProviderClickUrl({
        platform,
        deepLink
      });


    // ========================================================
    // EXACT IDEMPOTENCY PER DELIVERY
    // ========================================================

    const idempotencyKey =
      getDeliveryIdempotencyKey(
        deliveryId
      );


    // ========================================================
    // CUSTOM DATA
    //
    // deepLink remains available to ALL platforms.
    //
    // Android will use this when the user taps the push.
    //
    // Web also receives it as metadata, even though Web uses
    // providerClickUrl for the browser click destination.
    // ========================================================

    const providerResult =
      await sendOneSignalPush({

        subscriptionId,

        title,

        message:
          body,

        url:
          providerClickUrl,

        priority:
          normalizePriority(
            claimed.priority
          ),

        idempotencyKey,

        data: {
          source:
            "cashedge_market_intelligence",

          notificationId:
            String(
              notificationId
            ),

          deliveryId:
            String(
              deliveryId
            ),

          platform:
            platform ||
            null,

          deepLink:
            deepLink ||
            null
        }
      });


    // ========================================================
    // 4. SENT
    // ========================================================

    if (
      providerResult.ok ===
      true
    ) {

      const completed =
        await completeSent({
          deliveryId,

          lockToken:
            cleanLockToken,

          providerMessageId:
            providerResult
              .providerMessageId
        });


      return {
        ok: true,
        processed: true,
        sent: true,
        deliveryId,
        notificationId,
        platform:
          platform ||
          null,
        provider:
          "onesignal",
        providerMessageId:
          providerResult
            .providerMessageId,
        finalStatus:
          completed
            ?.final_status ||
          "sent"
      };
    }


    // ========================================================
    // 5. PROVIDER FAILURE
    // ========================================================

    const providerError =
      buildProviderErrorMessage(
        providerResult
      );


    // ========================================================
    // RETRYABLE
    // ========================================================

    if (
      providerResult
        .retryable ===
      true
    ) {

      const retrySeconds =
        calculateRetrySeconds({
          attemptCount:
            claimed
              .attempt_count,

          providerRetryAfter:
            providerResult
              .retryAfterSeconds
        });


      const retried =
        await markRetry({
          deliveryId,

          lockToken:
            cleanLockToken,

          errorMessage:
            providerError,

          retryAfterSeconds:
            retrySeconds,

          maxAttempts:
            safeMaxAttempts
        });


      return {
        ok: false,
        processed: true,
        sent: false,
        retryable: true,
        deliveryId,
        notificationId,
        stage:
          "provider",
        reason:
          providerResult
            .errorCode ||
          "PROVIDER_RETRY",
        retryAfterSeconds:
          retrySeconds,
        finalStatus:
          retried
            ?.final_status ||
          null,
        attempts:
          retried
            ?.attempts ??
          claimed
            .attempt_count ??
          null
      };
    }


    // ========================================================
    // PERMANENT PROVIDER FAILURE
    //
    // Usamos el mismo RPC de retry pero maxAttempts = 1,
    // obligando a que esta delivery quede terminal.
    // ========================================================

    const failed =
      await markRetry({
        deliveryId,

        lockToken:
          cleanLockToken,

        errorMessage:
          providerError,

        retryAfterSeconds:
          0,

        maxAttempts:
          1
      });


    return {
      ok: false,
      processed: true,
      sent: false,
      retryable: false,
      deliveryId,
      notificationId,
      stage:
        "provider",
      reason:
        providerResult
          .errorCode ||
        "PROVIDER_PERMANENT_FAILURE",
      finalStatus:
        failed
          ?.final_status ||
        null,
      attempts:
        failed
          ?.attempts ??
        claimed
          .attempt_count ??
        null
    };


  } catch (error) {

    // ========================================================
    // INTERNAL WORKER ERROR
    //
    // Todavía poseemos el lock en la mayoría de estos casos.
    // Intentamos liberar la delivery para que pueda ser tomada
    // nuevamente.
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
        await releaseDelivery({
          deliveryId,

          lockToken:
            cleanLockToken,

          delaySeconds:
            10,

          reason:
            errorMessage ||
            "WORKER_INTERNAL_ERROR"
        });


      return {
        ok: false,
        processed: true,
        sent: false,
        deliveryId,
        notificationId,
        stage:
          "worker",
        reason:
          errorMessage ||
          "WORKER_INTERNAL_ERROR",
        released:
          released?.updated ===
          true,
        finalStatus:
          released
            ?.final_status ||
          null
      };


    } catch (releaseError) {

      return {
        ok: false,
        processed: true,
        sent: false,
        deliveryId,
        notificationId,
        stage:
          "worker",
        reason:
          errorMessage ||
          "WORKER_INTERNAL_ERROR",
        releaseError:
          cleanString(
            releaseError
              ?.message ||
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
  processOneMarketNotificationDelivery,
  getDeliveryIdempotencyKey
};

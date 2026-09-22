// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// INTERNAL NOTIFICATION DELIVERY ENDPOINT
//
// POST /api/process-market-notification-deliveries
//
// Responsabilidad:
// - Ejecutar el Delivery Worker de forma segura.
// - Procesar deliveries ya creadas.
// - NO crea notificaciones.
// - NO hace fanout.
// - NO decide Premium.
// - NO activa notifications_enabled.
// - NO usa secretos por query string.
// ============================================================

const {
  randomUUID,
  timingSafeEqual
} = require("crypto");

const {
  processOneMarketNotificationDelivery
} = require(
  "../lib/marketNotificationDeliveryWorker"
);


// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BATCH_LIMIT = 5;

const MAX_BATCH_LIMIT = 10;

const DEFAULT_LEASE_SECONDS = 30;

const MAX_LEASE_SECONDS = 120;

const DEFAULT_MAX_ATTEMPTS = 5;

const MAX_ALLOWED_ATTEMPTS = 10;


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


// ============================================================
// CONSTANT-TIME SECRET COMPARISON
// ============================================================

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


// ============================================================
// AUTH
// ============================================================

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

  const pipelineSecret =
    cleanString(
      process.env
        .MARKET_PIPELINE_SECRET
    );

  const cronSecret =
    cleanString(
      process.env
        .CRON_SECRET
    );


  if (
    !pipelineSecret &&
    !cronSecret
  ) {

    return {
      ok: false,
      status: 500,
      error:
        "NOTIFICATION_WORKER_SECRET_NOT_CONFIGURED"
    };
  }


  const providedSecret =
    getBearerToken(req);


  const matchesPipelineSecret =
    pipelineSecret &&
    safeSecretEqual(
      providedSecret,
      pipelineSecret
    );

  const matchesCronSecret =
    cronSecret &&
    safeSecretEqual(
      providedSecret,
      cronSecret
    );


  if (
    !matchesPipelineSecret &&
    !matchesCronSecret
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
// REQUEST OPTIONS
// ============================================================

function getRequestOptions(req) {

  const body =
    req.body &&
    typeof req.body === "object"
      ? req.body
      : {};


  const limit =
    Math.max(
      1,
      Math.min(
        safeInteger(
          body.limit,
          DEFAULT_BATCH_LIMIT
        ),
        MAX_BATCH_LIMIT
      )
    );


  const leaseSeconds =
    Math.max(
      10,
      Math.min(
        safeInteger(
          body.leaseSeconds,
          DEFAULT_LEASE_SECONDS
        ),
        MAX_LEASE_SECONDS
      )
    );


  const maxAttempts =
    Math.max(
      1,
      Math.min(
        safeInteger(
          body.maxAttempts,
          DEFAULT_MAX_ATTEMPTS
        ),
        MAX_ALLOWED_ATTEMPTS
      )
    );


  return {
    limit,
    leaseSeconds,
    maxAttempts
  };
}


// ============================================================
// RESPONSE SUMMARY
// ============================================================

function buildSummary(results) {

  const summary = {
    requested:
      results.length,

    claimed:
      0,

    sent:
      0,

    retry:
      0,

    skipped:
      0,

    failed:
      0,

    noDeliveryAvailable:
      false
  };


  for (
    const result of results
  ) {

    if (
      result?.processed ===
      false &&
      result?.reason ===
      "NO_DELIVERY_AVAILABLE"
    ) {

      summary
        .noDeliveryAvailable =
        true;

      continue;
    }


    if (
      result?.processed ===
      true
    ) {

      summary.claimed += 1;
    }


    if (
      result?.sent ===
      true
    ) {

      summary.sent += 1;

      continue;
    }


    if (
      result?.retryable ===
      true
    ) {

      summary.retry += 1;

      continue;
    }


    if (
      result?.processed ===
        true &&
      result?.ok ===
        true &&
      result?.sent !==
        true
    ) {

      summary.skipped += 1;

      continue;
    }


    if (
      result?.processed ===
      true &&
      result?.ok ===
      false
    ) {

      summary.failed += 1;
    }
  }


  return summary;
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    // ========================================================
    // BASIC RESPONSE HEADERS
    // ========================================================

    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    res.setHeader(
      "Content-Type",
      "application/json"
    );


    // ========================================================
    // METHOD
    // ========================================================

   if (
  req.method !== "GET" &&
  req.method !== "POST"
) {

  res.setHeader(
    "Allow",
    "GET, POST"
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
    // AUTHORIZATION
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
    // OPTIONS
    // ========================================================

    const {
      limit,
      leaseSeconds,
      maxAttempts
    } =
      getRequestOptions(req);


    const results =
      [];


    // ========================================================
    // PROCESS BATCH
    //
    // Secuencial a propósito:
    //
    // - cada claim es independiente
    // - reducimos provider bursts
    // - simplificamos ownership
    // - evitamos reclamar varias deliveries y luego perder
    //   leases esperando otras requests
    // ========================================================

    try {

      for (
        let index = 0;
        index < limit;
        index += 1
      ) {

        // Cada claim recibe su propio lock token.

        const lockToken =
          randomUUID();


        const result =
          await processOneMarketNotificationDelivery({
            lockToken,
            leaseSeconds,
            maxAttempts
          });


        results.push(
          result
        );


        // Si no quedan deliveries listas,
        // terminamos el batch inmediatamente.

        if (
          result
            ?.processed ===
            false &&
          result
            ?.reason ===
            "NO_DELIVERY_AVAILABLE"
        ) {
          break;
        }
      }


      const summary =
        buildSummary(
          results
        );


      return res
        .status(200)
        .json({
          ok: true,

          worker:
            "market_notification_delivery",

          summary,

          results
        });


    } catch (error) {

      return res
        .status(500)
        .json({
          ok: false,

          worker:
            "market_notification_delivery",

          error:
            cleanString(
              error?.message ||
              error
            ).slice(
              0,
              2000
            ),

          results
        });
    }
  };

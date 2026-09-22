// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// INTERNAL PARENT NOTIFICATION ENDPOINT
//
// POST /api/process-market-notification-parents
//
// Responsabilidad:
// - Ejecutar Parent Notification Worker.
// - Claim parent.
// - Revalidar.
// - Fanout.
// - Crear market_notification_deliveries.
//
// NO:
// - envía push
// - llama OneSignal
// - procesa deliveries
// - activa notifications_enabled
// - usa secretos por query string
// ============================================================

const {
  randomUUID,
  timingSafeEqual
} = require("crypto");

const {
  processOneMarketNotificationParent
} = require(
  "../lib/marketNotificationParentWorker"
);


// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BATCH_LIMIT = 5;

const MAX_BATCH_LIMIT = 10;

const DEFAULT_LEASE_SECONDS = 30;

const MAX_LEASE_SECONDS = 120;


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

  const expectedSecret =
    cleanString(
      process.env
        .MARKET_PIPELINE_SECRET
    );


  if (!expectedSecret) {

    return {
      ok: false,
      status: 500,
      error:
        "MARKET_PIPELINE_SECRET_NOT_CONFIGURED"
    };
  }


  const providedSecret =
    getBearerToken(req);


  if (
    !safeSecretEqual(
      providedSecret,
      expectedSecret
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


  return {
    limit,
    leaseSeconds
  };
}


// ============================================================
// SUMMARY
// ============================================================

function buildSummary(results) {

  const summary = {

    requested:
      results.length,

    claimed:
      0,

    fanoutCompleted:
      0,

    cancelledOrSkipped:
      0,

    failed:
      0,

    insertedDeliveries:
      0,

    existingDeliveries:
      0,

    eligibleDevices:
      0,

    noParentAvailable:
      false
  };


  for (
    const result of results
  ) {

    if (
      result?.processed ===
      false &&
      result?.reason ===
      "NO_PARENT_NOTIFICATION_AVAILABLE"
    ) {

      summary
        .noParentAvailable =
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
      result?.fanout ===
      true &&
      result?.ok ===
      true
    ) {

      summary
        .fanoutCompleted +=
        1;


      summary
        .insertedDeliveries +=
        Number(
          result
            .insertedDeliveries ||
          0
        );


      summary
        .existingDeliveries +=
        Number(
          result
            .existingDeliveries ||
          0
        );


      summary
        .eligibleDevices +=
        Number(
          result
            .eligibleDevices ||
          0
        );


      continue;
    }


    if (
      result?.processed ===
        true &&
      result?.ok ===
        true &&
      result?.fanout ===
        false
    ) {

      summary
        .cancelledOrSkipped +=
        1;

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
    // HEADERS
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
      leaseSeconds
    } =
      getRequestOptions(req);


    const results =
      [];


    // ========================================================
    // PROCESS PARENTS SEQUENTIALLY
    // ========================================================

    try {

      for (
        let index = 0;
        index < limit;
        index += 1
      ) {

        const lockToken =
          randomUUID();


        const result =
          await processOneMarketNotificationParent({
            lockToken,
            leaseSeconds
          });


        results.push(
          result
        );


        // No quedan parents listos.
        if (
          result
            ?.processed ===
            false &&
          result
            ?.reason ===
            "NO_PARENT_NOTIFICATION_AVAILABLE"
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
            "market_notification_parent",

          summary,

          results
        });


    } catch (error) {

      return res
        .status(500)
        .json({

          ok: false,

          worker:
            "market_notification_parent",

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


const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const {
  AppStoreServerAPIClient,
  SignedDataVerifier,
  Environment,
  Status
} = require("@apple/app-store-server-library");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRODUCT_ID =
  "com.cashedge.app.premium.monthly";

// ==================================================
// APPLE SERVICES
// ==================================================

function getAppleServices(environment) {
  const required = [
    "APPLE_IAP_KEY_ID",
    "APPLE_IAP_ISSUER_ID",
    "APPLE_IAP_PRIVATE_KEY",
    "APPLE_BUNDLE_ID",
    "APPLE_APP_ID"
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing configuration: ${key}`);
    }
  }

  const rootCertificates = [
    "AppleIncRootCertificate.cer",
    "AppleRootCA-G2.cer",
    "AppleRootCA-G3.cer"
  ].map(file =>
    fs.readFileSync(
      path.join(__dirname, "../../lib", file)
    )
  );

  const bundleId = process.env.APPLE_BUNDLE_ID;

  const verifier = new SignedDataVerifier(
    rootCertificates,
    true,
    environment,
    bundleId,
    environment === Environment.PRODUCTION
      ? Number(process.env.APPLE_APP_ID)
      : undefined
  );

  const client = new AppStoreServerAPIClient(
    process.env.APPLE_IAP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    process.env.APPLE_IAP_KEY_ID,
    process.env.APPLE_IAP_ISSUER_ID,
    bundleId,
    environment
  );

  return { verifier, client };
}

// ==================================================
// VERIFY APPLE NOTIFICATION
// ==================================================

async function verifyNotification(signedPayload) {
  let lastError;

  for (const environment of [
    Environment.PRODUCTION,
    Environment.SANDBOX
  ]) {
    const services = getAppleServices(environment);

    try {
      const notification =
        await services.verifier.verifyAndDecodeNotification(
          signedPayload
        );

      return {
        notification,
        environment,
        ...services
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(
    "Invalid Apple notification"
  );
}

// ==================================================
// CURRENT SUBSCRIPTION STATUS
// ==================================================

async function getCurrentSubscription(
  client,
  verifier,
  originalTransactionId
) {
  const response =
    await client.getAllSubscriptionStatuses(
      originalTransactionId
    );

  const entries = (response.data || [])
    .flatMap(group => group.lastTransactions || []);

  const item = entries.find(
    entry =>
      entry.originalTransactionId ===
      originalTransactionId
  );

  if (!item?.signedTransactionInfo) {
    throw new Error("Subscription status unavailable");
  }

  const transaction =
    await verifier.verifyAndDecodeTransaction(
      item.signedTransactionInfo
    );

  if (
    transaction.originalTransactionId !==
      originalTransactionId ||
    transaction.productId !== PRODUCT_ID
  ) {
    throw new Error("Subscription verification mismatch");
  }

  const renewal = item.signedRenewalInfo
    ? await verifier.verifyAndDecodeRenewalInfo(
        item.signedRenewalInfo
      )
    : null;

  const expiresMs = Number(transaction.expiresDate);
  const graceMs = Number(
    renewal?.gracePeriodExpiresDate || 0
  );

  if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
    throw new Error("Invalid expiration date");
  }

  const now = Date.now();

  let status = "expired";

  if (
    transaction.revocationDate ||
    item.status === Status.REVOKED
  ) {
    status = "revoked";
  } else if (
    item.status === Status.ACTIVE &&
    expiresMs > now
  ) {
    status = "active";
  } else if (
    item.status === Status.BILLING_GRACE_PERIOD &&
    graceMs > now
  ) {
    status = "grace_period";
  } else if (item.status === Status.BILLING_RETRY) {
    status = "billing_retry";
  }

  return {
    transaction,
    status,
    expiresAt: new Date(expiresMs).toISOString(),
    graceExpiresAt: graceMs > 0
      ? new Date(graceMs).toISOString()
      : null
  };
}

// ==================================================
// APPLE NOTIFICATIONS V2
// ==================================================

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const signedPayload = req.body?.signedPayload;

  if (
    typeof signedPayload !== "string" ||
    signedPayload.length === 0
  ) {
    return res.status(400).json({
      error: "Missing signedPayload"
    });
  }

  let apple;

  try {
    // Verify Apple's cryptographic signature.
    apple = await verifyNotification(signedPayload);
  } catch (error) {
    console.error(
      "APPLE NOTIFICATION SIGNATURE ERROR:",
      error.message
    );

    return res.status(400).json({
      error: "Invalid Apple notification"
    });
  }

  try {
    const {
      notification,
      client,
      verifier,
      environment
    } = apple;

    // Official Apple connectivity test.
    if (notification.notificationType === "TEST") {
      console.log("APPLE TEST NOTIFICATION RECEIVED");

      return res.status(200).json({
        received: true,
        test: true
      });
    }

    const signedTransaction =
      notification.data?.signedTransactionInfo;

    // Some Apple events do not contain a transaction.
    if (!signedTransaction) {
      return res.status(200).json({
        received: true,
        ignored: true
      });
    }

    // Verify the transaction separately.
    const incoming =
      await verifier.verifyAndDecodeTransaction(
        signedTransaction
      );

    if (
      incoming.productId !== PRODUCT_ID ||
      !incoming.originalTransactionId
    ) {
      return res.status(200).json({
        received: true,
        ignored: true
      });
    }

    const originalTransactionId =
      incoming.originalTransactionId;

    // Only update purchases already linked to CashEdge.
    const {
      data: existing,
      error: lookupError
    } = await supabase
      .from("apple_subscriptions")
      .select("id, user_id")
      .eq(
        "original_transaction_id",
        originalTransactionId
      )
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!existing) {
      console.warn(
        "Apple transaction not yet linked:",
        originalTransactionId
      );

      return res.status(200).json({
        received: true,
        pendingAccountLink: true
      });
    }

    // Reject ownership conflicts.
    if (
      incoming.appAccountToken &&
      incoming.appAccountToken.toLowerCase() !==
        existing.user_id.toLowerCase()
    ) {
      throw new Error("Apple account ownership mismatch");
    }

    // Query Apple's current state instead of trusting
    // an old or duplicated notification event.
    const current = await getCurrentSubscription(
      client,
      verifier,
      originalTransactionId
    );

    if (
      current.transaction.appAccountToken &&
      current.transaction.appAccountToken.toLowerCase() !==
        existing.user_id.toLowerCase()
    ) {
      throw new Error("Current transaction ownership mismatch");
    }

    // Update only the Apple subscription record.
    const {
      data: updated,
      error: updateError
    } = await supabase
      .from("apple_subscriptions")
      .update({
        latest_transaction_id:
          current.transaction.transactionId,
        status: current.status,
        expires_at: current.expiresAt,
        grace_period_expires_at:
          current.graceExpiresAt,
        environment,
        updated_at: new Date().toISOString()
      })
      .eq(
        "original_transaction_id",
        originalTransactionId
      )
      .eq("user_id", existing.user_id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updated) {
      throw new Error("Subscription update not applied");
    }

    console.log("APPLE SUBSCRIPTION UPDATED:", {
      notificationType: notification.notificationType,
      subtype: notification.subtype || null,
      status: current.status,
      environment
    });

    return res.status(200).json({
      received: true
    });

  } catch (error) {
    console.error(
      "APPLE NOTIFICATIONS ERROR:",
      error.message
    );

    return res.status(500).json({
      received: false,
      error: "Unable to process Apple notification"
    });
  }
};


const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const {
  syncPremiumAccess
} = require("../../lib/syncPremiumAccess");
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

const PRODUCT_ID = "com.cashedge.app.premium.monthly";

function createAppleServices(environment) {
  const required = [
    "APPLE_IAP_KEY_ID",
    "APPLE_IAP_ISSUER_ID",
    "APPLE_IAP_PRIVATE_KEY",
    "APPLE_BUNDLE_ID",
    "APPLE_APP_ID"
  ];

  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`Missing configuration: ${name}`);
    }
  }

  const privateKey = process.env.APPLE_IAP_PRIVATE_KEY
    .replace(/\\n/g, "\n");

  const bundleId = process.env.APPLE_BUNDLE_ID;

  const certificates = [
    fs.readFileSync(path.join(
      __dirname, "../../lib/AppleIncRootCertificate.cer"
    )),
    fs.readFileSync(path.join(
      __dirname, "../../lib/AppleRootCA-G2.cer"
    )),
    fs.readFileSync(path.join(
      __dirname, "../../lib/AppleRootCA-G3.cer"
    ))
  ];

  const client = new AppStoreServerAPIClient(
    privateKey,
    process.env.APPLE_IAP_KEY_ID,
    process.env.APPLE_IAP_ISSUER_ID,
    bundleId,
    environment
  );

  const verifier = new SignedDataVerifier(
    certificates,
    true,
    environment,
    bundleId,
    environment === Environment.PRODUCTION
      ? Number(process.env.APPLE_APP_ID)
      : undefined
  );

  return { client, verifier };
}

async function getAppleTransaction(transactionId) {
  // Buscar primero en producción.
  // Solo intentar Sandbox si Apple devuelve 404.
  for (const environment of [
    Environment.PRODUCTION,
    Environment.SANDBOX
  ]) {
    const services = createAppleServices(environment);

    try {
      const response =
        await services.client.getTransactionInfo(transactionId);

      if (!response.signedTransactionInfo) {
        throw new Error("Missing signed transaction");
      }

      const transaction =
        await services.verifier.verifyAndDecodeTransaction(
          response.signedTransactionInfo
        );

      return {
        ...services,
        environment,
        transaction
      };
    } catch (error) {
      if (
        environment === Environment.PRODUCTION &&
        error.httpStatusCode === 404
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Transaction not found");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // 1. Verificar usuario de Supabase
    const authorization =
      String(req.headers.authorization || "");

    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData?.user?.id) {
      return res.status(401).json({
        error: "Invalid user token"
      });
    }

    const userId = authData.user.id;

    // 2. Obtener identificador de compra
    const transactionId =
      String(req.body?.transactionId || "").trim();

    if (!/^[0-9]{8,30}$/.test(transactionId)) {
      return res.status(400).json({
        error: "Invalid transaction ID"
      });
    }

    // 3. Consultar y verificar la compra con Apple
    const apple = await getAppleTransaction(transactionId);
    const initial = apple.transaction;

    if (
      initial.productId !== PRODUCT_ID ||
      !initial.originalTransactionId
    ) {
      return res.status(400).json({
        error: "Invalid subscription product"
      });
    }

    // La compra debe estar vinculada al usuario
    // mediante appAccountToken de StoreKit.
    if (
      String(initial.appAccountToken || "").toLowerCase() !==
      userId.toLowerCase()
    ) {
      return res.status(403).json({
        error: "Purchase is not linked to this account"
      });
    }

    // 4. Consultar el estado actual, incluidas renovaciones
    const statusResponse =
      await apple.client.getAllSubscriptionStatuses(
        initial.originalTransactionId
      );

    const items = (statusResponse.data || [])
      .flatMap(group => group.lastTransactions || []);

    const item = items.find(entry =>
      entry.originalTransactionId ===
      initial.originalTransactionId
    );

    if (!item?.signedTransactionInfo) {
      throw new Error("Subscription status unavailable");
    }

    const latest =
      await apple.verifier.verifyAndDecodeTransaction(
        item.signedTransactionInfo
      );

    if (
      latest.originalTransactionId !==
        initial.originalTransactionId ||
      latest.productId !== PRODUCT_ID ||
      (
        latest.appAccountToken &&
        latest.appAccountToken.toLowerCase() !==
          userId.toLowerCase()
      )
    ) {
      return res.status(403).json({
        error: "Subscription ownership mismatch"
      });
    }

    const renewal = item.signedRenewalInfo
      ? await apple.verifier.verifyAndDecodeRenewalInfo(
          item.signedRenewalInfo
        )
      : null;

    const now = Date.now();
    const expiresMs = Number(latest.expiresDate);
    const graceMs = Number(
      renewal?.gracePeriodExpiresDate || 0
    );

    if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
      throw new Error("Invalid subscription expiration");
    }

    // 5. Determinar el acceso desde el estado de Apple
    let status = "expired";

    if (latest.revocationDate) {
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
    } else if (item.status === Status.REVOKED) {
      status = "revoked";
    }

    // 6. Guardar en la tabla independiente de Apple
    const { error: dbError } = await supabase
      .from("apple_subscriptions")
      .upsert({
        user_id: userId,
        original_transaction_id:
          initial.originalTransactionId,
        latest_transaction_id: latest.transactionId,
        product_id: PRODUCT_ID,
        status,
        expires_at: new Date(expiresMs).toISOString(),
        grace_period_expires_at: graceMs > 0
          ? new Date(graceMs).toISOString()
          : null,
        environment: apple.environment,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "original_transaction_id"
      });

    if (dbError) {
      throw dbError;
    }
// Actualizar el Premium global de CashEdge.
// Conserva Premium si Apple o Stripe sigue activo.
const premiumAccess = await syncPremiumAccess(userId);
    return res.status(200).json({
      verified: true,
      provider: "apple",
      subscriptionStatus: status,
      isApplePremium: [
        "active",
        "grace_period"
      ].includes(status),
      isPremium: premiumAccess.isPremium,
      environment: apple.environment
    });

  } catch (error) {
    console.error(
      "APPLE SUBSCRIPTION VERIFICATION ERROR:",
      error.message
    );

    return res.status(500).json({
      verified: false,
      error: "Unable to verify Apple subscription"
    });
  }
};

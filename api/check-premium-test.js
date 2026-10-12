
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =========================
    // AUTHENTICATION
    // =========================

    const authHeader = String(
      req.headers.authorization || ""
    );

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const {
      data: authData,
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData?.user?.id) {
      return res.status(401).json({
        error: "Invalid token"
      });
    }

    const userId = authData.user.id;

    // =========================
    // EXISTING PREMIUM
    // =========================

    const {
      data: user,
      error: userError
    } = await supabaseAdmin
      .from("users")
      .select("is_premium, subscription_status")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    // Existing Stripe / legacy access
    const stripeOrLegacyPremium =
      user?.is_premium === true;

    // =========================
    // APPLE PREMIUM
    // =========================

    const {
      data: appleSubscriptions,
      error: appleError
    } = await supabaseAdmin
      .from("apple_subscriptions")
      .select(
        "status, expires_at, grace_period_expires_at"
      )
      .eq("user_id", userId);

    if (appleError) {
      throw appleError;
    }

    const now = Date.now();

    const applePremium =
      (appleSubscriptions || []).some(sub => {

        const expiresAt = sub.expires_at
          ? new Date(sub.expires_at).getTime()
          : 0;

        const graceExpiresAt =
          sub.grace_period_expires_at
            ? new Date(
                sub.grace_period_expires_at
              ).getTime()
            : 0;

        if (sub.status === "active") {
          return expiresAt > now;
        }

        if (sub.status === "grace_period") {
          return graceExpiresAt > now;
        }

        return false;
      });

    // =========================
    // COMBINED PREMIUM
    // =========================

    const isPremium =
      stripeOrLegacyPremium || applePremium;

    let source = "none";

    if (stripeOrLegacyPremium && applePremium) {
      source = "both";
    } else if (applePremium) {
      source = "apple";
    } else if (stripeOrLegacyPremium) {
      source = "stripe_or_legacy";
    }

    // =========================
    // TEST RESPONSE ONLY
    // =========================

    return res.status(200).json({
      testMode: true,
      isPremium,
      stripeOrLegacyPremium,
      applePremium,
      source,
      subscriptionStatus: isPremium
        ? "premium"
        : user?.subscription_status || "free"
    });

  } catch (error) {
    console.error(
      "PREMIUM TEST ERROR:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to test Premium access"
    });
  }
};

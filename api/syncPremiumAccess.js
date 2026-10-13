
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

// ============================================
// CHECK APPLE PREMIUM
// ============================================

async function hasActiveAppleSubscription(userId) {
  const { data, error } = await supabaseAdmin
    .from("apple_subscriptions")
    .select(
      "status, expires_at, grace_period_expires_at"
    )
    .eq("user_id", userId)
    .in("status", ["active", "grace_period"]);

  if (error) {
    throw new Error(
      `Apple subscription lookup failed: ${error.message}`
    );
  }

  const now = Date.now();

  return (data || []).some(subscription => {
    if (subscription.status === "active") {
      const expiration = Date.parse(
        subscription.expires_at || ""
      );

      return (
        Number.isFinite(expiration) &&
        expiration > now
      );
    }

    if (subscription.status === "grace_period") {
      const graceExpiration = Date.parse(
        subscription.grace_period_expires_at || ""
      );

      return (
        Number.isFinite(graceExpiration) &&
        graceExpiration > now
      );
    }

    return false;
  });
}

// ============================================
// CHECK STRIPE PREMIUM
// ============================================

async function hasActiveStripeSubscription(
  stripeCustomerId
) {
  if (!stripeCustomerId) {
    return false;
  }

  const subscriptions = stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 100
  });

  for await (const subscription of subscriptions) {
    if (
      subscription.status === "active" ||
      subscription.status === "trialing"
    ) {
      return true;
    }
  }

  return false;
}

// ============================================
// SYNC GLOBAL CASHEDGE PREMIUM
// ============================================

async function syncPremiumAccess(userId) {
  if (!userId) {
    throw new Error("Missing userId");
  }

  const { data: user, error: userError } =
    await supabaseAdmin
      .from("users")
      .select("id, stripe_customer_id")
      .eq("id", userId)
      .single();

  if (userError || !user) {
    throw new Error(
      `Unable to load CashEdge user: ${
        userError?.message || "User not found"
      }`
    );
  }

  // Verify both payment providers.
  const [appleActive, stripeActive] =
    await Promise.all([
      hasActiveAppleSubscription(userId),
      hasActiveStripeSubscription(
        user.stripe_customer_id
      )
    ]);

  // One valid subscription is enough.
  const isPremium = appleActive || stripeActive;

  const { error: updateError } =
    await supabaseAdmin
      .from("users")
      .update({
        is_premium: isPremium
      })
      .eq("id", userId);

  if (updateError) {
    throw new Error(
      `Premium sync failed: ${updateError.message}`
    );
  }

  console.log("CASHEDGE PREMIUM SYNC:", {
    userId,
    appleActive,
    stripeActive,
    isPremium
  });

  return {
    isPremium,
    appleActive,
    stripeActive
  };
}

module.exports = {
  syncPremiumAccess
};

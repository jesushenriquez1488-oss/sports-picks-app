const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function hasActiveAppleSubscription(userId) {
  const { data, error } = await supabaseAdmin
    .from("apple_subscriptions")
    .select("status, expires_at, grace_period_expires_at")
    .eq("user_id", userId)
    .in("status", ["active", "grace_period"]);

  if (error) throw error;

  const now = Date.now();

  return (data || []).some(subscription => {
    if (subscription.status === "active") {
      return Date.parse(subscription.expires_at || "") > now;
    }

    if (subscription.status === "grace_period") {
      return Date.parse(
        subscription.grace_period_expires_at || ""
      ) > now;
    }

    return false;
  });
}

async function hasActiveStripeSubscription(customerId) {
  if (!customerId) return false;

  const subscriptions = stripe.subscriptions.list({
    customer: customerId,
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

// NEW: Whop membership active for this user (by user_id or by email)
async function hasActiveWhopMembership(userId, email) {
  const filters = [`user_id.eq.${userId}`];
  if (email) filters.push(`email.eq.${String(email).trim().toLowerCase()}`);

  const { data, error } = await supabaseAdmin
    .from("whop_memberships")
    .select("membership_id")
    .eq("valid", true)
    .or(filters.join(","))
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function syncPremiumAccess(userId) {
  if (!userId) throw new Error("Missing userId");

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, email, stripe_customer_id")
    .eq("id", userId)
    .single();

  if (error || !user) {
    throw new Error("CashEdge user not found");
  }

  const [appleActive, stripeActive, whopActive] = await Promise.all([
    hasActiveAppleSubscription(userId),
    hasActiveStripeSubscription(user.stripe_customer_id),
    hasActiveWhopMembership(userId, user.email)
  ]);

  const isPremium = appleActive || stripeActive || whopActive;

  const active = [
    appleActive && "apple",
    stripeActive && "stripe",
    whopActive && "whop"
  ].filter(Boolean);

  // Keeps the old values ("apple", "stripe", "both") and adds "whop"
  const premiumProvider =
    active.length === 0 ? null :
    active.length === 1 ? active[0] :
    "both";

  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({
      is_premium: isPremium,
      premium_provider: premiumProvider
    })
    .eq("id", userId);

  if (updateError) throw updateError;

  console.log("CASHEDGE PREMIUM SYNC:", {
    userId,
    appleActive,
    stripeActive,
    whopActive,
    isPremium
  });

  return { isPremium, appleActive, stripeActive, whopActive };
}

module.exports = { syncPremiumAccess };

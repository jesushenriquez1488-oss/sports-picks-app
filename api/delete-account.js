const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
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

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // ========================================================
    // AUTH
    // ========================================================

    const authHeader =
      String(req.headers.authorization || "");

    const token =
      authHeader.startsWith("Bearer ")
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
    } =
      await supabaseAdmin.auth.getUser(token);

    const user =
      authData?.user;

    if (
      authError ||
      !user?.id
    ) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const userId =
      user.id;

    // ========================================================
    // LOAD CASHEDGE USER
    // ========================================================

    const {
      data: profile,
      error: profileError
    } =
      await supabaseAdmin
        .from("users")
        .select(
          "id, stripe_customer_id"
        )
        .eq("id", userId)
        .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    // ========================================================
    // CANCEL STRIPE SUBSCRIPTIONS
    // ========================================================

    if (profile?.stripe_customer_id) {
      const subscriptions =
        await stripe.subscriptions.list({
          customer:
            profile.stripe_customer_id,
          status: "all",
          limit: 100
        });

      for (
        const subscription
        of subscriptions.data
      ) {
        if (
          subscription.status !==
            "canceled" &&
          subscription.status !==
            "incomplete_expired"
        ) {
          await stripe.subscriptions.cancel(
            subscription.id
          );
        }
      }
    }

    // ========================================================
    // DELETE USER DATA
    // ========================================================

    const {
      error: analysisError
    } =
      await supabaseAdmin
        .from("analysis_usage")
        .delete()
        .eq("user_id", userId);

    if (analysisError) {
      throw analysisError;
    }

    const {
      error: trackingError
    } =
      await supabaseAdmin
        .from("user_tracking")
        .delete()
        .eq("user_id", userId);

    if (trackingError) {
      throw trackingError;
    }

    // ========================================================
    // ANONYMIZE AFFILIATE SALES
    // ========================================================

    const {
      error: affiliateError
    } =
      await supabaseAdmin
        .from("affiliate_sales")
        .update({
          user_id: null,
          stripe_customer_id: null,
          stripe_session_id: null
        })
        .eq("user_id", userId);

    if (affiliateError) {
      throw affiliateError;
    }

    // ========================================================
    // DELETE PUBLIC USER
    //
    // push_devices and market_notification_deliveries
    // are deleted automatically by CASCADE.
    // ========================================================

    const {
      error: userDeleteError
    } =
      await supabaseAdmin
        .from("users")
        .delete()
        .eq("id", userId);

    if (userDeleteError) {
      throw userDeleteError;
    }

    // ========================================================
    // DELETE SUPABASE AUTH ACCOUNT
    // ========================================================

    const {
      error: authDeleteError
    } =
      await supabaseAdmin
        .auth
        .admin
        .deleteUser(userId);

    if (authDeleteError) {
      throw authDeleteError;
    }

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error(
      "DELETE ACCOUNT ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to delete account."
    });
  }
};

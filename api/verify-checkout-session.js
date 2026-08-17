const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =========================
    // AUTH
    // =========================

    const authHeader = String(
      req.headers.authorization || ""
    );

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        verified: false,
        error: "Unauthorized"
      });
    }

    const {
      data: authData,
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (
      authError ||
      !authData?.user?.id
    ) {
      return res.status(401).json({
        verified: false,
        error: "Unauthorized"
      });
    }

    const userId = authData.user.id;

    // =========================
    // STRIPE SESSION
    // =========================

    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({
        verified: false,
        error: "Missing session_id"
      });
    }

    const session =
      await stripe.checkout.sessions.retrieve(
        session_id
      );

    // =========================
    // OWNERSHIP
    // =========================

    const belongsToUser =
      session.metadata?.userId === userId ||
      session.client_reference_id === userId;

    if (!belongsToUser) {
      return res.status(403).json({
        verified: false,
        error: "Forbidden"
      });
    }

    // =========================
    // PAYMENT
    // =========================

    if (session.payment_status !== "paid") {
      return res.status(200).json({
        verified: false,
        status: session.payment_status
      });
    }

    return res.status(200).json({
      verified: true,
      transactionId: session.id,
      value: Number(session.amount_total || 0) / 100,
      currency: String(
        session.currency || "usd"
      ).toUpperCase()
    });

  } catch (err) {
    console.error(
      "VERIFY CHECKOUT ERROR:",
      err
    );

    return res.status(500).json({
      verified: false,
      error: "Unable to verify checkout session"
    });
  }
};

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = req.body || {};

    if (!userId || userId === "guest") {
      return res.status(400).json({ error: "Falta userId válido" });
    }

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error || !user?.stripe_customer_id) {
      return res.status(404).json({
        error: "No se encontró cliente de Stripe para este usuario"
      });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: "https://www.cashedgeapp.com"
    });

    return res.status(200).json({
      url: portalSession.url
    });

  } catch (error) {
    console.error("❌ CUSTOMER PORTAL ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
};

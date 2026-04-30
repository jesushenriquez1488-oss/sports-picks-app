const Stripe = require("stripe");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  let event;

  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error de firma:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const userId = session.metadata?.userId;
    const email = session.customer_email || session.metadata?.email || "";

    console.log("💰 Pago recibido:", email);
    console.log("👤 User ID:", userId);

    if (!userId || userId === "guest") {
      console.error("❌ No llegó userId válido");
      return res.status(400).json({ error: "Missing valid userId" });
    }

    const { error } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: userId,
          email: email,
          is_premium: true,
          subscription_status: "premium",
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: "id" }
      );

    if (error) {
      console.error("❌ Error actualizando Supabase:", error);
      return res.status(500).json({ error: "Supabase update failed" });
    }

    console.log("🔥 PREMIUM ACTIVADO:", email);
  }

  return res.status(200).json({ received: true });
};

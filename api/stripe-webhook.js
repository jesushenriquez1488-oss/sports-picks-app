const Stripe = require("stripe");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

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

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session.metadata?.userId;
      const email = session.customer_email || session.metadata?.email || "";

      if (!userId || userId === "guest") {
        return res.status(400).json({ error: "Missing valid userId" });
      }

      await supabaseAdmin
        .from("users")
        .upsert(
          {
            id: userId,
            email,
            is_premium: true,
            subscription_status: "premium",
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null
          },
          { onConflict: "id" }
        );

      console.log("🔥 PREMIUM ACTIVADO:", email);
    }

    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed"
    ) {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      await supabaseAdmin
        .from("users")
        .update({
          is_premium: false,
          subscription_status: "canceled"
        })
        .eq("stripe_customer_id", customerId);

      console.log("🔒 PREMIUM DESACTIVADO:", customerId);
    }

    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const active =
        subscription.status === "active" ||
        subscription.status === "trialing";

      await supabaseAdmin
        .from("users")
        .update({
          is_premium: active,
          subscription_status: active ? "premium" : subscription.status
        })
        .eq("stripe_customer_id", customerId);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

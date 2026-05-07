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
    console.error("❌ Error de firma Stripe:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log("✅ STRIPE EVENT:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId =
        session.metadata?.userId ||
        session.client_reference_id;

      const email =
        session.customer_email ||
        session.metadata?.email ||
        "";

      if (!userId || userId === "guest") {
        console.error("❌ Missing valid userId:", userId);
        return res.status(200).json({ received: true });
      }

      const { data, error } = await supabaseAdmin
        .from("users")
        .upsert(
          {
            id: userId,
            email: email,
            is_premium: true,
            subscription_status: "premium",
            stripe_customer_id: session.customer || null
          },
          { onConflict: "id" }
        )
        .select();

      if (error) {
        console.error("❌ SUPABASE PREMIUM ERROR:", error.message);
        return res.status(500).json({ error: error.message });
      }

      console.log("✅ PREMIUM ACTIVADO:", data);
    }

    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed"
    ) {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const { error } = await supabaseAdmin
        .from("users")
        .update({
          is_premium: false,
          subscription_status: "canceled"
        })
        .eq("stripe_customer_id", customerId);

      if (error) {
        console.error("❌ ERROR DESACTIVANDO PREMIUM:", error.message);
      }
    }

    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const active =
        subscription.status === "active" ||
        subscription.status === "trialing";

      const { error } = await supabaseAdmin
        .from("users")
        .update({
          is_premium: active,
          subscription_status: active ? "premium" : subscription.status
        })
        .eq("stripe_customer_id", customerId);

      if (error) {
        console.error("❌ ERROR ACTUALIZANDO SUBSCRIPCIÓN:", error.message);
      }
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error("❌ WEBHOOK GENERAL ERROR:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

const Stripe = require("stripe");
const { buffer } = require("micro");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

  // 🔥 EVENTO IMPORTANTE
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    console.log("💰 Pago exitoso:", session.customer_email);
    console.log("🧾 Session ID:", session.id);

    // 👉 Aquí luego activamos premium
  }

  return res.status(200).json({ received: true });
};

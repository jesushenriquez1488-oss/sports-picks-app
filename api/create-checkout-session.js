const Stripe = require("stripe");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "STRIPE_SECRET_KEY no está configurada" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { userId, email } = req.body || {};

    if (!userId || !email) {
      return res.status(400).json({ error: "Falta userId o email" });
    }

    const origin =
      req.headers.origin ||
      `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price: "price_1TS20hJxhhhzBuV9O74jwDkT",
          quantity: 1,
        },
      ],
      success_url: `${origin}?success=true`,
      cancel_url: `${origin}?canceled=true`,
      metadata: {
        userId: userId,
        email: email,
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("STRIPE CHECKOUT ERROR:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({
        error: "Missing session_id"
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"]
    });

    if (!session) {
      return res.status(404).json({
        verified: false,
        error: "Session not found"
      });
    }

    if (session.payment_status !== "paid") {
      return res.status(200).json({
        verified: false,
        status: session.payment_status
      });
    }

    return res.status(200).json({
      verified: true,
      transactionId: session.id,
      value: session.amount_total / 100,
      currency: session.currency.toUpperCase(),
      customer: session.customer,
      subscription: session.subscription?.id || null
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      verified: false,
      error: err.message
    });
  }
};

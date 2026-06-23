const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

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
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: "STRIPE_SECRET_KEY no está configurada"
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

   const {
  userId,
  email,
  promoCode = "",
  action = "checkout"
} = req.body || {};

const cleanPromoCode = String(promoCode || "").trim().toUpperCase();
console.log("PROMO CODE RECEIVED:", cleanPromoCode);
    const APP_URL = "https://www.cashedgeapp.com";

    if (!userId || userId === "guest") {
      return res.status(400).json({
        error: "Falta userId válido"
      });
    }

    if (action === "portal") {
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
        return_url: APP_URL
      });

      return res.status(200).json({
        url: portalSession.url
      });
    }

    if (!email) {
      return res.status(400).json({
        error: "Falta email"
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",

      payment_method_types: ["card"],

      customer_email: email,

      client_reference_id: userId,

      line_items: [
        {
          price: "price_1TS20hJxhhhzBuV9O74jwDkT",
          quantity: 1
        }
      ],

      success_url: `${APP_URL}?success=true`,

      cancel_url: `${APP_URL}?canceled=true`,

     metadata: {
  userId,
  email,
  promoCode: cleanPromoCode
},

     subscription_data: {
  metadata: {
    userId,
    email,
    promoCode: cleanPromoCode
  }
}
    });

    return res.status(200).json({
      url: session.url
    });

  } catch (error) {
    console.error("❌ STRIPE SESSION ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
};

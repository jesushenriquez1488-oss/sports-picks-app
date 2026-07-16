const Stripe = require("stripe");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }

    return cookies;
  }, {});
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0]?.trim() || "";
  }

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || "";
  }

  return (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  );
}

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
const cookies = parseCookies(req.headers.cookie || "");

const metaEventId = crypto.randomUUID();

const fbp = cookies._fbp || "";
const fbc = cookies._fbc || "";

const clientIpAddress = getClientIp(req);
const clientUserAgent = req.headers["user-agent"] || "";
const eventSourceUrl = req.headers.referer || APP_URL;

const metaMetadata = {
  userId: String(userId),
  email: String(email || ""),
  promoCode: cleanPromoCode,
  metaEventId,
  eventSourceUrl: String(eventSourceUrl),
  ...(clientIpAddress
    ? { clientIpAddress: String(clientIpAddress) }
    : {}),
  ...(clientUserAgent
    ? { clientUserAgent: String(clientUserAgent) }
    : {}),
  ...(fbp ? { fbp: String(fbp) } : {}),
  ...(fbc ? { fbc: String(fbc) } : {})
};
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

    success_url:
  `${APP_URL}?success=true` +
  `&session_id={CHECKOUT_SESSION_ID}` +
  `&meta_event_id=${encodeURIComponent(metaEventId)}`,

      cancel_url: `${APP_URL}?canceled=true`,

     metadata: metaMetadata,

subscription_data: {
  metadata: metaMetadata
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

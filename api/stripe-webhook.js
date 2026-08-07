const Stripe = require("stripe");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
function sha256(value) {
  if (!value) return null;

  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

async function sendMetaPurchase({
  email,
  userId,
  value,
  currency = "USD",
  eventId,
  eventSourceUrl,
  clientIpAddress,
  clientUserAgent,
  fbp,
  fbc,
}) {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.warn("⚠️ Meta credentials are missing.");
    return;
  }

  const userData = {};

  const hashedEmail = sha256(email);
  const hashedExternalId = sha256(userId);

  if (hashedEmail) {
    userData.em = [hashedEmail];
  }

  if (hashedExternalId) {
    userData.external_id = [hashedExternalId];
  }

  if (clientIpAddress) {
    userData.client_ip_address = clientIpAddress;
  }

  if (clientUserAgent) {
    userData.client_user_agent = clientUserAgent;
  }

  if (fbp) {
    userData.fbp = fbp;
  }

  if (fbc) {
    userData.fbc = fbc;
  }

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_id: eventId,
        event_source_url:
          eventSourceUrl || "https://www.cashedgeapp.com/",
        user_data: userData,
        custom_data: {
          currency,
          value,
          content_name: "CashEdge Premium Subscription",
          content_type: "product",
        },
      },
    ],
  };

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ META PURCHASE ERROR:", result);
    throw new Error(
      result?.error?.message || "Meta Purchase event failed"
    );
  }

  console.log("✅ META PURCHASE SENT:", {
    eventId,
    value,
    currency,
    eventsReceived: result.events_received,
    messages: result.messages,
    fbtraceId: result.fbtrace_id,
  });
}
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
if (session.payment_status !== "paid") {
  console.log("ℹ️ Checkout completed but payment is not paid:", {
    sessionId: session.id,
    paymentStatus: session.payment_status
  });

  return res.status(200).json({ received: true });
}
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
    const advertisingConsent =
  session.metadata?.advertisingConsent === "granted";

if (advertisingConsent) {

  await sendMetaPurchase({
    email,
    userId,
    value: Number(session.amount_total || 0) / 100,
    currency: session.currency?.toUpperCase() || "USD",
    eventId:
      session.metadata?.metaEventId || session.id,
    eventSourceUrl:
      session.metadata?.eventSourceUrl ||
      "https://www.cashedgeapp.com/",
    clientIpAddress:
      session.metadata?.clientIpAddress || null,
    clientUserAgent:
      session.metadata?.clientUserAgent || null,
    fbp:
      session.metadata?.fbp || null,
    fbc:
      session.metadata?.fbc || null,
  });

  console.log(
    "✅ Meta CAPI Purchase sent with advertising consent."
  );

} else {

  console.log(
    "ℹ️ Meta CAPI Purchase skipped: advertising consent not granted."
  );

}
      const promoCode = String(session.metadata?.promoCode || "")
  .trim()
  .toUpperCase();

if (promoCode) {
  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from("affiliate_codes")
    .select("code, owner_name, commission_percent, active")
    .eq("code", promoCode)
    .eq("active", true)
    .maybeSingle();

  if (affiliateError) {
    console.error("❌ AFFILIATE LOOKUP ERROR:", affiliateError.message);
  }

  if (affiliate) {
    const amountPaid = Number(session.amount_total || 0) / 100;
    const commissionPercent = Number(affiliate.commission_percent || 30);
    const commissionAmount = Number(
      (amountPaid * (commissionPercent / 100)).toFixed(3)
    );

    const { error: saleError } = await supabaseAdmin
      .from("affiliate_sales")
      .insert({
        user_id: userId,
        affiliate_code: affiliate.code,
        owner_name: affiliate.owner_name,
        stripe_customer_id: session.customer || null,
        stripe_session_id: session.id,
        amount_paid: amountPaid,
        commission_percent: commissionPercent,
        commission_amount: commissionAmount
      });

    if (saleError) {
      console.error("❌ AFFILIATE SALE ERROR:", saleError.message);
    } else {
      console.log("✅ AFFILIATE SALE SAVED:", {
        code: affiliate.code,
        owner: affiliate.owner_name,
        amountPaid,
        commissionAmount
      });
    }
  } else {
    console.log("ℹ️ No valid affiliate code found:", promoCode);
  }
}
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

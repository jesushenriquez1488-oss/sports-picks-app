// /api/whop-webhook.js
// Whop → CashEdge: activates / removes Premium when someone buys or cancels on Whop.
// Events: membership.activated, membership.deactivated (also accepts *.went_valid/*.went_invalid)

const crypto = require("crypto");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");
const { syncPremiumAccess } = require("../lib/syncPremiumAccess");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = { api: { bodyParser: false } };

// ── Signature (Standard Webhooks: webhook-id / webhook-timestamp / webhook-signature) ──
function verifySignature(rawBody, headers) {
  const secret = process.env.WHOP_WEBHOOK_SECRET || "";
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"] || "";
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // Header can contain several "v1,<sig>" separated by spaces
  return signatureHeader.split(" ").some(part => {
    const sig = part.split(",")[1] || "";
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function pickEmail(data) {
  return String(
    data?.user?.email || data?.email || data?.member?.email || data?.customer?.email || ""
  ).trim().toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let event;
  try {
    const raw = (await buffer(req)).toString("utf8");
    if (!verifySignature(raw, req.headers)) {
      console.error("❌ WHOP signature invalid");
      return res.status(401).json({ error: "Invalid signature" });
    }
    event = JSON.parse(raw);
  } catch (err) {
    console.error("❌ WHOP webhook parse error:", err.message);
    return res.status(400).json({ error: "Bad request" });
  }

  try {
    const type = String(event?.type || event?.action || "");
    const data = event?.data || {};
    console.log("✅ WHOP EVENT:", type, JSON.stringify(data).slice(0, 1500));

    const activated = /membership\.(activated|went_valid)/.test(type);
    const deactivated = /membership\.(deactivated|went_invalid)/.test(type);
    if (!activated && !deactivated) return res.status(200).json({ received: true, ignored: type });

    const membershipId = String(data.id || "");
    const email = pickEmail(data);
    if (!membershipId) return res.status(200).json({ received: true, error: "No membership id" });

    // Find the CashEdge user with that email (if they already signed up)
    let userId = null;
    if (email) {
      const { data: user } = await supabaseAdmin
        .from("users").select("id").ilike("email", email).maybeSingle();
      userId = user?.id || null;
    }

    // Save / update the Whop membership
    const { error: upsertError } = await supabaseAdmin
      .from("whop_memberships")
      .upsert({
        membership_id: membershipId,
        email: email || null,
        status: String(data.status || (activated ? "active" : "inactive")),
        valid: activated,
        user_id: userId ? String(userId) : null,
        product_id: String(data?.product?.id || data?.product_id || ""),
        updated_at: new Date().toISOString()
      }, { onConflict: "membership_id" });
    if (upsertError) throw upsertError;

    // Recalculate Premium (Stripe OR Apple OR Whop)
    if (userId) await syncPremiumAccess(userId);

    console.log("✅ WHOP MEMBERSHIP SAVED:", { membershipId, email, userId, valid: activated });
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ WHOP WEBHOOK ERROR:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

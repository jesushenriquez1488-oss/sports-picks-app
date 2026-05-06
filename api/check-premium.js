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
    const { userId } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("is_premium, subscription_status")
      .eq("id", userId)
      .single();

    if (error || !data) {
      return res.status(200).json({
        isPremium: false,
        subscriptionStatus: "free"
      });
    }

    return res.status(200).json({
      isPremium: data.is_premium === true,
      subscriptionStatus: data.subscription_status || "free"
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

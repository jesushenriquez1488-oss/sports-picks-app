const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Verificar token del usuario
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Token inválido" });
    }

    // Usar el ID del token, no el del body
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("is_premium, subscription_status")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      return res.status(200).json({ isPremium: false, subscriptionStatus: "free" });
    }

    return res.status(200).json({
      isPremium: data.is_premium === true,
      subscriptionStatus: data.subscription_status || "free"
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

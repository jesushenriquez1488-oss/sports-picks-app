const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    // 🔎 buscar usuario
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("is_premium")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isPremium = user.is_premium;

    // 📊 traer picks
    const { data: picks, error: picksError } = await supabase
      .from("picks")
      .select("*")
      .order("created_at", { ascending: false });

    if (picksError) {
      return res.status(500).json({ error: "Error loading picks" });
    }

    // 🔐 filtro real
    const filtered = picks.filter(pick => {
      if (pick.is_premium && !isPremium) return false;
      return true;
    });

    return res.status(200).json({
      isPremium,
      picks: filtered
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

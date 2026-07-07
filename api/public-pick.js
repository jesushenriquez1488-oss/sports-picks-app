const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const nowISO = new Date().toISOString();

    const { data: picks } = await supabaseAdmin
      .from("daily_picks")
      .select("sport, away_team, home_team, game_time, analysis_json")
      .gte("game_time", nowISO)
      .order("game_time", { ascending: true })
      .limit(60);

    if (!picks || picks.length === 0) {
      return res.status(200).json({ available: false });
    }

    const premiumPicks = picks
      .filter(p =>
        p.analysis_json?.isPremiumPick === true &&
        p.analysis_json?.premium?.confidence
      )
      .sort((a, b) =>
        Number(b.analysis_json.premium.confidence || 0) -
        Number(a.analysis_json.premium.confidence || 0)
      );

    if (premiumPicks.length === 0) {
      return res.status(200).json({ available: false });
    }

    const best = premiumPicks[0];
    const premium = best.analysis_json.premium;

    return res.status(200).json({
      available: true,
      sport: String(best.sport || "").toUpperCase(),
      matchup: `${best.away_team} vs ${best.home_team}`,
      gameTime: best.game_time,
      confidence: Math.round(Number(premium.confidence || 0)),
      edge: Number(premium.mainEdge || 0).toFixed(1)
    });
  } catch (error) {
    console.error("PUBLIC PICK ERROR:", error);
    return res.status(200).json({ available: false });
  }
};

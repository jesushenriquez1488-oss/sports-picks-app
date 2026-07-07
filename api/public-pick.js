const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Extrae el confidence sin importar el deporte
function getConfidence(premium) {
  if (!premium) return 0;

  // NBA / WNBA / NFL / NCAAF -> premium.confidence
  if (premium.confidence) return Number(premium.confidence);

  // MLB -> recommendedCards[0].percentage
  if (Array.isArray(premium.recommendedCards) && premium.recommendedCards[0]?.percentage) {
    return Number(premium.recommendedCards[0].percentage);
  }

  return 0;
}

// Extrae el edge sin importar el deporte
function getEdge(premium) {
  if (!premium) return 0;
  if (premium.mainEdge) return Number(premium.mainEdge);
  if (premium.totalEdge) return Number(premium.totalEdge);
  if (Array.isArray(premium.recommendedCards) && premium.recommendedCards[0]?.totalEdge) {
    return Number(premium.recommendedCards[0].totalEdge);
  }
  return 0;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());

    const { data: picks } = await supabaseAdmin
      .from("daily_picks")
      .select("sport, away_team, home_team, game_time, analysis_json")
      .eq("game_date", today)
      .limit(60);

    if (!picks || picks.length === 0) {
      return res.status(200).json({ available: false });
    }

    const premiumPicks = picks
      .filter(p => p.analysis_json?.isPremiumPick === true)
      .map(p => ({
        sport: p.sport,
        away_team: p.away_team,
        home_team: p.home_team,
        game_time: p.game_time,
        confidence: getConfidence(p.analysis_json.premium),
        edge: getEdge(p.analysis_json.premium)
      }))
      .filter(p => p.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    if (premiumPicks.length === 0) {
      return res.status(200).json({ available: false });
    }

    const best = premiumPicks[0];

    return res.status(200).json({
      available: true,
      sport: String(best.sport || "").toUpperCase(),
      matchup: `${best.away_team} vs ${best.home_team}`,
      gameTime: best.game_time,
      confidence: Math.round(best.confidence),
      edge: Number(best.edge).toFixed(1)
    });
  } catch (error) {
    console.error("PUBLIC PICK ERROR:", error);
    return res.status(200).json({ available: false });
  }
};

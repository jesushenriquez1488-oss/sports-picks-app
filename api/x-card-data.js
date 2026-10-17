// /api/x-card-data.js
// Data for the X bot card (x-card.html).
// SECURITY: only serves picks saved in x_free_plays (the daily Free Premium Play
// that is tweeted publicly). Any other Premium pick is never exposed here.

const { createClient } = require("@supabase/supabase-js");
const { buildDisplayPayload } = require("./select-featured-pick");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  try {
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: "Invalid date" });
    }

    // 1) Which pick was the Free Premium Play that day
    const { data: play, error: playError } = await supabaseAdmin
      .from("x_free_plays")
      .select("pick_id")
      .eq("post_date", date)
      .maybeSingle();
    if (playError) throw playError;
    if (!play) return res.status(404).json({ ok: false, error: "No free play for that date" });

    // 2) The pick
    const { data: history, error: historyError } = await supabaseAdmin
      .from("picks_history")
      .select(`
        id, game_id, sport, away_team, home_team, game_date, pick, confidence,
        result, final_score, graded_at, is_premium, pick_type, pick_team,
        pick_direction, line, odds_american
      `)
      .eq("id", play.pick_id)
      .maybeSingle();
    if (historyError) throw historyError;
    if (!history) return res.status(404).json({ ok: false, error: "Pick not found" });

    // 3) The analysis snapshot (same source the landing uses)
    const { data: dailyPick, error: dailyError } = await supabaseAdmin
      .from("daily_picks")
      .select("sport, game_id, game_date, analysis_json")
      .eq("sport", history.sport)
      .eq("game_id", history.game_id)
      .eq("game_date", history.game_date)
      .maybeSingle();
    if (dailyError) throw dailyError;

    const payload = buildDisplayPayload(history, dailyPick || {});
    if (!payload) return res.status(404).json({ ok: false, error: "Unsupported sport" });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      featured: {
        sourceGameDate: history.game_date,
        sport: history.sport,
        result: String(history.result || "").toLowerCase(),
        finalScore: history.final_score || null,
        ...payload
      }
    });
  } catch (error) {
    console.error("X CARD DATA ERROR:", error);
    return res.status(500).json({ ok: false, error: "Unable to load card" });
  }
};

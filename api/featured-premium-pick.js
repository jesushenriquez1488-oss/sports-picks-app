const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getChicagoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const today = getChicagoDate();

   const { data, error } = await supabaseAdmin
  .from("landing_featured_picks")
  .select(`
    display_date,
    source_game_date,
    sport,
    result,
    final_score,
    display_payload
  `)
  .lte("display_date", today)
  .order("display_date", { ascending: false })
  .limit(1)
  .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(200).json({
        ok: true,
        available: false
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600"
    );

    return res.status(200).json({
      ok: true,
      available: true,
      featured: {
        displayDate: data.display_date,
        sourceGameDate: data.source_game_date,
        sport: data.sport,
        result: data.result,
        finalScore: data.final_score,
        ...data.display_payload
      }
    });

  } catch (error) {
    console.error(
      "FEATURED PREMIUM PICK ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      available: false,
      error: "Unable to load featured pick"
    });
  }
};

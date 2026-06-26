import dotenv from "dotenv";

dotenv.config();

const ODDS_API_KEY = process.env.ODDS_API_KEY;

export async function fetchOddsForSport(sport) {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY no configurada en el bot");
  }

  const isSoccer = sport.startsWith("soccer_");
  const isFootball =
    sport === "americanfootball_nfl" ||
    sport === "americanfootball_ncaaf";

  const markets = isSoccer ? "h2h,totals,spreads" : "h2h,spreads,totals";
  const regions = isFootball ? "us" : "us,eu";

  const url =
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=${regions}` +
    `&markets=${markets}` +
    `&oddsFormat=american`;

  console.log(`📡 Fetching odds: ${sport} | markets=${markets} | regions=${regions}`);

  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    console.error(`❌ Odds API error for ${sport}:`, text);
    return [];
  }

  let games = [];

  try {
    games = JSON.parse(text);
  } catch (err) {
    console.error(`❌ Error parseando odds para ${sport}:`, err.message);
    return [];
  }

  const cleanGames = games.filter(game => {
    if (!game.bookmakers || game.bookmakers.length === 0) return false;

    if (isFootball) {
      return game.bookmakers.some(book =>
        book.markets?.some(m => m.key === "spreads" || m.key === "totals")
      );
    }

    return true;
  });

  console.log(`✅ ${sport}: ${cleanGames.length} juegos con odds`);

  return cleanGames;
}

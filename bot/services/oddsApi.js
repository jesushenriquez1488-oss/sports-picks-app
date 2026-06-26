import dotenv from "dotenv";
import { ACTIVE_SPORTS } from "../config/sports.js";

dotenv.config();

const ODDS_API_KEY = process.env.ODDS_API_KEY;

function getMarketsForSport(sport) {
  if (sport.startsWith("soccer_")) return "h2h,totals,spreads";
  return "h2h,spreads,totals";
}

function getRegionsForSport(sport) {
  const isFootball =
    sport === "americanfootball_nfl" ||
    sport === "americanfootball_ncaaf";

  return isFootball ? "us" : "us,eu";
}

async function fetchOddsForSport(sport) {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY no configurada en el bot");
  }

  const markets = getMarketsForSport(sport);
  const regions = getRegionsForSport(sport);

  const url =
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=${regions}` +
    `&markets=${markets}` +
    `&oddsFormat=american`;

  console.log(`📡 ${sport} | markets=${markets} | regions=${regions}`);

  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    console.error(`❌ Odds API error ${sport}:`, text);
    return [];
  }

  try {
    const games = JSON.parse(text);

    return games.filter(game =>
      game.bookmakers && game.bookmakers.length > 0
    );
  } catch (error) {
    console.error(`❌ Error parseando ${sport}:`, error.message);
    return [];
  }
}

export async function fetchAllOdds() {
  const allGames = [];

  for (const sport of ACTIVE_SPORTS) {
    try {
      const games = await fetchOddsForSport(sport);

      console.log(`✅ ${sport}: ${games.length} juegos`);

      allGames.push(...games);
    } catch (error) {
      console.error(`❌ Error en ${sport}:`, error.message);
    }
  }

  return allGames;
}

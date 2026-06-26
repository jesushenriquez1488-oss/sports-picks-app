import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.ODDS_API_KEY;

export async function getOdds(sport, markets = "h2h") {
    console.log(`📡 Consultando ${sport} (${markets})`);

    return [];
}

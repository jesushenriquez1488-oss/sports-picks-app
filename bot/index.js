import { fetchAllOdds } from "./services/oddsApi.js";
import { normalizeOddsEvents } from "./services/marketNormalizer.js";

async function runMarketEngine() {
  console.log("🚀 CashEdge Market Engine iniciado...");

  const games = await fetchAllOdds();

  console.log(`📦 Juegos recibidos: ${games.length}`);

  const normalizedMarkets = normalizeOddsEvents(games);

  console.log(`📊 Mercados normalizados: ${normalizedMarkets.length}`);

  console.log("✅ Market Engine corrida terminada.");
}

runMarketEngine();

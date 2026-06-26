import { fetchAllOdds } from "./services/oddsApi.js";
import { normalizeOddsEvents } from "./services/marketNormalizer.js";
import { scanArbitrage } from "./scanners/arbitrageScanner.js";
import { saveArbitrageOpportunities } from "./services/supabase.js";

async function runMarketEngine() {
  console.log("🚀 CashEdge Market Engine iniciado...");

  const games = await fetchAllOdds();
  console.log(`📦 Juegos recibidos: ${games.length}`);

  const normalizedMarkets = normalizeOddsEvents(games);
  console.log(`📊 Mercados normalizados: ${normalizedMarkets.length}`);

  const arbitrageOpportunities = scanArbitrage(normalizedMarkets);
  console.log(`🚨 Arbitrajes encontrados: ${arbitrageOpportunities.length}`);

  await saveArbitrageOpportunities(arbitrageOpportunities);

  console.log("✅ Corrida terminada.");
}

runMarketEngine();

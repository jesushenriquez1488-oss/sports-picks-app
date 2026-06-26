import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createOpportunityFingerprint } from "../utils/opportunityFingerprint.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function saveArbitrageOpportunities(opportunities = []) {
  if (!opportunities.length) {
    console.log("📭 No hay arbitrajes para guardar.");
    return;
  }

  const rows = opportunities.map((opportunity) => ({
    fingerprint: createOpportunityFingerprint(opportunity),

    sport: opportunity.sport,
    game_id: opportunity.gameId,
    home_team: opportunity.homeTeam,
    away_team: opportunity.awayTeam,
    market: opportunity.market,

    book_a: opportunity.optionA.sportsbook,
    selection_a: opportunity.optionA.selection,
    odds_a: opportunity.optionA.odds,
    point_a: opportunity.optionA.point,

    book_b: opportunity.optionB.sportsbook,
    selection_b: opportunity.optionB.selection,
    odds_b: opportunity.optionB.odds,
    point_b: opportunity.optionB.point,

    profit_percent: opportunity.profitPercent,
    stake_a: opportunity.stakeA,
    stake_b: opportunity.stakeB,
    total_stake: opportunity.totalStake,
    guaranteed_profit: opportunity.guaranteedProfit,

    commence_time: opportunity.optionA.commenceTime,
    raw_data: opportunity,
    status: "active",
    expires_at: new Date(Date.now() + 90 * 1000).toISOString()
  }));

  const { error } = await supabase
    .from("arbitrage_alerts")
    .upsert(rows, { onConflict: "fingerprint" });

  if (error) {
    console.error("❌ Error guardando arbitrajes:", error);
    return;
  }

  console.log(`✅ ${rows.length} arbitrajes guardados.`);
}

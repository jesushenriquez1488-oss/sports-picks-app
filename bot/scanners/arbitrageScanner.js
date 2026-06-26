import { calculateTwoWayArbitrage } from "../calculators/arbitrageCalculator.js";

export function scanArbitrage(markets) {
  const opportunities = [];

  const grouped = new Map();

  for (const market of markets) {
    const key =
      `${market.gameId}|${market.market}|${market.point ?? "none"}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(market);
  }

  for (const [, selections] of grouped) {
    if (selections.length < 2) continue;

    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {

        const a = selections[i];
        const b = selections[j];

        if (a.sportsbook === b.sportsbook) continue;

        if (a.selection === b.selection) continue;

        const result = calculateTwoWayArbitrage(a, b);

        if (result.isArbitrage) {
          opportunities.push({
            ...result,
            sport: a.sportKey,
            gameId: a.gameId,
            homeTeam: a.homeTeam,
            awayTeam: a.awayTeam,
            market: a.market,
            optionA: a,
            optionB: b
          });
        }
      }
    }
  }

  return opportunities;
}

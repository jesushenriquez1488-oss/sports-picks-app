export function normalizeOddsEvents(events = []) {
  const normalized = [];

  for (const event of events) {
    const baseEvent = {
      gameId: event.id,
      sportKey: event.sport_key,
      sportTitle: event.sport_title,
      commenceTime: event.commence_time,
      homeTeam: event.home_team,
      awayTeam: event.away_team
    };

    for (const bookmaker of event.bookmakers || []) {
      const sportsbook = bookmaker.key;
      const sportsbookTitle = bookmaker.title;

      for (const market of bookmaker.markets || []) {
        const marketType = normalizeMarketKey(market.key);

        if (!marketType) continue;

        for (const outcome of market.outcomes || []) {
          normalized.push({
            ...baseEvent,
            sportsbook,
            sportsbookTitle,
            market: marketType,
            selection: outcome.name,
            odds: outcome.price,
            point: outcome.point ?? null,
            lastUpdate: bookmaker.last_update
          });
        }
      }
    }
  }

  return normalized;
}

function normalizeMarketKey(key) {
  if (key === "h2h") return "moneyline";
  if (key === "spreads") return "spread";
  if (key === "totals") return "total";
  return null;
}

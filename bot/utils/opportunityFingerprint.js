export function createOpportunityFingerprint(opportunity) {
  const sport = clean(opportunity.sport);
  const gameId = clean(opportunity.gameId);
  const market = clean(opportunity.market);

  const optionA = opportunity.optionA || {};
  const optionB = opportunity.optionB || {};

  const bookA = clean(optionA.sportsbook);
  const bookB = clean(optionB.sportsbook);

  const selectionA = clean(optionA.selection);
  const selectionB = clean(optionB.selection);

  const pointA = normalizePoint(optionA.point);
  const pointB = normalizePoint(optionB.point);

  const books = [bookA, bookB].sort().join("_");
  const selections = [selectionA, selectionB].sort().join("_");
  const points = [pointA, pointB].sort().join("_");

  return [
    sport,
    gameId,
    market,
    selections,
    points,
    books
  ].join("|");
}

function clean(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizePoint(point) {
  if (point === null || point === undefined || point === "") {
    return "none";
  }

  const value = Number(point);

  if (!Number.isFinite(value)) {
    return clean(point);
  }

  return value.toFixed(2);
}

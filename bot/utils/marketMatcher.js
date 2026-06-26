export function isValidArbitragePair(a, b) {
  if (!a || !b) return false;

  if (a.gameId !== b.gameId) return false;
  if (a.market !== b.market) return false;
  if (a.sportsbook === b.sportsbook) return false;
  if (a.selection === b.selection) return false;

  if (a.market === "moneyline") {
    return isMoneylinePair(a, b);
  }

  if (a.market === "spread") {
    return isSpreadPair(a, b);
  }

  if (a.market === "total") {
    return isTotalPair(a, b);
  }

  return false;
}

function isMoneylinePair(a, b) {
  return a.point == null && b.point == null;
}

function isSpreadPair(a, b) {
  if (a.point == null || b.point == null) return false;

  const pointA = Number(a.point);
  const pointB = Number(b.point);

  if (!Number.isFinite(pointA) || !Number.isFinite(pointB)) return false;

  return Math.abs(pointA + pointB) < 0.001;
}

function isTotalPair(a, b) {
  if (a.point == null || b.point == null) return false;

  const pointA = Number(a.point);
  const pointB = Number(b.point);

  if (!Number.isFinite(pointA) || !Number.isFinite(pointB)) return false;

  const sameLine = Math.abs(pointA - pointB) < 0.001;

  const oneOverOneUnder =
    isOver(a.selection) && isUnder(b.selection) ||
    isUnder(a.selection) && isOver(b.selection);

  return sameLine && oneOverOneUnder;
}

function isOver(selection = "") {
  return String(selection).toLowerCase() === "over";
}

function isUnder(selection = "") {
  return String(selection).toLowerCase() === "under";
}

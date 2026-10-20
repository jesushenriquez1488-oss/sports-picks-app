
"use strict";

const REQUIRED = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "three_pointers_made"
];

function scoreNBA(stats, platform) {
  if (!["draftkings", "fanduel"].includes(platform)) {
    throw new Error("Plataforma no admitida");
  }

  const missing = REQUIRED.filter(key =>
    stats?.[key] === null ||
    stats?.[key] === undefined ||
    stats?.[key] === "" ||
    !Number.isFinite(Number(stats[key]))
  );

  if (missing.length) {
    return {
      complete: false,
      points: null,
      missing
    };
  }

  const n = key => Number(stats[key]);

  const pts = n("points");
  const reb = n("rebounds");
  const ast = n("assists");
  const stl = n("steals");
  const blk = n("blocks");
  const tov = n("turnovers");
  const threes = n("three_pointers_made");

  let points;
  let doubleDouble = false;
  let tripleDouble = false;

  if (platform === "draftkings") {
    const categories = [
      pts, reb, ast, stl, blk
    ].filter(value => value >= 10).length;

    doubleDouble = categories >= 2;
    tripleDouble = categories >= 3;

    points =
      pts +
      threes * 0.5 +
      reb * 1.25 +
      ast * 1.5 +
      stl * 2 +
      blk * 2 -
      tov * 0.5 +
      (doubleDouble ? 1.5 : 0) +
      (tripleDouble ? 3 : 0);

  } else {
    points =
      pts +
      reb * 1.2 +
      ast * 1.5 +
      stl * 3 +
      blk * 3 -
      tov;
  }

  return {
    complete: true,
    points: Math.round(points * 100) / 100,
    doubleDouble,
    tripleDouble
  };
}

module.exports = {
  scoreNBA
};

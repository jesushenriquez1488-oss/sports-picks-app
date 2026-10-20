
"use strict";

const REQUIRED = [
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "fumbles_lost",
  "two_point_conversions",
  "return_tds",
  "offensive_fumble_recovery_tds"
];

function scoreNFLOffense(stats, platform) {
  if (!["draftkings", "fanduel"].includes(platform)) {
    throw new Error("Plataforma no admitida");
  }

  const missing = REQUIRED.filter(key =>
    stats?.[key] === null ||
    stats?.[key] === undefined ||
    stats?.[key] === "" ||
    !Number.isFinite(Number(stats[key]))
  );

  // Nunca inventamos cero si falta una estadistica.
  if (missing.length) {
    return {
      complete: false,
      points: null,
      missing
    };
  }

  const n = key => Number(stats[key]);

  const bonusPassing =
    n("passing_yards") >= 300 ? 3 : 0;

  const bonusRushing =
    n("rushing_yards") >= 100 ? 3 : 0;

  const bonusReceiving =
    n("receiving_yards") >= 100 ? 3 : 0;

  const receptionRate =
    platform === "draftkings" ? 1 : 0.5;

  const fumblePenalty =
    platform === "draftkings" ? 1 : 2;

  const points =
    n("passing_yards") * 0.04 +
    n("passing_tds") * 4 -
    n("passing_interceptions") +
    n("rushing_yards") * 0.1 +
    n("rushing_tds") * 6 +
    n("receptions") * receptionRate +
    n("receiving_yards") * 0.1 +
    n("receiving_tds") * 6 -
    n("fumbles_lost") * fumblePenalty +
    n("two_point_conversions") * 2 +
    n("return_tds") * 6 +
    n("offensive_fumble_recovery_tds") * 6 +
    bonusPassing +
    bonusRushing +
    bonusReceiving;

  return {
    complete: true,
    points: Math.round(points * 100) / 100,
    bonuses: {
      passing: bonusPassing,
      rushing: bonusRushing,
      receiving: bonusReceiving
    }
  };
}

module.exports = {
  scoreNFLOffense
};

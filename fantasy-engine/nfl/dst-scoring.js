
"use strict";

/**
 * CashEdge Fantasy Edge - NFL DST Scoring
 *
 * Calcula puntos Fantasy de una defensa a partir
 * de estadísticas reales y verificadas.
 *
 * No proyecta resultados futuros.
 * No consulta APIs ni escribe en Supabase.
 *
 * defensive_tds y special_teams_tds deben ser
 * categorías mutuamente excluyentes.
 * Las anotaciones por retorno de una patada
 * bloqueada deben contarse una sola vez.
 *
 * points_allowed debe excluir los puntos que
 * las reglas DFS no atribuyen a la defensa/ST.
 */

const PLATFORMS = ["draftkings", "fanduel"];

const REQUIRED = [
  "sacks",
  "interceptions",
  "fumble_recoveries",
  "defensive_tds",
  "special_teams_tds",
  "safeties",
  "blocked_kicks",
  "two_point_returns",
  "points_allowed"
];

function pointsAllowedScore(points) {
  if (points === 0) return 10;
  if (points <= 6) return 7;
  if (points <= 13) return 4;
  if (points <= 20) return 1;
  if (points <= 27) return 0;
  if (points <= 34) return -1;
  return -4;
}

function scoreNFLDST(stats, platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error("Plataforma DST no admitida");
  }

  const missing = REQUIRED.filter(key => {
    const value = stats?.[key];

    return (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value)) ||
      !Number.isInteger(Number(value)) ||
      Number(value) < 0
    );
  });

  if (missing.length) {
    return {
      complete: false,
      points: null,
      missing,
      readyForOptimization: false
    };
  }

  const n = key => Number(stats[key]);

  const breakdown = {
    sacks: n("sacks"),
    interceptions: n("interceptions") * 2,
    fumbleRecoveries: n("fumble_recoveries") * 2,
    defensiveTouchdowns: n("defensive_tds") * 6,
    specialTeamsTouchdowns: n("special_teams_tds") * 6,
    safeties: n("safeties") * 2,
    blockedKicks: n("blocked_kicks") * 2,
    twoPointReturns: n("two_point_returns") * 2,
    pointsAllowed: pointsAllowedScore(n("points_allowed"))
  };

  const points = Object.values(breakdown)
    .reduce((total, value) => total + value, 0);

  return {
    complete: true,
    platform,
    points,
    breakdown,
    readyForOptimization: false,
    readyForPublication: false,
    mode: "SHADOW"
  };
}

module.exports = {
  scoreNFLDST,
  pointsAllowedScore
};

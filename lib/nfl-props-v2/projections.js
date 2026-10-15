
"use strict";

// ==========================================
// CASHEDGE NFL V2 — PROJECTION BASELINE
// ==========================================
//
// Proyecciones independientes del sportsbook.
//
// No descarga estadísticas.
// No calcula cuotas.
// No modifica Confidence.
// No escribe en Supabase.
//
// Utiliza historial y participación
// previamente recopilados por CashEdge.
// ==========================================

function validNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function round(value, digits = 2) {
  return validNumber(value)
    ? Number(value.toFixed(digits))
    : null;
}

function multiply(a, b) {
  return validNumber(a) && validNumber(b)
    ? a * b
    : null;
}

function sum(a, b) {
  return validNumber(a) && validNumber(b)
    ? a + b
    : null;
}

// Calcular rendimiento ponderado,
// dando mayor importancia a los
// partidos recientes.
//
// Los pesos son provisionales:
// se calibrarán mediante backtests.
function weightedRate(
  rows,
  numerator,
  denominator,
  halfLifeGames
) {
  let top = 0;
  let bottom = 0;
  let observations = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const a = numerator(row.game);
    const b = denominator(row);

    if (
      !validNumber(a) ||
      !validNumber(b) ||
      b < 0
    ) {
      continue;
    }

    const weight = Math.pow(
      0.5,
      i / halfLifeGames
    );

    top += weight * a;
    bottom += weight * b;

    observations++;
  }

  return {
    value: bottom > 0
      ? top / bottom
      : null,

    observations,
    denominator: bottom
  };
}

// ==========================================
// MAIN PROJECTION
// ==========================================

function calculateNFLV2Baseline({
  playerGames,
  participation,
  roleSignals,
  season,
  halfLifeGames = 4
} = {}) {

  if (
    !Number.isInteger(Number(season)) ||
    !validNumber(halfLifeGames) ||
    halfLifeGames <= 0
  ) {
    throw new Error(
      "Invalid NFL V2 baseline parameters"
    );
  }

  const targetSeason = Number(season);

  const team = String(
    roleSignals
      ?.currentTeamFromLastBoxscore || ""
  );

  // ========================================
  // 1. VALIDAR SNAPS REALES
  // ========================================

  const evidence =
    Array.isArray(participation?.games)
      ? participation.games
      : [];

  const snapsByGame = new Map(
    evidence
      .filter(e =>
        e.match ===
          "verified_id_date_team" &&

        e.played === true &&

        validNumber(e.offenseSnaps) &&

        e.offenseSnaps > 0
      )
      .map(e => [
        `${e.espnGameId}|${e.date}`,
        e.offenseSnaps
      ])
  );

  // ========================================
  // 2. HISTORIAL VERIFICADO
  // ========================================

  const rows = (
    Array.isArray(playerGames)
      ? playerGames
      : []
  )
    .filter(game =>
      Number(game.season) ===
        targetSeason &&

      String(
        game.teamAbbreviation || ""
      ) === team
    )
    .map(game => ({
      game,

      snaps: snapsByGame.get(
        `${game.gameId}|${game.gameDate}`
      )
    }))
    .filter(row =>
      validNumber(row.snaps) &&
      row.snaps > 0
    )
    .sort((a, b) =>
      b.game.gameDate.localeCompare(
        a.game.gameDate
      )
    );

  // No producir proyecciones
  // sin evidencia histórica suficiente.
  if (
    !team ||

    roleSignals?.positionMatched !== true ||

    roleSignals?.roleEvidenceEnough !== true ||

    rows.length < 3
  ) {
    return {
      status:
        "insufficient_verified_role_data",

      season: targetSeason,
      currentTeam: team || null,
      gamesUsed: rows.length,

      publishable: false,
      projections: null
    };
  }

  // Mantener partidos de bajo volumen.
  // NO seleccionar solamente
  // los partidos buenos.
  const sample = rows.slice(0, 8);

  const recent = sample.slice(0, 3);

  // ========================================
  // 3. PARTICIPACION BASE ESPERADA
  // ========================================

  const expectedSnaps =
    recent.reduce(
      (total, row) =>
        total + row.snaps,
      0
    ) / recent.length;

  // Esta es la base histórica.
  // Los cambios actuales de rol y
  // lesiones se incorporarán después.

  // ========================================
  // 4. ESTADISTICAS INDIVIDUALES
  // ========================================

  const field = path => game => {
    const [market, stat] =
      path.split(".");

    return game?.[market]?.[stat];
  };

  const snap = row => row.snaps;

  const attempts =
    field("passing.attempts");

  const carries =
    field("rushing.attempts");

  const targets =
    field("receiving.targets");

  // ========================================
  // 5. OPORTUNIDADES POR SNAP
  // ========================================

  const passRate = weightedRate(
    sample,
    attempts,
    snap,
    halfLifeGames
  );

  const rushRate = weightedRate(
    sample,
    carries,
    snap,
    halfLifeGames
  );

  const targetRate = weightedRate(
    sample,
    targets,
    snap,
    halfLifeGames
  );

  // ========================================
  // 6. EFICIENCIA REAL DEL JUGADOR
  // ========================================

  const passYPA = weightedRate(
    sample,
    field("passing.yards"),
    row => attempts(row.game),
    halfLifeGames
  );

  const rushYPC = weightedRate(
    sample,
    field("rushing.yards"),
    row => carries(row.game),
    halfLifeGames
  );

  const recYPT = weightedRate(
    sample,
    field("receiving.yards"),
    row => targets(row.game),
    halfLifeGames
  );

  const catchRate = weightedRate(
    sample,
    field("receiving.receptions"),
    row => targets(row.game),
    halfLifeGames
  );

  // ========================================
  // 7. VOLUMEN BASE PROYECTADO
  // ========================================

  const passVolume = multiply(
    expectedSnaps,
    passRate.value
  );

  const rushVolume = multiply(
    expectedSnaps,
    rushRate.value
  );

  const targetVolume = multiply(
    expectedSnaps,
    targetRate.value
  );

  // ========================================
  // 8. PRODUCCION BASE PROYECTADA
  // ========================================

  const passingYards = multiply(
    passVolume,
    passYPA.value
  );

  const rushingYards = multiply(
    rushVolume,
    rushYPC.value
  );

  const receivingYards = multiply(
    targetVolume,
    recYPT.value
  );

  const receptions = multiply(
    targetVolume,
    catchRate.value
  );

  // ========================================
  // 9. RESULTADO EXPERIMENTAL
  // ========================================

  return {
    status:
      "baseline_ready_context_pending",

    season: targetSeason,
    currentTeam: team,

    gamesUsed: sample.length,
    halfLifeGames,

    publishable: false,

    currentInjuriesApplied: false,
    opponentDefenseApplied: false,

    // La línea del sportsbook
    // NO participa en este cálculo.
    lineUsed: false,

    expectedSnaps:
      round(expectedSnaps),

    expectedOpportunities: {
      passingAttempts:
        round(passVolume),

      rushingAttempts:
        round(rushVolume),

      targets:
        round(targetVolume)
    },

    efficiency: {
      yardsPerPassAttempt:
        round(passYPA.value, 3),

      yardsPerCarry:
        round(rushYPC.value, 3),

      yardsPerTarget:
        round(recYPT.value, 3),

      receptionsPerTarget:
        round(catchRate.value, 3)
    },

    projections: {
      passingYards:
        round(passingYards),

      rushingYards:
        round(rushingYards),

      receivingYards:
        round(receivingYards),

      receptions:
        round(receptions),

      passingPlusRushingYards:
        round(
          sum(
            passingYards,
            rushingYards
          )
        ),

      rushingPlusReceivingYards:
        round(
          sum(
            rushingYards,
            receivingYards
          )
        )
    },

    notes: [
      "Historical baseline only.",
      "Teammate injury redistribution pending.",
      "Opponent defensive adjustment pending.",
      "Predictive probability pending.",
      "No sportsbook line influences projection.",
      "Weights require backtest calibration."
    ]
  };
}


// ==========================================
// NFL V2 — DEFENSIVE ADJUSTMENT
// ==========================================

function applyNFLV2Defense({
  v2Baseline,
  defensiveContext
} = {}) {

  if (
    !v2Baseline?.projections ||
    !defensiveContext?.metrics
  ) {
    return null;
  }

  // Una muestra defensiva insuficiente
  // no modifica la proyección base.
  const factorFor = key => {
    const item = defensiveContext.metrics[key];

    return (
      item?.status === "research_only" &&
      validNumber(item.factor) &&
      item.factor > 0
    )
      ? item.factor
      : 1;
  };

  const factors = {
    passYPA: factorFor("passYPA"),
    rushYPC: factorFor("rushYPC"),
    recYPT: factorFor("recYPT"),
    catchRate: factorFor("catchRate")
  };

  const base = v2Baseline.projections;

  // Aplicar cada factor una sola vez.
  const passingYards = multiply(
    base.passingYards,
    factors.passYPA
  );

  const rushingYards = multiply(
    base.rushingYards,
    factors.rushYPC
  );

  const receivingYards = multiply(
    base.receivingYards,
    factors.recYPT
  );

  const receptions = multiply(
    base.receptions,
    factors.catchRate
  );

  // Las combinadas reutilizan las
  // proyecciones ya ajustadas.
  return {
    status: "experimental_defensive_adjustment",

    publishable: false,
    lineUsed: false,

    opponentTeamId:
      defensiveContext.opponentTeamId,

    defensiveGamesCurrentSeason:
      defensiveContext.gamesThisSeason,

    factorsUsed: factors,

    // No volvemos a calcular
    // el volumen del jugador.
    expectedOpportunities:
      v2Baseline.expectedOpportunities,

    projections: {
      passingYards: round(passingYards),

      rushingYards: round(rushingYards),

      receivingYards: round(receivingYards),

      receptions: round(receptions),

      passingPlusRushingYards: round(
        sum(passingYards, rushingYards)
      ),

      rushingPlusReceivingYards: round(
        sum(rushingYards, receivingYards)
      )
    },

    note:
      "Experimental defensive adjustment. " +
      "Insufficient defensive samples remain neutral. " +
      "No sportsbook line used."
  };
}

module.exports = {
  calculateNFLV2Baseline,
  applyNFLV2Defense
};


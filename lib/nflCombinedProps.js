/*
 * ============================================================
 * CASHEDGE — NFL COMBINED PROPS
 * EXPERIMENTAL DATA ENGINE
 * ============================================================
 *
 * FASE 1:
 *
 * - NO modifica Player Props de producción.
 * - NO calcula Confidence.
 * - NO genera recomendaciones.
 * - NO consulta Owls.
 * - NO escribe en Supabase.
 *
 * Su única responsabilidad es construir correctamente
 * estadísticas combinadas por partido utilizando
 * el historial que CashEdge ya posee.
 *
 * Mercados iniciales:
 *
 * 1. pass_rush_yards
 * 2. rush_rec_yards
 * ============================================================
 */


const NFL_COMBINED_PROP_MARKETS = {

  pass_rush_yards: {
    key: "pass_rush_yards",
    label: "Passing + Rushing Yards",

    components: [
      "passingYards",
      "rushingYards"
    ],

    allowedPositions: [
      "QB"
    ]
  },


  rush_rec_yards: {
    key: "rush_rec_yards",
    label: "Rushing + Receiving Yards",

    components: [
      "rushingYards",
      "receivingYards"
    ],

    allowedPositions: [
      "RB",
      "FB",
      "WR",
      "TE"
    ]
  }
};


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function isFiniteNumber(value) {

  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(
      Number(value)
    )
  );
}


function hasOwn(
  object,
  key
) {

  return (
    object &&
    Object.prototype
      .hasOwnProperty
      .call(
        object,
        key
      )
  );
}


/*
 * CashEdge actualmente posee dos formatos
 * principales de estadísticas:
 *
 * 1. Boxscore temporal:
 *
 * {
 *   passingYards,
 *   rushingYards,
 *   receivingYards
 * }
 *
 *
 * 2. Gamelog cache:
 *
 * {
 *   passing: {
 *     yards
 *   },
 *
 *   rushing: {
 *     yards
 *   },
 *
 *   receiving: {
 *     yards
 *   }
 * }
 *
 *
 * Este helper acepta ambos formatos.
 */

function readNFLYardStat(
  gameLog,
  stat
) {

  if (!gameLog) {
    return null;
  }


  if (
    stat === "passingYards"
  ) {

    if (
      hasOwn(
        gameLog,
        "passingYards"
      )
    ) {
      return isFiniteNumber(
        gameLog.passingYards
      )
        ? Number(
            gameLog.passingYards
          )
        : null;
    }


    if (
      hasOwn(
        gameLog?.passing,
        "yards"
      )
    ) {
      return isFiniteNumber(
        gameLog.passing.yards
      )
        ? Number(
            gameLog.passing.yards
          )
        : null;
    }


    return null;
  }


  if (
    stat === "rushingYards"
  ) {

    if (
      hasOwn(
        gameLog,
        "rushingYards"
      )
    ) {
      return isFiniteNumber(
        gameLog.rushingYards
      )
        ? Number(
            gameLog.rushingYards
          )
        : null;
    }


    if (
      hasOwn(
        gameLog?.rushing,
        "yards"
      )
    ) {
      return isFiniteNumber(
        gameLog.rushing.yards
      )
        ? Number(
            gameLog.rushing.yards
          )
        : null;
    }


    return null;
  }


  if (
    stat === "receivingYards"
  ) {

    if (
      hasOwn(
        gameLog,
        "receivingYards"
      )
    ) {
      return isFiniteNumber(
        gameLog.receivingYards
      )
        ? Number(
            gameLog.receivingYards
          )
        : null;
    }


    if (
      hasOwn(
        gameLog?.receiving,
        "yards"
      )
    ) {
      return isFiniteNumber(
        gameLog.receiving.yards
      )
        ? Number(
            gameLog.receiving.yards
          )
        : null;
    }


    return null;
  }


  return null;
}


/*
 * ============================================================
 * MARKET VALIDATION
 * ============================================================
 */

function getNFLCombinedMarket(
  market
) {

  const key =
    String(
      market || ""
    )
      .trim()
      .toLowerCase();


  return (
    NFL_COMBINED_PROP_MARKETS[
      key
    ] ||
    null
  );
}


function isNFLCombinedMarket(
  market
) {

  return Boolean(
    getNFLCombinedMarket(
      market
    )
  );
}


function isNFLCombinedPositionAllowed(
  market,
  position
) {

  const config =
    getNFLCombinedMarket(
      market
    );


  if (!config) {
    return false;
  }


  const pos =
    String(
      position || ""
    )
      .trim()
      .toUpperCase();


  return (
    config
      .allowedPositions
      .includes(
        pos
      )
  );
}


/*
 * ============================================================
 * COMBINED VALUE — ONE GAME
 * ============================================================
 *
 * IMPORTANTE:
 *
 * Los componentes se suman solamente
 * cuando pertenecen al MISMO partido.
 *
 * Nunca se suman promedios de partidos
 * diferentes.
 * ============================================================
 */

function getNFLCombinedGameValue(
  gameLog,
  market
) {

  const config =
    getNFLCombinedMarket(
      market
    );


  if (
    !config ||
    !gameLog
  ) {
    return null;
  }


  const values = {};


  for (
    const component of
    config.components
  ) {

    const value =
      readNFLYardStat(
        gameLog,
        component
      );


    /*
     * null significa dato inexistente.
     *
     * Cero sí es válido.
     */
    if (
      value === null
    ) {
      return null;
    }


    values[
      component
    ] = value;
  }


  const total =
    config.components
      .reduce(
        (
          sum,
          component
        ) =>
          sum +
          values[
            component
          ],
        0
      );


  return {

    gameId:
      gameLog?.gameId
        ? String(
            gameLog.gameId
          )
        : null,

    date:
      gameLog?.date ||
      null,

    season:
      Number.isFinite(
        Number(
          gameLog?.season
        )
      )
        ? Number(
            gameLog.season
          )
        : null,

    week:
      Number.isFinite(
        Number(
          gameLog?.week
        )
      )
        ? Number(
            gameLog.week
          )
        : null,

    opponentId:
      gameLog?.opponentId
        ? String(
            gameLog.opponentId
          )
        : null,

    opponent:
      gameLog?.opponent ||
      null,

    homeAway:
      gameLog?.homeAway ||
      null,

    market:
      config.key,

    components:
      values,

    value:
      Number(
        total.toFixed(1)
      )
  };
}


/*
 * ============================================================
 * COMBINED SAMPLE
 * ============================================================
 *
 * Recibe logs YA filtrados por CashEdge.
 *
 * Este módulo no decide si un partido
 * tuvo un rol comparable.
 *
 * Eso continuará siendo responsabilidad
 * de la capa de roles existente.
 * ============================================================
 */

function buildNFLCombinedSample({
  logs = [],
  market
}) {

  if (
    !Array.isArray(
      logs
    ) ||
    !logs.length
  ) {
    return [];
  }


  const uniqueGames =
    new Map();


  for (
    const gameLog of logs
  ) {

    const combined =
      getNFLCombinedGameValue(
        gameLog,
        market
      );


    if (!combined) {
      continue;
    }


    const gameKey =
      combined.gameId ||
      [
        combined.season || "",
        combined.date || "",
        combined.opponent || ""
      ].join("|");


    if (
      !gameKey
    ) {
      continue;
    }


    if (
      !uniqueGames.has(
        gameKey
      )
    ) {

      uniqueGames.set(
        gameKey,
        combined
      );
    }
  }


  return Array.from(
    uniqueGames.values()
  )
    .sort(
      (
        a,
        b
      ) =>
        new Date(
          b?.date || 0
        ) -
        new Date(
          a?.date || 0
        )
    );
}


/*
 * ============================================================
 * BASIC DISTRIBUTION SUMMARY
 * ============================================================
 *
 * Esto NO es todavía probabilidad predictiva.
 *
 * Son solamente estadísticas descriptivas
 * de la muestra.
 * ============================================================
 */

function mean(
  values
) {

  if (!values.length) {
    return null;
  }


  return (
    values.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    values.length
  );
}


function standardDeviation(
  values
) {

  if (
    !values.length
  ) {
    return null;
  }


  const avg =
    mean(
      values
    );


  if (
    avg === null
  ) {
    return null;
  }


  const variance =
    values.reduce(
      (
        sum,
        value
      ) =>
        sum +
        Math.pow(
          value - avg,
          2
        ),
      0
    ) /
    values.length;


  return Math.sqrt(
    variance
  );
}


function summarizeNFLCombinedSample(
  sample = []
) {

  const values =
    (
      Array.isArray(
        sample
      )
        ? sample
        : []
    )
      .map(
        game =>
          Number(
            game?.value
          )
      )
      .filter(
        value =>
          Number.isFinite(
            value
          )
      );


  if (!values.length) {

    return {
      games: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      values: []
    };
  }


  return {

    games:
      values.length,

    mean:
      Number(
        mean(
          values
        ).toFixed(2)
      ),

    stdDev:
      Number(
        standardDeviation(
          values
        ).toFixed(2)
      ),

    min:
      Math.min(
        ...values
      ),

    max:
      Math.max(
        ...values
      ),

    values
  };
}


/*
 * ============================================================
 * HISTORICAL COVERAGE
 * ============================================================
 *
 * SOLO frecuencia histórica.
 *
 * NO llamar a este porcentaje
 * "Confidence".
 * ============================================================
 */

function buildNFLCombinedHistoricalCoverage({
  sample = [],
  line,
  side = "OVER"
}) {

  const targetLine =
    Number(
      line
    );


  if (
    !Number.isFinite(
      targetLine
    )
  ) {
    return null;
  }


  const targetSide =
    String(
      side || "OVER"
    )
      .trim()
      .toUpperCase();


  if (
    targetSide !== "OVER" &&
    targetSide !== "UNDER"
  ) {
    return null;
  }


  let wins = 0;
  let losses = 0;
  let pushes = 0;


  for (
    const game of
    sample
  ) {

    const value =
      Number(
        game?.value
      );


    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }


    if (
      value === targetLine
    ) {

      pushes++;

      continue;
    }


    const covered =
      targetSide === "UNDER"
        ? value < targetLine
        : value > targetLine;


    if (covered) {
      wins++;
    } else {
      losses++;
    }
  }


  const decisions =
    wins +
    losses;


  if (
    decisions <= 0
  ) {
    return null;
  }


  return {

    wins,

    losses,

    pushes,

    games:
      wins +
      losses +
      pushes,

    percentage:
      Number(
        (
          (
            wins /
            decisions
          ) *
          100
        ).toFixed(1)
      )
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {

  NFL_COMBINED_PROP_MARKETS,

  getNFLCombinedMarket,

  isNFLCombinedMarket,

  isNFLCombinedPositionAllowed,

  readNFLYardStat,

  getNFLCombinedGameValue,

  buildNFLCombinedSample,

  summarizeNFLCombinedSample,

  buildNFLCombinedHistoricalCoverage
};

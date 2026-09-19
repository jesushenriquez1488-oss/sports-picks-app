const {
  evaluateMarketGame
} = require("./marketEvaluation");


// ============================================================
// RESEARCH THRESHOLDS
//
// These are observation thresholds.
// They are NOT part of CashEdge Confidence.
// ============================================================

const MONEY_DIVERGENCE_MIN = 15;
const MONEY_DIVERGENCE_STRONG = 30;

const PUBLIC_TICKETS_MIN = 65;

const LINE_MOVE_THRESHOLD = 0.5;
const PRICE_PROBABILITY_THRESHOLD_PP = 1.5;
// ============================================================
// SHARP SCORE — V2
//
// Signed score:
//
// +100 = strongest evidence WITH CashEdge
// -100 = strongest evidence AGAINST CashEdge
//
// This score is independent from CashEdge Confidence.
// ============================================================

const QUOTE_FRESH_MS =
  3 * 60 * 1000;


const SHARP_SCORE_WEIGHTS = {

  moneyTickets: 35,

  marketMovement: 30,

  breadth: 20,

  reverseLine: 20,

  persistence: 10
};


// ============================================================
// SCORE HELPERS
// ============================================================

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function roundInt(value) {

  const n =
    safeNum(value);

  return n === null
    ? 0
    : Math.round(n);
}


// ============================================================
// MONEY / TICKETS SCORE
//
// We preserve every split source independently.
//
// If material sources point in opposite directions,
// Money/Tickets contributes 0 instead of inventing a consensus.
// ============================================================

function calculateMoneyTicketsComponent(
  sourceSignals
) {

  const material =
    (sourceSignals || [])
      .filter(
        source =>
          safeNum(
            source.divergence
          ) !== null &&
          Math.abs(
            Number(
              source.divergence
            )
          ) >=
            MONEY_DIVERGENCE_MIN
      );


  const aligned =
    material.filter(
      source =>
        Number(
          source.divergence
        ) > 0
    );


  const against =
    material.filter(
      source =>
        Number(
          source.divergence
        ) < 0
    );


  const conflict =
    aligned.length > 0 &&
    against.length > 0;


  if (conflict) {

    return {

      score: 0,

      direction:
        "mixed",

      conflict: true,

      sources:
        material.length,

      strongestDivergence:
        material.length
          ? Math.max(
              ...material.map(
                source =>
                  Math.abs(
                    Number(
                      source.divergence
                    )
                  )
              )
            )
          : 0
    };
  }


  if (!material.length) {

    return {

      score: 0,

      direction:
        "neutral",

      conflict: false,

      sources: 0,

      strongestDivergence: 0
    };
  }


  const direction =
    aligned.length
      ? "aligned"
      : "against";


  const directionalSources =
    direction === "aligned"
      ? aligned
      : against;


  const strongestDivergence =
    Math.max(
      ...directionalSources.map(
        source =>
          Math.abs(
            Number(
              source.divergence
            )
          )
      )
    );


  /*
   * 15 pts divergence starts as meaningful.
   * 45+ pts reaches the base cap.
   */
  const magnitudeFactor =
    clamp(
      (
        strongestDivergence -
        MONEY_DIVERGENCE_MIN
      ) /
      30,
      0,
      1
    );


  let magnitude =
    10 +
    (
      magnitudeFactor *
      20
    );


  /*
   * Independent sources agreeing adds confirmation.
   */
  if (
    directionalSources.length >= 2
  ) {
    magnitude += 5;
  }


  magnitude =
    Math.min(
      magnitude,
      SHARP_SCORE_WEIGHTS
        .moneyTickets
    );


  return {

    score:
      roundInt(
        direction === "aligned"
          ? magnitude
          : -magnitude
      ),

    direction,

    conflict: false,

    sources:
      directionalSources.length,

    strongestDivergence:
      round2(
        strongestDivergence
      )
  };
}


// ============================================================
// MARKET MOVEMENT SCORE
//
// Uses CashEdge's already-calculated consensus movement.
//
// Spread / Total:
//   0.5 = 10
//   1.0 = 20
//   1.5 = 30
//
// Moneyline:
//   1.5pp = 10
//   3.0pp = 20
//   4.5pp = 30
// ============================================================

function calculateMarketMovementComponent({

  alignment,
  movementMarketType,
  lineMovement,
  impliedProbabilityMovementPP

}) {

  const state =
    String(
      alignment || ""
    )
      .trim()
      .toUpperCase();


  if (
    state !== "ALIGNED" &&
    state !== "AGAINST"
  ) {

    return {
      score: 0,
      direction: "neutral",
      magnitude: 0
    };
  }


  const sign =
    state === "ALIGNED"
      ? 1
      : -1;


  const type =
    normalize(
      movementMarketType
    );


  let magnitude = 0;


  if (
    type === "moneyline"
  ) {

    const move =
      Math.abs(
        safeNum(
          impliedProbabilityMovementPP
        ) || 0
      );


    magnitude =
      clamp(
        (
          move /
          PRICE_PROBABILITY_THRESHOLD_PP
        ) * 10,
        0,
        SHARP_SCORE_WEIGHTS
          .marketMovement
      );

  } else {

    const move =
      Math.abs(
        safeNum(
          lineMovement
        ) || 0
      );


    magnitude =
      clamp(
        (
          move /
          LINE_MOVE_THRESHOLD
        ) * 10,
        0,
        SHARP_SCORE_WEIGHTS
          .marketMovement
      );
  }


  return {

    score:
      roundInt(
        magnitude *
        sign
      ),

    direction:
      sign > 0
        ? "aligned"
        : "against",

    magnitude:
      round2(
        magnitude
      )
  };
}


// ============================================================
// MARKET BREADTH SCORE
//
// Measures how many configured sportsbooks agree.
//
// Reference books count slightly more than retail books.
// Neutral books reduce conviction.
// ============================================================

function calculateBreadthComponent({

  referenceAligned,
  referenceAgainst,
  referenceNeutral,

  retailAligned,
  retailAgainst,
  retailNeutral

}) {

  const refAligned =
    Math.max(
      0,
      Number(
        referenceAligned || 0
      )
    );

  const refAgainst =
    Math.max(
      0,
      Number(
        referenceAgainst || 0
      )
    );

  const refNeutral =
    Math.max(
      0,
      Number(
        referenceNeutral || 0
      )
    );


  const retAligned =
    Math.max(
      0,
      Number(
        retailAligned || 0
      )
    );

  const retAgainst =
    Math.max(
      0,
      Number(
        retailAgainst || 0
      )
    );

  const retNeutral =
    Math.max(
      0,
      Number(
        retailNeutral || 0
      )
    );


  const alignedWeight =
    (
      refAligned * 1.5
    ) +
    retAligned;


  const againstWeight =
    (
      refAgainst * 1.5
    ) +
    retAgainst;


  const neutralWeight =
    (
      refNeutral * 1.5
    ) +
    retNeutral;


  const totalWeight =
    alignedWeight +
    againstWeight +
    neutralWeight;


  const totalBooks =
    refAligned +
    refAgainst +
    refNeutral +
    retAligned +
    retAgainst +
    retNeutral;


  if (
    totalWeight <= 0 ||
    totalBooks <= 0
  ) {

    return {

      score: 0,

      direction:
        "neutral",

      books: 0
    };
  }


  const directionalBalance =
    (
      alignedWeight -
      againstWeight
    ) /
    totalWeight;


  /*
   * One sportsbook should never produce max breadth.
   * Four or more configured books can reach full weight.
   */
  const depthFactor =
    clamp(
      totalBooks / 4,
      0,
      1
    );


  const score =
    roundInt(
      directionalBalance *
      SHARP_SCORE_WEIGHTS
        .breadth *
      depthFactor
    );


  return {

    score,

    direction:
      score > 0
        ? "aligned"
        : score < 0
          ? "against"
          : "neutral",

    books:
      totalBooks,

    alignedBooks:
      refAligned +
      retAligned,

    againstBooks:
      refAgainst +
      retAgainst,

    neutralBooks:
      refNeutral +
      retNeutral
  };
}


// ============================================================
// REVERSE LINE MOVEMENT
//
// CashEdge side has heavy tickets,
// but market moves AGAINST it
//     → negative RLM.
//
// Other side has heavy tickets,
// but market moves WITH CashEdge
//     → positive RLM.
// ============================================================

function calculateReverseLineComponent({

  splitSourceSignals,
  alignment

}) {

  const valid =
    (splitSourceSignals || [])
      .filter(
        source =>
          safeNum(
            source.ticketsPct
          ) !== null
      );


  if (!valid.length) {

    return {
      score: 0,
      detected: false,
      direction: "neutral",
      ticketsPct: null
    };
  }


  const publicWith =
    valid.filter(
      source =>
        Number(
          source.ticketsPct
        ) >=
        PUBLIC_TICKETS_MIN
    );


  const publicAgainst =
    valid.filter(
      source =>
        Number(
          source.ticketsPct
        ) <=
        (
          100 -
          PUBLIC_TICKETS_MIN
        )
    );


  /*
   * Split sources disagree on which side is public.
   * Do not manufacture RLM.
   */
  if (
    publicWith.length &&
    publicAgainst.length
  ) {

    return {
      score: 0,
      detected: false,
      direction: "mixed",
      ticketsPct: null
    };
  }


  const state =
    String(
      alignment || ""
    )
      .trim()
      .toUpperCase();


  let direction =
    "neutral";

  let representativeTickets =
    null;


  if (
    publicWith.length &&
    state === "AGAINST"
  ) {

    direction =
      "against";

    representativeTickets =
      publicWith.reduce(
        (
          sum,
          source
        ) =>
          sum +
          Number(
            source.ticketsPct
          ),
        0
      ) /
      publicWith.length;
  }


  if (
    publicAgainst.length &&
    state === "ALIGNED"
  ) {

    direction =
      "aligned";

    representativeTickets =
      publicAgainst.reduce(
        (
          sum,
          source
        ) =>
          sum +
          Number(
            source.ticketsPct
          ),
        0
      ) /
      publicAgainst.length;
  }


  if (
    direction ===
    "neutral"
  ) {

    return {
      score: 0,
      detected: false,
      direction: "neutral",
      ticketsPct: null
    };
  }


  const publicDistance =
    Math.abs(
      representativeTickets -
      50
    );


  /*
   * 65% tickets = meaningful RLM.
   * 85%+ tickets can reach the full 20 points.
   */
  const intensity =
    clamp(
      (
        publicDistance -
        15
      ) /
      20,
      0,
      1
    );


  const magnitude =
    10 +
    (
      intensity * 10
    );


  const score =
    roundInt(
      direction === "aligned"
        ? magnitude
        : -magnitude
    );


  return {

    score,

    detected: true,

    direction,

    ticketsPct:
      round2(
        representativeTickets
      )
  };
}


// ============================================================
// PERSISTENCE SCORE
//
// Current directional pressure gets stronger if it persists.
//
// < 5 min  = 0
// 5–9 min  = 3
// 10–19    = 6
// 20+      = 10
// ============================================================

function calculatePersistenceComponent({

  alignment,
  persistenceMinutes

}) {

  const state =
    String(
      alignment || ""
    )
      .trim()
      .toUpperCase();


  if (
    state !== "ALIGNED" &&
    state !== "AGAINST"
  ) {

    return {
      score: 0,
      minutes: 0,
      direction: "neutral"
    };
  }


  const minutes =
    Math.max(
      0,
      safeNum(
        persistenceMinutes
      ) || 0
    );


  let magnitude = 0;


  if (minutes >= 20) {

    magnitude =
      SHARP_SCORE_WEIGHTS
        .persistence;

  } else if (
    minutes >= 10
  ) {

    magnitude = 6;

  } else if (
    minutes >= 5
  ) {

    magnitude = 3;
  }


  const sign =
    state === "ALIGNED"
      ? 1
      : -1;


  return {

    score:
      magnitude * sign,

    minutes:
      round2(
        minutes
      ),

    direction:
      sign > 0
        ? "aligned"
        : "against"
  };
}


// ============================================================
// SHARP READ
// ============================================================

function sharpReadFromScore({

  score,
  hasSharpEvidence

}) {

  // ==========================================================
  // TRUE SHARP EVIDENCE EXISTS
  //
  // Sharp evidence means at least one of:
  //
  // - meaningful Money vs Tickets divergence
  // - Reverse Line Movement
  //
  // Market movement / breadth / persistence can CONFIRM sharp,
  // but they do not create a sharp label by themselves.
  // ==========================================================

  if (hasSharpEvidence) {

    if (score >= 80) {
      return "STRONG_SHARP_SUPPORT";
    }

    if (score >= 55) {
      return "SHARP_SUPPORT";
    }

    if (score >= 30) {
      return "SHARP_LEAN_WITH_CASHEDGE";
    }

    if (score <= -80) {
      return "STRONG_SHARP_PRESSURE_AGAINST";
    }

    if (score <= -55) {
      return "SHARP_PRESSURE_AGAINST";
    }

    if (score <= -30) {
      return "SHARP_LEAN_AGAINST";
    }

    return "NO_CLEAR_SHARP_EDGE";
  }


  // ==========================================================
  // MARKET EVIDENCE ONLY
  //
  // Do NOT call sportsbook movement "sharp" when there is
  // no Money/Tickets or Reverse Line evidence.
  // ==========================================================

  if (score >= 55) {
    return "STRONG_MARKET_SUPPORT";
  }

  if (score >= 30) {
    return "MARKET_SUPPORT";
  }

  if (score <= -55) {
    return "STRONG_MARKET_PRESSURE_AGAINST";
  }

  if (score <= -30) {
    return "MARKET_PRESSURE_AGAINST";
  }

  return "NO_CLEAR_MARKET_EDGE";
}

// ============================================================
// LEGACY SIGNAL COMPATIBILITY
//
// marketEvents.js already understands these names.
// We preserve them so the new scoring engine does not break
// the current Market Intelligence event lifecycle.
// ============================================================

function legacySharpSignalFromScore({

  score,
  hasSharpEvidence

}) {

  // ==========================================================
  // MARKET-ONLY STATE
  //
  // Keep compatibility with marketEvents.js without claiming
  // sharp activity when evidence is only sportsbook movement.
  // ==========================================================

  if (!hasSharpEvidence) {

    if (score >= 30) {
      return "MARKET_SUPPORT";
    }

    if (score <= -30) {
      return "MARKET_CONFLICT";
    }

    return "NO_SHARP_SIGNAL";
  }


  // ==========================================================
  // SHARP STATE
  // ==========================================================

  if (score >= 80) {
    return "STRONG_SHARP_SIGNAL";
  }

  if (score >= 55) {
    return "SHARP_SUPPORT";
  }

  if (score >= 30) {
    return "POTENTIAL_SHARP_MONEY";
  }

  if (score <= -80) {
    return "STRONG_SHARP_CONFLICT";
  }

  if (score <= -55) {
    return "SHARP_CONFLICT";
  }

  if (score <= -30) {
    return "POTENTIAL_SHARP_AGAINST";
  }

  return "NO_SHARP_SIGNAL";
}


// ============================================================
// LEGACY 0–5 STRENGTH
// ============================================================

function legacyStrengthFromScore(
  score
) {

  const absolute =
    Math.abs(
      Number(score || 0)
    );


  if (absolute >= 90) {
    return 5;
  }

  if (absolute >= 80) {
    return 4;
  }

  if (absolute >= 65) {
    return 3;
  }

  if (absolute >= 45) {
    return 2;
  }

  if (absolute >= 30) {
    return 1;
  }

  return 0;
}


// ============================================================
// ALIGNMENT PERSISTENCE FROM SNAPSHOT HISTORY
// ============================================================

function getAlignmentPersistenceMinutes({

  snapshots,
  alignment

}) {

  const target =
    String(
      alignment || ""
    )
      .trim()
      .toUpperCase();


  if (
    target !== "ALIGNED" &&
    target !== "AGAINST"
  ) {
    return 0;
  }


  let oldestMatchingAt =
    null;


  for (
    const snapshot
    of snapshots || []
  ) {

    const state =
      String(
        snapshot
          ?.alignment_state ||
        ""
      )
        .trim()
        .toUpperCase();


    if (
      state !== target
    ) {
      break;
    }


    const timestamp =
      new Date(
        snapshot
          ?.observed_at ||
        0
      )
        .getTime();


    if (
      Number.isFinite(
        timestamp
      )
    ) {
      oldestMatchingAt =
        timestamp;
    }
  }


  if (
    oldestMatchingAt === null
  ) {
    return 0;
  }


  return Math.max(
    0,
    (
      Date.now() -
      oldestMatchingAt
    ) /
    60000
  );
}

// ============================================================
// HELPERS
// ============================================================

function safeNum(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


function round2(value) {
  const n = safeNum(value);

  return n === null
    ? null
    : Number(n.toFixed(2));
}


function americanToProbability(odds) {

  const n = safeNum(odds);

  if (
    n === null ||
    n === 0
  ) {
    return null;
  }

  if (n < 0) {
    return (
      Math.abs(n) /
      (
        Math.abs(n) +
        100
      )
    );
  }

  return (
    100 /
    (
      n +
      100
    )
  );
}


// ============================================================
// MONEY / TICKETS — ONE SOURCE
// ============================================================

function classifySplitSource({
  moneyPct,
  ticketsPct
}) {

  const money =
    safeNum(moneyPct);

  const tickets =
    safeNum(ticketsPct);


  if (
    money === null ||
    tickets === null
  ) {
    return {
      signal: "NO_SPLIT_DATA",
      divergence: null,
      direction: "neutral",
      strength: 0
    };
  }


  const divergence =
    round2(
      money -
      tickets
    );


  // ==========================================================
  // STRONG MONEY WITH CASHEDGE
  // ==========================================================

  if (
    divergence >=
    MONEY_DIVERGENCE_STRONG
  ) {
    return {
      signal:
        "STRONG_MONEY_DIVERGENCE",

      divergence,

      direction:
        "aligned",

      strength: 2
    };
  }


  // ==========================================================
  // POTENTIAL SHARP MONEY WITH CASHEDGE
  // ==========================================================

  if (
    divergence >=
    MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "POTENTIAL_SHARP_MONEY",

      divergence,

      direction:
        "aligned",

      strength: 1
    };
  }


  // ==========================================================
  // STRONG MONEY AGAINST CASHEDGE
  // ==========================================================

  if (
    divergence <=
    -MONEY_DIVERGENCE_STRONG
  ) {
    return {
      signal:
        "STRONG_MONEY_AGAINST",

      divergence,

      direction:
        "against",

      strength: 2
    };
  }


  // ==========================================================
  // POTENTIAL MONEY AGAINST CASHEDGE
  // ==========================================================

  if (
    divergence <=
    -MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "POTENTIAL_SHARP_AGAINST",

      divergence,

      direction:
        "against",

      strength: 1
    };
  }


  // ==========================================================
  // PUBLIC HEAVY
  //
  // Lots of tickets, but no meaningful large-bet divergence.
  // This is descriptive only.
  // ==========================================================

  if (
    tickets >=
      PUBLIC_TICKETS_MIN &&
    Math.abs(divergence) <
      MONEY_DIVERGENCE_MIN
  ) {
    return {
      signal:
        "PUBLIC_HEAVY",

      divergence,

      direction:
        "neutral",

      strength: 0
    };
  }


  return {
    signal:
      "MONEY_BALANCED",

    divergence,

    direction:
      "neutral",

    strength: 0
  };
}


// ============================================================
// QUOTE DIRECTION AGAINST CASHEDGE BASELINE
// ============================================================

function classifyBookMovement({
  marketType,
  selectionKey,

  baselineLine,
  baselinePrice,

  currentLine,
  currentPrice
}) {

  const type =
    normalize(marketType);

  const selection =
    normalize(selectionKey);


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  if (
    type === "moneyline"
  ) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const currentProb =
      americanToProbability(
        currentPrice
      );


    if (
      baselineProb === null ||
      currentProb === null
    ) {
      return "neutral";
    }


    const movePP =
      (
        currentProb -
        baselineProb
      ) * 100;


    if (
      movePP >=
      PRICE_PROBABILITY_THRESHOLD_PP
    ) {
      return "aligned";
    }


    if (
      movePP <=
      -PRICE_PROBABILITY_THRESHOLD_PP
    ) {
      return "against";
    }


    return "neutral";
  }


  const baseline =
    safeNum(
      baselineLine
    );

  const current =
    safeNum(
      currentLine
    );


  if (
    baseline === null ||
    current === null
  ) {
    return "neutral";
  }


  const movement =
    current -
    baseline;


  // ==========================================================
  // TOTAL UNDER
  //
  // 8.5 -> 8.0 supports UNDER.
  // ==========================================================

  if (
    type === "total" &&
    selection === "under"
  ) {

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // TOTAL OVER
  //
  // 8.5 -> 9.0 supports OVER.
  // ==========================================================

  if (
    type === "total" &&
    selection === "over"
  ) {

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // SPREAD
  //
  // +3.5 -> +2.5 supports selected team.
  // -2.5 -> -3.5 supports selected team.
  //
  // Both are numerical decreases.
  // ==========================================================

  if (
    type === "spread"
  ) {

    if (
      movement <=
      -LINE_MOVE_THRESHOLD
    ) {
      return "aligned";
    }

    if (
      movement >=
      LINE_MOVE_THRESHOLD
    ) {
      return "against";
    }
  }


  // ==========================================================
  // SAME LINE — USE PRICE PRESSURE
  // ==========================================================

  if (
    Math.abs(movement) <
    LINE_MOVE_THRESHOLD
  ) {

    const baselineProb =
      americanToProbability(
        baselinePrice
      );

    const currentProb =
      americanToProbability(
        currentPrice
      );


    if (
      baselineProb !== null &&
      currentProb !== null
    ) {

      const movePP =
        (
          currentProb -
          baselineProb
        ) * 100;


      if (
        movePP >=
        PRICE_PROBABILITY_THRESHOLD_PP
      ) {
        return "aligned";
      }


      if (
        movePP <=
        -PRICE_PROBABILITY_THRESHOLD_PP
      ) {
        return "against";
      }
    }
  }


  return "neutral";
}


// ============================================================
// LATEST SPLIT PER SOURCE
// ============================================================

function getLatestPerSplitSource(rows) {

  const map =
    new Map();


  for (
    const row
    of rows || []
  ) {

    const key =
      [
        normalize(row.provider),
        normalize(
          row.split_source_key
        )
      ].join("::");


    if (
      !map.has(key)
    ) {
      map.set(
        key,
        row
      );
    }
  }


  return Array.from(
    map.values()
  );
}


// ============================================================
// COMBINE MONEY SOURCES
//
// We DO NOT blindly average DraftKings and Circa.
//
// Every source is preserved independently.
// ============================================================

function combineMoneySignals(
  sourceSignals
) {

  const aligned =
    sourceSignals.filter(
      row =>
        row.direction ===
        "aligned"
    );


  const against =
    sourceSignals.filter(
      row =>
        row.direction ===
        "against"
    );


  // Sources materially disagree.
  if (
    aligned.length &&
    against.length
  ) {

    return {
      signal:
        "MONEY_CONFLICT",

      direction:
        "mixed",

      strength: 0
    };
  }


  if (aligned.length) {

    const strong =
      aligned.some(
        row =>
          row.strength >= 2
      );


    return {
      signal:
        strong
          ? "STRONG_MONEY_DIVERGENCE"
          : "POTENTIAL_SHARP_MONEY",

      direction:
        "aligned",

      strength:
        strong
          ? 2
          : 1
    };
  }


  if (against.length) {

    const strong =
      against.some(
        row =>
          row.strength >= 2
      );


    return {
      signal:
        strong
          ? "STRONG_MONEY_AGAINST"
          : "POTENTIAL_SHARP_AGAINST",

      direction:
        "against",

      strength:
        strong
          ? 2
          : 1
    };
  }


  const publicHeavy =
    sourceSignals.some(
      row =>
        row.signal ===
        "PUBLIC_HEAVY"
    );


  return {
    signal:
      publicHeavy
        ? "PUBLIC_HEAVY"
        : "MONEY_BALANCED",

    direction:
      "neutral",

    strength: 0
  };
}
// ============================================================
// SHARP SCORE V2 — FINAL COMBINATION
//
// Combines five independent evidence groups:
//
// 1. Money vs Tickets
// 2. Market Movement
// 3. Sportsbook Breadth
// 4. Reverse Line Movement
// 5. Persistence
//
// Final result:
// -100 = strongest pressure AGAINST CashEdge
// +100 = strongest support WITH CashEdge
//
// IMPORTANT:
// This is Market Intelligence.
// It does NOT modify CashEdge Confidence.
// ============================================================

function determineSharpSignalV2({

  splitSourceSignals,

  alignment,

  movementMarketType,

  lineMovement,
  impliedProbabilityMovementPP,

  referenceAligned,
  referenceAgainst,
  referenceNeutral,

  retailAligned,
  retailAgainst,
  retailNeutral,

  persistenceMinutes

}) {

  // ==========================================================
  // 1. MONEY / TICKETS
  // ==========================================================

  const moneyTickets =
    calculateMoneyTicketsComponent(
      splitSourceSignals
    );


  // ==========================================================
  // 2. MARKET MOVEMENT
  // ==========================================================

  const marketMovement =
    calculateMarketMovementComponent({

      alignment,

      movementMarketType,

      lineMovement,

      impliedProbabilityMovementPP
    });


  // ==========================================================
  // 3. SPORTSBOOK BREADTH
  // ==========================================================

  const breadth =
    calculateBreadthComponent({

      referenceAligned,
      referenceAgainst,
      referenceNeutral,

      retailAligned,
      retailAgainst,
      retailNeutral
    });


  // ==========================================================
  // 4. REVERSE LINE MOVEMENT
  // ==========================================================

  const reverseLine =
    calculateReverseLineComponent({

      splitSourceSignals,

      alignment
    });


  // ==========================================================
  // 5. PERSISTENCE
  // ==========================================================

  const persistence =
    calculatePersistenceComponent({

      alignment,

      persistenceMinutes
    });


  // ==========================================================
  // RAW SCORE
  // ==========================================================

  const rawScore =
    moneyTickets.score +
    marketMovement.score +
    breadth.score +
    reverseLine.score +
    persistence.score;


  // ==========================================================
  // FINAL SIGNED SCORE
  //
  // Components can theoretically total ±115.
  // Sharp Score itself is always limited to ±100.
  // ==========================================================

  const score =
    roundInt(
      clamp(
        rawScore,
        -100,
        100
      )
    );


  // ==========================================================
  // READ
  // ==========================================================

const hasMoneyEvidence =
  Math.abs(
    moneyTickets.score
  ) > 0;


const hasReverseLineEvidence =
  reverseLine.detected === true &&
  Math.abs(
    reverseLine.score
  ) > 0;


const hasSharpEvidence =
  hasMoneyEvidence ||
  hasReverseLineEvidence;


const read =
  sharpReadFromScore({

    score,

    hasSharpEvidence
  });


  // ==========================================================
  // DIRECTION
  // ==========================================================

  let direction =
    "neutral";


  if (score >= 30) {

    direction =
      "aligned";

  } else if (
    score <= -30
  ) {

    direction =
      "against";

  } else if (
    moneyTickets.conflict ===
    true
  ) {

    direction =
      "mixed";
  }


  // ==========================================================
  // LEGACY EVENT COMPATIBILITY
  //
  // marketEvents.js currently understands the original
  // signal vocabulary.
  // ==========================================================

const signal =
  legacySharpSignalFromScore({

    score,

    hasSharpEvidence
  });


  const strength =
    legacyStrengthFromScore(
      score
    );


  // ==========================================================
  // EVIDENCE QUALITY
  //
  // This is NOT another score.
  // It describes how many independent evidence groups
  // contributed materially.
  // ==========================================================

  const evidenceGroups = [

    {
      key:
        "money_tickets",

      active:
        Math.abs(
          moneyTickets.score
        ) > 0
    },

    {
      key:
        "market_movement",

      active:
        Math.abs(
          marketMovement.score
        ) > 0
    },

    {
      key:
        "breadth",

      active:
        Math.abs(
          breadth.score
        ) > 0
    },

    {
      key:
        "reverse_line",

      active:
        reverseLine.detected ===
        true
    },

    {
      key:
        "persistence",

      active:
        Math.abs(
          persistence.score
        ) > 0
    }

  ];


  const activeEvidenceGroups =
    evidenceGroups
      .filter(
        group =>
          group.active
      )
      .map(
        group =>
          group.key
      );


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    score,

    rawScore:
      roundInt(
        rawScore
      ),

    read,

    signal,

    direction,

    strength,

    evidenceCount:
      activeEvidenceGroups.length,

    evidenceGroups:
      activeEvidenceGroups,

    components: {

      moneyTickets,

      marketMovement,

      breadth,

      reverseLine,

      persistence
    }
  };
}

// ============================================================
// FINAL SHARP / MARKET SIGNAL
// ============================================================

function determineSharpSignal({

  money,

  referenceAligned,
  referenceAgainst,

  retailAligned,
  retailAgainst

}) {

  let alignedScore = 0;
  let againstScore = 0;


  // ==========================================================
  // MONEY EVIDENCE
  // ==========================================================

  if (
    money.direction ===
    "aligned"
  ) {
    alignedScore +=
      money.strength;
  }


  if (
    money.direction ===
    "against"
  ) {
    againstScore +=
      money.strength;
  }


  // ==========================================================
  // REFERENCE BOOK EVIDENCE
  //
  // Max 2 points.
  // ==========================================================

  alignedScore +=
    Math.min(
      referenceAligned,
      2
    );


  againstScore +=
    Math.min(
      referenceAgainst,
      2
    );


  // ==========================================================
  // RETAIL FOLLOWING
  //
  // At least two retail books following = +1 evidence.
  // ==========================================================

  if (
    retailAligned >= 2
  ) {
    alignedScore += 1;
  }


  if (
    retailAgainst >= 2
  ) {
    againstScore += 1;
  }


  // ==========================================================
  // MATERIAL CONFLICT
  // ==========================================================

  if (
    alignedScore >= 2 &&
    againstScore >= 2
  ) {

    return {
      signal:
        "MIXED_SIGNAL",

      direction:
        "mixed",

      strength:
        Math.max(
          alignedScore,
          againstScore
        )
    };
  }


  // ==========================================================
  // CASHEDGE-SUPPORTIVE SIDE
  // ==========================================================

  if (
    alignedScore >
    againstScore
  ) {

    // Money + reference + market following.
    if (
      money.direction ===
        "aligned" &&
      referenceAligned >= 1 &&
      (
        retailAligned >= 2 ||
        referenceAligned >= 2
      ) &&
      alignedScore >= 4
    ) {

      return {
        signal:
          "STRONG_SHARP_SIGNAL",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // Money divergence confirmed by at least one
    // reference book.
    if (
      money.direction ===
        "aligned" &&
      referenceAligned >= 1
    ) {

      return {
        signal:
          "SHARP_SUPPORT",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // Money signal exists but market has not confirmed it.
    if (
      money.direction ===
      "aligned"
    ) {

      return {
        signal:
          "POTENTIAL_SHARP_MONEY",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }


    // No Money/Tickets evidence.
    // Reference + retail move is MARKET SUPPORT,
    // not a sharp-money claim.
    if (
      referenceAligned >= 1 &&
      retailAligned >= 2
    ) {

      return {
        signal:
          "MARKET_SUPPORT",

        direction:
          "aligned",

        strength:
          Math.min(
            alignedScore,
            5
          )
      };
    }
  }


  // ==========================================================
  // CASHEDGE-CONFLICT SIDE
  // ==========================================================

  if (
    againstScore >
    alignedScore
  ) {

    if (
      money.direction ===
        "against" &&
      referenceAgainst >= 1 &&
      (
        retailAgainst >= 2 ||
        referenceAgainst >= 2
      ) &&
      againstScore >= 4
    ) {

      return {
        signal:
          "STRONG_SHARP_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      money.direction ===
        "against" &&
      referenceAgainst >= 1
    ) {

      return {
        signal:
          "SHARP_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      money.direction ===
      "against"
    ) {

      return {
        signal:
          "POTENTIAL_SHARP_AGAINST",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }


    if (
      referenceAgainst >= 1 &&
      retailAgainst >= 2
    ) {

      return {
        signal:
          "MARKET_CONFLICT",

        direction:
          "against",

        strength:
          Math.min(
            againstScore,
            5
          )
      };
    }
  }


  return {
    signal:
      "NO_SHARP_SIGNAL",

    direction:
      "neutral",

    strength: 0
  };
}


// ============================================================
// MAIN ENGINE
// ============================================================

async function evaluateSharpSignal({
  supabaseAdmin,
  gameId
}) {

  // First update normal Market Evaluation.
  const evaluation =
    await evaluateMarketGame({
      supabaseAdmin,
      gameId
    });


  if (
    evaluation?.ok !== true ||
    evaluation?.premium !== true
  ) {
    return evaluation;
  }


  // ==========================================================
  // CASHEDGE CONTEXT
  // ==========================================================

  const {
    data: context,
    error: contextError
  } =
    await supabaseAdmin
      .from(
        "market_pick_context"
      )
      .select("*")
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (contextError) {
    throw contextError;
  }


  if (!context) {
    throw new Error(
      "Missing market_pick_context"
    );
  }


  const marketType =
    normalize(
      context.market_type
    );

  const selectionKey =
    normalize(
      context.selection_key
    );

// ==========================================================
// MOVEMENT REFERENCE
//
// MLB Runline remains the actual Premium wager,
// but Sharp / Market Read uses Moneyline for team movement.
// ==========================================================

const movementMarketType =
  normalize(
    evaluation
      ?.movementReference
      ?.marketType ||
    context
      .movement_reference_market_type ||
    marketType
  );


const movementSelectionKey =
  normalize(
    evaluation
      ?.movementReference
      ?.selectionKey ||
    context
      .movement_reference_selection_key ||
    selectionKey
  );


const movementBaselinePrice =
  safeNum(
    evaluation
      ?.movementReference
      ?.baselinePrice
  ) ??
  safeNum(
    context
      .movement_baseline_price_american
  ) ??
  safeNum(
    context
      .first_premium_price_american
  );


const movementBaselineLine =
  movementMarketType ===
    "moneyline"
      ? null
      : safeNum(
          context
            .first_premium_line
        );
  // ==========================================================
  // SPLIT HISTORY
  //
  // Newest first. Then keep only latest row from each source.
  // ==========================================================

  const {
    data: splitRows,
    error: splitError
  } =
    await supabaseAdmin
      .from(
        "market_split_snapshots"
      )
      .select(`
        provider,
        split_source_key,
        split_source_name,
        money_pct,
        tickets_pct,
        line,
        price_american,
        provider_timestamp,
        observed_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .eq(
  "market_type",
  movementMarketType
)
.eq(
  "selection_key",
  movementSelectionKey
)
      .order(
        "observed_at",
        {
          ascending: false
        }
      )
      .limit(100);


  if (splitError) {
    throw splitError;
  }


  const latestSplits =
    getLatestPerSplitSource(
      splitRows || []
    );


  const splitSourceSignals =
    latestSplits.map(
      row => {

        const classified =
          classifySplitSource({
            moneyPct:
              row.money_pct,

            ticketsPct:
              row.tickets_pct
          });


        return {

          provider:
            row.provider,

          sourceKey:
            row.split_source_key,

          sourceName:
            row.split_source_name,

          moneyPct:
            safeNum(
              row.money_pct
            ),

          ticketsPct:
            safeNum(
              row.tickets_pct
            ),

          providerTimestamp:
            row.provider_timestamp,

          observedAt:
            row.observed_at,

          ...classified
        };
      }
    );


  const money =
    combineMoneySignals(
      splitSourceSignals
    );


  // ==========================================================
  // CURRENT BOOK QUOTES
  // ==========================================================

  const {
    data: quotes,
    error: quoteError
  } =
    await supabaseAdmin
      .from(
        "market_current_quotes"
      )
      .select(`
        provider,
        sportsbook_key,
        sportsbook_name,
        line,
        price_american,
        provider_timestamp,
        observed_at,
        updated_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
     .eq(
  "market_type",
  movementMarketType
)
.eq(
  "selection_key",
  movementSelectionKey
);


  if (quoteError) {
    throw quoteError;
  }

// ==========================================================
// LIVE QUOTE FILTER
//
// Sharp Score must use the same live-market definition
// as Market Evaluation and Opportunity.
// ==========================================================

const quoteNowMs =
  Date.now();


const freshQuotes =
  (quotes || [])
    .filter(
      quote => {

        if (
          safeNum(
            quote.price_american
          ) === null
        ) {
          return false;
        }


        const lastSeenMs =
          new Date(
            quote.updated_at ||
            quote.observed_at ||
            quote.provider_timestamp ||
            0
          )
            .getTime();


        if (
          !Number.isFinite(
            lastSeenMs
          )
        ) {
          return false;
        }


        return (
          quoteNowMs -
          lastSeenMs
        ) <=
          QUOTE_FRESH_MS;
      }
    );
  // ==========================================================
  // SPORTSBOOK ROLES
  // ==========================================================

  const {
    data: roleRows,
    error: rolesError
  } =
    await supabaseAdmin
      .from(
        "market_sportsbook_roles"
      )
      .select(`
        provider,
        sportsbook_key,
        sportsbook_name,
        role,
        reference_weight
      `)
      .eq(
        "is_active",
        true
      );


  if (rolesError) {
    throw rolesError;
  }


  const roleMap =
    new Map();


  for (
    const role
    of roleRows || []
  ) {

    const key =
      [
        normalize(
          role.provider
        ),

        normalize(
          role.sportsbook_key
        )
      ].join("::");


    roleMap.set(
      key,
      role
    );
  }


  let referenceAligned = 0;
  let referenceAgainst = 0;

  let retailAligned = 0;
  let retailAgainst = 0;

  let referenceNeutral = 0;
  let retailNeutral = 0;

  const bookDetails = [];


 for (
  const quote
  of freshQuotes
) {

    const roleKey =
      [
        normalize(
          quote.provider
        ),

        normalize(
          quote.sportsbook_key
        )
      ].join("::");


    const role =
      roleMap.get(
        roleKey
      );


    // Unknown books are intentionally NOT assumed to be
    // retail. We wait until their role is configured.
    if (!role) {
      continue;
    }


    const direction =
  classifyBookMovement({

    marketType:
      movementMarketType,

    selectionKey:
      movementSelectionKey,

    baselineLine:
      movementBaselineLine,

    baselinePrice:
      movementBaselinePrice,

    currentLine:
      quote.line,

    currentPrice:
      quote.price_american
  });

    const bookRole =
      normalize(
        role.role
      );


    if (
      bookRole ===
      "reference"
    ) {

      if (
        direction ===
        "aligned"
      ) {
        referenceAligned += 1;
      }

      if (
        direction ===
        "against"
      ) {
        referenceAgainst += 1;
      }

      if (
        direction ===
        "neutral"
      ) {
        referenceNeutral += 1;
      }
    }


    if (
      bookRole ===
      "retail"
    ) {

      if (
        direction ===
        "aligned"
      ) {
        retailAligned += 1;
      }

      if (
        direction ===
        "against"
      ) {
        retailAgainst += 1;
      }

      if (
        direction ===
        "neutral"
      ) {
        retailNeutral += 1;
      }
    }


    bookDetails.push({

      provider:
        quote.provider,

      sportsbookKey:
        quote.sportsbook_key,

      sportsbookName:
        quote.sportsbook_name,

      role:
        bookRole,

      direction,

      line:
        safeNum(
          quote.line
        ),

      price:
        safeNum(
          quote.price_american
        ),

      providerTimestamp:
        quote.provider_timestamp
    });
  }


  // ==========================================================
// ALIGNMENT PERSISTENCE
//
// Read consecutive current-direction snapshots backwards.
// Once direction changes or becomes neutral, persistence ends.
// ==========================================================

const {
  data: persistenceSnapshots,
  error: persistenceError
} =
  await supabaseAdmin
    .from(
      "market_evaluation_snapshots"
    )
    .select(`
      alignment_state,
      observed_at
    `)
    .eq(
      "cashedge_game_id",
      gameId
    )
    .eq(
      "market_type",
      movementMarketType
    )
    .eq(
      "selection_key",
      movementSelectionKey
    )
    .order(
      "observed_at",
      {
        ascending: false
      }
    )
    .limit(100);


if (persistenceError) {
  throw persistenceError;
}


const persistenceMinutes =
  getAlignmentPersistenceMinutes({

    snapshots:
      persistenceSnapshots || [],

    alignment:
      evaluation.alignment
  });


// ==========================================================
// SHARP SCORE V2
// ==========================================================

const sharp =
  determineSharpSignalV2({

    splitSourceSignals,

    alignment:
      evaluation.alignment,

    movementMarketType,

    lineMovement:
      evaluation
        ?.movement
        ?.line,

    impliedProbabilityMovementPP:
      evaluation
        ?.movement
        ?.impliedProbabilityPP,

    referenceAligned,
    referenceAgainst,
    referenceNeutral,

    retailAligned,
    retailAgainst,
    retailNeutral,

    persistenceMinutes
  });


const sharpComponents = {

  rawScore:
    sharp.rawScore,

  evidenceCount:
    sharp.evidenceCount,

  evidenceGroups:
    sharp.evidenceGroups,

  ...sharp.components
};

  const now =
    new Date()
      .toISOString();


  // ==========================================================
  // SUMMARY ROW
  // ==========================================================

  const {
    data: summary,
    error: summaryError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .select("*")
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (summaryError) {
    throw summaryError;
  }


  if (!summary) {
    throw new Error(
      "Missing market_evaluation_games row"
    );
  }


 const updates = {

  latest_money_signal:
    money.signal,

  latest_sharp_signal:
    sharp.signal,

  latest_sharp_strength:
    sharp.strength,

  latest_sharp_score:
    sharp.score,

  latest_sharp_read:
    sharp.read,

  latest_sharp_components:
    sharpComponents,

  updated_at:
    now
};

  // ==========================================================
  // FIRST OCCURRENCE TIMESTAMPS
  // ==========================================================

  if (
    !summary
      .first_potential_sharp_at &&
    (
      sharp.signal ===
        "POTENTIAL_SHARP_MONEY" ||
      sharp.signal ===
        "SHARP_SUPPORT" ||
      sharp.signal ===
        "STRONG_SHARP_SIGNAL"
    )
  ) {

    updates
      .first_potential_sharp_at =
      now;
  }


  if (
    !summary
      .first_sharp_support_at &&
    (
      sharp.signal ===
        "SHARP_SUPPORT" ||
      sharp.signal ===
        "STRONG_SHARP_SIGNAL"
    )
  ) {

    updates
      .first_sharp_support_at =
      now;
  }


  if (
    !summary
      .first_strong_sharp_at &&
    sharp.signal ===
      "STRONG_SHARP_SIGNAL"
  ) {

    updates
      .first_strong_sharp_at =
      now;
  }


  if (
    !summary
      .first_potential_sharp_against_at &&
    (
      sharp.signal ===
        "POTENTIAL_SHARP_AGAINST" ||
      sharp.signal ===
        "SHARP_CONFLICT" ||
      sharp.signal ===
        "STRONG_SHARP_CONFLICT"
    )
  ) {

    updates
      .first_potential_sharp_against_at =
      now;
  }


  if (
    !summary
      .first_sharp_conflict_at &&
    (
      sharp.signal ===
        "SHARP_CONFLICT" ||
      sharp.signal ===
        "STRONG_SHARP_CONFLICT"
    )
  ) {

    updates
      .first_sharp_conflict_at =
      now;
  }


  if (
    !summary
      .first_strong_sharp_conflict_at &&
    sharp.signal ===
      "STRONG_SHARP_CONFLICT"
  ) {

    updates
      .first_strong_sharp_conflict_at =
      now;
  }


  // ==========================================================
  // FINAL PRE-GAME SHARP STATE
  //
  // Same 30-minute research freeze used by Evaluation Engine.
  // ==========================================================

  const minutesToStart =
    safeNum(
      evaluation
        ?.timing
        ?.minutesToStart
    );


  if (
    !summary
      .pregame_final_sharp_signal &&
    minutesToStart !== null &&
    minutesToStart >= 0 &&
    minutesToStart <= 30
  ) {

    updates
      .pregame_final_money_signal =
      money.signal;

    updates
      .pregame_final_sharp_signal =
      sharp.signal;

    updates
      .pregame_final_sharp_strength =
      sharp.strength;
    updates
  .pregame_final_sharp_score =
  sharp.score;
  }


  const {
    error: updateSummaryError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .update(
        updates
      )
      .eq(
        "id",
        summary.id
      );


  if (updateSummaryError) {
    throw updateSummaryError;
  }


  // ==========================================================
  // UPDATE LATEST EVALUATION SNAPSHOT
  // ==========================================================

  const {
    data: latestSnapshot,
    error: latestSnapshotError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_snapshots"
      )
      .select(`
        id,
        context_json
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .order(
        "observed_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (latestSnapshotError) {
    throw latestSnapshotError;
  }


  if (latestSnapshot) {

    const oldContext =
      latestSnapshot
        .context_json &&
      typeof latestSnapshot
        .context_json ===
        "object"
          ? latestSnapshot
              .context_json
          : {};


    const {
      error: snapshotUpdateError
    } =
      await supabaseAdmin
        .from(
          "market_evaluation_snapshots"
        )
        .update({

          money_signal:
            money.signal,

          sharp_signal:
            sharp.signal,

          sharp_strength:
            sharp.strength,
sharp_score:
  sharp.score,

sharp_read:
  sharp.read,

sharp_components:
  sharpComponents,
          reference_aligned_count:
            referenceAligned,

          reference_against_count:
            referenceAgainst,

          retail_aligned_count:
            retailAligned,

          retail_against_count:
            retailAgainst,

          context_json: {

            ...oldContext,

            sharpResearch: {

              moneyDirection:
                money.direction,

              moneySignal:
                money.signal,

              splitSources:
                splitSourceSignals,

              referenceAligned,
              referenceAgainst,
              referenceNeutral,

              retailAligned,
              retailAgainst,
              retailNeutral,

              sharpDirection:
                sharp.direction,

              sharpSignal:
                sharp.signal,

              sharpStrength:
                sharp.strength,
sharpScore:
  sharp.score,

sharpRead:
  sharp.read,

sharpComponents,

persistenceMinutes:
  round2(
    persistenceMinutes
  ),
              books:
                bookDetails
            }
          }
        })
        .eq(
          "id",
          latestSnapshot.id
        );


    if (snapshotUpdateError) {
      throw snapshotUpdateError;
    }
  }


  // ==========================================================
  // RESPONSE
  // ==========================================================

  return {

    ok: true,

    shadowMode: true,

    gameId,

    pick:
      context
        .canonical_pick,

    alignment:
      evaluation.alignment,

    money: {

      signal:
        money.signal,

      direction:
        money.direction,

      sources:
        splitSourceSignals
    },

    marketEvidence: {

      referenceAligned,
      referenceAgainst,

      retailAligned,
      retailAgainst
    },

   sharp: {

  signal:
    sharp.signal,

  direction:
    sharp.direction,

  strength:
    sharp.strength,

  score:
    sharp.score,

  read:
    sharp.read,
     hasSharpEvidence:
  sharp.hasSharpEvidence,

evidenceFamily:
  sharp.evidenceFamily,

  rawScore:
    sharp.rawScore,

  evidenceCount:
    sharp.evidenceCount,

  evidenceGroups:
    sharp.evidenceGroups,

  components:
    sharpComponents
},

    timing:
      evaluation.timing
  };
}


module.exports = {
  evaluateSharpSignal
};

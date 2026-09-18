const {
  safeNumber
} =
  require("./marketOpportunity");


// ============================================================
// CASHEDGE MARKET IMPORTANCE PROFILES
//
// LEVEL 0 = noise / not relevant
// LEVEL 1 = informative
// LEVEL 2 = important
// LEVEL 3 = very important
//
// IMPORTANT:
// Profiles are independent by sport so research can tune
// each league later without affecting the others.
// ============================================================

const PROFILES = {

  mlb: {

    total: {

      line: {
        level1: 0.5,
        level2: 0.5,
        level3: 1.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    },


    spread: {

      line: {
        level1: 0.5,
        level2: 0.5,
        level3: 1.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  },


  nfl: {

    spread: {

      line: {
        level1: 0.5,
        level2: 1.0,
        level3: 2.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      },

      keyNumbers: [
        3,
        7
      ]
    },


    total: {

      line: {
        level1: 0.5,
        level2: 1.5,
        level3: 2.5
      },

      probability: {
        level1: 1.5,
        level2: 3.5,
        level3: 5.5
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  },


  ncaaf: {

    spread: {

      line: {
        level1: 0.5,
        level2: 1.0,
        level3: 2.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      },

      keyNumbers: [
        3,
        7
      ]
    },


    total: {

      line: {
        level1: 0.5,
        level2: 1.5,
        level3: 3.0
      },

      probability: {
        level1: 1.5,
        level2: 3.5,
        level3: 5.5
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  },


  nba: {

    spread: {

      line: {
        level1: 0.5,
        level2: 1.0,
        level3: 2.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    },


    total: {

      line: {
        level1: 0.5,
        level2: 1.5,
        level3: 3.0
      },

      probability: {
        level1: 1.5,
        level2: 3.5,
        level3: 5.5
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  },


  wnba: {

    spread: {

      line: {
        level1: 0.5,
        level2: 1.0,
        level3: 2.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    },


    total: {

      line: {
        level1: 0.5,
        level2: 1.5,
        level3: 3.0
      },

      probability: {
        level1: 1.5,
        level2: 3.5,
        level3: 5.5
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  },


  ncaab: {

    spread: {

      line: {
        level1: 0.5,
        level2: 1.0,
        level3: 2.0
      },

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    },


    total: {

      line: {
        level1: 0.5,
        level2: 1.5,
        level3: 3.0
      },

      probability: {
        level1: 1.5,
        level2: 3.5,
        level3: 5.5
      }
    },


    moneyline: {

      probability: {
        level1: 1.5,
        level2: 3.0,
        level3: 5.0
      }
    }
  }
};


// ============================================================
// HELPERS
// ============================================================

function normalize(value) {

  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}


function normalizeUpper(value) {

  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}


function absoluteNumber(value) {

  const n =
    safeNumber(value);

  return n === null
    ? 0
    : Math.abs(n);
}


function levelFromThresholds(
  value,
  thresholds
) {

  const amount =
    absoluteNumber(value);


  if (!thresholds) {
    return 0;
  }


  if (
    amount >=
    thresholds.level3
  ) {
    return 3;
  }


  if (
    amount >=
    thresholds.level2
  ) {
    return 2;
  }


  if (
    amount >=
    thresholds.level1
  ) {
    return 1;
  }


  return 0;
}


function getProfile(
  sport,
  marketType
) {

  const sportKey =
    normalize(sport);

  const marketKey =
    normalize(marketType);


  return (
    PROFILES
      ?.[
        sportKey
      ]
      ?.[
        marketKey
      ] ||
    null
  );
}


// ============================================================
// NFL / NCAAF KEY NUMBER DETECTION
//
// Example:
// -2.5 -> -3
// +3.5 -> +3
// -6.5 -> -7
//
// The absolute spread reaches/crosses 3 or 7.
// ============================================================

function crossesKeyNumber({

  baselineLine,
  marketLine,
  keyNumbers = []

}) {

  const start =
    safeNumber(
      baselineLine
    );

  const end =
    safeNumber(
      marketLine
    );


  if (
    start === null ||
    end === null
  ) {
    return null;
  }


  if (
    Math.abs(
      end - start
    ) < 0.5
  ) {
    return null;
  }


  const low =
    Math.min(
      Math.abs(start),
      Math.abs(end)
    );


  const high =
    Math.max(
      Math.abs(start),
      Math.abs(end)
    );


  for (
    const key
    of keyNumbers
  ) {

    if (
      key >= low &&
      key <= high
    ) {

      return key;
    }
  }


  return null;
}


// ============================================================
// SIGNAL IMPORTANCE
// ============================================================

function classifySignal(
  event
) {

  const type =
    normalizeUpper(
      event.event_type
    );


  const map = {

    STRONG_SHARP_SIGNAL: 3,
    STRONG_SHARP_CONFLICT: 3,

    SHARP_SUPPORT: 2,
    SHARP_CONFLICT: 2,
    MIXED_SIGNAL: 2,

    POTENTIAL_SHARP_MONEY: 1,
    POTENTIAL_SHARP_AGAINST: 1,

    MARKET_SUPPORT: 1,
    MARKET_CONFLICT: 1
  };


  const level =
    map[type] || 0;


  return {

    level,

    reason:
      level
        ? `Signal: ${type}`
        : "No material signal"
  };
}


// ============================================================
// MOVEMENT IMPORTANCE
// ============================================================

function classifyMovement({

  event,
  sport,
  marketType

}) {
    // ==========================================================
  // MLB RUNLINE / SPREAD
  //
  // Do not classify MLB runline movement as market importance.
  // A favorite/underdog flip can mechanically change
  // +1.5 to -1.5 and create false "3-run movement" noise.
  //
  // MLB team-side market intelligence must use Moneyline.
  // ==========================================================

  if (
    normalize(sport) === "mlb" &&
    normalize(marketType) === "spread"
  ) {

    return {

      level: 0,

      keyNumber:
        null,

      reason:
        "MLB runline movement is excluded; team-side movement uses Moneyline"
    };
  }

  const profile =
    getProfile(
      sport,
      marketType
    );


  if (!profile) {

    return {
      level: 0,
      reason:
        "No importance profile configured",
      keyNumber:
        null
    };
  }


  const data =
    event.event_data ||
    {};


  const metricType =
    normalize(
      data.metricType
    );


  // ==========================================================
  // LINE MOVEMENT
  // ==========================================================

  if (
    metricType ===
    "line"
  ) {

    const raw =
      absoluteNumber(
        data.rawMovement ??
        data.movementLevel
      );


    let level =
      levelFromThresholds(
        raw,
        profile.line
      );


    let keyNumber =
      null;


    if (
      Array.isArray(
        profile.keyNumbers
      )
    ) {

      keyNumber =
        crossesKeyNumber({

          baselineLine:
            data.baselineLine,

          marketLine:
            data.marketLine,

          keyNumbers:
            profile.keyNumbers
        });


      // Reaching/crossing 3 or 7
      // upgrades a half-point move to Important.
      if (
        keyNumber !== null &&
        level < 2
      ) {

        level = 2;
      }
    }


    return {

      level,

      keyNumber,

      reason:
        keyNumber !== null
          ? `${raw} point move reaching/crossing key number ${keyNumber}`
          : `${raw} point ${normalize(sport).toUpperCase()} ${normalize(marketType)} move`
    };
  }


  // ==========================================================
  // PRICE / IMPLIED PROBABILITY MOVEMENT
  // ==========================================================

  if (
    metricType ===
    "price_probability"
  ) {

    const probabilityMove =
      absoluteNumber(
        data.rawMovement ??
        data.movementLevel
      );


    const level =
      levelFromThresholds(
        probabilityMove,
        profile.probability
      );


    return {

      level,

      keyNumber:
        null,

      reason:
        `${probabilityMove} percentage-point implied probability move`
    };
  }


  return {

    level: 0,

    keyNumber:
      null,

    reason:
      "Unknown movement metric"
  };
}


// ============================================================
// OPPORTUNITY IMPORTANCE
// ============================================================

function classifyOpportunity({

  event,
  sport,
  marketType

}) {

  const type =
    normalizeUpper(
      event.event_type
    );


  const data =
    event.event_data ||
    {};


  // Closed is historically important,
  // but never Important NOW.
  if (
    type ===
    "OPPORTUNITY_CLOSED"
  ) {

    return {

      level: 2,

      reason:
        "Previously available value disappeared",

      canBeNow:
        false
    };
  }


  if (
    type ===
    "WINDOW_CLOSING"
  ) {

    return {

      level: 2,

      reason:
        "Actionable value remains but is deteriorating",

      canBeNow:
        true
    };
  }


  if (
    type ===
    "MARKET_CONFLICT"
  ) {

    return {

      level: 2,

      reason:
        "Current market movement conflicts with CashEdge",

      canBeNow:
        true
    };
  }


  if (
    type !==
    "VALUE_AVAILABLE"
  ) {

    return {

      level: 0,

      reason:
        "No actionable opportunity state",

      canBeNow:
        false
    };
  }


  const profile =
    getProfile(
      sport,
      marketType
    );


  const lineValue =
    absoluteNumber(
      data.lineValue
    );


  const priceValue =
    absoluteNumber(
      data.priceValueCents
    );


  let lineLevel = 0;


  if (
    profile?.line
  ) {

    lineLevel =
      levelFromThresholds(
        lineValue,
        profile.line
      );
  }


  let priceLevel = 0;


  // ==========================================================
  // BETTER PRICE OPPORTUNITY
  //
  // 10¢ = informative
  // 20¢ = important
  // 30¢ = very important
  // ==========================================================

  if (
    priceValue >= 30
  ) {
    priceLevel = 3;

  } else if (
    priceValue >= 20
  ) {
    priceLevel = 2;

  } else if (
    priceValue >= 10
  ) {
    priceLevel = 1;
  }


  const level =
    Math.max(
      lineLevel,
      priceLevel
    );


  let reason =
    "Material value remains available";


  if (
    lineLevel >=
    priceLevel &&
    lineValue > 0
  ) {

    reason =
      `${lineValue} points better than market`;

  } else if (
    priceValue > 0
  ) {

    reason =
      `${priceValue}¢ better price than market`;
  }


  return {

    level,

    reason,

    canBeNow:
      true
  };
}


// ============================================================
// CLASSIFY SINGLE EVENT
// ============================================================

function classifyEvent({

  event,
  sport,
  marketType

}) {

  const family =
    normalize(
      event.event_family
    );


  if (
    family ===
    "signal"
  ) {

    return {
      ...classifySignal(
        event
      ),
      canBeNow:
        event.is_active === true
    };
  }


  if (
    family ===
    "movement"
  ) {

    return {
      ...classifyMovement({
        event,
        sport,
        marketType
      }),
      canBeNow:
        true
    };
  }


  if (
    family ===
    "opportunity"
  ) {

    return classifyOpportunity({
      event,
      sport,
      marketType
    });
  }


  return {

    level: 0,

    reason:
      "Event family not ranked",

    canBeNow:
      false
  };
}


// ============================================================
// MAIN
// ============================================================

async function evaluateImportantMoves({

  supabaseAdmin,
  gameId

}) {

  // ==========================================================
  // SETTINGS
  // ==========================================================

  const {
    data: settings,
    error: settingsError
  } =
    await supabaseAdmin
      .from(
        "market_intelligence_settings"
      )
      .select(`
        shadow_mode,
        event_detection_enabled,
        notifications_enabled,
        frontend_enabled
      `)
      .eq(
        "id",
        1
      )
      .maybeSingle();


  if (settingsError) {
    throw settingsError;
  }


  if (
    settings
      ?.event_detection_enabled !==
    true
  ) {

    return {

      ok: true,

      skipped:
        true,

      reason:
        "Important Moves disabled while event detection is disabled",

      shadowMode:
        settings
          ?.shadow_mode === true
    };
  }


  // ==========================================================
  // CONTEXT
  // ==========================================================

  const {
    data: context,
    error: contextError
  } =
    await supabaseAdmin
      .from(
        "market_pick_context"
      )
      .select(`
        sport,
        cashedge_game_id,
        canonical_pick,
        market_type,
        selection_key,
        current_is_premium
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (contextError) {
    throw contextError;
  }


  if (
    !context ||
    context
      .current_is_premium !==
      true
  ) {

    return {

      ok: true,

      skipped:
        true,

      reason:
        "Game is not currently Premium"
    };
  }


  // ==========================================================
  // CURRENT ALIGNMENT
  // ==========================================================

  const {
    data: evaluation,
    error: evaluationError
  } =
    await supabaseAdmin
      .from(
        "market_evaluation_games"
      )
      .select(`
        latest_alignment_state,
        latest_opportunity_state
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (evaluationError) {
    throw evaluationError;
  }


    // ==========================================================
  // CURRENT GAME TIME
  //
  // Calculate dynamically.
  // Do not trust an old snapshot's minutes_to_start because
  // that value becomes stale as time passes.
  // ==========================================================

  let gameTime =
    null;


  const {
    data: providerGame,
    error: providerGameError
  } =
    await supabaseAdmin
      .from(
        "market_provider_events"
      )
      .select(`
        game_time
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .not(
        "game_time",
        "is",
        null
      )
      .order(
        "updated_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (providerGameError) {
    throw providerGameError;
  }


  gameTime =
    providerGame
      ?.game_time ||
    null;


  if (!gameTime) {

    const {
      data: dailyPick,
      error: dailyPickError
    } =
      await supabaseAdmin
        .from(
          "daily_picks"
        )
        .select(`
          game_time
        `)
        .eq(
          "game_id",
          gameId
        )
        .not(
          "game_time",
          "is",
          null
        )
        .order(
          "updated_at",
          {
            ascending: false
          }
        )
        .limit(1)
        .maybeSingle();


    if (dailyPickError) {
      throw dailyPickError;
    }


    gameTime =
      dailyPick
        ?.game_time ||
      null;
  }


  let minutesToStart =
    null;


  if (gameTime) {

    const rawGameTime =
      String(gameTime)
        .trim()
        .replace(
          " ",
          "T"
        );


    const hasTimezone =
      /(?:Z|[+-]\d{2}:\d{2})$/i
        .test(
          rawGameTime
        );


    const normalizedGameTime =
      hasTimezone
        ? rawGameTime
        : `${rawGameTime}Z`;


    const gameMs =
      new Date(
        normalizedGameTime
      )
        .getTime();


    if (
      Number.isFinite(
        gameMs
      )
    ) {

      minutesToStart =
        Number(
          (
            (
              gameMs -
              Date.now()
            ) /
            60000
          )
            .toFixed(2)
        );
    }
  }


  const pregame =
    minutesToStart === null ||
    minutesToStart > 0;


  // ==========================================================
  // EVENTS
  // ==========================================================

  const {
    data: events,
    error: eventsError
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .select("*")
      .eq(
        "cashedge_game_id",
        gameId
      )
      .order(
        "first_detected_at",
        {
          ascending: false
        }
      )
      .limit(150);


  if (eventsError) {
    throw eventsError;
  }


  if (
    !(events || []).length
  ) {

    return {

      ok: true,

      gameId,

      importantNow:
        false,

      importanceLevel:
        0,

      events:
        []
    };
  }


  // Clear NOW status first.
  // Historical importance remains.
  const {
    error: clearError
  } =
    await supabaseAdmin
      .from(
        "market_events"
      )
      .update({

        is_important_now:
          false
      })
      .eq(
        "cashedge_game_id",
        gameId
      );


  if (clearError) {
    throw clearError;
  }


  const classified = [];


  // Latest movement event matters for current movement status.
  const movementEvents =
    (events || [])
      .filter(
        event =>
          normalize(
            event.event_family
          ) ===
          "movement"
      );


  const latestMovement =
    movementEvents[0] ||
    null;


  const currentAlignment =
    normalizeUpper(
      evaluation
        ?.latest_alignment_state
    );


  const timestamp =
    new Date()
      .toISOString();


  // ==========================================================
  // BASE CLASSIFICATION
  // ==========================================================

  for (
    const event
    of events
  ) {

    const eventMarketType =
  normalize(
    event.market_type ||
    context.market_type
  );


const result =
  classifyEvent({

    event,

    sport:
      context.sport,

    marketType:
      eventMarketType
  });

    let importantNow =
      false;


    if (
      pregame &&
      result.level >= 2
    ) {

      const family =
        normalize(
          event.event_family
        );


      if (
        family ===
        "signal"
      ) {

        importantNow =
          event.is_active ===
          true;
      }


      if (
        family ===
        "opportunity"
      ) {

        importantNow =
          result.canBeNow ===
          true &&
          event.is_active ===
          true;
      }


      if (
        family ===
        "movement" &&
        latestMovement &&
        String(
          latestMovement.id
        ) ===
        String(
          event.id
        )
      ) {

        const direction =
          normalizeUpper(
            event.direction
          );


        importantNow =
          (
            direction ===
              "ALIGNED" &&
            currentAlignment ===
              "ALIGNED"
          ) ||
          (
            direction ===
              "AGAINST" &&
            currentAlignment ===
              "AGAINST"
          );
      }
    }
    let eventMinutesToStart =
      null;


    if (
      gameTime &&
      event.first_detected_at
    ) {

      const rawGameTime =
        String(gameTime)
          .trim()
          .replace(
            " ",
            "T"
          );


      const hasTimezone =
        /(?:Z|[+-]\d{2}:\d{2})$/i
          .test(
            rawGameTime
          );


      const normalizedGameTime =
        hasTimezone
          ? rawGameTime
          : `${rawGameTime}Z`;


      const gameMs =
        new Date(
          normalizedGameTime
        )
          .getTime();


      const eventMs =
        new Date(
          event.first_detected_at
        )
          .getTime();


      if (
        Number.isFinite(gameMs) &&
        Number.isFinite(eventMs)
      ) {

        eventMinutesToStart =
          Number(
            (
              (
                gameMs -
                eventMs
              ) /
              60000
            )
              .toFixed(2)
          );
      }
    }

   const mergedEventData = {

  ...(
    event.event_data ||
    {}
  ),

  gameTime:
    gameTime,

 minutesToStart:
  eventMinutesToStart,

  importance: {
        level:
          result.level,

        reason:
          result.reason,

        keyNumber:
          result.keyNumber ||
          null,

       profile:
  `${normalize(context.sport)}:${eventMarketType}`,

        classifiedAt:
          timestamp
      }
    };


    const {
      error: updateError
    } =
      await supabaseAdmin
        .from(
          "market_events"
        )
        .update({

          importance_level:
            result.level,

          is_important:
            result.level >= 2,

          is_important_now:
            importantNow,

          importance_reason:
            result.reason,

          importance_updated_at:
            timestamp,

          event_data:
            mergedEventData
        })
        .eq(
          "id",
          event.id
        );


    if (updateError) {
      throw updateError;
    }


    classified.push({

      id:
        event.id,

      family:
        event.event_family,

      type:
        event.event_type,

      level:
        result.level,

      importantNow,

      reason:
        result.reason,

      keyNumber:
        result.keyNumber ||
        null
    });
  }


  // ==========================================================
  // COMBINATION INTELLIGENCE
  //
  // This is where separate moderate signals can become
  // a very important actionable situation.
  // ==========================================================

  const activeSignal =
    classified.find(
      item =>
        item.family ===
          "signal" &&
        events.find(
          event =>
            String(event.id) ===
              String(item.id)
        )
          ?.is_active ===
        true
    ) ||
    null;


  const activeOpportunity =
    classified.find(
      item =>
        item.family ===
          "opportunity" &&
        events.find(
          event =>
            String(event.id) ===
              String(item.id)
        )
          ?.is_active ===
        true
    ) ||
    null;


  const latestMovementClass =
    latestMovement
      ? classified.find(
          item =>
            String(item.id) ===
            String(
              latestMovement.id
            )
        )
      : null;


  const signalType =
    normalizeUpper(
      activeSignal?.type
    );


  const opportunityType =
    normalizeUpper(
      activeOpportunity?.type
    );
const activeOpportunityEvent =
  activeOpportunity
    ? events.find(
        event =>
          String(event.id) ===
          String(activeOpportunity.id)
      )
    : null;


const activeOpportunityData =
  activeOpportunityEvent
    ?.event_data ||
  {};


const staleLineDetected =
  (
    latestMovementClass?.level || 0
  ) >= 2 &&
  opportunityType ===
    "VALUE_AVAILABLE" &&
  normalize(
    activeOpportunityData
      .opportunityType
  ) ===
    "better_line";

  let combinationLevel = 0;
  let combinationReason = null;


  // Strong signal + actionable value.
  if (
    (
      signalType ===
        "STRONG_SHARP_SIGNAL" ||
      signalType ===
        "SHARP_SUPPORT"
    ) &&
    (
      opportunityType ===
        "VALUE_AVAILABLE" ||
      opportunityType ===
        "WINDOW_CLOSING"
    )
  ) {

    combinationLevel = 3;

    combinationReason =
      opportunityType ===
        "WINDOW_CLOSING"
        ? "Sharp support plus a closing value window"
        : "Sharp support while actionable value remains available";
  }


  // Sharp conflict + market conflict.
  if (
    (
      signalType ===
        "STRONG_SHARP_CONFLICT" ||
      signalType ===
        "SHARP_CONFLICT"
    ) &&
    opportunityType ===
      "MARKET_CONFLICT"
  ) {

    combinationLevel = 3;

    combinationReason =
      "Sharp evidence and market movement both conflict with CashEdge";
  }


 // Explicit stale line:
// material market movement + a sportsbook still offering
// a better LINE on the CashEdge Premium side.
if (
  staleLineDetected
) {

  combinationLevel =
    Math.max(
      combinationLevel,
      3
    );

  combinationReason =
    combinationReason ||
    "STALE_LINE: market moved materially while a better line remains available";
}

  // Key-number movement + value still available.
  if (
    latestMovementClass
      ?.keyNumber &&
    opportunityType ===
      "VALUE_AVAILABLE"
  ) {

    combinationLevel = 3;

    combinationReason =
      `Key-number move to ${latestMovementClass.keyNumber} while a better line remains available`;
  }


  // ==========================================================
  // UPGRADE EVENTS INVOLVED IN LEVEL-3 COMBINATION
  // ==========================================================

  if (
    pregame &&
    combinationLevel === 3
  ) {

    const upgradeIds =
      [
        activeSignal?.id,
        activeOpportunity?.id,
        latestMovementClass?.id
      ]
        .filter(Boolean);


    for (
      const eventId
      of upgradeIds
    ) {

      const sourceEvent =
        events.find(
          event =>
            String(event.id) ===
            String(eventId)
        );


      if (!sourceEvent) {
        continue;
      }


      const currentData =
        sourceEvent
          .event_data ||
        {};


      const {
        error: upgradeError
      } =
        await supabaseAdmin
          .from(
            "market_events"
          )
          .update({

            importance_level:
              3,

            is_important:
              true,

            is_important_now:
              true,

            importance_reason:
              combinationReason,

            importance_updated_at:
              timestamp,

          event_data: {

  ...currentData,

  ...(
    staleLineDetected &&
    String(eventId) ===
      String(activeOpportunity?.id)
      ? {
          staleLine: {

            detected:
              true,

            sportsbookKey:
              activeOpportunityData
                .sportsbookKey ||
              null,

            sportsbook:
              activeOpportunityData
                .sportsbook ||
              null,

            bestLine:
              safeNumber(
                activeOpportunityData
                  .bestLine
              ),

            bestPrice:
              safeNumber(
                activeOpportunityData
                  .bestPrice
              ),

            marketLine:
              safeNumber(
                activeOpportunityData
                  ?.marketNow
                  ?.line
              ),

            marketPrice:
              safeNumber(
                activeOpportunityData
                  ?.marketNow
                  ?.price
              )
          }
        }
      : {}
  ),

  importance: {
                level:
                  3,

                reason:
                  combinationReason,

                combination:
                  true,

              profile:
  `${normalize(context.sport)}:${normalize(
    sourceEvent.market_type ||
    context.market_type
  )}`,
                classifiedAt:
                  timestamp
              }
            }
          })
          .eq(
            "id",
            eventId
          );


      if (upgradeError) {
        throw upgradeError;
      }


      const local =
        classified.find(
          item =>
            String(item.id) ===
            String(eventId)
        );


      if (local) {

        local.level = 3;
        local.importantNow = true;
        local.reason =
          combinationReason;
      }
    }
  }


  // ==========================================================
  // GAME SUMMARY
  //
  // One game counts ONCE regardless of number of events.
  // ==========================================================

  const nowEvents =
    classified
      .filter(
        event =>
          event.importantNow ===
          true
      )
      .sort(
        (a, b) =>
          b.level -
          a.level
      );


  const gameLevel =
    nowEvents.length
      ? Math.max(
          ...nowEvents.map(
            event =>
              event.level
          )
        )
      : 0;


  return {

    ok: true,

    shadowMode:
      settings
        ?.shadow_mode === true,

    gameId,

    sport:
      context.sport,

    pick:
      context
        .canonical_pick,

    marketType:
      context
        .market_type,

    currentAlignment:
      evaluation
        ?.latest_alignment_state ||
      null,

    opportunityState:
      evaluation
        ?.latest_opportunity_state ||
      null,

    pregame,

    minutesToStart,

    importantNow:
      nowEvents.length > 0,

    importanceLevel:
      gameLevel,

    combination:
      combinationLevel === 3
        ? {
            level: 3,
            reason:
              combinationReason
          }
        : null,

    importantEvents:
      nowEvents,

    historicalEvents:
      classified
        .filter(
          event =>
            event.level >= 2
        )
  };
}


module.exports = {
  evaluateImportantMoves
};

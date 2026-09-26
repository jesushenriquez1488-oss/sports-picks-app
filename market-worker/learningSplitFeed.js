"use strict";

const PREFIX =
  "[learning-split-feed]";

const CAPTURE_CHUNK_SIZE =
  500;


// ============================================================
// HELPERS
// ============================================================

function txt(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const output =
    String(value).trim();

  return output || null;
}


function num(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const output =
    Number(value);

  return Number.isFinite(output)
    ? output
    : null;
}


function normalize(value) {

  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


function splitEventDate(
  event
) {

  const eventId =
    txt(
      event?.event_id
    );


  if (!eventId) {
    return null;
  }


  const match =
    eventId.match(
      /^(\d{4})(\d{2})(\d{2})/
    );


  if (!match) {
    return null;
  }


  const [
    ,
    year,
    month,
    day
  ] = match;


  const output =
    `${year}-${month}-${day}`;


  const parsed =
    Date.parse(
      `${output}T12:00:00Z`
    );


  return Number.isFinite(parsed)
    ? output
    : null;
}


function normalizeSourceKey(
  value
) {

  const key =
    normalize(value);


  if (
    key === "dk"
  ) {
    return "draftkings";
  }


  if (
    key === "fd"
  ) {
    return "fanduel";
  }


  return key;
}


// ============================================================
// EVENT IDENTITY
//
// Used ONLY to detect ambiguous doubleheaders.
//
// If OWLS sends two split records for the same:
//
// sport + date + away + home
//
// we skip them instead of guessing.
// ============================================================

function splitGameIdentity({
  sport,
  event
}) {

  const eventDate =
    splitEventDate(
      event
    );


  if (!eventDate) {
    return null;
  }


  const away =
    normalize(
      event?.away_team
    );


  const home =
    normalize(
      event?.home_team
    );


  if (
    !sport ||
    !away ||
    !home
  ) {
    return null;
  }


  return [
    normalize(sport),
    eventDate,
    away,
    home
  ].join("|");
}


// ============================================================
// STATE BUILDER
// ============================================================

function pushState(
  map,
  state
) {

  if (
    !state?.cashedge_game_id ||
    !state?.sport ||
    !state?.provider ||
    !state?.split_source_key ||
    !state?.market_type ||
    !state?.selection_key
  ) {
    return;
  }


  if (
    !Number.isFinite(
      state.money_pct
    ) ||
    !Number.isFinite(
      state.tickets_pct
    )
  ) {
    return;
  }


  const identity =
    [
      state.sport,
      state.cashedge_game_id,
      state.provider,
      state.split_source_key,
      state.market_type,
      state.selection_key
    ].join("|");


  map.set(
    identity,
    state
  );
}


// ============================================================
// BUILD STATES FROM ONE SPLIT SOURCE
// ============================================================

function buildSourceStates({
  sport,
  tracked,
  event,
  providerSplit,
  observedAt,
  normalizeSelectionKey
}) {

  const states =
    [];


  const sourceKey =
    normalizeSourceKey(
      providerSplit?.book
    );


  if (!sourceKey) {
    return states;
  }


  const selectionNormalizer =
    typeof normalizeSelectionKey ===
      "function"
      ? normalizeSelectionKey
      : normalize;


  const awaySelection =
    selectionNormalizer(
      event?.away_team
    );


  const homeSelection =
    selectionNormalizer(
      event?.home_team
    );


  if (
    !awaySelection ||
    !homeSelection
  ) {
    return states;
  }


  const base = {
    cashedge_game_id:
      tracked.cashedge_game_id,

    sport:
      normalize(sport),

    provider:
      "owls",

    split_source_key:
      sourceKey,

    provider_timestamp:
      null,

    observed_at:
      observedAt
  };


  // ==========================================================
  // SPREAD
  // ==========================================================

  const spread =
    providerSplit?.spread;


  if (spread) {

    const awayLine =
      num(
        spread.away_line
      );

    const homeLine =
      num(
        spread.home_line
      );

    const awayMoney =
      num(
        spread.away_handle_pct
      );

    const awayTickets =
      num(
        spread.away_bets_pct
      );

    const homeMoney =
      num(
        spread.home_handle_pct
      );

    const homeTickets =
      num(
        spread.home_bets_pct
      );


    if (
      awayLine !== null &&
      awayMoney !== null &&
      awayTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "spread",

        selection_key:
          awaySelection,

        line:
          awayLine,

        price_american:
          null,

        money_pct:
          awayMoney,

        tickets_pct:
          awayTickets
      });
    }


    if (
      homeLine !== null &&
      homeMoney !== null &&
      homeTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "spread",

        selection_key:
          homeSelection,

        line:
          homeLine,

        price_american:
          null,

        money_pct:
          homeMoney,

        tickets_pct:
          homeTickets
      });
    }
  }


  // ==========================================================
  // TOTAL
  // ==========================================================

  const total =
    providerSplit?.total;


  if (total) {

    const totalLine =
      num(
        total.line
      );

    const overMoney =
      num(
        total.over_handle_pct
      );

    const overTickets =
      num(
        total.over_bets_pct
      );

    const underMoney =
      num(
        total.under_handle_pct
      );

    const underTickets =
      num(
        total.under_bets_pct
      );


    if (
      totalLine !== null &&
      overMoney !== null &&
      overTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "total",

        selection_key:
          "over",

        line:
          totalLine,

        price_american:
          null,

        money_pct:
          overMoney,

        tickets_pct:
          overTickets
      });
    }


    if (
      totalLine !== null &&
      underMoney !== null &&
      underTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "total",

        selection_key:
          "under",

        line:
          totalLine,

        price_american:
          null,

        money_pct:
          underMoney,

        tickets_pct:
          underTickets
      });
    }
  }


  // ==========================================================
  // MONEYLINE
  // ==========================================================

  const moneyline =
    providerSplit?.moneyline;


  if (moneyline) {

    const awayPrice =
      num(
        moneyline.away_price
      );

    const awayMoney =
      num(
        moneyline.away_handle_pct
      );

    const awayTickets =
      num(
        moneyline.away_bets_pct
      );

    const homePrice =
      num(
        moneyline.home_price
      );

    const homeMoney =
      num(
        moneyline.home_handle_pct
      );

    const homeTickets =
      num(
        moneyline.home_bets_pct
      );


    if (
      awayPrice !== null &&
      awayMoney !== null &&
      awayTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "moneyline",

        selection_key:
          awaySelection,

        line:
          null,

        price_american:
          Math.round(
            awayPrice
          ),

        money_pct:
          awayMoney,

        tickets_pct:
          awayTickets
      });
    }


    if (
      homePrice !== null &&
      homeMoney !== null &&
      homeTickets !== null
    ) {

      states.push({
        ...base,

        market_type:
          "moneyline",

        selection_key:
          homeSelection,

        line:
          null,

        price_american:
          Math.round(
            homePrice
          ),

        money_pct:
          homeMoney,

        tickets_pct:
          homeTickets
      });
    }
  }


  return states;
}


// ============================================================
// CAPTURE ONE SPORT SPLIT BOARD
// ============================================================

async function captureSplitBoard({
  sport,
  events,
  learningCapture,
  resolveGame,
  normalizeSelectionKey
}) {

  if (
    !learningCapture ||
    typeof learningCapture
      .captureSplitStates !==
      "function" ||
    typeof learningCapture
      .getStatus !==
      "function" ||
    typeof resolveGame !==
      "function"
  ) {

    return {
      ok: false,
      written: 0,
      reason:
        "split_dependencies_unavailable"
    };
  }


  const status =
    learningCapture
      .getStatus();


  if (
    status?.active !== true
  ) {

    return {
      ok: true,
      written: 0,
      skipped: true,
      reason:
        "learning_disabled"
    };
  }


  const list =
    Array.isArray(
      events
    )
      ? events
      : [];


  /*
   * Count identical sport/date/team combinations.
   *
   * Example:
   * Cubs @ Red Sox Game 1
   * Cubs @ Red Sox Game 2
   *
   * Both become ambiguous because Splits gives us
   * no kickoff time.
   */
  const identityCounts =
    new Map();


  for (
    const event
    of list
  ) {

    const identity =
      splitGameIdentity({
        sport,
        event
      });


    if (!identity) {
      continue;
    }


    identityCounts.set(
      identity,
      (
        identityCounts.get(
          identity
        ) ||
        0
      ) +
      1
    );
  }


  const stateMap =
    new Map();


  let matchedEvents =
    0;

  let ambiguousEvents =
    0;

  let unmatchedEvents =
    0;


  const observedAt =
    new Date()
      .toISOString();


  for (
    const event
    of list
  ) {

    const identity =
      splitGameIdentity({
        sport,
        event
      });


    /*
     * No trustworthy date in event_id.
     */
    if (!identity) {

      unmatchedEvents +=
        1;

      continue;
    }


    /*
     * Doubleheader or another duplicate team/date event.
     *
     * Never guess.
     */
    if (
      (
        identityCounts.get(
          identity
        ) ||
        0
      ) !== 1
    ) {

      ambiguousEvents +=
        1;

      continue;
    }


    const eventDate =
      splitEventDate(
        event
      );


    let tracked =
      null;


    try {

      tracked =
        resolveGame({
          sport,
          event,
          eventDate
        });

    } catch (error) {

      console.error(
        `${PREFIX} resolver failed: ${error?.message || error}`
      );

      continue;
    }


    if (
      !tracked
        ?.cashedge_game_id
    ) {

      unmatchedEvents +=
        1;

      continue;
    }


    matchedEvents +=
      1;


    const sources =
      Array.isArray(
        event?.splits
      )
        ? event.splits
        : [];


    for (
      const providerSplit
      of sources
    ) {

      const states =
        buildSourceStates({
          sport,
          tracked,
          event,
          providerSplit,
          observedAt,
          normalizeSelectionKey
        });


      for (
        const state
        of states
      ) {

        pushState(
          stateMap,
          state
        );
      }
    }
  }


  const states =
    Array.from(
      stateMap.values()
    );


  let written =
    0;


  for (
    let index = 0;
    index < states.length;
    index +=
      CAPTURE_CHUNK_SIZE
  ) {

    const chunk =
      states.slice(
        index,
        index +
          CAPTURE_CHUNK_SIZE
      );


    const result =
      await learningCapture
        .captureSplitStates(
          chunk
        );


    if (
      result?.ok !== true
    ) {

      return {
        ok: false,
        matchedEvents,
        ambiguousEvents,
        unmatchedEvents,
        states:
          states.length,
        written
      };
    }


    written +=
      Number(
        result.written ||
        0
      );
  }


  return {
    ok: true,
    matchedEvents,
    ambiguousEvents,
    unmatchedEvents,
    states:
      states.length,
    written
  };
}


// ============================================================
// SAFE WRAPPER
// ============================================================

async function captureSplitBoardSafe(
  args
) {

  try {

    const result =
      await captureSplitBoard(
        args
      );


    if (
      result?.ok === true &&
      Number(
        result.written ||
        0
      ) > 0
    ) {

      console.log(
        `${PREFIX} sport: ${String(
          args?.sport || ""
        )}, matched: ${Number(
          result.matchedEvents || 0
        )}, ambiguous: ${Number(
          result.ambiguousEvents || 0
        )}, states: ${Number(
          result.states || 0
        )}, written: ${Number(
          result.written || 0
        )}`
      );
    }


    if (
      result?.ok !== true
    ) {

      console.error(
        `${PREFIX} capture unsuccessful`
      );
    }


    return result;

  } catch (error) {

    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );


    return {
      ok: false,
      written: 0
    };
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  captureSplitBoardSafe,
  captureSplitBoard,
  splitEventDate
};

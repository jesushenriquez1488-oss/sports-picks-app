"use strict";

const {
  io
} = require("socket.io-client");
// ============================================================
// LEARNING INTELLIGENCE
// Optional and non-fatal.
// A Learning failure must NEVER stop Market Intelligence.
// ============================================================

let learningCapture =
  null;

try {

  learningCapture =
    require("./learningCapture");

} catch (error) {

  console.error(
    `[learning-capture] module unavailable: ${error?.message || error}`
  );

  learningCapture =
    null;
}
let learningCashEdgeSync =
  null;

try {

  learningCashEdgeSync =
    require("./learningCashEdgeSync");

} catch (error) {

  console.error(
    `[learning-cashedge-sync] module unavailable: ${error?.message || error}`
  );

  learningCashEdgeSync =
    null;
}
async function initializeLearningSafe() {

  if (
    !learningCapture ||
    typeof learningCapture.initialize !== "function"
  ) {
    return;
  }

  try {

    const result =
      await learningCapture.initialize();


    if (
      result?.disabled === true
    ) {

      console.log(
        "[learning-capture] disabled"
      );

      return;
    }


    if (
      result?.ok === true
    ) {

      console.log(
        "[learning-capture] initialized"
      );

      return;
    }


    console.error(
      "[learning-capture] initialization not ready"
    );

  } catch (error) {

    console.error(
      `[learning-capture] initialization failed: ${error?.message || error}`
    );
  }
}
async function syncLearningCashEdgeSafe() {

  try {

    if (
      !learningCapture ||
      !learningCashEdgeSync ||
      typeof learningCashEdgeSync.syncCashEdgeStatesSafe !== "function"
    ) {
      return;
    }


    const status =
      learningCapture.getStatus?.();


    if (
      status?.active !== true
    ) {
      return;
    }


    const result =
      await learningCashEdgeSync
        .syncCashEdgeStatesSafe(
          learningCapture
        );


    if (
      result?.ok !== true
    ) {

      console.error(
        "[learning-cashedge-sync] sync unsuccessful"
      );

      return;
    }


    if (
      Number(result?.written || 0) > 0
    ) {

      console.log(
        `[learning-cashedge-sync] checked: ${Number(result.checked || 0)}, states: ${Number(result.states || 0)}, written: ${Number(result.written || 0)}`
      );
    }

  } catch (error) {

    console.error(
      `[learning-cashedge-sync] failed: ${error?.message || error}`
    );
  }
}
// ============================================================
// CONFIG
// ============================================================

const WORKER_NAME =
  "cashedge-live-market-worker";

const OWLS_URL =
  "https://api.owlsinsight.com";

const CASHEDGE_ORIGIN =
  process.env.CASHEDGE_ORIGIN ||
  "https://www.cashedgeapp.com";

const OWLS_API_KEY =
  process.env.OWLS_API_KEY;

const MARKET_INGEST_SECRET =
  process.env.MARKET_INGEST_SECRET;


const TRACKED_GAMES_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/tracked-games`;

const INGEST_QUOTE_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/ingest-quote`;

const INGEST_SPLIT_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/ingest-split`;
const PICK_CONTEXT_SYNC_URL =
  process.env.PICK_CONTEXT_SYNC_URL;
const SPORTS = [
  "mlb",
  "nfl",
  "nba",
  "ncaaf",
  "ncaab",
  "wnba"
];


/*
 * Books that we actually want CashEdge
 * Market Intelligence to consume.
 *
 * We are intentionally NOT ingesting the entire
 * Owls catalog.
 */
const BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "hardrock",
  "circa"
];


const REFRESH_INTERVAL_MS =
  60 * 1000;
const PICK_CONTEXT_SYNC_INTERVAL_MS =
  5 * 60 * 1000;
const LEARNING_CASHEDGE_SYNC_INTERVAL_MS =
  5 * 60 * 1000;
const SPLIT_REFRESH_INTERVAL_MS =
  30 * 1000;
const OWLS_WATCHDOG_INTERVAL_MS =
  30 * 1000;

const OWLS_HEARTBEAT_STALE_MS =
  3 * 60 * 1000;
const MAX_CONCURRENCY =
  6;


// ============================================================
// REQUIRED ENVIRONMENT
// ============================================================

if (!OWLS_API_KEY) {
  console.error(
    `[${WORKER_NAME}] OWLS_API_KEY missing`
  );

  process.exit(1);
}


if (!MARKET_INGEST_SECRET) {
  console.error(
    `[${WORKER_NAME}] MARKET_INGEST_SECRET missing`
  );

  process.exit(1);
}
if (!PICK_CONTEXT_SYNC_URL) {

  console.error(
    `[${WORKER_NAME}] PICK_CONTEXT_SYNC_URL missing`
  );

  process.exit(1);
}

// ============================================================
// STATE
// ============================================================

let socket =
  null;

let refreshTimer =
  null;
let syncTimer =
  null;
let learningCashEdgeTimer =
  null;
let pickContextSyncRunning =
  false;
let splitTimer =
  null;

let splitRefreshRunning =
  false;

const lastSentSplitSignatures =
  new Map();
let watchdogTimer =
  null;

let lastOwlsHeartbeatAt =
  null;

let lastOwlsOddsUpdateAt =
  null;

let watchdogReconnectActive =
  false;

let trackedGameMap =
  new Map();

let trackedCount =
  null;

let premiumCount =
  null;

let processingUpdate =
  false;

let queuedUpdate =
  null;

let firstIngestSummaryLogged =
  false;


/*
 * Prevent repeated POSTs when Owls sends the
 * same board state again.
 *
 * key:
 * game + book + market + selection
 *
 * value:
 * line + price
 */
const lastSentSignatures =
  new Map();
const QUOTE_REVALIDATE_MS =
  60 * 1000;
// ============================================================
// NORMALIZATION
// ============================================================
function normalizeSportsbookKey(
  value
) {
  const key =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if (
    key === "caesars"
  ) {
    return "williamhill_us";
  }

  if (
    key === "hardrock"
  ) {
    return "hardrockbet";
  }

  return key;
}
function normalizeText(
  value
) {
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


function centralDateFromIso(
  value
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }


  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Chicago",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
      .formatToParts(
        date
      );


  const map =
    Object.fromEntries(
      parts.map(
        part => [
          part.type,
          part.value
        ]
      )
    );


  return (
    `${map.year}-${map.month}-${map.day}`
  );
}


function normalizeTeamForGameKey(
  sport,
  value
) {

  const normalized =
    normalizeText(value);


  if (
    normalizeText(sport) === "mlb"
  ) {

    const athleticsAliases =
      new Set([
        "athletics",
        "oakland athletics",
        "sacramento athletics",
        "las vegas athletics",
        "a s"
      ]);


    if (
      athleticsAliases.has(
        normalized
      )
    ) {
      return "athletics";
    }
  }


  return normalized;
}


function makeGameKey({
  sport,
  awayTeam,
  homeTeam,
  gameDate
}) {

  return [
    normalizeText(sport),

    normalizeTeamForGameKey(
      sport,
      awayTeam
    ),

    normalizeTeamForGameKey(
      sport,
      homeTeam
    ),

    gameDate
  ].join("|");
}
function parseCashEdgeGameTime(
  value
) {

  if (!value) {
    return NaN;
  }


  const raw =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );


  const hasTimezone =
    /(?:Z|[+-]\d{2}:\d{2})$/i
      .test(raw);


  const normalized =
    hasTimezone
      ? raw
      : `${raw}Z`;


  return Date.parse(
    normalized
  );
}


function resolveTrackedGame({
  candidates,
  commenceTime
}) {

  const games =
    Array.isArray(
      candidates
    )
      ? candidates
      : [];


  if (!games.length) {
    return null;
  }


  const commenceMs =
    Date.parse(
      commenceTime
    );


  if (
    !Number.isFinite(
      commenceMs
    )
  ) {
    return null;
  }


  let bestGame =
    null;

  let bestDifferenceMs =
    Number.POSITIVE_INFINITY;


  for (
    const game
    of games
  ) {

    const gameTimeMs =
      parseCashEdgeGameTime(
        game.game_time
      );


    if (
      !Number.isFinite(
        gameTimeMs
      )
    ) {
      continue;
    }


    const differenceMs =
      Math.abs(
        gameTimeMs -
        commenceMs
      );


    if (
      differenceMs <
      bestDifferenceMs
    ) {

      bestDifferenceMs =
        differenceMs;

      bestGame =
        game;
    }
  }


  // ==========================================================
  // STRICT EVENT MATCH
  //
  // Even if CashEdge has only ONE tracked game for these teams,
  // Owls may contain multiple games on the same date.
  //
  // Never attach an Owls event unless its start time is close
  // to the actual CashEdge game time.
  // ==========================================================

  const MAX_MATCH_DIFFERENCE_MS =
    90 * 60 * 1000;


  if (
    !bestGame ||
    bestDifferenceMs >
      MAX_MATCH_DIFFERENCE_MS
  ) {

    return null;
  }


  return bestGame;
}
function getAllTrackedGames() {

  return Array
    .from(
      trackedGameMap.values()
    )
    .flatMap(
      value =>
        Array.isArray(value)
          ? value
          : value
            ? [value]
            : []
    );
}
// ============================================================
// TRACKED CASHEDGE GAMES
// ============================================================
async function syncPickContext() {

  const response =
    await fetch(
      PICK_CONTEXT_SYNC_URL,
      {
        headers: {
          Authorization:
            `Bearer ${MARKET_INGEST_SECRET}`
        }
      }
    );


  const body =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok ||
    body?.ok !== true
  ) {

    throw new Error(
      body?.error ||
      `pick-context sync HTTP ${response.status}`
    );
  }


  if (
    Number(body.created || 0) > 0 ||
    Number(body.deactivated || 0) > 0 ||
    Number(body.errors || 0) > 0
  ) {

    console.log(
      `[${WORKER_NAME}] pick context sync — created: ${Number(body.created || 0)}, updated: ${Number(body.updated || 0)}, deactivated: ${Number(body.deactivated || 0)}, errors: ${Number(body.errors || 0)}`
    );
  }


  return body;
}


async function refreshCashEdgeState() {

  await refreshTrackedGames();
}
// ============================================================
// OWLS CURRENT BOARD REVALIDATION
//
// WebSocket:
//   detects market changes immediately.
//
// REST snapshot:
//   confirms that unchanged sportsbook prices are still
//   currently available.
//
// This does NOT create fake movement.
// An unchanged quote only refreshes its last-seen time.
// ============================================================

async function refreshOwlsCurrentBoard() {

 const activeSports =
  Array.from(
    new Set(
      getAllTrackedGames()
        .filter(
          game =>
            game
              ?.current_is_premium ===
            true
        )
        .map(
          game =>
            String(
              game?.sport || ""
            )
              .trim()
              .toLowerCase()
        )
        .filter(
          sport =>
            SPORTS.includes(
              sport
            )
        )
    )
  );

  if (
    !activeSports.length
  ) {
    return;
  }


  const sports = {};


  for (
    const sport
    of activeSports
  ) {

    try {

      const url =
        `${OWLS_URL}/api/v1/${sport}/odds?books=${encodeURIComponent(
          BOOKS.join(",")
        )}`;


      const response =
        await fetch(
          url,
          {
            headers: {
              Authorization:
                `Bearer ${OWLS_API_KEY}`
            }
          }
        );


      const body =
        await response
          .json()
          .catch(
            () => null
          );


      if (
        !response.ok ||
        body?.success !== true ||
        !body?.data ||
        typeof body.data !==
          "object"
      ) {

        console.error(
          `[${WORKER_NAME}] Owls REST ${sport} error: ${
            body?.error ||
            `HTTP ${response.status}`
          }`
        );

        continue;
      }


      const eventsForSport =
        [];


      for (
        const [
          bookName,
          bookEvents
        ]
        of Object.entries(
          body.data
        )
      ) {

        const rawBookKey =
          String(
            bookName || ""
          )
            .trim()
            .toLowerCase();


        if (
          !BOOKS.includes(
            rawBookKey
          ) ||
          !Array.isArray(
            bookEvents
          )
        ) {
          continue;
        }


        for (
          const event
          of bookEvents
        ) {

          const bookmakers =
            Array.isArray(
              event?.bookmakers
            )
              ? event.bookmakers
                  .filter(
                    bookmaker =>
                      String(
                        bookmaker?.key ||
                        ""
                      )
                        .trim()
                        .toLowerCase() ===
                      rawBookKey
                  )
              : [];


          if (
            !bookmakers.length
          ) {
            continue;
          }


          eventsForSport.push({
            ...event,
            bookmakers
          });
        }
      }


      if (
        eventsForSport.length
      ) {
        sports[sport] =
          eventsForSport;
      }

    } catch (error) {

      console.error(
        `[${WORKER_NAME}] Owls REST ${sport} refresh error: ${error.message}`
      );
    }
  }


  if (
    !Object.keys(
      sports
    ).length
  ) {
    return;
  }


  queueOddsUpdate({
    sports,

    timestamp:
      new Date()
        .toISOString(),

    last_odds_change:
      null
  });
}

async function syncPickContextSafe() {

  if (
    pickContextSyncRunning
  ) {
    return;
  }


  pickContextSyncRunning =
    true;


  try {

    await syncPickContext();

    await refreshTrackedGames();

  } catch (error) {

    console.error(
      `[${WORKER_NAME}] pick-context sync error: ${error.message}`
    );

  } finally {

    pickContextSyncRunning =
      false;
  }
}
async function refreshTrackedGames() {

  const response =
    await fetch(
      TRACKED_GAMES_URL,
      {
        headers: {
          Authorization:
            `Bearer ${MARKET_INGEST_SECRET}`
        }
      }
    );


  const body =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok ||
    body?.ok !== true ||
    !Array.isArray(body.games)
  ) {
    throw new Error(
      body?.error ||
      `tracked-games HTTP ${response.status}`
    );
  }


  const nextMap =
    new Map();


  for (
    const game
    of body.games
  ) {

    if (
      !game?.sport ||
      !game?.away_team ||
      !game?.home_team ||
      !game?.game_date ||
      !game?.cashedge_game_id
    ) {
      continue;
    }


    const key =
      makeGameKey({
        sport:
          game.sport,

        awayTeam:
          game.away_team,

        homeTeam:
          game.home_team,

        gameDate:
          game.game_date
      });

if (
  !nextMap.has(
    key
  )
) {

  nextMap.set(
    key,
    []
  );
}


nextMap
  .get(key)
  .push(game);
  }


  trackedGameMap =
    nextMap;


  /*
   * Remove dedupe signatures belonging to games
   * that are no longer Premium.
   *
   * If they later become Premium again, they will
   * receive a fresh baseline.
   */
  const activePremiumIds =
    new Set(
      body.games
        .filter(
          game =>
            game
              .current_is_premium ===
            true
        )
        .map(
          game =>
            String(
              game
                .cashedge_game_id
            )
        )
    );


  for (
    const key
    of lastSentSignatures.keys()
  ) {

    const gameId =
      key.split("|")[0];

    if (
      !activePremiumIds.has(
        gameId
      )
    ) {
      lastSentSignatures
        .delete(
          key
        );
    }
  }


  /*
   * Only print when the board actually changed,
   * so Railway logs stay clean.
   */
  if (
    trackedCount !== body.count ||
    premiumCount !== body.premiumCount
  ) {

    trackedCount =
      body.count;

    premiumCount =
      body.premiumCount;


    console.log(
      `[${WORKER_NAME}] CashEdge tracked games: ${trackedCount}, Premium: ${premiumCount}`
    );
  }
}


// ============================================================
// MARKET MAPPING
// ============================================================

function getOwlsMarketKey(
  marketType
) {
  if (
    marketType ===
    "moneyline"
  ) {
    return "h2h";
  }


  if (
    marketType ===
    "spread"
  ) {
    return "spreads";
  }


  if (
    marketType ===
    "total"
  ) {
    return "totals";
  }


  return null;
}


function findPremiumOutcome({
  tracked,
  market
}) {

  if (
    !market ||
    !Array.isArray(
      market.outcomes
    )
  ) {
    return null;
  }


  const selection =
    normalizeText(
      tracked.selection_key
    );


  if (
    tracked.market_type ===
    "total"
  ) {

    return (
      market.outcomes.find(
        outcome =>
          normalizeText(
            outcome?.name
          ) ===
          selection
      ) ||
      null
    );
  }


  return (
    market.outcomes.find(
      outcome =>
        normalizeText(
          outcome?.name
        ) ===
        selection
    ) ||
    null
  );
}


// ============================================================
// CASHEDGE INGEST
// ============================================================

async function ingestQuote(
  payload
) {

  const response =
    await fetch(
      INGEST_QUOTE_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${MARKET_INGEST_SECRET}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );


  const body =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok ||
    body?.ok !== true
  ) {

    throw new Error(
      body?.error ||
      `ingest-quote HTTP ${response.status}`
    );
  }


  return body;
}

async function ingestSplit(
  payload
) {

  const response =
    await fetch(
      INGEST_SPLIT_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${MARKET_INGEST_SECRET}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );


  const body =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok ||
    body?.ok !== true
  ) {

    throw new Error(
      body?.error ||
      `ingest-split HTTP ${response.status}`
    );
  }


  return body;
}


function getSplitTarget(
  tracked
) {

  let marketType =
    tracked.market_type;

  let selectionKey =
    tracked.selection_key;


  /*
   * MLB Runline:
   * CashEdge wager remains spread,
   * but Market Intelligence movement/splits
   * use the selected team's moneyline.
   */
  if (
    tracked.sport === "mlb" &&
    tracked.market_type === "spread"
  ) {

    marketType =
      "moneyline";
  }


  return {
    marketType,
    selectionKey
  };
}


function findTrackedSplitGame({
  sport,
  awayTeam,
  homeTeam
}) {

  const away =
    normalizeTeamForGameKey(
      sport,
      awayTeam
    );

  const home =
    normalizeTeamForGameKey(
      sport,
      homeTeam
    );

for (
  const tracked
  of getAllTrackedGames()
) {

    if (
      tracked.current_is_premium !== true ||
      tracked.sport !== sport
    ) {
      continue;
    }


    const trackedAway =
      normalizeTeamForGameKey(
        sport,
        tracked.away_team
      );

    const trackedHome =
      normalizeTeamForGameKey(
        sport,
        tracked.home_team
      );


    if (
      trackedAway === away &&
      trackedHome === home
    ) {
      return tracked;
    }
  }


  return null;
}


function buildSplitPayload({
  sport,
  tracked,
  providerSplit
}) {

  const {
    marketType,
    selectionKey
  } =
    getSplitTarget(
      tracked
    );


  const normalizedSelection =
    normalizeText(
      selectionKey
    );

  const awayKey =
    normalizeText(
      tracked.away_team
    );

  const homeKey =
    normalizeText(
      tracked.home_team
    );


  let line =
    null;

  let price =
    null;

  let moneyPct =
    null;

  let ticketsPct =
    null;


  if (
    marketType === "total"
  ) {

    const total =
      providerSplit?.total;

    if (!total) {
      return null;
    }


    line =
      Number(
        total.line
      );


    if (
      normalizedSelection === "over"
    ) {

      moneyPct =
        Number(
          total.over_handle_pct
        );

      ticketsPct =
        Number(
          total.over_bets_pct
        );

    } else if (
      normalizedSelection === "under"
    ) {

      moneyPct =
        Number(
          total.under_handle_pct
        );

      ticketsPct =
        Number(
          total.under_bets_pct
        );

    } else {
      return null;
    }

  } else if (
    marketType === "spread"
  ) {

    const spread =
      providerSplit?.spread;

    if (!spread) {
      return null;
    }


    if (
      normalizedSelection ===
      awayKey
    ) {

      line =
        Number(
          spread.away_line
        );

      moneyPct =
        Number(
          spread.away_handle_pct
        );

      ticketsPct =
        Number(
          spread.away_bets_pct
        );

    } else if (
      normalizedSelection ===
      homeKey
    ) {

      line =
        Number(
          spread.home_line
        );

      moneyPct =
        Number(
          spread.home_handle_pct
        );

      ticketsPct =
        Number(
          spread.home_bets_pct
        );

    } else {
      return null;
    }

  } else if (
    marketType === "moneyline"
  ) {

    const moneyline =
      providerSplit?.moneyline;

    if (!moneyline) {
      return null;
    }


    if (
      normalizedSelection ===
      awayKey
    ) {

      price =
        Number(
          moneyline.away_price
        );

      moneyPct =
        Number(
          moneyline.away_handle_pct
        );

      ticketsPct =
        Number(
          moneyline.away_bets_pct
        );

    } else if (
      normalizedSelection ===
      homeKey
    ) {

      price =
        Number(
          moneyline.home_price
        );

      moneyPct =
        Number(
          moneyline.home_handle_pct
        );

      ticketsPct =
        Number(
          moneyline.home_bets_pct
        );

    } else {
      return null;
    }

  } else {
    return null;
  }


  if (
    !Number.isFinite(
      moneyPct
    ) ||
    !Number.isFinite(
      ticketsPct
    )
  ) {
    return null;
  }


  if (
    marketType !== "moneyline" &&
    !Number.isFinite(
      line
    )
  ) {
    return null;
  }


  if (
    marketType === "moneyline" &&
    !Number.isFinite(
      price
    )
  ) {
    return null;
  }


  let sourceKey =
    String(
      providerSplit?.book ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    sourceKey === "dk"
  ) {
    sourceKey =
      "draftkings";
  }


  return {
    sport,

    cashedge_game_id:
      tracked.cashedge_game_id,

    provider:
      "owls",

    split_source_key:
      sourceKey,

    split_source_name:
      providerSplit?.title ||
      sourceKey,

    market_type:
      marketType,

    selection_key:
      selectionKey,

    line:
      marketType === "moneyline"
        ? null
        : line,

    price_american:
      marketType === "moneyline"
        ? Math.round(price)
        : null,

    money_pct:
      moneyPct,

    tickets_pct:
      ticketsPct,

    provider_timestamp:
      null
  };
}


async function refreshBettingSplits() {

  if (
    splitRefreshRunning
  ) {
    return;
  }


  splitRefreshRunning =
    true;


  let sent =
    0;

  let errors =
    0;


  try {

   const activeSports =
  [
    ...new Set(
      getAllTrackedGames()
        .filter(
          game =>
            game.current_is_premium ===
            true
        )
        .map(
          game =>
            game.sport
        )
        .filter(
          sport =>
            SPORTS.includes(
              sport
            )
        )
    )
  ];

    for (
      const sport
      of activeSports
    ) {

      try {

        const response =
          await fetch(
            `${OWLS_URL}/api/v1/${sport}/splits`,
            {
              headers: {
                Authorization:
                  `Bearer ${OWLS_API_KEY}`
              }
            }
          );


        const body =
          await response
            .json()
            .catch(
              () => null
            );


        if (
          !response.ok
        ) {

          throw new Error(
            body?.error ||
            `Owls splits HTTP ${response.status}`
          );
        }


        const events =
          Array.isArray(
            body?.data
          )
            ? body.data
            : [];
console.log(
  `[${WORKER_NAME}] ${sport} splits board — events: ${events.length}, status: ${body?.meta?.status || "unknown"}, reason: ${body?.meta?.partial_reason || "none"}, total: ${body?.meta?.total_games ?? body?.meta?.active_games ?? "unknown"}, books: ${Array.isArray(body?.meta?.books) ? body.meta.books.join(",") : "unknown"}`
);
        for (
          const event
          of events
        ) {

          const tracked =
            findTrackedSplitGame({
              sport,

              awayTeam:
                event.away_team,

              homeTeam:
                event.home_team
            });


          if (!tracked) {
            continue;
          }


          const sources =
            Array.isArray(
              event.splits
            )
              ? event.splits
              : [];


          for (
            const providerSplit
            of sources
          ) {

            const payload =
              buildSplitPayload({
                sport,
                tracked,
                providerSplit
              });


            if (!payload) {
              continue;
            }


            const signatureKey =
              [
                payload
                  .cashedge_game_id,

                payload
                  .split_source_key,

                payload
                  .market_type,

                payload
                  .selection_key
              ].join("|");


            const signature =
              [
                payload.line ??
                  "null",

                payload
                  .price_american ??
                  "null",

                payload
                  .money_pct,

                payload
                  .tickets_pct
              ].join("|");


            if (
              lastSentSplitSignatures
                .get(
                  signatureKey
                ) ===
              signature
            ) {
              continue;
            }


            try {

              await ingestSplit(
                payload
              );


              lastSentSplitSignatures
                .set(
                  signatureKey,
                  signature
                );


              sent += 1;

            } catch (error) {

              errors += 1;

              console.error(
                `[${WORKER_NAME}] split ingest error: ${error.message}`
              );
            }
          }
        }

      } catch (error) {

        errors += 1;

        console.error(
          `[${WORKER_NAME}] ${sport} splits error: ${error.message}`
        );
      }
    }


   console.log(
  `[${WORKER_NAME}] betting splits — sent: ${sent}, errors: ${errors}`
);

  } finally {

    splitRefreshRunning =
      false;
  }
}
// ============================================================
// CONCURRENCY
// ============================================================

async function runJobs(
  jobs
) {

  let nextIndex =
    0;

  let sent =
    0;

  let errors =
    0;


  async function worker() {

    while (true) {

      const index =
        nextIndex++;

      if (
        index >=
        jobs.length
      ) {
        return;
      }


      const job =
        jobs[index];


      try {

        await ingestQuote(
          job.payload
        );


       lastSentSignatures
  .set(
    job.signatureKey,
    {
      signature:
        job.signature,

      sentAt:
        Date.now()
    }
  );

        sent += 1;

      } catch (error) {

        errors += 1;

        /*
         * Keep errors visible,
         * but do not log every normal quote.
         */
        console.error(
          `[${WORKER_NAME}] ingest error: ${error.message}`
        );
      }
    }
  }


  const workers =
    [];


  const count =
    Math.min(
      MAX_CONCURRENCY,
      jobs.length
    );


  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    workers.push(
      worker()
    );
  }


  await Promise.all(
    workers
  );


  return {
    sent,
    errors
  };
}


// ============================================================
// PROCESS OWLS BOARD
// ============================================================

async function processOddsUpdate(
  data
) {

  const jobs =
    [];

  const matchedPremiumGames =
    new Set();
const premiumQuoteCounts =
  new Map();

  for (
    const sport
    of SPORTS
  ) {

    const events =
      Array.isArray(
        data?.sports?.[sport]
      )
        ? data.sports[sport]
        : [];


    for (
      const event
      of events
    ) {

      /*
       * CashEdge Market Intelligence is PRE-GAME.
       * Never ingest after kickoff.
       */
      const commenceTime =
        event?.commence_time;

      const commenceMs =
        Date.parse(
          commenceTime
        );


      if (
        !Number.isFinite(
          commenceMs
        ) ||
        commenceMs <= Date.now()
      ) {
        continue;
      }


      const gameDate =
        centralDateFromIso(
          commenceTime
        );


      if (!gameDate) {
        continue;
      }


      const gameKey =
        makeGameKey({
          sport,

          awayTeam:
            event.away_team,

          homeTeam:
            event.home_team,

          gameDate
        });


      const trackedCandidates =
  trackedGameMap.get(
    gameKey
  ) ||
  [];


const tracked =
  resolveTrackedGame({

    candidates:
      trackedCandidates,

    commenceTime
  });


      if (
        !tracked ||
        tracked
          .current_is_premium !==
        true
      ) {
        continue;
      }


      if (
        !tracked.market_type ||
        !tracked.selection_key
      ) {
        continue;
      }


      matchedPremiumGames.add(
        tracked
          .cashedge_game_id
      );


      const owlsMarketKey =
        getOwlsMarketKey(
          tracked.market_type
        );


      if (!owlsMarketKey) {
        continue;
      }


      const bookmakers =
        Array.isArray(
          event.bookmakers
        )
          ? event.bookmakers
          : [];


      for (
        const bookmaker
        of bookmakers
      ) {

       const owlsBookKey =
  String(
    bookmaker?.key ||
    ""
  )
    .trim()
    .toLowerCase();


if (
  !BOOKS.includes(
    owlsBookKey
  )
) {
  continue;
}


const sportsbookKey =
  normalizeSportsbookKey(
    owlsBookKey
  );

        const markets =
          Array.isArray(
            bookmaker.markets
          )
            ? bookmaker.markets
            : [];


        const market =
          markets.find(
            item =>
              String(
                item?.key ||
                ""
              )
                .trim()
                .toLowerCase() ===
              owlsMarketKey
          );


        if (!market) {
          continue;
        }


        const outcome =
          findPremiumOutcome({
            tracked,
            market
          });


        if (!outcome) {
          continue;
        }


        const price =
          Number(
            outcome.price
          );


        if (
          !Number.isFinite(
            price
          )
        ) {
          continue;
        }


        let line =
          null;


     if (
  tracked.market_type !==
  "moneyline"
) {

  if (
    outcome.point === null ||
    outcome.point === undefined ||
    String(
      outcome.point
    ).trim() === ""
  ) {
    continue;
  }


  line =
    Number(
      outcome.point
    );


  if (
    !Number.isFinite(
      line
    )
  ) {
    continue;
  }


  // ========================================================
  // SPREAD 0 SAFETY
  //
  // A real pick'em is valid, but an isolated 0 from one
  // sportsbook must not overwrite a real spread.
  //
  // Accept 0 only when:
  // 1. CashEdge itself currently has a 0 spread, OR
  // 2. another approved sportsbook also confirms 0.
  // ========================================================

  if (
    tracked.market_type ===
      "spread" &&
    line === 0
  ) {

    const cashEdgeLine =
      Number(
        tracked.line
      );


    const cashEdgeConfirmsZero =
      Number.isFinite(
        cashEdgeLine
      ) &&
      cashEdgeLine === 0;


    const anotherBookConfirmsZero =
      bookmakers.some(
        otherBook => {

          const otherBookKey =
            String(
              otherBook?.key ||
              ""
            )
              .trim()
              .toLowerCase();


          if (
            !otherBookKey ||
            otherBookKey ===
              sportsbookKey ||
            !BOOKS.includes(
              otherBookKey
            )
          ) {
            return false;
          }


          const otherMarkets =
            Array.isArray(
              otherBook.markets
            )
              ? otherBook.markets
              : [];


          const otherMarket =
            otherMarkets.find(
              item =>
                String(
                  item?.key ||
                  ""
                )
                  .trim()
                  .toLowerCase() ===
                owlsMarketKey
            );


          if (!otherMarket) {
            return false;
          }


          const otherOutcome =
            findPremiumOutcome({
              tracked,
              market:
                otherMarket
            });


          if (
            !otherOutcome ||
            otherOutcome.point ===
              null ||
            otherOutcome.point ===
              undefined ||
            String(
              otherOutcome.point
            ).trim() ===
              ""
          ) {
            return false;
          }


          const otherLine =
            Number(
              otherOutcome.point
            );


          return (
            Number.isFinite(
              otherLine
            ) &&
            otherLine === 0
          );
        }
      );


    if (
      !cashEdgeConfirmsZero &&
      !anotherBookConfirmsZero
    ) {
      continue;
    }
  }
}


        const signatureKey =
          [
            tracked
              .cashedge_game_id,

            sportsbookKey,

            tracked
              .market_type,

            tracked
              .selection_key
          ].join("|");


const signature =
  `${line ?? "null"}|${Math.round(price)}`;


const previousSent =
  lastSentSignatures
    .get(
      signatureKey
    ) ||
  null;


const sameQuote =
  previousSent
    ?.signature ===
  signature;


const lastSentAt =
  Number(
    previousSent
      ?.sentAt ||
    0
  );


const needsRevalidation =
  !lastSentAt ||
  (
    Date.now() -
    lastSentAt
  ) >=
    QUOTE_REVALIDATE_MS;


if (
  sameQuote &&
  !needsRevalidation
) {
  continue;
}

        const providerTimestamp =
          bookmaker.last_update ||
          data.last_odds_change ||
          data.timestamp ||
          null;
premiumQuoteCounts.set(
  tracked.cashedge_game_id,
  (
    premiumQuoteCounts.get(
      tracked.cashedge_game_id
    ) || 0
  ) + 1
);

     jobs.push({
  signatureKey,
  signature,

  isRevalidation:
    sameQuote === true,

  payload: {
            sport,

            cashedge_game_id:
              tracked
                .cashedge_game_id,

            provider:
              "owls",

            provider_event_id:
              event.id ||
              null,

            sportsbook_key:
              sportsbookKey,

            sportsbook_name:
              bookmaker.title ||
              sportsbookKey,

            market_type:
              tracked
                .market_type,

            selection_key:
              tracked
                .selection_key,

            selection_name:
              outcome.name ||
              tracked
                .selection_key,

            line,

            price_american:
              Math.round(
                price
              ),

            provider_timestamp:
              providerTimestamp,

            raw_payload: {
              event_id:
                event.id ||
                null,

              commence_time:
                commenceTime,

              away_team:
                event.away_team ||
                null,

              home_team:
                event.home_team ||
                null,

              sportsbook_key:
                sportsbookKey,

              market_key:
                owlsMarketKey,

              outcome: {
                name:
                  outcome.name ||
                  null,

                point:
                  outcome.point ??
                  null,

                price:
                  outcome.price ??
                  null
              },

              last_update:
                bookmaker
                  .last_update ||
                null
            }
          }
        });
      }
    }
  }
const gamesWithRealChanges =
  new Set(
    jobs
      .filter(
        job =>
          job.isRevalidation !== true
      )
      .map(
        job =>
          String(
            job?.payload
              ?.cashedge_game_id ||
            ""
          )
      )
      .filter(Boolean)
  );


const periodicRefreshAssigned =
  new Set();


for (
  const job
  of jobs
) {

  const gameId =
    String(
      job?.payload
        ?.cashedge_game_id ||
      ""
    );


  const canOwnPeriodicRefresh =
    Boolean(gameId) &&
    job.isRevalidation === true &&
    !gamesWithRealChanges.has(
      gameId
    ) &&
    !periodicRefreshAssigned.has(
      gameId
    );


  job.payload.allow_periodic_refresh =
    canOwnPeriodicRefresh;


  if (
    canOwnPeriodicRefresh
  ) {

    periodicRefreshAssigned.add(
      gameId
    );
  }
}

  const result =
    await runJobs(
      jobs
    );


  /*
   * One startup summary only.
   * No heartbeat/log spam.
   */
  if (
    !firstIngestSummaryLogged
  ) {

    firstIngestSummaryLogged =
      true;


    console.log(
      `[${WORKER_NAME}] live market ingest active`
    );

    console.log(
      `[${WORKER_NAME}] matched Premium games: ${matchedPremiumGames.size}`
    );

    console.log(
      `[${WORKER_NAME}] quotes sent: ${result.sent}, errors: ${result.errors}`
    );
   for (
  const tracked
  of getAllTrackedGames()
) {

  if (
    tracked?.sport !== "mlb" ||
    tracked?.current_is_premium !== true
  ) {
    continue;
  }


  if (
    !matchedPremiumGames.has(
      tracked.cashedge_game_id
    )
  ) {

    console.log(
      `[${WORKER_NAME}] MLB Premium NOT matched in Owls board: ${tracked.cashedge_game_id} | ${tracked.away_team} @ ${tracked.home_team}`
    );
  }
}
    for (
  const gameId
  of matchedPremiumGames
) {

  if (
    (
      premiumQuoteCounts.get(
        gameId
      ) || 0
    ) === 0
  ) {

    console.log(
      `[${WORKER_NAME}] Premium matched but no usable quotes: ${gameId}`
    );
  }
}
  }
}


// ============================================================
// SERIALIZE OWLS UPDATES
// ============================================================

async function queueOddsUpdate(
  data
) {

  if (
    processingUpdate
  ) {

    /*
     * Owls sends the current board.
     * Keep only the newest waiting update.
     */
    queuedUpdate =
      data;

    return;
  }


  processingUpdate =
    true;


  try {

    let current =
      data;


    while (current) {

      queuedUpdate =
        null;


      await processOddsUpdate(
        current
      );


      current =
        queuedUpdate;
    }

  } catch (error) {

    console.error(
      `[${WORKER_NAME}] odds processing error: ${error.message}`
    );

  } finally {

    processingUpdate =
      false;
  }
}


// ============================================================
// OWLS CONNECTION
// ============================================================

function markOwlsHeartbeat() {

  lastOwlsHeartbeatAt =
    Date.now();
}


function forceOwlsReconnect(
  reason
) {

  if (watchdogReconnectActive) {
    return;
  }


  watchdogReconnectActive =
    true;


  console.error(
    `[${WORKER_NAME}] forcing Owls reconnect: ${reason}`
  );


  const oldSocket =
    socket;


  socket =
    null;


  if (oldSocket) {

    try {

      oldSocket
        .removeAllListeners();

      oldSocket
        .disconnect();

    } catch (error) {

      console.error(
        `[${WORKER_NAME}] Owls disconnect cleanup error: ${error.message}`
      );
    }
  }


  setTimeout(
    () => {

      watchdogReconnectActive =
        false;

      connectOwls();

    },
    1000
  );
}


function connectOwls() {

  socket =
    io(
      OWLS_URL,
      {
        query: {
          apiKey:
            OWLS_API_KEY
        },

        transports: [
          "websocket"
        ],

        reconnection:
          true,

        reconnectionAttempts:
          Infinity,

        reconnectionDelay:
          1000,

        reconnectionDelayMax:
          15000,

        timeout:
          20000
      }
    );


  socket.on(
    "connect",
    () => {

      markOwlsHeartbeat();


      console.log(
        `[${WORKER_NAME}] connected to Owls Insight`
      );


      /*
       * Engine.IO ping is the real transport heartbeat.
       * It does not depend on sportsbook lines moving.
       */
      const engine =
        socket
          ?.io
          ?.engine;


      if (
        engine &&
        typeof engine.on ===
          "function"
      ) {

        engine.on(
          "ping",
          markOwlsHeartbeat
        );
      }


      socket.emit(
        "subscribe",
        {
          sports:
            SPORTS,

          books:
            BOOKS
        }
      );


      console.log(
        `[${WORKER_NAME}] subscribed to CashEdge market books`
      );
    }
  );


  socket.on(
    "odds-update",
    data => {

      markOwlsHeartbeat();

      lastOwlsOddsUpdateAt =
        Date.now();


      queueOddsUpdate(
        data
      );
    }
  );


  socket.on(
    "connect_error",
    error => {

      console.error(
        `[${WORKER_NAME}] Owls connection error: ${error.message}`
      );
    }
  );


  socket.on(
    "disconnect",
    reason => {

      console.log(
        `[${WORKER_NAME}] disconnected from Owls: ${reason}`
      );
    }
  );
}


function startOwlsWatchdog() {

  if (watchdogTimer) {

    clearInterval(
      watchdogTimer
    );
  }


  watchdogTimer =
    setInterval(
      () => {

        /*
         * If Socket.IO already knows it is disconnected,
         * its normal reconnect system handles it.
         */
        if (
          !socket ||
          socket.connected !== true
        ) {
          return;
        }


        if (!lastOwlsHeartbeatAt) {
          return;
        }


        const heartbeatAge =
          Date.now() -
          lastOwlsHeartbeatAt;


        if (
          heartbeatAge >
          OWLS_HEARTBEAT_STALE_MS
        ) {

          forceOwlsReconnect(
            `no Socket.IO heartbeat for ${Math.round(
              heartbeatAge / 1000
            )}s`
          );
        }

      },
      OWLS_WATCHDOG_INTERVAL_MS
    );
}

async function start() {

  console.log(
    `[${WORKER_NAME}] started`
  );


  console.log(
    `[${WORKER_NAME}] CashEdge origin: ${CASHEDGE_ORIGIN}`
  );
  void initializeLearningSafe();

  /*
   * Load the current tracked board first.
   *
   * Do NOT block the live worker waiting for
   * pick-context synchronization.
   */
  while (true) {

    try {

      await refreshTrackedGames();

      break;

    } catch (error) {

      console.error(
        `[${WORKER_NAME}] tracked-games error: ${error.message}`
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            15000
          )
      );
    }
  }


  /*
   * Tracked games refresh every minute.
   */
 refreshTimer =
  setInterval(
    async () => {

      try {

        await refreshCashEdgeState();

      } catch (error) {

        console.error(
          `[${WORKER_NAME}] tracked-games refresh error: ${error.message}`
        );
      }


      try {

        await refreshOwlsCurrentBoard();

      } catch (error) {

        console.error(
          `[${WORKER_NAME}] Owls board revalidation error: ${error.message}`
        );
      }

    },
    REFRESH_INTERVAL_MS
  );


  /*
   * Pick context sync runs independently.
   *
   * A Vercel timeout here must NEVER stop:
   * - Owls connection
   * - quote ingestion
   * - betting splits
   */
  void syncPickContextSafe();


  syncTimer =
    setInterval(
      () => {
        void syncPickContextSafe();
      },

      PICK_CONTEXT_SYNC_INTERVAL_MS
    );
    learningCashEdgeTimer =
    setInterval(
      () => {
        void syncLearningCashEdgeSafe();
      },
      LEARNING_CASHEDGE_SYNC_INTERVAL_MS
    );
try {

  await refreshOwlsCurrentBoard();

} catch (error) {

  console.error(
    `[${WORKER_NAME}] initial Owls board revalidation error: ${error.message}`
  );
}

  /*
   * Start live Owls feed.
   */
  connectOwls();

  startOwlsWatchdog();


  /*
   * Start Betting Splits immediately.
   */
  try {

    await refreshBettingSplits();

  } catch (error) {

    console.error(
      `[${WORKER_NAME}] initial splits error: ${error.message}`
    );
  }


  splitTimer =
    setInterval(
      refreshBettingSplits,
      SPLIT_REFRESH_INTERVAL_MS
    );
}

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(
  signal
) {

  console.log(
    `[${WORKER_NAME}] shutting down: ${signal}`
  );


  if (
    refreshTimer
  ) {
    clearInterval(
      refreshTimer
    );
  }
  if (
  syncTimer
) {

  clearInterval(
    syncTimer
  );
}
if (
  watchdogTimer
) {

  clearInterval(
    watchdogTimer
  );
}
if (
  splitTimer
) {

  clearInterval(
    splitTimer
  );
}
  if (
    socket
  ) {
    socket.disconnect();
  }

if (
  learningCashEdgeTimer
) {

  clearInterval(
    learningCashEdgeTimer
  );
}
  process.exit(0);
}


process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);


process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);


// ============================================================
// RUN
// ============================================================

start();

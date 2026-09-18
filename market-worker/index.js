"use strict";

const {
  io
} = require("socket.io-client");


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

  await syncPickContext();

  await refreshTrackedGames();
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


    nextMap.set(
      key,
      game
    );
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
            job.signature
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


      const tracked =
        trackedGameMap.get(
          gameKey
        );


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


        if (
          lastSentSignatures
            .get(
              signatureKey
            ) ===
          signature
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
  of trackedGameMap.values()
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

// ============================================================
// START
// ============================================================

async function start() {

  console.log(
    `[${WORKER_NAME}] started`
  );


  console.log(
    `[${WORKER_NAME}] CashEdge origin: ${CASHEDGE_ORIGIN}`
  );


  /*
   * Load CashEdge IDs BEFORE opening Owls,
   * so the first live board can already be matched.
   */
  while (true) {

    try {

     await refreshCashEdgeState();
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
      },
      REFRESH_INTERVAL_MS
    );


  connectOwls();
  startOwlsWatchdog();
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
  watchdogTimer
) {

  clearInterval(
    watchdogTimer
  );
}

  if (
    socket
  ) {
    socket.disconnect();
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

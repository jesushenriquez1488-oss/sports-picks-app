"use strict";

const {
  io
} = require("socket.io-client");
// ============================================================
// NBA LIVE WATCHERS
//
// OPTIONAL AND NON-FATAL.
// A failure here must NEVER stop Market Intelligence.
// ============================================================

let nbaInjuryWatcherModule =
  null;

try {

  nbaInjuryWatcherModule =
    require(
      "./nbaInjuryWatcher"
    );

} catch (error) {

  console.error(
    `[nba-injury-watch] module unavailable: ${error?.message || error}`
  );

  nbaInjuryWatcherModule =
    null;
}


let nbaMarketSignalWatcherModule =
  null;

try {

  nbaMarketSignalWatcherModule =
    require(
      "./nbaMarketSignalWatcher"
    );

} catch (error) {

  console.error(
    `[nba-market-watch] module unavailable: ${error?.message || error}`
  );

  nbaMarketSignalWatcherModule =
    null;
}
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
let learningMarketFeed =
  null;

try {

  learningMarketFeed =
    require("./learningMarketFeed");

} catch (error) {

  console.error(
    `[learning-market-feed] module unavailable: ${error?.message || error}`
  );

  learningMarketFeed =
    null;
}
let learningSplitFeed =
  null;

try {

  learningSplitFeed =
    require("./learningSplitFeed");

} catch (error) {

  console.error(
    `[learning-split-feed] module unavailable: ${error?.message || error}`
  );

  learningSplitFeed =
    null;
}
let learningGameRegistry =
  null;

try {

  learningGameRegistry =
    require("./learningGameRegistry");

} catch (error) {

  console.error(
    `[learning-game-registry] module unavailable: ${error?.message || error}`
  );

  learningGameRegistry =
    null;
}
let learningResultsSync =
  null;

try {

  learningResultsSync =
    require("./learningResultsSync");

} catch (error) {

  console.error(
    `[learning-results] module unavailable: ${error?.message || error}`
  );

  learningResultsSync =
    null;
}
let learningLabelEngine =
  null;

try {

  learningLabelEngine =
    require("./learningLabelEngine");

} catch (error) {

  console.error(
    `[learning-labels] module unavailable: ${error?.message || error}`
  );

  learningLabelEngine =
    null;
}


let learningFeatureEngine =
  null;

try {

  learningFeatureEngine =
    require("./learningFeatureEngine");

} catch (error) {

  console.error(
    `[learning-features] module unavailable: ${error?.message || error}`
  );

  learningFeatureEngine =
    null;
}
let learningGameStoryBuilder =
  null;

try {

  learningGameStoryBuilder =
    require("./learningGameStoryBuilder");

} catch (error) {

  console.error(
    `[learning-game-stories] module unavailable: ${error?.message || error}`
  );

  learningGameStoryBuilder =
    null;
}


let learningPatternRegistry =
  null;

try {

  learningPatternRegistry =
    require("./learningPatternRegistry");

} catch (error) {

  console.error(
    `[learning-pattern-registry] module unavailable: ${error?.message || error}`
  );

  learningPatternRegistry =
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
async function runLearningPostResultsPipelineSafe(
  gameDate
) {

  try {

    if (
      !gameDate ||
      !learningLabelEngine ||
      typeof learningLabelEngine
        .labelGameDateSafe !==
        "function" ||
      !learningFeatureEngine ||
      typeof learningFeatureEngine
        .buildGameDateSafe !==
        "function"
    ) {

      console.error(
        "[learning-pipeline] labels/features unavailable"
      );

      return false;
    }


    const labelResult =
      await learningLabelEngine
        .labelGameDateSafe(
          gameDate
        );


    if (
      labelResult?.ok !== true
    ) {

      console.error(
        `[learning-pipeline] labels unsuccessful for ${gameDate}`
      );

      return false;
    }


    console.log(
      `[learning-labels] date: ${gameDate}, market states: ${Number(labelResult.marketStates || 0)}, existing: ${Number(labelResult.existing || 0)}, written: ${Number(labelResult.written || 0)}, skipped: ${Number(labelResult.skipped || 0)}`
    );


    const featureResult =
      await learningFeatureEngine
        .buildGameDateSafe(
          gameDate
        );


    if (
      featureResult?.ok !== true
    ) {

      console.error(
        `[learning-pipeline] features unsuccessful for ${gameDate}`
      );

      return false;
    }


    console.log(
      `[learning-features] date: ${gameDate}, labeled: ${Number(featureResult.labeledStates || 0)}, market states: ${Number(featureResult.marketStates || 0)}, existing: ${Number(featureResult.existing || 0)}, written: ${Number(featureResult.written || 0)}, splits: ${Number(featureResult.withSplits || 0)}, CashEdge: ${Number(featureResult.withCashEdge || 0)}, movements: ${Number(featureResult.movements || 0)}`
    );
if (
  !learningGameStoryBuilder ||
  typeof learningGameStoryBuilder
    .buildGameDateStoriesSafe !==
    "function"
) {

  console.error(
    "[learning-pipeline] game story builder unavailable"
  );

  return false;
}


const storyResult =
  await learningGameStoryBuilder
    .buildGameDateStoriesSafe(
      gameDate
    );


if (
  storyResult?.ok !== true
) {

  console.error(
    `[learning-pipeline] game stories unsuccessful for ${gameDate}`
  );

  return false;
}


console.log(
  `[learning-game-stories] date: ${gameDate}, games: ${Number(storyResult.games || 0)}, completed: ${Number(storyResult.completedGames || 0)}, written: ${Number(storyResult.written || 0)}`
);


if (
  !learningPatternRegistry ||
  typeof learningPatternRegistry
    .syncGameDatePatternsSafe !==
    "function"
) {

  console.error(
    "[learning-pipeline] pattern registry unavailable"
  );

  return false;
}


const patternResult =
  await learningPatternRegistry
    .syncGameDatePatternsSafe(
      gameDate
    );


if (
  patternResult?.ok !==
  true
) {

  console.error(
    `[learning-pipeline] pattern registry unsuccessful for ${gameDate}`
  );

  return false;
}


console.log(
  `[learning-pattern-registry] date: ${gameDate}, stories: ${Number(patternResult.stories || 0)}, games: ${Number(patternResult.uniqueGames || 0)}, observations: ${Number(patternResult.observations || 0)}, patterns: ${Number(patternResult.patterns || 0)}, written: ${Number(patternResult.written || 0)}`
);


console.log(
  `[learning-pipeline] complete: ${gameDate}`
);


return true;
  } catch (error) {

    console.error(
      `[learning-pipeline] failed: ${error?.message || error}`
    );

    return false;
  }
}
async function syncLearningResultsIfDueSafe() {

  try {

    if (
      !learningResultsSync ||
      typeof learningResultsSync
        .syncYesterdayResultsSafe !==
        "function"
    ) {
      return;
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
            "2-digit",

          hour:
            "2-digit",

          hourCycle:
            "h23"
        }
      )
        .formatToParts(
          new Date()
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


    const hour =
      Number(
        map.hour
      );


    /*
     * Learning results only run
     * from 6 AM through 12 PM Central.
     */
    if (
      !Number.isFinite(hour) ||
      hour < 6 ||
      hour > 12
    ) {
      return;
    }


    const currentDay =
      `${map.year}-${map.month}-${map.day}`;


    /*
     * If yesterday is already complete,
     * stop checking for the rest of today.
     */
    if (
      learningResultsCompleteDay ===
      currentDay
    ) {
      return;
    }


    const hourKey =
      `${currentDay}|${hour}`;


    /*
     * Only one run per hour.
     */
    if (
      learningResultsLastHourKey ===
      hourKey ||
      learningResultsRunning
    ) {
      return;
    }


    learningResultsLastHourKey =
      hourKey;

    learningResultsRunning =
      true;


    const result =
      await learningResultsSync
        .syncYesterdayResultsSafe();


    if (
      result?.ok !== true
    ) {

      console.error(
        "[learning-results] sync unsuccessful"
      );

      return;
    }


    if (
      Number(
        result?.written || 0
      ) > 0 ||
      Number(
        result?.unresolved || 0
      ) > 0
    ) {

      console.log(
        `[learning-results] date: ${result.gameDate || "unknown"}, checked: ${Number(result.checked || 0)}, pending: ${Number(result.pending || 0)}, written: ${Number(result.written || 0)}, unresolved: ${Number(result.unresolved || 0)}`
      );
    }


       /*
     * Learning does NOT require 100% result coverage.
     *
     * Run the downstream pipeline when:
     *
     * 1) this date has not been processed yet,
     * 2) new results were written since the last run,
     * 3) or Results finally reached full completion.
     *
     * This lets 70 resolved games continue even if
     * 1 game remains unresolved.
     */
    const shouldRunPipeline =
      Boolean(
        result?.gameDate
      ) &&
      (
        learningPipelineProcessedDay !==
          currentDay ||
        Number(
          result?.written ||
          0
        ) > 0 ||
        result?.complete ===
          true
      );


    let pipelineComplete =
      true;


    if (
      shouldRunPipeline
    ) {

      pipelineComplete =
        await runLearningPostResultsPipelineSafe(
          result.gameDate
        );


      if (
        pipelineComplete ===
        true
      ) {

        learningPipelineProcessedDay =
          currentDay;
      }
    }


    /*
     * Continue checking unresolved games hourly.
     *
     * Only stop the Results scheduler when the
     * result collector itself says the day is
     * fully complete AND the Learning pipeline
     * has processed that final state successfully.
     */
    if (
      result?.complete ===
        true &&
      pipelineComplete ===
        true
    ) {

      console.log(
        `[learning-results] yesterday complete: ${result.gameDate || "unknown"}`
      );


      learningResultsCompleteDay =
        currentDay;
    }

  } catch (error) {

    console.error(
      `[learning-results] scheduler failed: ${error?.message || error}`
    );

  } finally {

    learningResultsRunning =
      false;
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
/*
 * OPTIONAL.
 *
 * Missing BDL key must NEVER stop the worker.
 * ESPN can still work independently.
 */
const BALLDONTLIE_API_KEY =
  process.env.BALLDONTLIE_API_KEY ||
  "";

const TRACKED_GAMES_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/tracked-games`;

const INGEST_QUOTE_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/ingest-quote`;

const INGEST_SPLIT_URL =
  `${CASHEDGE_ORIGIN}/api/market-intelligence/ingest-split`;


const NBA_INJURY_INGEST_URL =
  `${CASHEDGE_ORIGIN}/api/analyze-nba?mode=ingest-nba-injuries`;


const NBA_INJURY_REANALYSIS_URL =
  `${CASHEDGE_ORIGIN}/api/analyze-nba?mode=generate-daily`;

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
const LEARNING_MARKET_BASELINE_INTERVAL_MS =
  30 * 60 * 1000;
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
let learningResultsTimer =
  null;

let learningResultsRunning =
  false;

let learningResultsLastHourKey =
  null;

let learningResultsCompleteDay =
  null;

/*
 * A day does NOT need 100% of its results
 * before Learning can process it.
 *
 * This remembers that the available results
 * for today's "yesterday" date were already
 * processed successfully at least once.
 */
let learningPipelineProcessedDay =
  null;

const learningMarketBaselineAt =
  new Map();
let owlsCurrentBoardRefreshRunning =
  false;
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
let owlsConnectionRetryTimer =
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
let nbaInjuryWatcher =
  null;

let nbaMarketSignalWatcher =
  null;

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
// LEARNING — OWLS GAME MATCH
//
// Reuses the SAME CashEdge game matching rules already used
// by Market Intelligence.
//
// No separate matching logic.
// No guessed game IDs.
// ============================================================

function resolveLearningMarketGame({
  sport,
  event
}) {

  const commenceTime =
    event?.commence_time;


  const gameDate =
    centralDateFromIso(
      commenceTime
    );


  if (
    !gameDate
  ) {
    return null;
  }


  const gameKey =
    makeGameKey({
      sport,

      awayTeam:
        event?.away_team,

      homeTeam:
        event?.home_team,

      gameDate
    });


  const candidates =
    trackedGameMap.get(
      gameKey
    ) ||
    [];


  return resolveTrackedGame({
    candidates,
    commenceTime
  });
}
// ============================================================
// NBA LIVE INJURY SNAPSHOT — SAFE SYNC
//
// Completely isolated from Market Intelligence.
//
// Baseline / structural changes only.
// Failure here must NEVER affect:
// - Owls
// - Market Intelligence
// - quote ingestion
// - splits
// - Learning
// ============================================================

async function syncNBAInjurySnapshotSafe(
  event
) {

  try {

    if (
      !event?.gameId ||
      !event?.game
    ) {
      return;
    }


    // ========================================================
    // 1. PERSIST NEW GOOD INJURY SNAPSHOT
    //
    // Nothing happens until Vercel confirms the snapshot
    // was successfully stored.
    // ========================================================

    const response =
      await fetch(
        NBA_INJURY_INGEST_URL,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "X-Internal-Secret":
              MARKET_INGEST_SECRET
          },

          body:
            JSON.stringify({

              gameId:
                event.gameId,

              awayTeam:
                event.game
                  ?.away_team,

              homeTeam:
                event.game
                  ?.home_team,

              gameTime:
                event.game
                  ?.game_time,

              awayTeamId:
                event.awayTeamId,

              homeTeamId:
                event.homeTeamId,

              injuries:
                event.injuries ||
                []
            })
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
        `HTTP ${response.status}`
      );
    }


    // ========================================================
    // BASELINE
    //
    // Important:
    // Vercel may report changed=true when the row did not
    // previously exist.
    //
    // Railway knows whether this was actually a baseline.
    // A baseline NEVER causes reanalysis.
    // ========================================================

    // ========================================================
// DECIDE WHETHER THIS REALLY NEEDS REANALYSIS
//
// Cases:
//
// 1. Brand-new baseline:
//    no previous persisted state
//    → NO reanalysis
//
// 2. Railway restart, same BDL state:
//    previous persisted state exists
//    but fingerprint did not change
//    → NO reanalysis
//
// 3. Railway restart while it was offline,
//    and BDL changed meanwhile:
//    in-memory event looks like baseline,
//    but persisted Vercel state was different
//    → YES reanalysis
//
// 4. Normal live structural change:
//    → YES reanalysis
// ========================================================

const recoveredChangeAfterRestart =
  event.isBaseline === true &&
  body.hadPreviousState === true &&
  body.changed === true;


const normalLiveChange =
  event.changed === true &&
  body.changed === true;


const shouldReanalyze =
  recoveredChangeAfterRestart ||
  normalLiveChange;


// ========================================================
// BASELINE WITH NO CHANGE
// ========================================================

if (
  event.isBaseline === true &&
  !shouldReanalyze
) {

  console.log(
    `[${WORKER_NAME}] NBA injury baseline saved: ${event.gameId} | injuries=${Number(body.injuries || 0)}`
  );

  return;
}


// ========================================================
// NO PERSISTED STRUCTURAL CHANGE
// ========================================================

if (
  !shouldReanalyze
) {
  return;
}


if (
  recoveredChangeAfterRestart
) {

  console.log(
    `[${WORKER_NAME}] NBA injury change recovered after restart: ${event.gameId} | injuries=${Number(body.injuries || 0)}`
  );

} else {

  console.log(
    `[${WORKER_NAME}] NBA injury snapshot changed: ${event.gameId} | injuries=${Number(body.injuries || 0)}`
  );
}

    // ========================================================
    // 2. TARGETED NBA REANALYSIS
    //
    // Snapshot is already persisted at this point.
    //
    // Only:
    // - basketball_nba
    // - this exact gameId
    // - force=true
    //
    // Completely isolated from Market Intelligence.
    // ========================================================

    try {

      const params =
        new URLSearchParams({

          sport:
            "basketball_nba",

          gameId:
            String(
              event.gameId
            ),

          force:
            "true"
        });


      const reanalysisResponse =
        await fetch(
          `${NBA_INJURY_REANALYSIS_URL}&${params.toString()}`,
          {

            method:
              "GET",

            headers: {

              "X-Internal-Secret":
                MARKET_INGEST_SECRET
            }
          }
        );


      const reanalysisBody =
        await reanalysisResponse
          .json()
          .catch(
            () => null
          );


      if (
        !reanalysisResponse.ok
      ) {

        throw new Error(
          reanalysisBody?.error ||
          `HTTP ${reanalysisResponse.status}`
        );
      }


      // ======================================================
      // generate-daily can return HTTP 200 while an individual
      // generated game contains an analysis error.
      //
      // Detect that too.
      // ======================================================

      const failedResult =
        Array.isArray(
          reanalysisBody?.results
        )
          ? reanalysisBody.results
              .find(
                result =>
                  result?.ok !== true
              )
          : null;


      if (
        failedResult
      ) {

        throw new Error(
          failedResult?.error ||
          "Targeted NBA reanalysis failed"
        );
      }


      console.log(
        `[${WORKER_NAME}] NBA injury reanalysis complete: ${event.gameId}`
      );

    } catch (
      error
    ) {

      /*
       * CRITICAL:
       *
       * Snapshot already succeeded.
       * Reanalysis failure must NEVER propagate back into
       * Owls / Market Intelligence / splits / Learning.
       */
      console.error(
        `[nba-injury-watch] reanalysis failed ${event.gameId}: ${error?.message || error}`
      );
    }


  } catch (
    error
  ) {

    console.error(
      `[nba-injury-watch] snapshot sync failed: ${error?.message || error}`
    );
  }
}


// ============================================================
// NBA LIVE WATCHERS — SAFE INITIALIZATION
//
// Absolutely isolated from Market Intelligence.
// ============================================================

function initializeNBAWatchersSafe() {

  try {

    const createInjuryWatcher =
      nbaInjuryWatcherModule
        ?.createNBAInjuryWatcher;


    const createMarketWatcher =
      nbaMarketSignalWatcherModule
        ?.createNBAMarketSignalWatcher;


    if (
      typeof createInjuryWatcher !==
        "function" ||
      typeof createMarketWatcher !==
        "function"
    ) {

      console.log(
        `[${WORKER_NAME}] NBA live watchers disabled`
      );

      return;
    }


nbaInjuryWatcher =
  createInjuryWatcher({

    balldontlieApiKey:
      BALLDONTLIE_API_KEY,


    getGameStartMs:
      game =>
        parseCashEdgeGameTime(
          game?.game_time
        ),


    // ========================================================
    // GOOD BDL SNAPSHOT
    //
    // Baseline or structural change only.
    // Completely non-blocking for Market Intelligence.
    // ========================================================

    onSnapshot:
      event => {

        return syncNBAInjurySnapshotSafe(
          event
        );
      },


    // ========================================================
    // STRUCTURAL INJURY CHANGE
    //
    // For now this logs detection.
    // Automatic model recalculation comes next.
    // ========================================================

    onChange:
      event => {

        console.log(
          `[${WORKER_NAME}] NBA STRUCTURAL INJURY CHANGE: ${event.gameId} | ${event.changedProviders.join(", ")}`
        );
      }
  });


    nbaMarketSignalWatcher =
      createMarketWatcher({

        allowedBooks:
          BOOKS,

        /*
         * Reuse CashEdge's EXISTING exact game matcher.
         *
         * No duplicate team matching.
         * No guessed game IDs.
         */
        resolveGame:
          ({
            event
          }) =>
            resolveLearningMarketGame({
              sport:
                "nba",

              event
            }),

        /*
         * First market state for every tracked NBA game
         * creates an injury baseline independently.
         */
        onBaseline:
          ({
            game
          }) => {

            if (
              !nbaInjuryWatcher ||
              typeof nbaInjuryWatcher
                .ensureBaseline !==
                "function"
            ) {
              return;
            }


            return nbaInjuryWatcher
              .ensureBaseline(
                game
              );
          },

        /*
         * ANY real spread / total / price change
         * starts or extends the injury verification window.
         */
        onSignal:
          ({
            game
          }) => {

            if (
              !nbaInjuryWatcher ||
              typeof nbaInjuryWatcher
                .trigger !==
                "function"
            ) {
              return;
            }


            nbaInjuryWatcher
              .trigger(
                game
              );
          }
      });


    console.log(
      `[${WORKER_NAME}] NBA live watchers ready`
    );

  } catch (
    error
  ) {

    /*
     * CRITICAL:
     * initialization failure is NON-FATAL.
     */
    console.error(
      `[${WORKER_NAME}] NBA live watchers unavailable: ${error?.message || error}`
    );


    nbaInjuryWatcher =
      null;

    nbaMarketSignalWatcher =
      null;
  }
}


// ============================================================
// NBA MARKET WATCH — SAFE DISPATCH
//
// Market Intelligence NEVER awaits this.
// ============================================================

function queueNBAMarketSignalWatchSafe(
  data
) {

  try {

    if (
      !nbaMarketSignalWatcher ||
      typeof nbaMarketSignalWatcher
        .processBoard !==
        "function"
    ) {
      return;
    }


    setImmediate(
      () => {

        try {

          Promise
            .resolve(
              nbaMarketSignalWatcher
                .processBoard(
                  data
                )
            )
            .catch(
              error => {

                console.error(
                  `[nba-market-watch] dispatch failed: ${error?.message || error}`
                );
              }
            );

        } catch (
          error
        ) {

          console.error(
            `[nba-market-watch] dispatch failed: ${error?.message || error}`
          );
        }
      }
    );

  } catch (
    error
  ) {

    /*
     * Nothing from this feature is allowed
     * to escape into production.
     */
    console.error(
      `[nba-market-watch] queue failed: ${error?.message || error}`
    );
  }
}

// ============================================================
// LEARNING — FULL MARKET BOARD
//
// CRITICAL:
// Market Intelligence never waits for this.
//
// queueOddsUpdate() remains completely independent.
//
// setImmediate() gives the production Market Intelligence
// path priority before Learning starts processing the board.
// ============================================================

function queueLearningMarketBoardSafe(
  data
) {

  try {

    if (
      !learningCapture ||
      !learningMarketFeed ||
      typeof learningMarketFeed
        .queueMarketBoardSafe !==
        "function"
    ) {
      return;
    }


    const status =
      learningCapture
        .getStatus?.();


    if (
      status?.active !== true
    ) {
      return;
    }


    setImmediate(
      () => {

        try {

          learningMarketFeed
            .queueMarketBoardSafe({
              data,

              learningCapture,

              resolveGame:
                resolveLearningMarketGame,

              normalizeSportsbookKey,

              normalizeSelectionKey:
                normalizeText,

              allowedSports:
                SPORTS,

              allowedBooks:
                BOOKS
            });

        } catch (error) {

          console.error(
            `[learning-market-feed] dispatch failed: ${error?.message || error}`
          );
        }
      }
    );

  } catch (error) {

    console.error(
      `[learning-market-feed] queue failed: ${error?.message || error}`
    );
  }
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

  if (
    owlsCurrentBoardRefreshRunning
  ) {
    return;
  }


  owlsCurrentBoardRefreshRunning =
    true;


  try {

    const trackedGames =
      getAllTrackedGames();

  // ==========================================================
  // PRODUCTION SPORTS
  //
  // Keep current Market Intelligence behavior:
  // Premium sports continue REST revalidation every minute.
  // ==========================================================

  const productionSports =
    new Set(
      trackedGames
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
    );
  // ==========================================================
  // NBA LIVE WATCHER SPORTS
  //
  // If the isolated NBA market watcher is available and
  // CashEdge has at least one tracked NBA game, keep ONE
  // NBA REST board refresh active.
  //
  // IMPORTANT:
  // - does NOT make non-Premium games enter Market Intelligence
  // - does NOT change quote ingestion
  // - does NOT change Premium logic
  // - only gives the side-car a reliable baseline
  // ==========================================================

  const nbaWatcherSports =
    new Set(
      nbaMarketSignalWatcher &&
      typeof nbaMarketSignalWatcher
        .processBoard ===
        "function" &&
      trackedGames.some(
        game =>
          String(
            game?.sport || ""
          )
            .trim()
            .toLowerCase() ===
          "nba"
      )
        ? ["nba"]
        : []
    );

  // ==========================================================
  // LEARNING BASELINE SPORTS
  //
  // WebSocket captures live changes.
  //
  // REST exists here only so a market that NEVER changes
  // still receives one observable baseline.
  //
  // Non-Premium sports are checked only every 30 minutes.
  // ==========================================================

  const learningReady =
    Boolean(
      learningCapture
        ?.getStatus?.()
        ?.active === true &&
      learningMarketFeed &&
      typeof learningMarketFeed
        .queueMarketBoardSafe ===
        "function"
    );


  const now =
    Date.now();


  const learningDueSports =
    new Set();


  if (
    learningReady
  ) {

    for (
      const game
      of trackedGames
    ) {

      const sport =
        String(
          game?.sport || ""
        )
          .trim()
          .toLowerCase();


      if (
        !SPORTS.includes(
          sport
        )
      ) {
        continue;
      }


      const lastBaselineAt =
        Number(
          learningMarketBaselineAt
            .get(
              sport
            ) ||
          0
        );


      if (
        !lastBaselineAt ||
        (
          now -
          lastBaselineAt
        ) >=
        LEARNING_MARKET_BASELINE_INTERVAL_MS
      ) {

        learningDueSports.add(
          sport
        );
      }
    }
  }


  // ==========================================================
  // ONE REST REQUEST PER SPORT
  //
  // If Production and Learning both need the sport,
  // they share the exact same OWLS request.
  // ==========================================================

  const activeSports =
  Array.from(
    new Set([
      ...productionSports,
      ...learningDueSports,
      ...nbaWatcherSports
    ])
  );

  if (
    !activeSports.length
  ) {
    return;
  }


  const sports =
    {};


  const successfulSports =
    new Set();


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


      successfulSports.add(
        sport
      );


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


  // ==========================================================
  // REMEMBER SUCCESSFUL LEARNING BASELINE CHECKS
  //
  // Failed sports are NOT marked, so they can retry next minute.
  // ==========================================================

  for (
    const sport
    of learningDueSports
  ) {

    if (
      successfulSports.has(
        sport
      )
    ) {

      learningMarketBaselineAt
        .set(
          sport,
          now
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


  const payload = {
    sports,

    timestamp:
      new Date()
        .toISOString(),

    last_odds_change:
      null
  };


  // ==========================================================
  // PRODUCTION
  //
  // Existing logic still filters to Premium games internally.
  // ==========================================================

  queueOddsUpdate(
    payload
  );


  // ==========================================================
  // LEARNING
  //
  // The capture layer writes the first unseen state,
  // then writes only real line/price changes.
  // ==========================================================

  queueLearningMarketBoardSafe(
    payload
  );
    /*
 * NBA side-car LAST.
 *
 * Production and Learning already received
 * the board first.
 */
queueNBAMarketSignalWatchSafe(
  payload
);

  } finally {

    owlsCurrentBoardRefreshRunning =
      false;
  }
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
 * Learning game registry.
 *
 * Reuse the tracked-games response already downloaded.
 * No additional Vercel request.
 * Direct Railway -> Supabase write.
 */
try {

  learningGameRegistry
    ?.queueGamesSafe?.(
      body.games
    );

} catch (error) {

  console.error(
    `[learning-game-registry] dispatch failed: ${error?.message || error}`
  );
}

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
// ============================================================
// LEARNING — SPLIT GAME MATCH
//
// Splits do not provide kickoff time.
//
// Therefore:
// - date comes from OWLS event_id
// - teams + date must map to exactly ONE CashEdge game
// - doubleheaders are never guessed
// ============================================================

function resolveLearningSplitGame({
  sport,
  event,
  eventDate
}) {

  if (
    !sport ||
    !eventDate ||
    !event?.away_team ||
    !event?.home_team
  ) {
    return null;
  }


  const gameKey =
    makeGameKey({
      sport,

      awayTeam:
        event.away_team,

      homeTeam:
        event.home_team,

      gameDate:
        eventDate
    });


  const candidates =
    trackedGameMap.get(
      gameKey
    ) ||
    [];


  /*
   * No kickoff time exists in Splits.
   *
   * Exactly one candidate is required.
   * Never guess between doubleheaders.
   */
  if (
    candidates.length !== 1
  ) {
    return null;
  }


 const tracked =
  candidates[0];


const gameTimeMs =
  parseCashEdgeGameTime(
    tracked?.game_time
  );


/*
 * LEARNING IS STRICTLY PRE-GAME.
 *
 * If kickoff time is missing, invalid,
 * or the game already started,
 * never capture the split.
 */
if (
  !Number.isFinite(
    gameTimeMs
  ) ||
  gameTimeMs <=
    Date.now()
) {
  return null;
}


return tracked;
}
const learningSplitRunningSports =
  new Set();


function queueLearningSplitBoardSafe({
  sport,
  events
}) {

  try {

    if (
      !learningCapture ||
      !learningSplitFeed ||
      typeof learningSplitFeed
        .captureSplitBoardSafe !==
        "function"
    ) {
      return;
    }


    const status =
      learningCapture
        .getStatus?.();


    if (
      status?.active !== true
    ) {
      return;
    }


    /*
     * Never allow overlapping Learning split captures
     * for the same sport.
     */
    if (
      learningSplitRunningSports.has(
        sport
      )
    ) {
      return;
    }


    learningSplitRunningSports.add(
      sport
    );


    setImmediate(
      () => {

        void learningSplitFeed
          .captureSplitBoardSafe({
            sport,
            events,

            learningCapture,

            resolveGame:
              resolveLearningSplitGame,

            normalizeSelectionKey:
              normalizeText
          })
          .catch(
            error => {

              console.error(
                `[learning-split-feed] dispatch failed (${sport}): ${error?.message || error}`
              );
            }
          )
          .finally(
            () => {

              learningSplitRunningSports.delete(
                sport
              );
            }
          );
      }
    );

  } catch (error) {

    learningSplitRunningSports.delete(
      sport
    );

    console.error(
      `[learning-split-feed] queue failed (${sport}): ${error?.message || error}`
    );
  }
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

  const learningSplitsActive =
  Boolean(
    learningCapture
      ?.getStatus?.()
      ?.active === true &&
    learningSplitFeed &&
    typeof learningSplitFeed
      .captureSplitBoardSafe ===
      "function"
  );


const activeSports =
  [
    ...new Set(
      getAllTrackedGames()
        .filter(
          game =>
            (
              learningSplitsActive ||
              game.current_is_premium ===
                true
            )
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
        queueLearningSplitBoardSafe({
  sport,
  events
});
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
if (
  owlsConnectionRetryTimer
) {

  clearTimeout(
    owlsConnectionRetryTimer
  );

  owlsConnectionRetryTimer =
    null;
}

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


    /*
     * Production Market Intelligence FIRST.
     */
    queueOddsUpdate(
      data
    );


    /*
     * Learning runs independently after production
     * has received the same OWLS board.
     */
    queueLearningMarketBoardSafe(
      data
    );
    /*
 * NBA side-car LAST.
 *
 * Never awaited.
 * Never blocks Owls.
 */
queueNBAMarketSignalWatchSafe(
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


    /*
     * Railway may briefly overlap old + new containers
     * during a deploy.
     *
     * OWLS allows only one WebSocket connection, so the
     * new container can be rejected while the old one
     * is still shutting down.
     *
     * Explicitly retry without affecting REST ingestion,
     * splits, Learning, or Market Intelligence processing.
     */
    if (
      owlsConnectionRetryTimer
    ) {
      return;
    }


    const failedSocket =
      socket;


    owlsConnectionRetryTimer =
      setTimeout(
        () => {

          owlsConnectionRetryTimer =
            null;


          if (
            socket !== failedSocket ||
            !failedSocket ||
            failedSocket.connected === true
          ) {
            return;
          }


          console.log(
            `[${WORKER_NAME}] retrying Owls connection`
          );


          try {

            failedSocket.connect();

          } catch (retryError) {

            console.error(
              `[${WORKER_NAME}] Owls retry error: ${retryError.message}`
            );
          }

        },
        10000
      );


    owlsConnectionRetryTimer.unref?.();
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
 * No network calls here.
 * Only creates the isolated watcher objects.
 */
initializeNBAWatchersSafe();

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
/*
 * Start live Owls feed FIRST.
 *
 * Learning / REST baseline must never delay
 * the production WebSocket.
 */
connectOwls();

startOwlsWatchdog();


/*
 * REST revalidation + Learning baseline
 * run independently after live production
 * is already connected.
 */
void refreshOwlsCurrentBoard()
  .catch(
    error => {

      console.error(
        `[${WORKER_NAME}] initial Owls board revalidation error: ${error.message}`
      );
    }
  );

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
  /*
 * Learning results:
 * check once per hour between
 * 6 AM and 12 PM Central.
 *
 * The scheduler itself wakes every minute
 * only to check the clock.
 * External result APIs are called at most
 * once per hour and stop once complete.
 */
void syncLearningResultsIfDueSafe();

learningResultsTimer =
  setInterval(
    () => {
      void syncLearningResultsIfDueSafe();
    },
    60 * 1000
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
  owlsConnectionRetryTimer
) {

  clearTimeout(
    owlsConnectionRetryTimer
  );

  owlsConnectionRetryTimer =
    null;
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
  if (
  learningResultsTimer
) {

  clearInterval(
    learningResultsTimer
  );
}
  try {

  nbaMarketSignalWatcher
    ?.shutdown?.();

} catch (error) {

  console.error(
    `[nba-market-watch] shutdown skipped: ${error?.message || error}`
  );
}


try {

  nbaInjuryWatcher
    ?.shutdown?.();

} catch (error) {

  console.error(
    `[nba-injury-watch] shutdown skipped: ${error?.message || error}`
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

"use strict";

// ============================================================
// NBA INJURY WATCHER
//
// COMPLETELY NON-CRITICAL SIDE-CAR.
//
// Provider failure must NEVER affect:
// - Owls
// - Market Intelligence
// - quote ingestion
// - splits
// - Learning
//
// Market trigger:
//   +10 seconds
//   then 5 additional checks
//   one per minute.
//
// Only ONE active window per game.
// ============================================================

const FIRST_CHECK_DELAY_MS =
  10 * 1000;

const CHECK_INTERVAL_MS =
  60 * 1000;

const FOLLOW_UP_CHECKS =
  5;

const WINDOW_LENGTH_MS =
  FIRST_CHECK_DELAY_MS +
  (
    FOLLOW_UP_CHECKS *
    CHECK_INTERVAL_MS
  );

const REQUEST_TIMEOUT_MS =
  10 * 1000;

const BDL_TEAM_CACHE_MS =
  24 * 60 * 60 * 1000;

const MAX_CONCURRENT_GAME_CHECKS =
  2;


// ============================================================
// HELPERS
// ============================================================

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function normalizeStatus(value) {
  const status =
    cleanText(value);


  if (
    status.includes("out")
  ) {
    return "out";
  }


  if (
    status.includes("doubt")
  ) {
    return "doubtful";
  }


  if (
    status.includes("question")
  ) {
    return "questionable";
  }


  if (
    status.includes("day-to-day") ||
    status.includes("day to day")
  ) {
    return "day-to-day";
  }


  if (
    status.includes("probable")
  ) {
    return "probable";
  }


  if (
    status.includes("available") ||
    status.includes("active")
  ) {
    return "available";
  }


  return status ||
    "unknown";
}


async function fetchJsonStrict(
  url,
  options = {}
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal
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
        `HTTP ${response.status}`
      );
    }


    return body;

  } finally {

    clearTimeout(
      timer
    );
  }
}


function normalizeProviderRows(
  rows
) {

  return (
    Array.isArray(
      rows
    )
      ? rows
      : []
  )
    .map(
      row => ({

        playerId:
          row?.playerId != null
            ? String(
                row.playerId
              )
            : null,


        playerName:
          String(
            row?.playerName ||
            ""
          )
            .trim() ||
          null,


        teamId:
          row?.teamId != null
            ? String(
                row.teamId
              )
            : null,


        status:
          normalizeStatus(
            row?.status
          ),


        returnDate:
          row?.returnDate ||
          null,


        description:
          String(
            row?.description ||
            ""
          )
            .trim() ||
          null
      })
    )
    .filter(
      row =>
        Boolean(
          row.playerId
        )
    )
    .sort(
      (
        a,
        b
      ) => {

        const aKey =
          `${a.teamId || ""}|${a.playerId}|${a.status}|${a.returnDate || ""}`;


        const bKey =
          `${b.teamId || ""}|${b.playerId}|${b.status}|${b.returnDate || ""}`;


        return aKey
          .localeCompare(
            bKey
          );
      }
    );
}


function fingerprintRows(
  rows
) {

  const normalized =
    normalizeProviderRows(
      rows
    );


  return JSON.stringify(

    normalized.map(
      row => ({

        playerId:
          row.playerId,

        teamId:
          row.teamId,

        status:
          row.status,

        returnDate:
          row.returnDate
      })
    )
  );
}


// ============================================================
// FACTORY
// ============================================================

function createNBAInjuryWatcher({

  balldontlieApiKey,

  getGameStartMs,

  onSnapshot,

  onChange,

  logger = console

} = {}) {


  let stopped =
    false;


  let bdlTeamsCache = {

    expiresAt:
      0,

    teams:
      new Map()
  };


  let bdlTeamsPromise =
    null;


  const gameStates =
    new Map();


  const baselineInFlight =
    new Set();


  const activeWindows =
    new Map();


  const providerErrorSignatures =
    new Map();


  // ==========================================================
  // SMALL INTERNAL CONCURRENCY QUEUE
  //
  // Even if several NBA games move together,
  // do not hammer BALLDONTLIE all at once.
  // ==========================================================

  const checkQueue =
    [];


  let activeChecks =
    0;


  function drainQueue() {

    while (

      !stopped &&

      activeChecks <
        MAX_CONCURRENT_GAME_CHECKS &&

      checkQueue.length >
        0
    ) {

      const task =
        checkQueue.shift();


      activeChecks +=
        1;


      Promise
        .resolve()
        .then(
          () =>
            checkGameInternal(
              task.game
            )
        )
        .catch(
          error => {

            logger.error(
              `[nba-injury-watch] check failed: ${error?.message || error}`
            );
          }
        )
        .finally(
          () => {

            activeChecks -=
              1;


            task.resolve();


            drainQueue();
          }
        );
    }
  }


  function queueCheck(
    game
  ) {

    if (
      stopped
    ) {
      return Promise.resolve();
    }


    return new Promise(
      resolve => {

        checkQueue.push({

          game,

          resolve
        });


        drainQueue();
      }
    );
  }


  function logProviderErrorOnce(
    gameId,
    provider,
    message
  ) {

    const key =
      `${gameId}|${provider}`;


    const signature =
      String(
        message ||
        "unknown error"
      );


    if (
      providerErrorSignatures
        .get(
          key
        ) ===
      signature
    ) {

      return;
    }


    providerErrorSignatures
      .set(
        key,
        signature
      );


    logger.error(
      `[nba-injury-watch] ${provider} unavailable ${gameId}: ${signature}`
    );
  }


  function clearProviderError(
    gameId,
    provider
  ) {

    providerErrorSignatures
      .delete(
        `${gameId}|${provider}`
      );
  }


  function fireChangeSafe(
    payload
  ) {

    if (
      typeof onChange !==
      "function"
    ) {

      return;
    }


    setImmediate(
      () => {

        try {

          Promise
            .resolve(
              onChange(
                payload
              )
            )
            .catch(
              error => {

                logger.error(
                  `[nba-injury-watch] onChange failed: ${error?.message || error}`
                );
              }
            );

        } catch (
          error
        ) {

          logger.error(
            `[nba-injury-watch] onChange failed: ${error?.message || error}`
          );
        }
      }
    );
  }


  function fireSnapshotSafe(
    payload
  ) {

    if (
      typeof onSnapshot !==
      "function"
    ) {

      return;
    }


    setImmediate(
      () => {

        try {

          Promise
            .resolve(
              onSnapshot(
                payload
              )
            )
            .catch(
              error => {

                logger.error(
                  `[nba-injury-watch] onSnapshot failed: ${error?.message || error}`
                );
              }
            );

        } catch (
          error
        ) {

          logger.error(
            `[nba-injury-watch] onSnapshot failed: ${error?.message || error}`
          );
        }
      }
    );
  }


  // ==========================================================
  // BALLDONTLIE
  // ==========================================================

  async function getBDLTeamMap() {

    if (

      bdlTeamsCache
        .teams
        .size >
      0 &&

      Date.now() <
        bdlTeamsCache
          .expiresAt
    ) {

      return bdlTeamsCache
        .teams;
    }


    if (
      bdlTeamsPromise
    ) {

      return bdlTeamsPromise;
    }


    if (
      !balldontlieApiKey
    ) {

      throw new Error(
        "BALLDONTLIE_API_KEY not configured"
      );
    }


    bdlTeamsPromise =
      (async () => {

        const body =
          await fetchJsonStrict(

            "https://api.balldontlie.io/v1/teams",

            {

              headers: {

                Authorization:
                  balldontlieApiKey
              }
            }
          );


        const teams =
          new Map();


        for (
          const team
          of body?.data ||
          []
        ) {

          const name =
            cleanText(
              team?.full_name
            );


          const id =
            Number(
              team?.id
            );


          if (
            name &&
            Number.isFinite(
              id
            )
          ) {

            teams.set(
              name,
              id
            );
          }
        }


        bdlTeamsCache = {

          teams,

          expiresAt:
            Date.now() +
            BDL_TEAM_CACHE_MS
        };


        return teams;
      })();


    try {

      return await bdlTeamsPromise;

    } finally {

      bdlTeamsPromise =
        null;
    }
  }


  async function fetchBDLGameInjuries(
    game
  ) {

    const teams =
      await getBDLTeamMap();


    const awayId =
      teams.get(
        cleanText(
          game?.away_team
        )
      );


    const homeId =
      teams.get(
        cleanText(
          game?.home_team
        )
      );


    if (
      !awayId ||
      !homeId
    ) {

      throw new Error(
        `team mapping failed: ${game?.away_team} @ ${game?.home_team}`
      );
    }


    const url =
      new URL(
        "https://api.balldontlie.io/v1/player_injuries"
      );


    url.searchParams.append(
      "team_ids[]",
      String(
        awayId
      )
    );


    url.searchParams.append(
      "team_ids[]",
      String(
        homeId
      )
    );


    url.searchParams.set(
      "per_page",
      "100"
    );


    const body =
      await fetchJsonStrict(

        url.toString(),

        {

          headers: {

            Authorization:
              balldontlieApiKey
          }
        }
      );


    const rows =
      (
        body?.data ||
        []
      )
        .map(
          item => {

            const player =
              item?.player ||
              {};


            return {

              playerId:
                player?.id,


              playerName:
                [
                  player?.first_name,
                  player?.last_name
                ]
                  .filter(
                    Boolean
                  )
                  .join(
                    " "
                  )
                  .trim() ||
                null,


              teamId:
                player?.team_id ??
                player?.team?.id ??
                null,


              status:
                item?.status,


              returnDate:
                item?.return_date ||
                null,


              description:
                item?.description ||
                null
            };
          }
        )
        .filter(
          row =>

            String(
              row?.teamId ||
              ""
            ) ===
              String(
                awayId
              ) ||

            String(
              row?.teamId ||
              ""
            ) ===
              String(
                homeId
              )
        );


    return {

      ok:
        true,


      awayTeamId:
        awayId,


      homeTeamId:
        homeId,


      rows
    };
  }


  // ==========================================================
  // ONE COMPLETE CHECK — BALLDONTLIE ONLY
  // ==========================================================

  async function checkGameInternal(
    game
  ) {

    if (
      stopped
    ) {

      return;
    }


    const gameId =
      String(
        game
          ?.cashedge_game_id ||
        ""
      );


    if (
      !gameId
    ) {

      return;
    }


    const gameStartMs =

      typeof getGameStartMs ===
        "function"

        ? getGameStartMs(
            game
          )

        : Date.parse(
            game?.game_time
          );


    if (

      !Number.isFinite(
        gameStartMs
      ) ||

      gameStartMs <=
        Date.now()
    ) {

      activeWindows.delete(
        gameId
      );


      return;
    }


    const bdl =

      await fetchBDLGameInjuries(
        game
      )

        .catch(
          error => ({

            ok:
              false,

            error:
              error?.message ||
              String(
                error
              )
          })
        );


    // ========================================================
    // BDL FAILURE
    //
    // A provider failure NEVER becomes "0 injuries".
    // Keep the last known good state intact.
    // ========================================================

    if (
      bdl?.ok !==
      true
    ) {

      logProviderErrorOnce(

        gameId,

        "balldontlie",

        bdl?.error
      );


      return;
    }


    clearProviderError(

      gameId,

      "balldontlie"
    );


    const state =

      gameStates.get(
        gameId
      ) ||

      {

        fingerprints:
          {},

        snapshots:
          {}
      };


    const normalized =
      normalizeProviderRows(
        bdl.rows
      );


    const fingerprint =
      fingerprintRows(
        normalized
      );


    const previousFingerprint =

      state
        ?.fingerprints
        ?.balldontlie;


    const isBaseline =

      typeof previousFingerprint !==
      "string";


    const changed =

      !isBaseline &&

      previousFingerprint !==
        fingerprint;


    const nowIso =
      new Date()
        .toISOString();


    // ========================================================
    // LAST KNOWN GOOD IN-MEMORY STATE
    // ========================================================

    state
      .fingerprints
      .balldontlie =
      fingerprint;


    state
      .snapshots
      .balldontlie =
      normalized;


    state.awayTeamId =
      bdl.awayTeamId;


    state.homeTeamId =
      bdl.homeTeamId;


    state.updatedAt =
      nowIso;


    gameStates.set(
      gameId,
      state
    );


    // ========================================================
    // PERSIST
    //
    // Only baseline or REAL structural change reaches Vercel.
    //
    // Identical repeated checks stay inside Railway.
    // ========================================================

    if (
      isBaseline ||
      changed
    ) {

      fireSnapshotSafe({

        gameId,

        game,


        awayTeamId:
          bdl.awayTeamId,


        homeTeamId:
          bdl.homeTeamId,


        injuries:
          normalized,


        fingerprint,


        isBaseline,


        changed,


        checkedAt:
          nowIso
      });
    }


    // ========================================================
    // STRUCTURAL CHANGE
    // ========================================================

    if (
      changed
    ) {

      logger.log(
        `[nba-injury-watch] CHANGE ${gameId} | balldontlie`
      );


      fireChangeSafe({

        gameId,

        game,


        changedProviders:
          [
            "balldontlie"
          ],


        fingerprints:
          state.fingerprints,


        snapshots:
          state.snapshots,


        detectedAt:
          nowIso
      });
    }
  }


  // ==========================================================
  // BASELINE
  // ==========================================================

  async function ensureBaseline(
    game
  ) {

    try {

      if (

        stopped ||

        cleanText(
          game?.sport
        ) !==
          "nba"
      ) {

        return;
      }


      const gameId =
        String(
          game
            ?.cashedge_game_id ||
          ""
        );


      if (

        !gameId ||

        baselineInFlight.has(
          gameId
        )
      ) {

        return;
      }


      const existing =
        gameStates.get(
          gameId
        );


      if (

        existing &&

        typeof existing
          ?.fingerprints
          ?.balldontlie ===
          "string"
      ) {

        return;
      }


      baselineInFlight.add(
        gameId
      );


      try {

        await queueCheck(
          game
        );


        const baselineState =
          gameStates.get(
            gameId
          );


        if (

          typeof baselineState
            ?.fingerprints
            ?.balldontlie ===
          "string"
        ) {

          logger.log(
            `[nba-injury-watch] baseline ready ${gameId}`
          );

        } else {

          logger.log(
            `[nba-injury-watch] baseline unavailable ${gameId}`
          );
        }


      } finally {

        baselineInFlight.delete(
          gameId
        );
      }


    } catch (
      error
    ) {

      logger.error(
        `[nba-injury-watch] baseline failed: ${error?.message || error}`
      );
    }
  }




  // ==========================================================
  // MARKET-TRIGGERED WINDOW
  // ==========================================================

  function closeWindow(
    gameId,
    window
  ) {

    if (
      window?.timer
    ) {
      clearTimeout(
        window.timer
      );

      window.timer =
        null;
    }


    if (
      activeWindows.get(
        gameId
      ) ===
      window
    ) {

      activeWindows.delete(
        gameId
      );
    }
  }


  function scheduleWindow(
    window
  ) {

    if (
      stopped
    ) {
      return;
    }


    const delay =
      Math.max(
        0,
        window.nextCheckAt -
          Date.now()
      );


    window.timer =
      setTimeout(
        () => {

          void runWindowCheck(
            window
          );

        },
        delay
      );
  }


  async function runWindowCheck(
    window
  ) {

    try {

      if (
        stopped
      ) {
        return;
      }


      const current =
        activeWindows.get(
          window.gameId
        );


      if (
        current !==
        window
      ) {
        return;
      }


      const gameStartMs =
        typeof getGameStartMs ===
          "function"
          ? getGameStartMs(
              window.game
            )
          : Date.parse(
              window.game
                ?.game_time
            );


      if (
        !Number.isFinite(
          gameStartMs
        ) ||
        Date.now() >=
          gameStartMs
      ) {

        closeWindow(
          window.gameId,
          window
        );

        return;
      }


      if (
        Date.now() >
          window.deadlineAt +
            5000
      ) {

        closeWindow(
          window.gameId,
          window
        );

        return;
      }


      await queueCheck(
        window.game
      );


      window.nextCheckAt +=
        CHECK_INTERVAL_MS;


      if (
        window.nextCheckAt >
          window.deadlineAt
      ) {

        closeWindow(
          window.gameId,
          window
        );


        logger.log(
          `[nba-injury-watch] window closed ${window.gameId}`
        );


        return;
      }


      scheduleWindow(
        window
      );

    } catch (
      error
    ) {

      /*
       * Even a bug inside a window is contained.
       */
      logger.error(
        `[nba-injury-watch] window check failed: ${error?.message || error}`
      );


      if (
        activeWindows.get(
          window.gameId
        ) ===
        window
      ) {

        window.nextCheckAt +=
          CHECK_INTERVAL_MS;


        if (
          window.nextCheckAt <=
            window.deadlineAt
        ) {

          scheduleWindow(
            window
          );

        } else {

          closeWindow(
            window.gameId,
            window
          );
        }
      }
    }
  }


  function trigger(
    game
  ) {

    try {

      if (
        stopped ||
        cleanText(
          game?.sport
        ) !== "nba"
      ) {
        return;
      }


      const gameId =
        String(
          game
            ?.cashedge_game_id ||
          ""
        );


      const gameStartMs =
        typeof getGameStartMs ===
          "function"
          ? getGameStartMs(
              game
            )
          : Date.parse(
              game?.game_time
            );


      if (
        !gameId ||
        !Number.isFinite(
          gameStartMs
        ) ||
        gameStartMs <=
          Date.now()
      ) {
        return;
      }


      /*
       * If market moved before we managed to create
       * a baseline, grab one NOW.
       *
       * Then the +10 second check has something
       * to compare against.
       */
      void ensureBaseline(
        game
      );


      const now =
        Date.now();


      const requestedDeadline =
        Math.min(
          gameStartMs,
          now +
          WINDOW_LENGTH_MS
        );


      const existing =
        activeWindows.get(
          gameId
        );


      if (
        existing
      ) {

        existing.game =
          game;


        existing.deadlineAt =
          Math.max(
            existing.deadlineAt,
            requestedDeadline
          );


        logger.log(
          `[nba-injury-watch] window extended ${gameId}`
        );


        return;
      }


      const window = {
        gameId,
        game,

        nextCheckAt:
          now +
          FIRST_CHECK_DELAY_MS,

        deadlineAt:
          requestedDeadline,

        timer:
          null
      };


      activeWindows.set(
        gameId,
        window
      );


      logger.log(
        `[nba-injury-watch] market trigger ${gameId} | first check in 10s`
      );


      scheduleWindow(
        window
      );

    } catch (
      error
    ) {

      logger.error(
        `[nba-injury-watch] trigger failed: ${error?.message || error}`
      );
    }
  }


  // ==========================================================
  // SHUTDOWN
  // ==========================================================

  function shutdown() {

    stopped =
      true;


    for (
      const window
      of activeWindows.values()
    ) {

      if (
        window?.timer
      ) {

        clearTimeout(
          window.timer
        );
      }
    }


    activeWindows.clear();
    baselineInFlight.clear();

    /*
     * Pending tasks become harmless.
     * No process.exit, ever.
     */
    while (
      checkQueue.length
    ) {

      const task =
        checkQueue.shift();

      try {
        task.resolve();
      } catch {}
    }
  }


  return {
    ensureBaseline,
    trigger,
    shutdown
  };
}


module.exports = {
  createNBAInjuryWatcher
};

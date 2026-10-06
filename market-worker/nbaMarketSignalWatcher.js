"use strict";

// ============================================================
// NBA MARKET SIGNAL WATCHER
//
// SIDE-CAR ONLY.
//
// Reads the SAME Owls board already received by Railway.
// It NEVER calls Vercel.
// It NEVER writes Market Intelligence.
// It NEVER blocks production.
//
// Watches ALL tracked NBA games:
// - spreads
// - totals
// - moneyline prices
//
// First state = baseline.
// Real change = signal.
// ============================================================

function cleanText(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}


function finiteOrNull(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function normalizeOutcomes(
  outcomes
) {
  return (
    Array.isArray(
      outcomes
    )
      ? outcomes
      : []
  )
    .map(
      outcome => ({
        name:
          cleanText(
            outcome?.name
          ),

        point:
          finiteOrNull(
            outcome?.point
          ),

        price:
          finiteOrNull(
            outcome?.price
          )
      })
    )
    .filter(
      outcome =>
        Boolean(
          outcome.name
        )
    )
    .sort(
      (a, b) => {

        const aKey =
          `${a.name}|${a.point ?? "null"}|${a.price ?? "null"}`;

        const bKey =
          `${b.name}|${b.point ?? "null"}|${b.price ?? "null"}`;

        return aKey.localeCompare(
          bKey
        );
      }
    );
}


function normalizeMarkets(
  markets
) {
  const allowed =
    new Set([
      "h2h",
      "spreads",
      "totals"
    ]);

  return (
    Array.isArray(
      markets
    )
      ? markets
      : []
  )
    .filter(
      market =>
        allowed.has(
          cleanText(
            market?.key
          )
        )
    )
    .map(
      market => ({
        key:
          cleanText(
            market?.key
          ),

        outcomes:
          normalizeOutcomes(
            market?.outcomes
          )
      })
    )
    .filter(
      market =>
        market.outcomes.length > 0
    )
    .sort(
      (a, b) =>
        a.key.localeCompare(
          b.key
        )
    );
}


function fireSafe(
  callback,
  payload,
  logger,
  label
) {
  if (
    typeof callback !==
    "function"
  ) {
    return;
  }

  setImmediate(
    () => {

      try {

        Promise
          .resolve(
            callback(
              payload
            )
          )
          .catch(
            error => {

              logger.error(
                `[nba-market-watch] ${label} failed: ${error?.message || error}`
              );
            }
          );

      } catch (
        error
      ) {

        logger.error(
          `[nba-market-watch] ${label} failed: ${error?.message || error}`
        );
      }
    }
  );
}


function createNBAMarketSignalWatcher({
  resolveGame,
  allowedBooks = [],
  onBaseline,
  onSignal,
  logger = console
} = {}) {

  let stopped =
    false;

  const fingerprints =
    new Map();

  const allowedBookSet =
    new Set(
      (
        Array.isArray(
          allowedBooks
        )
          ? allowedBooks
          : []
      )
        .map(
          cleanText
        )
        .filter(Boolean)
    );


  function processBoard(
    data
  ) {

    if (
      stopped
    ) {
      return;
    }

    try {

      const events =
        Array.isArray(
          data?.sports?.nba
        )
          ? data.sports.nba
          : [];

      if (
        !events.length
      ) {
        return;
      }

      /*
       * REST current-board can contain the same event
       * once per sportsbook.
       *
       * Aggregate first, THEN compare fingerprints.
       */
      const gameBoards =
        new Map();


      for (
        const event
        of events
      ) {

        try {

          const commenceMs =
            Date.parse(
              event?.commence_time
            );

          if (
            !Number.isFinite(
              commenceMs
            ) ||
            commenceMs <=
              Date.now()
          ) {
            continue;
          }


          const game =
            typeof resolveGame ===
              "function"
              ? resolveGame({
                  event
                })
              : null;


          if (
            !game ||
            cleanText(
              game?.sport
            ) !== "nba"
          ) {
            continue;
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
            continue;
          }


          if (
            !gameBoards.has(
              gameId
            )
          ) {

            gameBoards.set(
              gameId,
              {
                gameId,
                game,
                books:
                  new Map()
              }
            );
          }


          const entry =
            gameBoards.get(
              gameId
            );


          const bookmakers =
            Array.isArray(
              event?.bookmakers
            )
              ? event.bookmakers
              : [];


          for (
            const bookmaker
            of bookmakers
          ) {

            const book =
              cleanText(
                bookmaker?.key
              );


            if (
              !book ||
              (
                allowedBookSet.size >
                  0 &&
                !allowedBookSet.has(
                  book
                )
              )
            ) {
              continue;
            }


            const markets =
              normalizeMarkets(
                bookmaker?.markets
              );


            if (
              !markets.length
            ) {
              continue;
            }


            entry.books.set(
              book,
              {
                book,
                markets
              }
            );
          }

        } catch (
          error
        ) {

          logger.error(
            `[nba-market-watch] event skipped: ${error?.message || error}`
          );
        }
      }


      for (
        const entry
        of gameBoards.values()
      ) {

        try {

          const snapshot =
            Array
              .from(
                entry.books.values()
              )
              .sort(
                (a, b) =>
                  a.book.localeCompare(
                    b.book
                  )
              );


          if (
            !snapshot.length
          ) {
            continue;
          }


          const fingerprint =
            JSON.stringify(
              snapshot
            );


          const previous =
            fingerprints.get(
              entry.gameId
            );


          /*
           * First sight of game:
           * market baseline only.
           *
           * Also gives Injury Watcher a chance
           * to create its independent baseline.
           */
          if (
            typeof previous ===
            "undefined"
          ) {

            fingerprints.set(
              entry.gameId,
              fingerprint
            );


            fireSafe(
              onBaseline,
              {
                gameId:
                  entry.gameId,

                game:
                  entry.game,

                snapshot,

                detectedAt:
                  new Date()
                    .toISOString()
              },
              logger,
              "baseline callback"
            );


            continue;
          }


          if (
            previous ===
            fingerprint
          ) {
            continue;
          }


          fingerprints.set(
            entry.gameId,
            fingerprint
          );


          fireSafe(
            onSignal,
            {
              gameId:
                entry.gameId,

              game:
                entry.game,

              previousFingerprint:
                previous,

              fingerprint,

              snapshot,

              detectedAt:
                new Date()
                  .toISOString()
            },
            logger,
            "signal callback"
          );

        } catch (
          error
        ) {

          logger.error(
            `[nba-market-watch] game skipped: ${error?.message || error}`
          );
        }
      }

    } catch (
      error
    ) {

      /*
       * Absolutely nothing escapes this module.
       */
      logger.error(
        `[nba-market-watch] board processing failed: ${error?.message || error}`
      );
    }
  }


  function shutdown() {

    stopped =
      true;

    fingerprints.clear();
  }


  return {
    processBoard,
    shutdown
  };
}


module.exports = {
  createNBAMarketSignalWatcher
};

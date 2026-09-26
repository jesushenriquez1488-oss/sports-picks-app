"use strict";

const crypto =
  require("crypto");

const PREFIX =
  "[learning-game-registry]";

const ENABLED =
  String(
    process.env.LEARNING_ENABLED ||
    ""
  ).toLowerCase() ===
  "true";

const URL =
  String(
    process.env.LEARNING_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(
      /\/+$/,
      ""
    );

const KEY =
  String(
    process.env.LEARNING_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();

const TIMEOUT_MS =
  5000;

const PAGE_SIZE =
  1000;

const WRITE_CHUNK_SIZE =
  500;


// ============================================================
// STATE
// ============================================================

const knownGames =
  new Map();

let hydrated =
  false;

let hydrationPromise =
  null;

let processing =
  false;

let queuedGames =
  null;

let warnedMissingConfig =
  false;


// ============================================================
// HELPERS
// ============================================================

function txt(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const output =
    String(value)
      .trim();


  return output || null;
}


function low(
  value
) {

  const output =
    txt(value);


  return output
    ? output.toLowerCase()
    : null;
}


function ts(
  value
) {

  if (!value) {
    return null;
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
      .test(
        raw
      );


  const normalized =
    hasTimezone
      ? raw
      : `${raw}Z`;


  const date =
    new Date(
      normalized
    );


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}


function dateOnly(
  value
) {

  const output =
    txt(value);


  if (
    !output ||
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        output
      )
  ) {
    return null;
  }


  return output;
}


function hash(
  ...parts
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      parts
        .map(
          value =>
            String(
              value ??
              "∅"
            )
        )
        .join("|")
    )
    .digest(
      "hex"
    );
}


function active() {

  if (!ENABLED) {
    return false;
  }


  if (
    URL &&
    KEY
  ) {
    return true;
  }


  if (
    !warnedMissingConfig
  ) {

    warnedMissingConfig =
      true;


    console.warn(
      `${PREFIX} disabled: missing Learning Supabase environment variables`
    );
  }


  return false;
}


// ============================================================
// SAFE HTTP
// ============================================================

async function request(
  path,
  options = {}
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );


  timer.unref?.();


  try {

    return await fetch(
      `${URL}/rest/v1/${path}`,
      {
        ...options,

        headers: {
          apikey:
            KEY,

          Authorization:
            `Bearer ${KEY}`,

          ...(options.headers || {})
        },

        signal:
          controller.signal
      }
    );

  } finally {

    clearTimeout(
      timer
    );
  }
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeGame(
  input = {}
) {

  const row = {

    cashedge_game_id:
      txt(
        input.cashedge_game_id
      ),

    sport:
      low(
        input.sport
      ),

    away_team:
      txt(
        input.away_team
      ),

    home_team:
      txt(
        input.home_team
      ),

    game_date:
      dateOnly(
        input.game_date
      ),

    game_time:
      ts(
        input.game_time
      )
  };


  if (
    !row.cashedge_game_id ||
    !row.sport ||
    !row.away_team ||
    !row.home_team ||
    !row.game_date ||
    !row.game_time
  ) {
    return null;
  }


  return row;
}


function gameSignature(
  row
) {

  return hash(
    row.sport,
    row.away_team,
    row.home_team,
    row.game_date,
    row.game_time
  );
}


// ============================================================
// HYDRATE EXISTING CURRENT RANGE
// ============================================================

async function hydrate(
  normalizedGames
) {

  if (
    hydrated
  ) {
    return true;
  }


  if (
    hydrationPromise
  ) {
    return hydrationPromise;
  }


  hydrationPromise =
    (async () => {

      try {

        const dates =
          normalizedGames
            .map(
              game =>
                game.game_date
            )
            .filter(
              Boolean
            )
            .sort();


        if (
          !dates.length
        ) {

          hydrated =
            true;

          return true;
        }


        const minDate =
          dates[0];

        const maxDate =
          dates[
            dates.length -
            1
          ];


        let start =
          0;


        while (true) {

          const end =
            start +
            PAGE_SIZE -
            1;


          const response =
            await request(
              `learning_games?select=cashedge_game_id,sport,away_team,home_team,game_date,game_time&game_date=gte.${encodeURIComponent(
                minDate
              )}&game_date=lte.${encodeURIComponent(
                maxDate
              )}&order=cashedge_game_id.asc`,
              {
                method:
                  "GET",

                headers: {
                  Range:
                    `${start}-${end}`,

                  "Range-Unit":
                    "items"
                }
              }
            );


          if (
            !response.ok
          ) {

            const detail =
              (
                await response
                  .text()
              ).slice(
                0,
                300
              );


            console.error(
              `${PREFIX} hydrate failed HTTP ${response.status}: ${detail}`
            );


            return false;
          }


          const rows =
            await response
              .json()
              .catch(
                () => null
              );


          if (
            !Array.isArray(
              rows
            )
          ) {

            console.error(
              `${PREFIX} hydrate failed: invalid response`
            );


            return false;
          }


          for (
            const existing
            of rows
          ) {

            const row =
              normalizeGame(
                existing
              );


            if (!row) {
              continue;
            }


            knownGames.set(
              row.cashedge_game_id,
              gameSignature(
                row
              )
            );
          }


          if (
            rows.length <
            PAGE_SIZE
          ) {
            break;
          }


          start +=
            PAGE_SIZE;
        }


        hydrated =
          true;


        return true;

      } catch (error) {

        console.error(
          `${PREFIX} hydrate failed: ${error?.message || error}`
        );


        return false;
      }
    })();


  try {

    return await hydrationPromise;

  } finally {

    if (
      hydrated !==
      true
    ) {
      hydrationPromise =
        null;
    }
  }
}


// ============================================================
// UPSERT
// ============================================================

async function upsertRows(
  rows
) {

  if (
    !rows.length
  ) {
    return true;
  }


  try {

    const response =
      await request(
        "learning_games?on_conflict=cashedge_game_id",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Prefer:
              "resolution=merge-duplicates,return=minimal"
          },

          body:
            JSON.stringify(
              rows
            )
        }
      );


    if (
      response.ok
    ) {
      return true;
    }


    const detail =
      (
        await response
          .text()
      ).slice(
        0,
        300
      );


    console.error(
      `${PREFIX} write failed HTTP ${response.status}: ${detail}`
    );


    return false;

  } catch (error) {

    console.error(
      `${PREFIX} write failed: ${error?.message || error}`
    );


    return false;
  }
}


// ============================================================
// SYNC
// ============================================================

async function syncGames(
  inputs
) {

  try {

    if (
      !active()
    ) {

      return {
        ok: true,
        written: 0,
        disabled: true
      };
    }


    const normalized =
      (
        Array.isArray(
          inputs
        )
          ? inputs
          : [inputs]
      )
        .map(
          normalizeGame
        )
        .filter(
          Boolean
        );


    if (
      !normalized.length
    ) {

      return {
        ok: true,
        checked: 0,
        written: 0
      };
    }


    const ready =
      await hydrate(
        normalized
      );


    if (
      !ready
    ) {

      return {
        ok: false,
        checked:
          normalized.length,
        written: 0
      };
    }


    const now =
      new Date()
        .toISOString();


    const changed =
      [];


    for (
      const row
      of normalized
    ) {

      const signature =
        gameSignature(
          row
        );


      const previous =
        knownGames.get(
          row.cashedge_game_id
        );


      if (
        previous ===
        signature
      ) {
        continue;
      }


      changed.push({
        ...row,

        last_seen_at:
          now,

        capture_version:
          1
      });
    }


    if (
      !changed.length
    ) {

      return {
        ok: true,
        checked:
          normalized.length,
        written: 0
      };
    }


    let written =
      0;


    for (
      let index = 0;
      index < changed.length;
      index +=
        WRITE_CHUNK_SIZE
    ) {

      const chunk =
        changed.slice(
          index,
          index +
            WRITE_CHUNK_SIZE
        );


      const ok =
        await upsertRows(
          chunk
        );


      if (!ok) {

        return {
          ok: false,
          checked:
            normalized.length,
          written
        };
      }


      for (
        const row
        of chunk
      ) {

        knownGames.set(
          row.cashedge_game_id,
          gameSignature(
            row
          )
        );
      }


      written +=
        chunk.length;
    }


    return {
      ok: true,
      checked:
        normalized.length,
      written
    };

  } catch (error) {

    console.error(
      `${PREFIX} sync failed: ${error?.message || error}`
    );


    return {
      ok: false,
      written: 0
    };
  }
}


// ============================================================
// NON-BLOCKING QUEUE
// ============================================================

function queueGamesSafe(
  games
) {

  try {

    if (
      !active()
    ) {
      return;
    }


    if (
      processing
    ) {

      /*
       * Keep only the newest tracked board.
       */
      queuedGames =
        games;

      return;
    }


    processing =
      true;


    setImmediate(
      async () => {

        try {

          let current =
            games;


          while (
            current
          ) {

            queuedGames =
              null;


            const result =
              await syncGames(
                current
              );


            if (
              result?.ok !==
              true
            ) {

              console.error(
                `${PREFIX} sync unsuccessful`
              );
            } else if (
              Number(
                result.written ||
                0
              ) > 0
            ) {

              console.log(
                `${PREFIX} checked: ${Number(
                  result.checked || 0
                )}, written: ${Number(
                  result.written || 0
                )}`
              );
            }


            current =
              queuedGames;
          }

        } catch (error) {

          console.error(
            `${PREFIX} queue failed: ${error?.message || error}`
          );

        } finally {

          processing =
            false;
        }
      }
    );

  } catch (error) {

    processing =
      false;


    console.error(
      `${PREFIX} queue failed: ${error?.message || error}`
    );
  }
}


// ============================================================
// STATUS
// ============================================================

function getStatus() {

  return {
    enabled:
      ENABLED,

    configured:
      Boolean(
        URL &&
        KEY
      ),

    active:
      ENABLED &&
      Boolean(
        URL &&
        KEY
      ),

    hydrated
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  queueGamesSafe,
  syncGames,
  getStatus
};

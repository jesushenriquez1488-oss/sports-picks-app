"use strict";

const crypto =
  require("crypto");

const learningEngine =
  require("./learningEngine");

const PREFIX =
  "[learning-pattern-registry]";

const ENABLED =
  String(
    process.env.LEARNING_ENABLED ||
    ""
  )
    .trim()
    .toLowerCase() ===
  "true";

const SUPABASE_URL =
  String(
    process.env.LEARNING_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(
      /\/+$/,
      ""
    );

const SERVICE_KEY =
  String(
    process.env
      .LEARNING_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  )
    .trim();

const TIMEOUT_MS =
  8000;

const ENGINE_VERSION =
  1;

let running =
  false;


// ============================================================
// PATTERN IDENTITY
// ============================================================

function stableConditions(
  conditions
) {

  return Array.isArray(
    conditions
  )
    ? [
        ...new Set(
          conditions
            .map(
              value =>
                String(
                  value ||
                  ""
                )
                  .trim()
            )
            .filter(
              Boolean
            )
        )
      ]
        .sort()
    : [];
}


function patternKey(
  pattern
) {

  const raw =
    [
      String(
        pattern?.family ||
        ""
      ),

      String(
        pattern?.sport ||
        ""
      ),

      String(
        pattern?.market_type ||
        ""
      ),

      JSON.stringify(
        stableConditions(
          pattern?.conditions
        )
      )
    ]
      .join("|");


  return crypto
    .createHash(
      "sha256"
    )
    .update(
      raw
    )
    .digest(
      "hex"
    )
    .slice(
      0,
      32
    );
}


// ============================================================
// SUPABASE
// ============================================================

function authHeaders(
  extra = {}
) {

  return {
    apikey:
      SERVICE_KEY,

    Authorization:
      `Bearer ${SERVICE_KEY}`,

    "Content-Type":
      "application/json",

    ...extra
  };
}


async function request(
  table,
  {
    method =
      "GET",

    params =
      {},

    body =
      null,

    extraHeaders =
      {}
  } = {}
) {

  const url =
    new URL(
      `${SUPABASE_URL}/rest/v1/${table}`
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
  ) {

    if (
      value !== null &&
      value !== undefined
    ) {

      url.searchParams.set(
        key,
        String(
          value
        )
      );
    }
  }


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

    const response =
      await fetch(
        url,
        {
          method,

          headers:
            authHeaders(
              extraHeaders
            ),

          body:
            body === null
              ? undefined
              : JSON.stringify(
                  body
                ),

          signal:
            controller.signal
        }
      );


    const text =
      await response
        .text();


    let parsed =
      null;


    if (
      text
    ) {

      try {

        parsed =
          JSON.parse(
            text
          );

      } catch {

        parsed =
          text;
      }
    }


    if (
      !response.ok
    ) {

      throw new Error(
        `Supabase ${table} HTTP ${response.status}: ${
          typeof parsed ===
          "string"
            ? parsed
            : JSON.stringify(
                parsed
              )
        }`
      );
    }


    return parsed;

  } finally {

    clearTimeout(
      timer
    );
  }
}


// ============================================================
// SAVE DAILY SHADOW RUN
// ============================================================

async function writeShadowRun({
  gameDate,
  result
}) {

  const patterns =
    Array.isArray(
      result?.patterns
    )
      ? result.patterns.map(
          pattern => ({
            pattern_key:
              patternKey(
                pattern
              ),

            family:
              pattern.family,

            sport:
              pattern.sport,

            market_type:
              pattern.market_type,

            conditions:
              stableConditions(
                pattern.conditions
              ),

            games:
              Number(
                pattern.games ||
                0
              ),

            wins:
              Number(
                pattern.wins ||
                0
              ),

            losses:
              Number(
                pattern.losses ||
                0
              ),

            pushes:
              Number(
                pattern.pushes ||
                0
              ),

            win_rate:
              pattern.win_rate ??
              null
          })
        )
      : [];


  const row = {
    game_date:
      gameDate,

    engine_version:
      ENGINE_VERSION,

    stories:
      Number(
        result?.stories ||
        0
      ),

    unique_games:
      Number(
        result?.uniqueGames ||
        0
      ),

    observations:
      Number(
        result?.observations ||
        0
      ),

    pattern_count:
      patterns.length,

    patterns,

    built_at:
      new Date()
        .toISOString()
  };


  await request(
    "learning_pattern_shadow_runs",
    {
      method:
        "POST",

      params: {
        on_conflict:
          "game_date,engine_version"
      },

      extraHeaders: {
        Prefer:
          "resolution=merge-duplicates,return=minimal"
      },

      body:
        [
          row
        ]
    }
  );


  return {
    written:
      1,

    patterns:
      patterns.length
  };
}


// ============================================================
// PROCESS ONE GAME DATE
// ============================================================

async function syncGameDatePatterns(
  gameDate
) {

  if (
    !ENABLED
  ) {

    return {
      ok:
        true,

      disabled:
        true,

      gameDate,

      written:
        0,

      patterns:
        0
    };
  }


  if (
    !SUPABASE_URL ||
    !SERVICE_KEY
  ) {

    throw new Error(
      "Learning Supabase environment missing"
    );
  }


  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        String(
          gameDate ||
          ""
        )
      )
  ) {

    throw new Error(
      `Invalid Learning game date: ${gameDate}`
    );
  }


  if (
    !learningEngine ||
    typeof learningEngine
      .analyzeLearningSafe !==
      "function"
  ) {

    throw new Error(
      "Learning Engine unavailable"
    );
  }


  const result =
    await learningEngine
      .analyzeLearningSafe({
        gameDate,

        minGames:
          1,

        returnAllPatterns:
          true
      });


  if (
    result?.ok !==
    true
  ) {

    throw new Error(
      result?.error ||
      "Learning Engine analysis unsuccessful"
    );
  }


  const writeResult =
    await writeShadowRun({
      gameDate,
      result
    });


  return {
    ok:
      true,

    gameDate,

    stories:
      Number(
        result.stories ||
        0
      ),

    uniqueGames:
      Number(
        result.uniqueGames ||
        0
      ),

    observations:
      Number(
        result.observations ||
        0
      ),

    patterns:
      writeResult.patterns,

    written:
      writeResult.written
  };
}


// ============================================================
// SAFE PUBLIC ENTRY
// ============================================================

async function syncGameDatePatternsSafe(
  gameDate
) {

  if (
    running
  ) {

    return {
      ok:
        true,

      skippedRun:
        true,

      reason:
        "already-running",

      gameDate
    };
  }


  running =
    true;


  try {

    return await syncGameDatePatterns(
      gameDate
    );

  } catch (error) {

    console.error(
      `${PREFIX} failed: ${error?.message || error}`
    );


    return {
      ok:
        false,

      gameDate,

      error:
        error?.message ||
        String(
          error
        )
    };

  } finally {

    running =
      false;
  }
}


module.exports = {
  syncGameDatePatternsSafe
};

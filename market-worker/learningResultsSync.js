"use strict";

const LEARNING_ENABLED =
  String(process.env.LEARNING_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

const SUPABASE_URL =
  String(process.env.LEARNING_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.LEARNING_SUPABASE_SERVICE_ROLE_KEY || "")
    .trim();

const REQUEST_TIMEOUT_MS =
  8 * 1000;

const SUPPORTED_SPORTS =
  new Set([
    "mlb",
    "nfl",
    "nba",
    "ncaaf",
    "ncaab",
    "wnba"
  ]);


// ============================================================
// CONFIG
// ============================================================

function getConfigStatus() {

  if (!LEARNING_ENABLED) {
    return {
      active: false,
      reason: "LEARNING_DISABLED"
    };
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      active: false,
      reason: "LEARNING_SUPABASE_ENV_MISSING"
    };
  }

  return {
    active: true,
    reason: null
  };
}


// ============================================================
// HTTP
// ============================================================

function supabaseHeaders(
  extra = {}
) {

  return {
    apikey:
      SUPABASE_SERVICE_ROLE_KEY,

    Authorization:
      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

    ...extra
  };
}


async function fetchWithTimeout(
  url,
  options = {}
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),

      REQUEST_TIMEOUT_MS
    );


  try {

    return await fetch(
      url,
      {
        ...options,

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


function normalizeTeam(
  sport,
  value
) {

  const normalized =
    normalizeText(
      value
    );


  if (
    String(
      sport || ""
    )
      .trim()
      .toLowerCase() ===
    "mlb"
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


function aliasesMatch(
  sport,
  expectedName,
  aliases
) {

  const expected =
    normalizeTeam(
      sport,
      expectedName
    );


  if (!expected) {
    return false;
  }


  return aliases
    .map(
      value =>
        normalizeTeam(
          sport,
          value
        )
    )
    .filter(Boolean)
    .some(
      alias =>
        alias === expected ||
        alias.includes(
          expected
        ) ||
        expected.includes(
          alias
        )
    );
}


// ============================================================
// DATE
// ============================================================

function centralDateString(
  date = new Date()
) {

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


function yesterdayCentralDate() {

  const today =
    centralDateString();


  const date =
    new Date(
      `${today}T12:00:00Z`
    );


  date.setUTCDate(
    date.getUTCDate() - 1
  );


  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function espnDate(
  gameDate
) {

  return String(
    gameDate || ""
  )
    .replaceAll(
      "-",
      ""
    );
}


// ============================================================
// GAME IDENTITY
// ============================================================

function pairKey(
  game
) {

  return [
    String(
      game?.sport || ""
    )
      .trim()
      .toLowerCase(),

    normalizeTeam(
      game?.sport,
      game?.away_team
    ),

    normalizeTeam(
      game?.sport,
      game?.home_team
    )
  ]
    .join("|");
}


// ============================================================
// RESULT ROW
// ============================================================

function buildResultRow({
  game,
  awayScore,
  homeScore,
  source,
  sourceEventId
}) {

  const away =
    Number(
      awayScore
    );


  const home =
    Number(
      homeScore
    );


  if (
    !Number.isInteger(
      away
    ) ||
    !Number.isInteger(
      home
    ) ||
    away < 0 ||
    home < 0
  ) {
    return null;
  }


  return {
    cashedge_game_id:
      String(
        game.cashedge_game_id
      ),

    sport:
      String(
        game.sport
      )
        .trim()
        .toLowerCase(),

    away_score:
      away,

    home_score:
      home,

    winner:
      home > away
        ? "home"
        : away > home
        ? "away"
        : "tie",

    margin:
      home - away,

    total_points:
      home + away,

    source,

    source_event_id:
      sourceEventId
        ? String(
            sourceEventId
          )
        : null,

    captured_at:
      new Date()
        .toISOString(),

    capture_version:
      1
  };
}


// ============================================================
// LOAD YESTERDAY LEARNING GAMES
// ============================================================

async function loadYesterdayGames(
  gameDate
) {

  const params =
    new URLSearchParams({
      select:
        "cashedge_game_id,sport,away_team,home_team,game_date,game_time",

      game_date:
        `eq.${gameDate}`,

      order:
        "sport.asc,game_time.asc"
    });


  const response =
    await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/learning_games?${params.toString()}`,
      {
        headers:
          supabaseHeaders()
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
    !Array.isArray(
      body
    )
  ) {

    throw new Error(
      body?.message ||
      body?.error ||
      `learning_games HTTP ${response.status}`
    );
  }


  return body
    .filter(
      game =>
        game?.cashedge_game_id &&
        SUPPORTED_SPORTS.has(
          String(
            game?.sport || ""
          )
            .trim()
            .toLowerCase()
        )
    );
}


// ============================================================
// EXISTING RESULTS
// ============================================================

function quotePostgrestValue(
  value
) {

  return (
    `"${String(value)
      .replace(
        /\\/g,
        "\\\\"
      )
      .replace(
        /"/g,
        '\\"'
      )}"`
  );
}


async function loadExistingResultIds(
  gameIds
) {

  const existing =
    new Set();


  const chunkSize =
    100;


  for (
    let index = 0;
    index < gameIds.length;
    index += chunkSize
  ) {

    const chunk =
      gameIds.slice(
        index,
        index + chunkSize
      );


    const inFilter =
      `in.(${chunk
        .map(
          quotePostgrestValue
        )
        .join(",")})`;


    const params =
      new URLSearchParams({
        select:
          "cashedge_game_id",

        cashedge_game_id:
          inFilter
      });


    const response =
      await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/learning_game_results?${params.toString()}`,
        {
          headers:
            supabaseHeaders()
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
      !Array.isArray(
        body
      )
    ) {

      throw new Error(
        body?.message ||
        body?.error ||
        `learning_game_results HTTP ${response.status}`
      );
    }


    for (
      const row
      of body
    ) {

      if (
        row?.cashedge_game_id
      ) {

        existing.add(
          String(
            row.cashedge_game_id
          )
        );
      }
    }
  }


  return existing;
}


// ============================================================
// ESPN
// ============================================================

async function fetchEspnEvents(
  sport,
  gameDate
) {

  const sportPath =
    sport === "nfl"
      ? "football/nfl"

      : sport === "ncaaf"
      ? "football/college-football"

      : sport === "nba"
      ? "basketball/nba"

      : sport === "wnba"
      ? "basketball/wnba"

      : sport === "ncaab"
      ? "basketball/mens-college-basketball"

      : null;


  if (!sportPath) {
    return [];
  }


  /*
   * NCAAF already uses these groups in CashEdge.
   * This gives us broad FBS/FCS coverage without
   * searching one game at a time.
   */
  const groupQueries =
    sport === "ncaaf"
      ? [
          "&groups=80&limit=500",
          "&groups=81&limit=500"
        ]
      : [
          "&limit=500"
        ];


  const byId =
    new Map();


  for (
    const groupQuery
    of groupQueries
  ) {

    const url =
      "https://site.api.espn.com/apis/site/v2/sports/" +
      `${sportPath}/scoreboard?dates=${espnDate(gameDate)}${groupQuery}`;


    const response =
      await fetchWithTimeout(
        url
      );


    if (!response.ok) {
      continue;
    }


    const body =
      await response
        .json()
        .catch(
          () => null
        );


    const events =
      Array.isArray(
        body?.events
      )
        ? body.events
        : [];


    for (
      const event
      of events
    ) {

      const id =
        String(
          event?.id || ""
        );


      if (id) {
        byId.set(
          id,
          event
        );
      }
    }
  }


  return Array.from(
    byId.values()
  );
}


function extractEspnFinal(
  sport,
  event
) {

  const competition =
    event
      ?.competitions
      ?.[0];


  const competitors =
    Array.isArray(
      competition?.competitors
    )
      ? competition.competitors
      : [];


  if (
    !competition ||
    competitors.length < 2
  ) {
    return null;
  }


  const status =
    competition
      ?.status
      ?.type;


  const completed =
    status?.completed === true ||
    status?.name ===
      "STATUS_FINAL" ||
    status?.state ===
      "post";


  if (!completed) {
    return null;
  }


  const home =
    competitors.find(
      competitor =>
        competitor
          ?.homeAway ===
        "home"
    );


  const away =
    competitors.find(
      competitor =>
        competitor
          ?.homeAway ===
        "away"
    );


  if (
    !home ||
    !away
  ) {
    return null;
  }


  const homeScore =
    Number(
      home?.score
    );


  const awayScore =
    Number(
      away?.score
    );


  if (
    !Number.isFinite(
      homeScore
    ) ||
    !Number.isFinite(
      awayScore
    )
  ) {
    return null;
  }


  return {
    sourceEventId:
      event?.id ||
      null,

    awayScore,

    homeScore,

    awayAliases: [
      away?.team?.displayName,
      away?.team?.shortDisplayName,
      away?.team?.location,
      away?.team?.abbreviation
    ],

    homeAliases: [
      home?.team?.displayName,
      home?.team?.shortDisplayName,
      home?.team?.location,
      home?.team?.abbreviation
    ],

    sport
  };
}


// ============================================================
// MLB STATS API
// ============================================================

async function fetchMlbGames(
  gameDate
) {

  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&date=${encodeURIComponent(gameDate)}&hydrate=team`;


  const response =
    await fetchWithTimeout(
      url
    );


  if (!response.ok) {
    return [];
  }


  const body =
    await response
      .json()
      .catch(
        () => null
      );


  return Array.isArray(
    body
      ?.dates
      ?.[0]
      ?.games
  )
    ? body.dates[0].games
    : [];
}


function extractMlbFinal(
  game
) {

  const status =
    String(
      game
        ?.status
        ?.detailedState ||
      ""
    )
      .trim()
      .toLowerCase();


  const completed =
    status.includes(
      "final"
    ) ||
    status.includes(
      "game over"
    ) ||
    game
      ?.status
      ?.abstractGameState ===
      "Final";


  if (!completed) {
    return null;
  }


  const awayScore =
    Number(
      game
        ?.teams
        ?.away
        ?.score
    );


  const homeScore =
    Number(
      game
        ?.teams
        ?.home
        ?.score
    );


  if (
    !Number.isFinite(
      awayScore
    ) ||
    !Number.isFinite(
      homeScore
    )
  ) {
    return null;
  }


  return {
    sourceEventId:
      game?.gamePk ||
      null,

    awayScore,

    homeScore,

    awayAliases: [
      game
        ?.teams
        ?.away
        ?.team
        ?.name
    ],

    homeAliases: [
      game
        ?.teams
        ?.home
        ?.team
        ?.name
    ]
  };
}


// ============================================================
// MATCH RESULT TO LEARNING GAME
// ============================================================

function findUniqueProviderMatch({
  sport,
  game,
  providerFinals
}) {

  const matches =
    providerFinals
      .filter(
        item =>
          aliasesMatch(
            sport,
            game.away_team,
            item.awayAliases
          ) &&
          aliasesMatch(
            sport,
            game.home_team,
            item.homeAliases
          )
      );


  /*
   * Never guess.
   *
   * This intentionally rejects ambiguous
   * doubleheaders or duplicate events.
   */
  if (
    matches.length !== 1
  ) {
    return null;
  }


  return matches[0];
}


// ============================================================
// INSERT RESULTS
// ============================================================

async function insertResults(
  rows
) {

  if (!rows.length) {
    return 0;
  }


  const response =
    await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/learning_game_results?on_conflict=cashedge_game_id`,
      {
        method:
          "POST",

        headers:
          supabaseHeaders({
            "Content-Type":
              "application/json",

            Prefer:
              "resolution=ignore-duplicates,return=minimal"
          }),

        body:
          JSON.stringify(
            rows
          )
      }
    );


  if (!response.ok) {

    const body =
      await response
        .json()
        .catch(
          () => null
        );


    throw new Error(
      body?.message ||
      body?.error ||
      `insert results HTTP ${response.status}`
    );
  }


  return rows.length;
}


// ============================================================
// MAIN SYNC
// ============================================================

async function syncYesterdayResults() {

  const status =
    getConfigStatus();


  if (!status.active) {

    return {
      ok: true,
      disabled: true,
      reason:
        status.reason,

      checked: 0,
      pending: 0,
      written: 0,
      unresolved: 0,
      complete: true
    };
  }


  const gameDate =
    yesterdayCentralDate();


  const games =
    await loadYesterdayGames(
      gameDate
    );


  if (!games.length) {

    return {
      ok: true,
      gameDate,

      checked: 0,
      pending: 0,
      written: 0,
      unresolved: 0,
      complete: true
    };
  }


  const existingIds =
    await loadExistingResultIds(
      games.map(
        game =>
          String(
            game
              .cashedge_game_id
          )
      )
    );


  const pendingGames =
    games.filter(
      game =>
        !existingIds.has(
          String(
            game
              .cashedge_game_id
          )
        )
    );


  /*
   * Nothing pending means:
   * do not call ESPN
   * do not call MLB
   * stop immediately.
   */
  if (
    !pendingGames.length
  ) {

    return {
      ok: true,
      gameDate,

      checked:
        games.length,

      pending: 0,

      written: 0,

      unresolved: 0,

      complete: true
    };
  }


  /*
   * If the same team pairing exists more than once
   * on the same sport/date, do not analyze it.
   *
   * This follows our existing Learning rule for
   * doubleheaders: skip instead of guessing.
   */
  const pairCounts =
    new Map();


  for (
    const game
    of pendingGames
  ) {

    const key =
      pairKey(
        game
      );


    pairCounts.set(
      key,
      (
        pairCounts.get(
          key
        ) ||
        0
      ) + 1
    );
  }


  const rows =
    [];


  let ambiguous =
    0;


  const sports =
    Array.from(
      new Set(
        pendingGames.map(
          game =>
            String(
              game.sport
            )
              .trim()
              .toLowerCase()
        )
      )
    );


  for (
    const sport
    of sports
  ) {

    const sportGames =
      pendingGames.filter(
        game =>
          String(
            game.sport
          )
            .trim()
            .toLowerCase() ===
          sport
      );


    let providerFinals =
      [];


    let source =
      "espn";


    if (
      sport === "mlb"
    ) {

      source =
        "mlb_statsapi";


      const providerGames =
        await fetchMlbGames(
          gameDate
        );


      providerFinals =
        providerGames
          .map(
            extractMlbFinal
          )
          .filter(
            Boolean
          );

    } else {

      const events =
        await fetchEspnEvents(
          sport,
          gameDate
        );


      providerFinals =
        events
          .map(
            event =>
              extractEspnFinal(
                sport,
                event
              )
          )
          .filter(
            Boolean
          );
    }


    for (
      const game
      of sportGames
    ) {

      /*
       * Doubleheader / ambiguous pair:
       * skip completely.
       */
      if (
        pairCounts.get(
          pairKey(
            game
          )
        ) !== 1
      ) {

        ambiguous += 1;

        continue;
      }


      const match =
        findUniqueProviderMatch({
          sport,
          game,
          providerFinals
        });


      if (!match) {
        continue;
      }


      const row =
        buildResultRow({
          game,

          awayScore:
            match.awayScore,

          homeScore:
            match.homeScore,

          source,

          sourceEventId:
            match.sourceEventId
        });


      if (row) {
        rows.push(
          row
        );
      }
    }
  }


  const written =
    await insertResults(
      rows
    );


 const unresolved =
  Math.max(
    0,

    pendingGames.length -
    written -
    ambiguous
  );

  return {
    ok: true,

    gameDate,

    checked:
      games.length,

    pending:
      pendingGames.length,

    written,

    unresolved,

    ambiguous,

    complete:
      unresolved === 0
  };
}


// ============================================================
// SAFE WRAPPER
//
// A Learning result failure must NEVER stop
// Market Intelligence or the Railway worker.
// ============================================================

async function syncYesterdayResultsSafe() {

  try {

    return await syncYesterdayResults();

  } catch (error) {

    console.error(
      `[learning-results] sync failed: ${error?.message || error}`
    );


    return {
      ok: false,

      error:
        error?.message ||
        String(error),

      checked: 0,
      pending: 0,
      written: 0,
      unresolved: 0,
      complete: false
    };
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  syncYesterdayResultsSafe
};

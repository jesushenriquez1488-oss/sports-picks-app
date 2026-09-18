const { createClient } =
  require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// CENTRAL DATE
// ============================================================

function getCentralDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}


// ============================================================
// ADD DAYS TO DATE
// ============================================================

function addDays(
  dateString,
  days
) {
  const [year, month, day] =
    String(dateString)
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day + days,
      12,
      0,
      0
    )
  )
    .toISOString()
    .slice(0, 10);
}
// ============================================================
// PREMIUM RADAR TEAM LOGOS
// ============================================================

const PREMIUM_RADAR_LOGO_CACHE_TTL_MS =
  6 * 60 * 60 * 1000;


const premiumRadarLogoCache =
  globalThis
    .__cashEdgePremiumRadarLogoCache ||
  new Map();


globalThis
  .__cashEdgePremiumRadarLogoCache =
  premiumRadarLogoCache;


// ============================================================
// NORMALIZE TEAM NAME
// ============================================================

function normalizeRadarTeamName(
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
      /[^a-z0-9]/g,
      ""
    );
}


// ============================================================
// ESPN SPORT PATH
// ============================================================

function getPremiumRadarEspnPath(
  sport
) {

  const normalizedSport =
    String(
      sport || ""
    )
      .toLowerCase()
      .trim();


  const paths = {

    mlb:
      "baseball/mlb",

    nba:
      "basketball/nba",

    wnba:
      "basketball/wnba",

    ncaab:
      "basketball/mens-college-basketball",

    nfl:
      "football/nfl",

    ncaaf:
      "football/college-football"
  };


  return (
    paths[
      normalizedSport
    ] ||
    null
  );
}


// ============================================================
// TEAM NAME MATCH
// ============================================================

function radarTeamMatches(
  expectedName,
  espnTeam
) {

  const expected =
    normalizeRadarTeamName(
      expectedName
    );


  if (!expected) {
    return false;
  }


  const aliases = [

    espnTeam
      ?.displayName,

    espnTeam
      ?.shortDisplayName,

    espnTeam
      ?.name,

    espnTeam
      ?.location,

    espnTeam
      ?.abbreviation

  ]
    .map(
      normalizeRadarTeamName
    )
    .filter(Boolean);


  return aliases.some(
    alias =>
      alias === expected ||
      (
        alias.length >= 4 &&
        expected.length >= 4 &&
        (
          alias.includes(
            expected
          ) ||
          expected.includes(
            alias
          )
        )
      )
  );
}


// ============================================================
// LOAD ESPN SCOREBOARD
// ============================================================

async function loadPremiumRadarLogoBoard(
  sport,
  gameDate
) {

  const sportPath =
    getPremiumRadarEspnPath(
      sport
    );


  if (
    !sportPath ||
    !gameDate
  ) {

    return [];
  }


  const compactDate =
    String(
      gameDate
    )
      .replaceAll(
        "-",
        ""
      );


  const normalizedSport =
    String(
      sport || ""
    )
      .toLowerCase()
      .trim();


  const cacheKey =
    `${sportPath}:${compactDate}`;


  const cached =
    premiumRadarLogoCache
      .get(
        cacheKey
      );


  if (
    cached &&
    (
      Date.now() -
      cached.createdAt
    ) <
    PREMIUM_RADAR_LOGO_CACHE_TTL_MS
  ) {

    return cached.events;
  }


  try {

    const urls =
      normalizedSport ===
      "ncaaf"
        ? [
            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${compactDate}&groups=80&limit=500`,

            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${compactDate}&groups=81&limit=500`
          ]
        : [
            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${compactDate}&limit=500`
          ];


    const responses =
      await Promise.all(
        urls.map(
          url =>
            fetch(url)
        )
      );


    const eventMap =
      new Map();


    for (
      const response of
      responses
    ) {

      if (!response.ok) {
        continue;
      }


      const data =
        await response.json();


      const events =
        Array.isArray(
          data?.events
        )
          ? data.events
          : [];


      for (
        const event of
        events
      ) {

        const eventKey =
          String(
            event?.id ||
            `${event?.date || ""}:${event?.name || ""}`
          );


        eventMap.set(
          eventKey,
          event
        );
      }
    }


    const events =
      Array.from(
        eventMap.values()
      );


    premiumRadarLogoCache
      .set(
        cacheKey,
        {
          createdAt:
            Date.now(),

          events
        }
      );


    return events;

  } catch (error) {

    console.warn(
      "PREMIUM RADAR LOGO ERROR:",
      sport,
      gameDate,
      error?.message ||
      error
    );


    return [];
  }
}

// ============================================================
// RESOLVE GAME LOGOS
// ============================================================

function resolvePremiumRadarGameLogos(
  row,
  events
) {

  for (
    const event of
    events || []
  ) {

    const competitors =
      event
        ?.competitions
        ?.[0]
        ?.competitors ||
      [];


    const away =
      competitors.find(
        competitor =>
          competitor
            ?.homeAway ===
          "away"
      );


    const home =
      competitors.find(
        competitor =>
          competitor
            ?.homeAway ===
          "home"
      );


    if (
      !away ||
      !home
    ) {

      continue;
    }


    const awayMatches =
      radarTeamMatches(
        row.away_team,
        away.team
      );


    const homeMatches =
      radarTeamMatches(
        row.home_team,
        home.team
      );


    if (
      !awayMatches ||
      !homeMatches
    ) {

      continue;
    }


    return {

      away:
        away
          ?.team
          ?.logos
          ?.[0]
          ?.href ||
        away
          ?.team
          ?.logo ||
        null,


      home:
        home
          ?.team
          ?.logos
          ?.[0]
          ?.href ||
        home
          ?.team
          ?.logo ||
        null
    };
  }


  return {
    away: null,
    home: null
  };
}

// ============================================================
// RADAR FIELDS
// ============================================================

const RADAR_SELECT = `
  id,
  source_daily_pick_id,
  sport,
  game_id,
  game_date,
  away_team,
  home_team,
  first_seen_at,
  first_premium_at,
  opening_market_line,
  current_market_line,
  current_is_premium,
  current_pick,
  current_confidence,
  current_edge,
  current_projection,
  current_recommendation,
  game_status,
  result,
  final_score,
  source_updated_at,
  last_synced_at
`;


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );


    if (req.method === "OPTIONS") {
      return res
        .status(200)
        .end();
    }


    if (req.method !== "GET") {
      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });
    }


    try {

      // ======================================================
      // LOGIN REQUIRED
      // ======================================================

      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );


      const token =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : null;


      if (!token) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unauthorized"
          });
      }


      const {
        data: authData,
        error: authError
      } =
        await supabaseAdmin
          .auth
          .getUser(token);


      if (
        authError ||
        !authData?.user?.id
      ) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // ACCOUNT ACCESS
      // Uses existing CashEdge is_premium
      // ======================================================

      const {
        data: profile,
        error: profileError
      } =
        await supabaseAdmin
          .from("users")
          .select("is_premium")
          .eq(
            "id",
            authData.user.id
          )
          .maybeSingle();


      if (profileError) {
        console.error(
          "PREMIUM RADAR PROFILE ERROR:",
          profileError.message
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Unable to verify account access"
          });
      }


      const isPremiumUser =
        profile?.is_premium === true;


      // ======================================================
      // DATE WINDOW
      // ======================================================

      const today =
        getCentralDate();


      const footballEndDate =
        addDays(
          today,
          6
        );


      // ======================================================
      // FREE USER
      //
      // Free users can see ONLY how many CURRENT Premium
      // opportunities exist.
      //
      // They do NOT receive:
      // teams
      // picks
      // confidence
      // edge
      // projections
      // lines
      // history
      // dates
      // ======================================================

      if (!isPremiumUser) {

        const [
          dailyCountResult,
          footballCountResult
        ] =
          await Promise.all([

            supabaseAdmin
              .from("premium_radar")
              .select(
                "id",
                {
                  count: "exact",
                  head: true
                }
              )
              .in(
                "sport",
                [
                  "mlb",
                  "nba",
                  "wnba",
                  "ncaab"
                ]
              )
              .eq(
                "game_date",
                today
              )
              .eq(
                "current_is_premium",
                true
              ),


            supabaseAdmin
              .from("premium_radar")
              .select(
                "id",
                {
                  count: "exact",
                  head: true
                }
              )
              .in(
                "sport",
                [
                  "ncaaf",
                  "nfl"
                ]
              )
              .gte(
                "game_date",
                today
              )
              .lte(
                "game_date",
                footballEndDate
              )
              .eq(
                "current_is_premium",
                true
              )

          ]);


        if (dailyCountResult.error) {
          throw dailyCountResult.error;
        }


        if (footballCountResult.error) {
          throw footballCountResult.error;
        }


        const premiumCount =
          Number(
            dailyCountResult.count ||
            0
          ) +
          Number(
            footballCountResult.count ||
            0
          );


        return res
          .status(200)
          .json({
            ok: true,
            locked: true,
            premiumCount
          });
      }

// ======================================================
// PREMIUM USER — HISTORY
//
// Visible history = previous 7 calendar days.
// TODAY remains separate.
//
// premium_radar already contains only games that
// entered Radar at some point, including games that
// later stopped being Premium.
// ======================================================

const radarViewMode =
  String(
    req.query.view || "today"
  )
    .toLowerCase()
    .trim();


if (radarViewMode === "history") {

  // ====================================================
  // HISTORY — ONE DAY AT A TIME
  //
  // User can select any of the previous 7 calendar days.
  // Only the selected day is queried and returned.
  // ====================================================

  const dates =
    Array.from(
      {
        length: 7
      },
      (
        _,
        index
      ) =>
        addDays(
          today,
          -(index + 1)
        )
    );


  const requestedDate =
    String(
      req.query.date || ""
    )
      .trim();


  const selectedDate =
    dates.includes(
      requestedDate
    )
      ? requestedDate
      : dates[0];


  const {
    data: historyRows,
    error: historyError
  } =
    await supabaseAdmin
      .from("premium_radar")
      .select(
        RADAR_SELECT
      )
      .eq(
        "game_date",
        selectedDate
      );


  if (historyError) {
    throw historyError;
  }


  let rows =
    historyRows || [];


  // ====================================================
  // CANONICAL RESULTS FROM picks_history
  //
  // Match:
  // sport + game_id + pick
  // ====================================================

  const historyGameIds =
    [
      ...new Set(
        rows
          .map(
            row =>
              row.game_id
          )
          .filter(Boolean)
      )
    ];


  if (historyGameIds.length) {

    const {
      data: gradedRows,
      error: gradedRowsError
    } =
      await supabaseAdmin
        .from("picks_history")
        .select(
          `
            sport,
            game_id,
            pick,
            result,
            final_score,
            graded_at
          `
        )
        .in(
          "game_id",
          historyGameIds
        );


    if (gradedRowsError) {
      throw gradedRowsError;
    }


    const gradedMap =
      new Map();


    for (
      const graded of
        gradedRows || []
    ) {

      const key =
        [
          String(
            graded.sport || ""
          )
            .toLowerCase()
            .trim(),

          String(
            graded.game_id || ""
          )
            .trim(),

          String(
            graded.pick || ""
          )
            .trim()
        ].join("|");


      const existing =
        gradedMap.get(key);


      if (
        !existing ||
        (
          graded.graded_at &&
          (
            !existing.graded_at ||
            new Date(
              graded.graded_at
            ).getTime() >
            new Date(
              existing.graded_at
            ).getTime()
          )
        )
      ) {

        gradedMap.set(
          key,
          graded
        );
      }
    }


    rows =
      rows.map(
        row => {

          const key =
            [
              String(
                row.sport || ""
              )
                .toLowerCase()
                .trim(),

              String(
                row.game_id || ""
              )
                .trim(),

              String(
                row.current_pick || ""
              )
                .trim()
            ].join("|");


          const graded =
            gradedMap.get(key);


          if (!graded) {
            return row;
          }


          return {
            ...row,

            result:
              graded.result ||
              row.result ||
              "pending",

            final_score:
              graded.final_score ||
              row.final_score ||
              null
          };
        }
      );
  }


  // ====================================================
  // SORT SELECTED DAY
  // ====================================================

  rows.sort(
    (a, b) => {

      const sportCompare =
        String(
          a.sport || ""
        ).localeCompare(
          String(
            b.sport || ""
          )
        );


      if (sportCompare !== 0) {
        return sportCompare;
      }


      if (
        a.current_is_premium !==
        b.current_is_premium
      ) {

        return a.current_is_premium
          ? -1
          : 1;
      }


      return (
        Number(
          b.current_confidence || 0
        ) -
        Number(
          a.current_confidence || 0
        )
      );
    }
  );


  // ====================================================
  // GROUP SELECTED DAY BY SPORT
  //
  // Keep same frontend shape:
  // grouped[date][sport]
  // ====================================================

  const grouped = {
    [selectedDate]: {}
  };


  for (const row of rows) {

    if (
      !grouped[
        selectedDate
      ][row.sport]
    ) {

      grouped[
        selectedDate
      ][row.sport] =
        [];
    }


    grouped[
      selectedDate
    ][row.sport]
      .push(row);
  }


  return res
    .status(200)
    .json({
      ok: true,

      locked: false,

      view:
        "history",

      today,

      dates,

      selectedDate,

      historyCount:
        rows.length,

      grouped
    });
}
      // ======================================================
      // PREMIUM USER
      //
      // DAILY SPORTS:
      // today only
      // ======================================================

      const {
        data: dailyRows,
        error: dailyError
      } =
        await supabaseAdmin
          .from("premium_radar")
          .select(
            RADAR_SELECT
          )
          .in(
            "sport",
            [
              "mlb",
              "nba",
              "wnba",
              "ncaab"
            ]
          )
          .eq(
  "game_date",
  today
)
.eq(
  "current_is_premium",
  true
);


      if (dailyError) {
        throw dailyError;
      }


      // ======================================================
      // PREMIUM USER
      //
      // FOOTBALL:
      // today + next 6 days
      // ======================================================

      const {
        data: footballRows,
        error: footballError
      } =
        await supabaseAdmin
          .from("premium_radar")
          .select(
            RADAR_SELECT
          )
          .in(
            "sport",
            [
              "ncaaf",
              "nfl"
            ]
          )
          .gte(
            "game_date",
            today
          )
         .lte(
  "game_date",
  footballEndDate
)
.eq(
  "current_is_premium",
  true
);


      if (footballError) {
        throw footballError;
      }


      // ======================================================
      // COMBINE
      // ======================================================

const radarRows = [
  ...(dailyRows || []),
  ...(footballRows || [])
];
const logoBoardRequests =
  [
    ...new Map(
      radarRows.map(
        row => {

          const key =
            `${row.sport}:${row.game_date}`;


          return [
            key,
            {
              key,
              sport:
                row.sport,
              gameDate:
                row.game_date
            }
          ];
        }
      )
    ).values()
  ];


const logoBoardResults =
  await Promise.all(
    logoBoardRequests.map(
      async request => ({

        key:
          request.key,

        events:
          await loadPremiumRadarLogoBoard(
            request.sport,
            request.gameDate
          )

      })
    )
  );


const logoBoardByKey =
  new Map(
    logoBoardResults.map(
      result => [
        result.key,
        result.events
      ]
    )
  );


const teamLogosByGameId =
  new Map();


for (
  const row of
  radarRows
) {

  const logoKey =
    `${row.sport}:${row.game_date}`;


  const events =
    logoBoardByKey.get(
      logoKey
    ) ||
    [];


  teamLogosByGameId.set(
    String(
      row.game_id
    ),
    resolvePremiumRadarGameLogos(
      row,
      events
    )
  );
}

const sourceDailyPickIds =
  radarRows
    .map(
      row =>
        row.source_daily_pick_id
    )
    .filter(Boolean);

const radarGameIds =
  [
    ...new Set(
      radarRows
        .map(
          row =>
            row.game_id
        )
        .filter(Boolean)
    )
  ];


let marketContextByGameId =
  new Map();

let marketEvaluationByGameId =
  new Map();

let marketEventsByGameId =
  new Map();

let marketIntelligenceEnabled =
  false;


if (radarGameIds.length) {

  const [
    marketContextsResult,
    marketEvaluationsResult,
    marketEventsResult,
    marketSettingsResult
  ] =
    await Promise.all([

      supabaseAdmin
        .from(
          "market_pick_context"
        )
        .select(`
          cashedge_game_id,
          market_type,
          first_premium_line,
          first_premium_price_american,
          current_cashedge_line,
          current_cashedge_price_american,
          movement_reference_market_type,
          movement_reference_selection_key,
          movement_baseline_price_american
        `)
        .in(
          "cashedge_game_id",
          radarGameIds
        ),


      supabaseAdmin
        .from(
          "market_evaluation_games"
        )
        .select(`
          cashedge_game_id,
          latest_alignment_state,
          latest_market_line,
          latest_market_price_american,
          latest_best_sportsbook_key,
          latest_best_sportsbook_name,
          latest_best_line,
          latest_best_price_american,
          latest_money_pct,
          latest_tickets_pct,
          latest_opportunity_state,
          latest_opportunity_type,
          latest_opportunity_line_value,
          latest_opportunity_price_value_cents,
          latest_opportunity_book_key,
          latest_opportunity_book_name,
          latest_opportunity_best_line,
          latest_opportunity_best_price,
          opportunity_state_started_at,
          updated_at
        `)
        .in(
          "cashedge_game_id",
          radarGameIds
        ),


      supabaseAdmin
        .from(
          "market_events"
        )
        .select(`
          id,
          cashedge_game_id,
          event_family,
          event_type,
          direction,
          severity,
          signal_strength,
          headline,
          explanation,
          event_data,
          importance_level,
          is_important,
          is_important_now,
          is_active,
          first_detected_at,
          last_detected_at,
          resolved_at
        `)
        .in(
          "cashedge_game_id",
          radarGameIds
        )
        .in(
          "event_family",
          [
            "movement",
            "opportunity",
            "signal"
          ]
        )
        .order(
          "first_detected_at",
          {
            ascending: false
          }
        )
        .limit(2000),


      supabaseAdmin
        .from(
          "market_intelligence_settings"
        )
        .select(`
          frontend_enabled
        `)
        .eq(
          "id",
          1
        )
        .maybeSingle()

    ]);


  if (marketContextsResult.error) {
    throw marketContextsResult.error;
  }

  if (marketEvaluationsResult.error) {
    throw marketEvaluationsResult.error;
  }

  if (marketEventsResult.error) {
    throw marketEventsResult.error;
  }

  if (marketSettingsResult.error) {
    throw marketSettingsResult.error;
  }


  marketIntelligenceEnabled =
    marketSettingsResult
      .data
      ?.frontend_enabled ===
    true;


  marketContextByGameId =
    new Map(
      (
        marketContextsResult.data ||
        []
      )
        .map(
          context => [
            String(
              context.cashedge_game_id
            ),
            context
          ]
        )
    );


  marketEvaluationByGameId =
    new Map(
      (
        marketEvaluationsResult.data ||
        []
      )
        .map(
          evaluation => [
            String(
              evaluation
                .cashedge_game_id
            ),
            evaluation
          ]
        )
    );


  for (
    const event of
    marketEventsResult.data ||
    []
  ) {

    const gameKey =
      String(
        event.cashedge_game_id
      );


    if (
      !marketEventsByGameId
        .has(gameKey)
    ) {

      marketEventsByGameId
        .set(
          gameKey,
          []
        );
    }


    const gameEvents =
      marketEventsByGameId
        .get(gameKey);


    if (
      gameEvents.length <
      20
    ) {

      gameEvents.push(
        event
      );
    }
  }
}
let sourceEventIdByDailyPickId =
  new Map();
let sourceMarketByDailyPickId =
  new Map();

if (sourceDailyPickIds.length) {

  const {
    data: sourceDailyPicks,
    error: sourceDailyPicksError
  } =
    await supabaseAdmin
      .from("daily_picks")
      .select(
        "id, game_time, analysis_json"
      )
      .in(
        "id",
        sourceDailyPickIds
      );


  if (sourceDailyPicksError) {
    throw sourceDailyPicksError;
  }


  gameTimeByDailyPickId =
    new Map(
      (sourceDailyPicks || [])
        .map(
          row => [
            String(row.id),
            row.game_time || null
          ]
        )
    );


  sourceEventIdByDailyPickId =
    new Map(
      (sourceDailyPicks || [])
        .map(
          row => [
            String(row.id),

            row.analysis_json
              ?.sourceEventId ||
            null
          ]
        )
    );
  sourceMarketByDailyPickId =
  new Map(
    (sourceDailyPicks || [])
      .map(
        row => {

          const card =
            row.analysis_json
              ?.premium
              ?.recommendedCards
              ?.[0] ||
            null;


          const cardType =
            String(
              card?.type || ""
            )
              .toUpperCase()
              .trim();


          let marketType =
            null;


          if (
            cardType === "ML"
          ) {

            marketType =
              "moneyline";

          } else if (
            cardType === "RUNLINE"
          ) {

            marketType =
              "spread";

          } else if (
            cardType === "OVER" ||
            cardType === "UNDER"
          ) {

            marketType =
              "total";
          }


          const price =
            Number(
              card?.odds_american
            );


          return [
            String(row.id),

            {
              marketType,

              price:
                Number.isFinite(
                  price
                )
                  ? price
                  : null
            }
          ];
        }
      )
  );
}


const rows =
  radarRows.map(
    row => {

      const gameKey =
        String(
          row.game_id
        );


      const marketContext =
        marketContextByGameId
          .get(gameKey) ||
        null;


      const marketEvaluation =
        marketEvaluationByGameId
          .get(gameKey) ||
        null;


      const marketEvents =
        marketEventsByGameId
          .get(gameKey) ||
        [];


      const latestMovement =
        marketEvents.find(
          event =>
            event.event_family ===
            "movement"
        ) ||
        null;


      const activeOpportunityEvent =
        marketEvents.find(
          event =>
            event.event_family ===
              "opportunity" &&
            event.is_active ===
              true
        ) ||
        null;


      const staleLineEvent =
        marketEvents.find(
          event =>
            event.event_family ===
              "opportunity" &&
            event.is_active ===
              true &&
            event
              ?.event_data
              ?.staleLine
              ?.detected ===
              true
        ) ||
        null;


      const activity =
        marketEvents
          .filter(
            event =>
              event.event_family ===
                "movement" ||
              event.event_family ===
                "opportunity" ||
              (
                event.event_family ===
                  "signal" &&
                (
                  event.is_active ===
                    true ||
                  event.is_important ===
                    true ||
                  Number(
                    event.signal_strength ||
                    0
                  ) >= 2
                )
              )
          )
          .slice(
            0,
            12
          );


      return {

        ...row,
away_team_logo:
  teamLogosByGameId
    .get(
      gameKey
    )
    ?.away ||
  null,


home_team_logo:
  teamLogosByGameId
    .get(
      gameKey
    )
    ?.home ||
  null,

        market_type:
  marketContext
    ?.market_type ||
  (
    row.source_daily_pick_id
      ? sourceMarketByDailyPickId
          .get(
            String(
              row.source_daily_pick_id
            )
          )
          ?.marketType ||
        null
      : null
  ),

     first_premium_price_american:
  marketContext
    ?.first_premium_price_american ??
  (
    row.source_daily_pick_id
      ? sourceMarketByDailyPickId
          .get(
            String(
              row.source_daily_pick_id
            )
          )
          ?.price ??
        null
      : null
  ),


       current_market_price_american:
  marketContext
    ?.current_cashedge_price_american ??
  (
    row.source_daily_pick_id
      ? sourceMarketByDailyPickId
          .get(
            String(
              row.source_daily_pick_id
            )
          )
          ?.price ??
        null
      : null
  ),


        game_time:
          row.source_daily_pick_id
            ? gameTimeByDailyPickId.get(
                String(
                  row.source_daily_pick_id
                )
              ) || null
            : null,


        source_event_id:
          row.source_daily_pick_id
            ? sourceEventIdByDailyPickId.get(
                String(
                  row.source_daily_pick_id
                )
              ) || null
            : null,


        market_intelligence: {

          available:
            Boolean(
              marketEvaluation ||
              latestMovement ||
              activeOpportunityEvent
            ),


          marketType:
            marketContext
              ?.market_type ||
            null,


          movementReferenceMarketType:
            marketContext
              ?.movement_reference_market_type ||
            null,


          alignment:
            marketEvaluation
              ?.latest_alignment_state ||
            null,


          consensus: {

            line:
              marketEvaluation
                ?.latest_market_line ??
              null,

            price:
              marketEvaluation
                ?.latest_market_price_american ??
              null
          },


          bestAvailable: {

            sportsbookKey:
              marketEvaluation
                ?.latest_best_sportsbook_key ||
              null,

            sportsbook:
              marketEvaluation
                ?.latest_best_sportsbook_name ||
              null,

            line:
              marketEvaluation
                ?.latest_best_line ??
              null,

            price:
              marketEvaluation
                ?.latest_best_price_american ??
              null
          },


          ticketsPct:
            marketEvaluation
              ?.latest_tickets_pct ??
            null,


          moneyPct:
            marketEvaluation
              ?.latest_money_pct ??
            null,


          opportunity: {

            state:
              marketEvaluation
                ?.latest_opportunity_state ||
              null,

            type:
              marketEvaluation
                ?.latest_opportunity_type ||
              null,

            lineValue:
              marketEvaluation
                ?.latest_opportunity_line_value ??
              null,

            priceValueCents:
              marketEvaluation
                ?.latest_opportunity_price_value_cents ??
              null,

            sportsbookKey:
              marketEvaluation
                ?.latest_opportunity_book_key ||
              null,

            sportsbook:
              marketEvaluation
                ?.latest_opportunity_book_name ||
              null,

            line:
              marketEvaluation
                ?.latest_opportunity_best_line ??
              null,

            price:
              marketEvaluation
                ?.latest_opportunity_best_price ??
              null,

            startedAt:
              marketEvaluation
                ?.opportunity_state_started_at ||
              null,

            headline:
              activeOpportunityEvent
                ?.headline ||
              null,

            explanation:
              activeOpportunityEvent
                ?.explanation ||
              null
          },


          staleLine:
            staleLineEvent
              ?.event_data
              ?.staleLine ||
            null,


          movement:
            latestMovement
              ? {

                  eventType:
                    latestMovement
                      .event_type,

                  direction:
                    latestMovement
                      .direction,

                  headline:
                    latestMovement
                      .headline,

                  explanation:
                    latestMovement
                      .explanation,

                  detectedAt:
                    latestMovement
                      .first_detected_at,

                  data:
                    latestMovement
                      .event_data ||
                    {}

                }
              : null,


          importantNow:
            marketEvents.some(
              event =>
                event.is_important_now ===
                true
            ),


          activity:
            activity.map(
              event => ({

                id:
                  event.id,

                family:
                  event.event_family,

                type:
                  event.event_type,

                direction:
                  event.direction,

                severity:
                  event.severity,

                headline:
                  event.headline,

                explanation:
                  event.explanation,

                importanceLevel:
                  event.importance_level,

                importantNow:
                  event.is_important_now ===
                  true,

                active:
                  event.is_active ===
                  true,

                detectedAt:
                  event.first_detected_at,

                lastDetectedAt:
                  event.last_detected_at,

                data:
                  event.event_data ||
                  {}

              })
            )
        }
      };
    }
  );

      // ======================================================
      // CURRENT PREMIUM COUNT
      //
      // Games that were Premium before but are no longer
      // Premium remain visible in Radar, but are NOT counted
      // in this number.
      // ======================================================

      const premiumCount =
        rows.filter(
          row =>
            row.current_is_premium ===
            true
        ).length;


      // ======================================================
      // SORT BY REAL GAME DATE
      // ======================================================

     rows.sort(
  (a, b) => {

    // 1. Fecha real del juego
    const dateCompare =
      String(
        a.game_date
      ).localeCompare(
        String(
          b.game_date
        )
      );


    if (dateCompare !== 0) {
      return dateCompare;
    }


    // 2. Deporte
    const sportCompare =
      String(
        a.sport
      ).localeCompare(
        String(
          b.sport
        )
      );


    if (sportCompare !== 0) {
      return sportCompare;
    }


    // 3. Premium actuales primero
    const aPremium =
      a.current_is_premium === true
        ? 1
        : 0;

    const bPremium =
      b.current_is_premium === true
        ? 1
        : 0;


    if (aPremium !== bPremium) {
      return (
        bPremium -
        aPremium
      );
    }


    // 4. Hora del juego:
    // más temprano primero
    const aTimeRaw =
      a.game_time
        ? new Date(
            a.game_time
          ).getTime()
        : NaN;

    const bTimeRaw =
      b.game_time
        ? new Date(
            b.game_time
          ).getTime()
        : NaN;


    const aTime =
      Number.isFinite(
        aTimeRaw
      )
        ? aTimeRaw
        : Number.POSITIVE_INFINITY;

    const bTime =
      Number.isFinite(
        bTimeRaw
      )
        ? bTimeRaw
        : Number.POSITIVE_INFINITY;


    if (aTime !== bTime) {
      return (
        aTime -
        bTime
      );
    }


    // 5. Si empiezan a la misma hora,
    // Confidence más alta primero
    const aConfidence =
      Number(
        a.current_confidence
      ) || 0;

    const bConfidence =
      Number(
        b.current_confidence
      ) || 0;


    return (
      bConfidence -
      aConfidence
    );
  }
);


      // ======================================================
      // GROUP
      //
      // Example:
      //
      // 2026-09-05
      //   mlb
      //   ncaaf
      //
      // 2026-09-09
      //   nfl
      //
      // 2026-09-10
      //   ncaaf
      //   nfl
      // ======================================================

      const grouped = {};


      for (const row of rows) {

        const date =
          row.game_date;


        if (!grouped[date]) {
          grouped[date] = {};
        }


        if (
          !grouped[date][row.sport]
        ) {
          grouped[date][row.sport] =
            [];
        }


        grouped[date][row.sport]
          .push(row);
      }


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({
          ok: true,

          locked: false,

          premiumCount,

          today,

         footballEndDate,

marketIntelligenceEnabled,

grouped
        });


    } catch (error) {

      console.error(
        "PREMIUM RADAR ENDPOINT ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  };

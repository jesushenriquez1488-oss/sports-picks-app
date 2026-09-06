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

  const historyStartDate =
    addDays(
      today,
      -7
    );

  const historyEndDate =
    addDays(
      today,
      -1
    );


  const {
    data: historyRows,
    error: historyError
  } =
    await supabaseAdmin
      .from("premium_radar")
      .select(
        RADAR_SELECT
      )
      .gte(
        "game_date",
        historyStartDate
      )
      .lte(
        "game_date",
        historyEndDate
      );


  if (historyError) {
    throw historyError;
  }


  let rows =
  historyRows || [];


// ====================================================
// HISTORY — CANONICAL RESULTS FROM picks_history
//
// premium_radar stores the Radar opportunity.
// picks_history is the canonical grading source.
//
// Match by:
// sport + game_id + pick
//
// This avoids assigning the result of another play
// from the same game.
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
  // HISTORY ORDER
  //
  // Newest day first.
  // Then sport.
  // Current Premium before former Premium.
  // Confidence as final tie-breaker.
  // ====================================================

  rows.sort(
    (a, b) => {

      const dateCompare =
        String(
          b.game_date || ""
        ).localeCompare(
          String(
            a.game_date || ""
          )
        );


      if (dateCompare !== 0) {
        return dateCompare;
      }


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
  // GROUP BY DATE → SPORT
  // ====================================================

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


  // Always return the seven available dates,
  // even when one of those days had zero Premiums.
  //
  // Example:
  // Yesterday
  // Sep 4
  // Sep 3
  // ...
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


  return res
    .status(200)
    .json({
      ok: true,

      locked: false,

      view:
        "history",

      today,

      historyStartDate,

      historyEndDate,

      historyCount:
        rows.length,

      dates,

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


const sourceDailyPickIds =
  radarRows
    .map(
      row =>
        row.source_daily_pick_id
    )
    .filter(Boolean);


let gameTimeByDailyPickId =
  new Map();

let sourceEventIdByDailyPickId =
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
}


const rows =
  radarRows.map(
    row => ({
      ...row,

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
          : null
    })
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

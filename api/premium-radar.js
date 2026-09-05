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

      const rows = [
        ...(dailyRows || []),
        ...(footballRows || [])
      ];


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


          return String(
            a.sport
          ).localeCompare(
            String(
              b.sport
            )
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

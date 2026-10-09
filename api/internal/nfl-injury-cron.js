"use strict";


// ============================================================
// CONFIG
// ============================================================

const API_SPORTS_BASE =
  "https://v1.american-football.api-sports.io";

const CASHEDGE_ORIGIN =
  process.env.CASHEDGE_ORIGIN ||
  "https://www.cashedgeapp.com";


// ============================================================
// CENTRAL TIME
// ============================================================

function getCentralNow() {

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

        minute:
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


  return {
    year:
      Number(
        map.year
      ),

    month:
      Number(
        map.month
      ),

    day:
      Number(
        map.day
      ),

    hour:
      Number(
        map.hour
      ),

    minute:
      Number(
        map.minute
      ),

    date:
      `${map.year}-${map.month}-${map.day}`
  };
}


// ============================================================
// NFL SEASON
// ============================================================

function getNFLSeason(
  year,
  month
) {

  /*
   * January / February belong to
   * the previous NFL season.
   */

  if (
    month <= 2
  ) {
    return year - 1;
  }


  return year;
}


// ============================================================
// API SPORTS
// ============================================================

async function apiSports(
  path
) {

  const apiKey =
    String(
      process.env.API_SPORTS_KEY ||
      ""
    );


  if (
    !apiKey
  ) {
    throw new Error(
      "API_SPORTS_KEY missing"
    );
  }


  const response =
    await fetch(
      `${API_SPORTS_BASE}${path}`,
      {
        headers: {
          "x-apisports-key":
            apiKey
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `API-Sports HTTP ${response.status}`
    );
  }


  const body =
    await response
      .json();


  const errors =
    body?.errors;


  const hasErrors =
    Array.isArray(
      errors
    )
      ? errors.length > 0
      : (
          errors &&
          typeof errors ===
            "object" &&
          Object.keys(
            errors
          ).length > 0
        );


  if (
    hasErrors
  ) {

    throw new Error(
      `API-Sports: ${JSON.stringify(
        errors
      )}`
    );
  }


  return Array.isArray(
    body?.response
  )
    ? body.response
    : [];
}


// ============================================================
// MAIN
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    if (
      req.method !==
      "GET"
    ) {

      return res
        .status(405)
        .json({
          ok: false,
          error:
            "Method not allowed"
        });
    }


    // ========================================================
    // AUTH — VERCEL CRON
    // ========================================================

    const cronSecret =
      String(
        process.env.CRON_SECRET ||
        ""
      );


    const authHeader =
      String(
        req.headers
          .authorization ||
        ""
      );


    if (
      !cronSecret ||
      authHeader !==
        `Bearer ${cronSecret}`
    ) {

      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Unauthorized"
        });
    }


    try {

      // ======================================================
      // BATCH
      // ======================================================

      const start =
        Number(
          req.query.start
        );


      const validStarts =
        new Set([
          0,
          8,
          16,
          24
        ]);


      if (
        !validStarts.has(
          start
        )
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Invalid start"
          });
      }


      // ======================================================
      // CENTRAL DATE
      // ======================================================

      const central =
        getCentralNow();


      const season =
        getNFLSeason(
          central.year,
          central.month
        );


      // ======================================================
      // DOES NFL PLAY TODAY?
      // ======================================================

      let gamesToday =
        [];

      let scheduleError =
        null;


      try {

        gamesToday =
          await apiSports(
            `/games` +
            `?league=1` +
            `&season=${season}` +
            `&date=${encodeURIComponent(
              central.date
            )}` +
            `&timezone=${encodeURIComponent(
              "America/Chicago"
            )}`
          );

      } catch (
        error
      ) {

        /*
         * SAFETY:
         *
         * If schedule lookup fails,
         * DON'T stop injury monitoring.
         *
         * We prefer extra polling over
         * missing an injury change.
         */

        scheduleError =
          error?.message ||
          String(error);
      }


      const isGameDay =
        gamesToday.length > 0;


      // ======================================================
      // FREQUENCY
      //
      // GAME DAY:
      // cron runs every 10 minutes.
      //
      // NO GAME:
      // only first cycle of each hour runs.
      //
      // Our four batches execute at:
      // :00 :02 :04 :06
      //
      // The next cycles:
      // :10 :12 :14 :16...
      // are skipped when there is no NFL game.
      // ======================================================

      if (
        !isGameDay &&
        !scheduleError &&
        central.minute >= 10
      ) {

        return res
          .status(200)
          .json({
            ok: true,

            skipped:
              true,

            reason:
              "no_nfl_games_hourly_mode",

            centralDate:
              central.date,

            centralHour:
              central.hour,

            centralMinute:
              central.minute,

            season,

            start
          });
      }


      // ======================================================
      // RUN INJURY SYNC
      // ======================================================

      const syncUrl =
        `${CASHEDGE_ORIGIN}` +
        `/api/internal/nfl-injury-sync` +
        `?season=${season}` +
        `&start=${start}` +
        `&limit=8`;


      const response =
        await fetch(
          syncUrl,
          {
            method:
              "GET",

            headers: {
              "x-internal-secret":
                cronSecret
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
          `nfl-injury-sync HTTP ${response.status}`
        );
      }


      return res
        .status(200)
        .json({

          ok:
            true,

          cron:
            "nfl-injury",

          centralDate:
            central.date,

          centralHour:
            central.hour,

          centralMinute:
            central.minute,

          season,

          gameDay:
            isGameDay,

          gamesToday:
            gamesToday.length,

          scheduleError,

          start,

          limit:
            8,

          sync:
            body

        });


    } catch (
      error
    ) {

      return res
        .status(500)
        .json({

          ok:
            false,

          cron:
            "nfl-injury",

          error:
            error?.message ||
            String(error)

        });
    }
  };

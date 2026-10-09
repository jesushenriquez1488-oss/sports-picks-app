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
    await response.json();


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
// TEAM NORMALIZATION
// ============================================================

function normalizeNFLTeamName(
  value
) {

  return String(
    value ||
    ""
  )
    .toLowerCase()
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim();
}


// ============================================================
// CENTRAL DATE FOR GAME
// ============================================================

function getCentralDateFromValue(
  value
) {

  const date =
    new Date(
      value
    );


  if (
    !Number.isFinite(
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


// ============================================================
// ADD DAYS
// ============================================================

function addDaysToDate(
  dateString,
  days
) {

  const [
    year,
    month,
    day
  ] =
    String(
      dateString
    )
      .split("-")
      .map(
        Number
      );


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day +
        Number(
          days ||
          0
        )
      )
    );


  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


// ============================================================
// DID THIS TEAM CHANGE?
// ============================================================

function teamHadInjuryChange(
  teamResult
) {

  return [
    "inserted",
    "changed",
    "reactivated",
    "deactivated"
  ]
    .some(
      key =>
        Number(
          teamResult?.[key] ||
          0
        ) > 0
    );
}


// ============================================================
// REANALYZE AFFECTED NFL GAME
// ============================================================

async function reanalyzeChangedNFLGames({
  syncBody,
  cronSecret,
  centralDate
}) {

  try {

    // ========================================================
    // CHANGED TEAMS
    // ========================================================

    const changedTeams =
      Array.from(
        new Set(
          (
            syncBody?.teamResults ||
            []
          )
            .filter(
              teamHadInjuryChange
            )
            .map(
              row =>
                String(
                  row?.team ||
                  ""
                ).trim()
            )
            .filter(
              Boolean
            )
        )
      );


    if (
      !changedTeams.length
    ) {

      return {
        ok: true,
        triggered: false,
        changedTeams: [],
        gamesFound: 0,
        gamesReanalyzed: 0,
        results: []
      };
    }


    // ========================================================
    // FRESH NFL ODDS
    // ========================================================

    const oddsResponse =
      await fetch(
        `${CASHEDGE_ORIGIN}` +
        `/api/odds` +
        `?sport=americanfootball_nfl` +
        `&force=true`,
        {
          headers: {
            "X-Internal-Secret":
              cronSecret
          }
        }
      );


    const oddsBody =
      await oddsResponse
        .json()
        .catch(
          () => null
        );


    if (
      !oddsResponse.ok ||
      !Array.isArray(
        oddsBody
      )
    ) {

      return {
        ok: false,
        triggered: true,
        changedTeams,
        gamesFound: 0,
        gamesReanalyzed: 0,

        error:
          oddsBody?.error ||
          `NFL odds HTTP ${oddsResponse.status}`,

        results: []
      };
    }


    // ========================================================
    // ONLY TODAY + NEXT 6 DAYS
    // ========================================================

    const changedSet =
      new Set(
        changedTeams.map(
          normalizeNFLTeamName
        )
      );


    const footballWindow =
      new Set(
        Array.from(
          {
            length: 7
          },
          (
            _,
            index
          ) =>
            addDaysToDate(
              centralDate,
              index
            )
        )
      );


    const targets =
      new Map();


    for (
      const game of
      oddsBody
    ) {

      const awayTeam =
        String(
          game?.away_team ||
          game?.awayTeam ||
          ""
        ).trim();


      const homeTeam =
        String(
          game?.home_team ||
          game?.homeTeam ||
          ""
        ).trim();


      if (
        !awayTeam ||
        !homeTeam
      ) {
        continue;
      }


      const gameDate =
        getCentralDateFromValue(
          game?.commence_time ||
          game?.commenceTime ||
          game?.game_time
        );


      if (
        !gameDate ||
        !footballWindow.has(
          gameDate
        )
      ) {
        continue;
      }


      const affected =
        changedSet.has(
          normalizeNFLTeamName(
            awayTeam
          )
        ) ||
        changedSet.has(
          normalizeNFLTeamName(
            homeTeam
          )
        );


      if (
        !affected
      ) {
        continue;
      }


      const key =
        String(
          game?.id ||
          `${awayTeam}|${homeTeam}|${gameDate}`
        );


      targets.set(
        key,
        {
          game,
          awayTeam,
          homeTeam,
          gameDate
        }
      );
    }


    // ========================================================
    // FORCE REANALYSIS
    // ========================================================

    const results =
      [];


    for (
      const target of
      targets.values()
    ) {

      const params =
        new URLSearchParams({
          type:
            "nfl",

          teamA:
            target.awayTeam,

          teamB:
            target.homeTeam,

          force:
            "true"
        });


      const response =
        await fetch(
          `${CASHEDGE_ORIGIN}` +
          `/api/football-data` +
          `?${params.toString()}`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              "X-Internal-Secret":
                cronSecret
            },

            body:
              JSON.stringify({
                oddsSnapshot:
                  target.game,

                force:
                  true
              })
          }
        );


      const data =
        await response
          .json()
          .catch(
            () => null
          );


      results.push({

        game:
          `${target.awayTeam} vs ${target.homeTeam}`,

        gameDate:
          target.gameDate,

        ok:
          response.ok,

        status:
          response.status,

        frozen:
          data?.frozen ===
          true,

        noPlay:
          data?.noPlay ===
          true,

        projectedSpread:
          data?.projectedSpread ??
          null,

        error:
          response.ok
            ? null
            : (
                data?.error ||
                `football-data HTTP ${response.status}`
              )
      });
    }


    return {

      ok:
        results.every(
          item =>
            item.ok
        ),

      triggered:
        true,

      changedTeams,

      gamesFound:
        targets.size,

      gamesReanalyzed:
        results.filter(
          item =>
            item.ok &&
            item.frozen !==
              true
        ).length,

      results
    };


  } catch (
    error
  ) {

    return {

      ok: false,

      triggered:
        true,

      changedTeams:
        [],

      gamesFound:
        0,

      gamesReanalyzed:
        0,

      error:
        error?.message ||
        String(error),

      results:
        []
    };
  }
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
    // AUTH
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
      // GAME DAY?
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

        scheduleError =
          error?.message ||
          String(error);
      }


      const isGameDay =
        gamesToday.length >
        0;


      // ======================================================
      // NON-GAME DAY = HOURLY
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
      // SYNC INJURIES
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
        body?.ok !==
          true
      ) {

        throw new Error(
          body?.error ||
          `nfl-injury-sync HTTP ${response.status}`
        );
      }


      // ======================================================
      // AUTO REANALYSIS
      // ======================================================

      const reanalysis =
        await reanalyzeChangedNFLGames({
          syncBody:
            body,

          cronSecret,

          centralDate:
            central.date
        });


      // ======================================================
      // RESPONSE
      // ======================================================

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
            body,

          reanalysis

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

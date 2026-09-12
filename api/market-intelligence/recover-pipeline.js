const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const {
  runMarketPipeline
} =
  require("../../lib/marketPipeline");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// CONFIG
// ============================================================

const MAX_GAMES_PER_RECOVERY_RUN =
  20;


const MAX_RECOVERY_ATTEMPTS =
  5;


/*
 * Backoff after real processing failures:
 *
 * attempt 1 = 1 minute
 * attempt 2 = 2 minutes
 * attempt 3 = 5 minutes
 * attempt 4 = 10 minutes
 * attempt 5 = 30 minutes
 */
const RECOVERY_BACKOFF_MINUTES =
  [
    1,
    2,
    5,
    10,
    30
  ];


// ============================================================
// SECURITY
// ============================================================

function secureEqual(
  supplied,
  expected
) {

  if (
    !supplied ||
    !expected
  ) {
    return false;
  }


  const a =
    crypto
      .createHash("sha256")
      .update(
        String(supplied)
      )
      .digest();


  const b =
    crypto
      .createHash("sha256")
      .update(
        String(expected)
      )
      .digest();


  return crypto
    .timingSafeEqual(
      a,
      b
    );
}


// ============================================================
// HELPERS
// ============================================================

function nowIso() {

  return new Date()
    .toISOString();
}


function dateMs(value) {

  if (!value) {
    return null;
  }


  const ms =
    new Date(value)
      .getTime();


  return Number.isFinite(ms)
    ? ms
    : null;
}


function isRecoveryCandidate(
  row,
  nowMs
) {

  // ==========================================================
  // EXPIRED / BROKEN ACTIVE LOCK
  // ==========================================================

  if (
    row.processing ===
    true
  ) {

    const leaseMs =
      dateMs(
        row.lease_until
      );


    if (
      leaseMs === null ||
      leaseMs <= nowMs
    ) {

      return true;
    }


    // Another healthy worker still owns it.
    return false;
  }


  // ==========================================================
  // WORKER YIELDED OR NEW WORK IS PENDING
  // ==========================================================

  if (
    row.rerun_requested ===
    true
  ) {
    return true;
  }


  // ==========================================================
  // PREVIOUS PIPELINE ERROR
  // ==========================================================

  if (
    row.last_error
  ) {

    const attempts =
      Number(
        row
          .recovery_attempt_count ||
        0
      );


    if (
      attempts >=
      MAX_RECOVERY_ATTEMPTS
    ) {

      return false;
    }


    const nextRecoveryMs =
      dateMs(
        row.next_recovery_at
      );


    if (
      nextRecoveryMs !== null &&
      nextRecoveryMs > nowMs
    ) {

      return false;
    }


    return true;
  }


  // ==========================================================
  // EXPLICIT SCHEDULED RECOVERY
  // ==========================================================

  const nextRecoveryMs =
    dateMs(
      row.next_recovery_at
    );


  if (
    nextRecoveryMs !== null &&
    nextRecoveryMs <= nowMs
  ) {

    return true;
  }


  return false;
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    /*
     * Vercel Cron invokes cron routes with GET.
     *
     * This is the ONLY reason this internal endpoint is GET.
     *
     * Authentication is still Bearer-only.
     * No secret appears in the URL.
     */
    if (
      req.method !==
      "GET"
    ) {

      return res
        .status(405)
        .json({

          ok:
            false,

          error:
            "GET required"
        });
    }


    try {

      // ======================================================
      // AUTH
      // ======================================================

      const configuredSecret =
        process.env
          .CRON_SECRET;


      if (
        !configuredSecret
      ) {

        return res
          .status(500)
          .json({

            ok:
              false,

            error:
              "CRON_SECRET is not configured"
          });
      }


      const authHeader =
        String(
          req.headers
            .authorization ||
          ""
        );


      const bearer =
        authHeader
          .startsWith(
            "Bearer "
          )
          ? authHeader
              .slice(7)
              .trim()
          : "";


      if (
        !secureEqual(
          bearer,
          configuredSecret
        )
      ) {

        return res
          .status(401)
          .json({

            ok:
              false,

            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // MASTER SWITCH
      //
      // Recovery remains dormant until Event Detection is
      // intentionally activated.
      // ======================================================

      const {
        data: settings,
        error: settingsError
      } =
        await supabaseAdmin
          .from(
            "market_intelligence_settings"
          )
          .select(`
            shadow_mode,
            event_detection_enabled
          `)
          .eq(
            "id",
            1
          )
          .maybeSingle();


      if (
        settingsError
      ) {
        throw settingsError;
      }


      if (
        settings
          ?.event_detection_enabled !==
        true
      ) {

        return res
          .status(200)
          .json({

            ok:
              true,

            skipped:
              true,

            reason:
              "Market pipeline recovery disabled while event detection is disabled"
          });
      }


      // ======================================================
      // POTENTIAL RECOVERY ROWS
      // ======================================================

      const {
        data: rows,
        error: rowsError
      } =
        await supabaseAdmin
          .from(
            "market_pipeline_coordination"
          )
          .select(`
            cashedge_game_id,
            sport,

            processing,
            rerun_requested,

            lease_until,

            last_provider_timestamp,
            last_received_at,
            last_finished_at,

            last_error,

            recovery_attempt_count,
            last_recovery_at,
            next_recovery_at,
            last_recovery_error,

            updated_at
          `)
          .or(
            [
              "processing.eq.true",
              "rerun_requested.eq.true",
              "last_error.not.is.null",
              "next_recovery_at.not.is.null"
            ].join(",")
          )
          .order(
            "updated_at",
            {
              ascending:
                true
            }
          )
          .limit(100);


      if (
        rowsError
      ) {
        throw rowsError;
      }


      const nowMs =
        Date.now();


      const candidates =
        (rows || [])
          .filter(
            row =>
              isRecoveryCandidate(
                row,
                nowMs
              )
          )
          .slice(
            0,
            MAX_GAMES_PER_RECOVERY_RUN
          );


      let recovered =
        0;

      let queued =
        0;

      let yielded =
        0;

      let failed =
        0;

      let maxRetries =
        0;


      const results =
        [];


      // ======================================================
      // RECOVER EACH GAME
      //
      // Per-game DB locking still protects against overlap
      // between this Recovery function and live ingestion.
      // ======================================================

      for (
        const row
        of candidates
      ) {

        const gameId =
          row
            .cashedge_game_id;


        const recoveryStartedAt =
          nowIso();


        // Record attempt time.
        //
        // Do NOT increment failure count yet.
        // Only actual failures count toward max retry limit.

        await supabaseAdmin
          .from(
            "market_pipeline_coordination"
          )
          .update({

            last_recovery_at:
              recoveryStartedAt,

            updated_at:
              recoveryStartedAt
          })
          .eq(
            "cashedge_game_id",
            gameId
          );


        try {

          const result =
            await runMarketPipeline({

              supabaseAdmin,

              gameId,

              sport:
                row.sport ||
                null,

              providerTimestamp:
                row
                  .last_provider_timestamp ||
                null,

              receivedAt:
                row
                  .last_received_at ||
                recoveryStartedAt
            });


          if (
            result
              ?.queued ===
            true
          ) {

            queued +=
              1;


            results.push({

              gameId,

              status:
                "already_processing"
            });


            continue;
          }


          if (
            result
              ?.staleOwner ===
            true
          ) {

            queued +=
              1;


            results.push({

              gameId,

              status:
                "ownership_changed"
            });


            continue;
          }


          if (
            result
              ?.yielded ===
            true
          ) {

            yielded +=
              1;


            const nextRecoveryAt =
              new Date(
                Date.now() +
                60 * 1000
              )
                .toISOString();


            await supabaseAdmin
              .from(
                "market_pipeline_coordination"
              )
              .update({

                next_recovery_at:
                  nextRecoveryAt,

                updated_at:
                  nowIso()
              })
              .eq(
                "cashedge_game_id",
                gameId
              );


            results.push({

              gameId,

              status:
                "yielded_pending"
            });


            continue;
          }


          recovered +=
            1;


          results.push({

            gameId,

            status:
              "recovered"
          });


        } catch (error) {

          failed +=
            1;


          const errorMessage =
            String(
              error.message ||
              error
            );


          const nextAttempt =
            Number(
              row
                .recovery_attempt_count ||
              0
            ) + 1;


          if (
            nextAttempt >=
            MAX_RECOVERY_ATTEMPTS
          ) {

            maxRetries +=
              1;


            await supabaseAdmin
              .from(
                "market_pipeline_coordination"
              )
              .update({

                recovery_attempt_count:
                  nextAttempt,

                next_recovery_at:
                  null,

                last_recovery_error:
                  `[MAX RETRIES] ${errorMessage}`,

                updated_at:
                  nowIso()
              })
              .eq(
                "cashedge_game_id",
                gameId
              );


            results.push({

              gameId,

              status:
                "max_retries",

              attempts:
                nextAttempt
            });


            continue;
          }


          const backoffIndex =
            Math.min(
              nextAttempt - 1,
              RECOVERY_BACKOFF_MINUTES
                .length - 1
            );


          const delayMinutes =
            RECOVERY_BACKOFF_MINUTES[
              backoffIndex
            ];


          const nextRecoveryAt =
            new Date(
              Date.now() +
              delayMinutes *
              60 *
              1000
            )
              .toISOString();


          await supabaseAdmin
            .from(
              "market_pipeline_coordination"
            )
            .update({

              recovery_attempt_count:
                nextAttempt,

              next_recovery_at:
                nextRecoveryAt,

              last_recovery_error:
                errorMessage,

              updated_at:
                nowIso()
            })
            .eq(
              "cashedge_game_id",
              gameId
            );


          results.push({

            gameId,

            status:
              "retry_scheduled",

            attempts:
              nextAttempt,

            retryInMinutes:
              delayMinutes
          });
        }
      }


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok:
            true,

          shadowMode:
            settings
              ?.shadow_mode ===
            true,

          candidates:
            candidates.length,

          recovered,
          queued,
          yielded,
          failed,
          maxRetries,

          results
        });


    } catch (error) {

      console.error(
        "MARKET PIPELINE RECOVERY ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message
        });
    }
  };

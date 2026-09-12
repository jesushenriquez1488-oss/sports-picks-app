const crypto =
  require("crypto");

const {
  evaluateMarketEvents
} =
  require("./marketEvents");

const {
  evaluateOpportunityState
} =
  require("./marketOpportunityState");

const {
  evaluateImportantMoves
} =
  require("./marketImportance");


// ============================================================
// CONFIG
// ============================================================

const PIPELINE_LEASE_SECONDS =
  15;

/*
 * Prevent a high-frequency market stream from keeping one
 * Vercel invocation alive indefinitely.
 *
 * If more data is still arriving after this amount of passes,
 * the current worker safely yields and leaves the game pending.
 */
const MAX_PASSES_PER_INVOCATION =
  6;


// ============================================================
// HELPERS
// ============================================================

function nowIso() {

  return new Date()
    .toISOString();
}


function safeDateMs(value) {

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


function diffMs(
  start,
  end
) {

  const a =
    safeDateMs(start);

  const b =
    safeDateMs(end);


  if (
    a === null ||
    b === null
  ) {
    return null;
  }


  return Math.max(
    0,
    Math.round(
      b - a
    )
  );
}


// ============================================================
// SETTINGS
// ============================================================

async function getPipelineSettings(
  supabaseAdmin
) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_intelligence_settings"
      )
      .select(`
        shadow_mode,
        ingestion_enabled,
        event_detection_enabled,
        notifications_enabled,
        frontend_enabled
      `)
      .eq(
        "id",
        1
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// DURABLE PENDING SIGNAL
//
// Once event detection is enabled, every real market update
// creates a durable "this game needs processing" marker BEFORE
// attempting to acquire the worker lock.
//
// If the worker dies later, Recovery can see the pending state.
// ============================================================

async function signalPending({

  supabaseAdmin,

  gameId,
  sport,

  providerTimestamp,
  receivedAt

}) {

  const {
    error
  } =
    await supabaseAdmin
      .rpc(
        "signal_market_pipeline_pending_v2",
        {

          p_game_id:
            gameId,

          p_sport:
            sport || null,

          p_provider_timestamp:
            providerTimestamp || null,

          p_received_at:
            receivedAt
        }
      );


  if (error) {
    throw error;
  }
}


// ============================================================
// ACQUIRE LOCK
// ============================================================

async function acquireLock({

  supabaseAdmin,

  gameId,
  sport,

  providerTimestamp,
  receivedAt,

  lockToken

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .rpc(
        "acquire_market_pipeline_v2",
        {

          p_game_id:
            gameId,

          p_lock_token:
            lockToken,

          p_sport:
            sport || null,

          p_provider_timestamp:
            providerTimestamp || null,

          p_received_at:
            receivedAt,

          p_lease_seconds:
            PIPELINE_LEASE_SECONDS
        }
      );


  if (error) {
    throw error;
  }


  return Array.isArray(data)
    ? data[0]
    : data;
}


// ============================================================
// COMPLETE PASS
// ============================================================

async function completePass({

  supabaseAdmin,

  gameId,
  lockToken,

  errorMessage = null

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .rpc(
        "complete_market_pipeline_pass_v2",
        {

          p_game_id:
            gameId,

          p_lock_token:
            lockToken,

          p_error:
            errorMessage,

          p_lease_seconds:
            PIPELINE_LEASE_SECONDS
        }
      );


  if (error) {
    throw error;
  }


  return Array.isArray(data)
    ? data[0]
    : data;
}


// ============================================================
// YIELD LOCK
// ============================================================

async function yieldLock({

  supabaseAdmin,

  gameId,
  lockToken

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .rpc(
        "yield_market_pipeline_v2",
        {

          p_game_id:
            gameId,

          p_lock_token:
            lockToken
        }
      );


  if (error) {
    throw error;
  }


  return Array.isArray(data)
    ? data[0]
    : data;
}


// ============================================================
// GET LATEST SIGNAL
//
// If several sportsbook updates arrived while the previous
// pass was running, the next pass must use the newest
// provider / received timestamps.
// ============================================================

async function getLatestSignal({

  supabaseAdmin,
  gameId

}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "market_pipeline_coordination"
      )
      .select(`
        sport,
        last_provider_timestamp,
        last_received_at
      `)
      .eq(
        "cashedge_game_id",
        gameId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


// ============================================================
// PIPELINE RUN LOG
//
// Logging failures NEVER break Market Intelligence.
// ============================================================

async function savePipelineRun({

  supabaseAdmin,
  payload

}) {

  try {

    const {
      error
    } =
      await supabaseAdmin
        .from(
          "market_pipeline_runs"
        )
        .insert(
          payload
        );


    if (error) {

      console.error(
        "MARKET PIPELINE RUN LOG ERROR:",
        error.message
      );
    }


  } catch (error) {

    console.error(
      "MARKET PIPELINE RUN LOG FAILED:",
      error.message
    );
  }
}


// ============================================================
// RESET RECOVERY STATE AFTER SUCCESS
// ============================================================

async function resetRecoveryState({

  supabaseAdmin,
  gameId

}) {

  try {

    const {
      error
    } =
      await supabaseAdmin
        .from(
          "market_pipeline_coordination"
        )
        .update({

          recovery_attempt_count:
            0,

          next_recovery_at:
            null,

          last_recovery_error:
            null,

          last_error:
            null,

          updated_at:
            nowIso()
        })
        .eq(
          "cashedge_game_id",
          gameId
        );


    if (error) {

      console.error(
        "MARKET PIPELINE RECOVERY RESET ERROR:",
        error.message
      );
    }


  } catch (error) {

    console.error(
      "MARKET PIPELINE RECOVERY RESET FAILED:",
      error.message
    );
  }
}


// ============================================================
// SCHEDULE FIRST RECOVERY AFTER PIPELINE FAILURE
// ============================================================

async function scheduleRecoveryAfterFailure({

  supabaseAdmin,
  gameId,
  errorMessage

}) {

  try {

    const nextRecoveryAt =
      new Date(
        Date.now() +
        60 * 1000
      )
        .toISOString();


    const {
      error
    } =
      await supabaseAdmin
        .from(
          "market_pipeline_coordination"
        )
        .update({

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


    if (error) {

      console.error(
        "MARKET PIPELINE RECOVERY SCHEDULE ERROR:",
        error.message
      );
    }


  } catch (error) {

    console.error(
      "MARKET PIPELINE RECOVERY SCHEDULE FAILED:",
      error.message
    );
  }
}


// ============================================================
// ONE PROCESSING PASS
// ============================================================

async function executePipelinePass({

  supabaseAdmin,

  gameId,
  sport,

  lockToken,

  providerTimestamp,
  receivedAt,

  passNumber

}) {

  const startedAt =
    nowIso();


  let eventsResult =
    null;

  let opportunityResult =
    null;

  let importantResult =
    null;


  let eventsFinishedAt =
    null;

  let opportunityFinishedAt =
    null;

  let importantFinishedAt =
    null;


  let eventsMs =
    null;

  let opportunityMs =
    null;

  let importanceMs =
    null;


  try {

    // ========================================================
    // 1. MARKET EVENTS
    //
    // Internally:
    //
    // Evaluation
    // Sharp
    // Event Engine
    // ========================================================

    const eventsStartedMs =
      Date.now();


    eventsResult =
      await evaluateMarketEvents({

        supabaseAdmin,
        gameId
      });


    eventsMs =
      Date.now() -
      eventsStartedMs;


    eventsFinishedAt =
      nowIso();


    // ========================================================
    // 2. OPPORTUNITY
    // ========================================================

    const opportunityStartedMs =
      Date.now();


    opportunityResult =
      await evaluateOpportunityState({

        supabaseAdmin,
        gameId
      });


    opportunityMs =
      Date.now() -
      opportunityStartedMs;


    opportunityFinishedAt =
      nowIso();


    // ========================================================
    // 3. IMPORTANT MOVES
    // ========================================================

    const importantStartedMs =
      Date.now();


    importantResult =
      await evaluateImportantMoves({

        supabaseAdmin,
        gameId
      });


    importanceMs =
      Date.now() -
      importantStartedMs;


    importantFinishedAt =
      nowIso();


    const finishedAt =
      nowIso();


    // ========================================================
    // PERFORMANCE LOG
    // ========================================================

    await savePipelineRun({

      supabaseAdmin,

      payload: {

        cashedge_game_id:
          gameId,

        sport:
          sport || null,

        lock_token:
          lockToken,

        pass_number:
          passNumber,

        provider_timestamp:
          providerTimestamp || null,

        received_at:
          receivedAt,

        started_at:
          startedAt,

        events_finished_at:
          eventsFinishedAt,

        opportunity_finished_at:
          opportunityFinishedAt,

        important_finished_at:
          importantFinishedAt,

        finished_at:
          finishedAt,

        provider_to_received_ms:
          diffMs(
            providerTimestamp,
            receivedAt
          ),

        events_ms:
          eventsMs,

        opportunity_ms:
          opportunityMs,

        importance_ms:
          importanceMs,

        total_ms:
          diffMs(
            startedAt,
            finishedAt
          ),

        received_to_important_ms:
          diffMs(
            receivedAt,
            importantFinishedAt
          ),

        alignment_state:
          eventsResult
            ?.alignment ||
          null,

        sharp_signal:
          eventsResult
            ?.sharp
            ?.signal ||
          null,

        opportunity_state:
          opportunityResult
            ?.state ||
          null,

        important_now:
          importantResult
            ?.importantNow ===
            true,

        importance_level:
          Number(
            importantResult
              ?.importanceLevel ||
            0
          ),

        status:
          "success",

        error:
          null
      }
    });


    return {

      ok:
        true,

      startedAt,
      finishedAt,

      totalMs:
        diffMs(
          startedAt,
          finishedAt
        ),

      eventsMs,
      opportunityMs,
      importanceMs,

      events:
        eventsResult,

      opportunity:
        opportunityResult,

      importantMoves:
        importantResult
    };


  } catch (error) {

    const finishedAt =
      nowIso();


    await savePipelineRun({

      supabaseAdmin,

      payload: {

        cashedge_game_id:
          gameId,

        sport:
          sport || null,

        lock_token:
          lockToken,

        pass_number:
          passNumber,

        provider_timestamp:
          providerTimestamp || null,

        received_at:
          receivedAt,

        started_at:
          startedAt,

        events_finished_at:
          eventsFinishedAt,

        opportunity_finished_at:
          opportunityFinishedAt,

        important_finished_at:
          importantFinishedAt,

        finished_at:
          finishedAt,

        provider_to_received_ms:
          diffMs(
            providerTimestamp,
            receivedAt
          ),

        events_ms:
          eventsMs,

        opportunity_ms:
          opportunityMs,

        importance_ms:
          importanceMs,

        total_ms:
          diffMs(
            startedAt,
            finishedAt
          ),

        received_to_important_ms:
          importantFinishedAt
            ? diffMs(
                receivedAt,
                importantFinishedAt
              )
            : null,

        alignment_state:
          eventsResult
            ?.alignment ||
          null,

        sharp_signal:
          eventsResult
            ?.sharp
            ?.signal ||
          null,

        opportunity_state:
          opportunityResult
            ?.state ||
          null,

        important_now:
          importantResult
            ?.importantNow ===
            true,

        importance_level:
          Number(
            importantResult
              ?.importanceLevel ||
            0
          ),

        status:
          "error",

        error:
          String(
            error.message ||
            error
          )
      }
    });


    throw error;
  }
}


// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

async function runMarketPipeline({

  supabaseAdmin,

  gameId,
  sport = null,

  providerTimestamp = null,
  receivedAt = null

}) {

  if (
    !gameId ||
    !String(gameId).trim()
  ) {

    throw new Error(
      "gameId is required"
    );
  }


  const cleanGameId =
    String(gameId)
      .trim();


  const triggerReceivedAt =
    receivedAt ||
    nowIso();


  // ==========================================================
  // MASTER SETTINGS
  // ==========================================================

  const settings =
    await getPipelineSettings(
      supabaseAdmin
    );


  /*
   * Architecture remains completely dormant until we
   * intentionally enable Market Event Detection.
   */
  if (
    settings
      ?.event_detection_enabled !==
    true
  ) {

    return {

      ok:
        true,

      skipped:
        true,

      reason:
        "Market pipeline disabled while event detection is disabled",

      shadowMode:
        settings
          ?.shadow_mode ===
        true
    };
  }


  // ==========================================================
  // DURABLE PENDING MARKER
  //
  // From this moment, Recovery can see that fresh market data
  // needs to be processed even if this worker later dies.
  // ==========================================================

  await signalPending({

    supabaseAdmin,

    gameId:
      cleanGameId,

    sport,

    providerTimestamp,

    receivedAt:
      triggerReceivedAt
  });


  // ==========================================================
  // UNIQUE WORKER TOKEN
  // ==========================================================

  const lockToken =
    crypto.randomUUID();


  // ==========================================================
  // TRY TO OWN THIS GAME
  // ==========================================================

  const lock =
    await acquireLock({

      supabaseAdmin,

      gameId:
        cleanGameId,

      sport,

      providerTimestamp,

      receivedAt:
        triggerReceivedAt,

      lockToken
    });


  // Another worker owns this game.
  //
  // The database has already marked rerun_requested=true.

  if (
    lock?.acquired !==
    true
  ) {

    return {

      ok:
        true,

      queued:
        true,

      processing:
        false,

      reason:
        "Game already processing; rerun requested",

      gameId:
        cleanGameId,

      leaseUntil:
        lock
          ?.current_lease_until ||
        null
    };
  }


  // ==========================================================
  // WE OWN THE GAME
  // ==========================================================

  let passNumber =
    0;


  const passes =
    [];


  try {

    while (true) {

      passNumber +=
        1;


      // ======================================================
      // USE NEWEST RECEIVED MARKET UPDATE
      // ======================================================

      const latestSignal =
        await getLatestSignal({

          supabaseAdmin,

          gameId:
            cleanGameId
        });


      const passSport =
        latestSignal
          ?.sport ||
        sport;


      const passProviderTimestamp =
        latestSignal
          ?.last_provider_timestamp ||
        providerTimestamp;


      const passReceivedAt =
        latestSignal
          ?.last_received_at ||
        triggerReceivedAt;


      // ======================================================
      // EXECUTE ONE PASS
      // ======================================================

      const pass =
        await executePipelinePass({

          supabaseAdmin,

          gameId:
            cleanGameId,

          sport:
            passSport,

          lockToken,

          providerTimestamp:
            passProviderTimestamp,

          receivedAt:
            passReceivedAt,

          passNumber
        });


      passes.push({

        pass:
          passNumber,

        totalMs:
          pass.totalMs,

        importantNow:
          pass
            ?.importantMoves
            ?.importantNow ===
          true,

        importanceLevel:
          Number(
            pass
              ?.importantMoves
              ?.importanceLevel ||
            0
          ),

        opportunityState:
          pass
            ?.opportunity
            ?.state ||
          null
      });


      // ======================================================
      // COMPLETE PASS ATOMICALLY
      // ======================================================

      const completion =
        await completePass({

          supabaseAdmin,

          gameId:
            cleanGameId,

          lockToken
        });


      // ======================================================
      // STALE WORKER
      //
      // Never modify another worker's lock.
      // ======================================================

      if (
        completion
          ?.ownership_valid !==
        true
      ) {

        return {

          ok:
            true,

          staleOwner:
            true,

          gameId:
            cleanGameId,

          passCount:
            passNumber,

          passes
        };
      }


      // ======================================================
      // EVERYTHING CAUGHT UP
      // ======================================================

      if (
        completion
          ?.continue_processing !==
        true
      ) {

        await resetRecoveryState({

          supabaseAdmin,

          gameId:
            cleanGameId
        });


        break;
      }


      // ======================================================
      // TOO MANY CONTINUOUS PASSES
      //
      // Do NOT let one Vercel invocation run forever.
      //
      // Safely release our own lock and leave this game marked
      // as pending.
      // ======================================================

      if (
        passNumber >=
        MAX_PASSES_PER_INVOCATION
      ) {

        const yielded =
          await yieldLock({

            supabaseAdmin,

            gameId:
              cleanGameId,

            lockToken
          });


        return {

          ok:
            true,

          processed:
            true,

          yielded:
            yielded
              ?.yielded ===
            true,

          pending:
            true,

          gameId:
            cleanGameId,

          passCount:
            passNumber,

          reason:
            "Maximum continuous passes reached; game safely left pending",

          passes
        };
      }


      /*
       * Fresh data arrived during the pass.
       *
       * Same worker retains ownership and immediately processes
       * the newest database state.
       */
    }


    return {

      ok:
        true,

      processed:
        true,

      gameId:
        cleanGameId,

      passCount:
        passNumber,

      passes
    };


  } catch (error) {

    const errorMessage =
      String(
        error.message ||
        error
      );


    // ========================================================
    // RELEASE ONLY OUR OWN LOCK
    // ========================================================

    try {

      await completePass({

        supabaseAdmin,

        gameId:
          cleanGameId,

        lockToken,

        errorMessage
      });


    } catch (
      releaseError
    ) {

      console.error(
        "MARKET PIPELINE LOCK RELEASE ERROR:",
        releaseError.message
      );
    }


    // ========================================================
    // MAKE FAILURE RECOVERABLE
    // ========================================================

    await scheduleRecoveryAfterFailure({

      supabaseAdmin,

      gameId:
        cleanGameId,

      errorMessage
    });


    throw error;
  }
}


module.exports = {

  runMarketPipeline
};

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
// SAVE PERFORMANCE RUN
//
// Observability must never break the market pipeline.
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


  try {

    // ========================================================
    // 1. MARKET EVENTS
    //
    // Internally:
    // Evaluation -> Sharp -> Event Engine
    // ========================================================

    const eventsStartedMs =
      Date.now();


    eventsResult =
      await evaluateMarketEvents({

        supabaseAdmin,
        gameId
      });


    const eventsMs =
      Date.now() -
      eventsStartedMs;


    eventsFinishedAt =
      nowIso();


    // ========================================================
    // 2. OPPORTUNITY STATE
    // ========================================================

    const opportunityStartedMs =
      Date.now();


    opportunityResult =
      await evaluateOpportunityState({

        supabaseAdmin,
        gameId
      });


    const opportunityMs =
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


    const importanceMs =
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

      ok: true,

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


  // While architecture is dormant,
  // do not even acquire a processing lock.
  if (
    settings
      ?.event_detection_enabled !==
    true
  ) {

    return {

      ok: true,

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
  // UNIQUE OWNER TOKEN
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


  // Another Vercel instance already owns it.
  // Our RPC already marked rerun_requested=true.
  if (
    lock?.acquired !== true
  ) {

    return {

      ok: true,

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

  let passNumber = 0;

  const passes = [];


  try {

    while (true) {

      passNumber += 1;


      const pass =
        await executePipelinePass({

          supabaseAdmin,

          gameId:
            cleanGameId,

          sport,

          lockToken,

          providerTimestamp,

          receivedAt:
            triggerReceivedAt,

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


      // We somehow lost ownership.
      // Never touch another instance's lock.
      if (
        completion
          ?.ownership_valid !==
        true
      ) {

        return {

          ok: true,

          staleOwner:
            true,

          gameId:
            cleanGameId,

          passes
        };
      }


      // No market update arrived while processing.
      if (
        completion
          ?.continue_processing !==
        true
      ) {

        break;
      }


      // Otherwise:
      // rerun_requested was true.
      // Same owner immediately does another pass
      // using newest database state.
    }


    return {

      ok: true,

      processed:
        true,

      gameId:
        cleanGameId,

      passCount:
        passNumber,

      passes
    };


  } catch (error) {

    // ========================================================
    // RELEASE OUR LOCK ON FAILURE
    // ========================================================

    try {

      await completePass({

        supabaseAdmin,

        gameId:
          cleanGameId,

        lockToken,

        errorMessage:
          String(
            error.message ||
            error
          )
      });


    } catch (
      releaseError
    ) {

      console.error(
        "MARKET PIPELINE LOCK RELEASE ERROR:",
        releaseError.message
      );
    }


    throw error;
  }
}


module.exports = {
  runMarketPipeline
};

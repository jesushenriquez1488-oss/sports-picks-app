// ============================================================
// CASHEDGE — PREMIUM RADAR B1
// Synchronization layer
//
// IMPORTANT:
// - Radar NEVER calculates sports analysis.
// - Radar NEVER changes daily_picks.
// - Radar NEVER changes picks_history.
// - Radar only copies canonical values already produced by CashEdge.
// - A Radar failure must NEVER break the canonical analysis.
// ============================================================

function radarNum(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function radarBool(value) {
  return value === true;
}


function sameText(a, b) {
  return String(a ?? "") === String(b ?? "");
}


function sameNumber(a, b) {
  const x = radarNum(a);
  const y = radarNum(b);

  if (x === null && y === null) {
    return true;
  }

  if (x === null || y === null) {
    return false;
  }

  return Math.abs(x - y) < 0.0001;
}


// ============================================================
// MAIN SYNC
// ============================================================

async function syncPremiumRadar({
  supabaseAdmin,

  // Source identity
  sourceDailyPickId,
  sport,
  gameId,
  gameDate,
  awayTeam = null,
  homeTeam = null,

  // Canonical current state
  isPremium,
  pick = null,
  confidence = null,
  edge = null,
  projection = null,
  recommendation = null,

  // Market
  openingMarketLine = null,
  currentMarketLine = null,

  // Optional canonical context
  injuryAdjustment = null,
  weatherAdjustment = null,
  starterState = null,
  pitcherId = null,

  // Source version
  sourceUpdatedAt = null
}) {

  /*
   * CRITICAL:
   * Radar is never allowed to break the normal CashEdge analysis.
   *
   * Any failure is captured here and returned instead of thrown.
   */
  try {

    if (!supabaseAdmin) {
      return {
        ok: false,
        skipped: true,
        reason: "missing_supabase"
      };
    }

    if (!sport || !gameId) {
      return {
        ok: false,
        skipped: true,
        reason: "missing_identity"
      };
    }

    const now =
      new Date().toISOString();

    const premiumNow =
      radarBool(isPremium);

    const canonicalConfidence =
      radarNum(confidence);

    const canonicalEdge =
      radarNum(edge);

    const canonicalOpeningLine =
      radarNum(openingMarketLine);

    const canonicalCurrentLine =
      radarNum(currentMarketLine);


    // ========================================================
    // 1. LOOK FOR EXISTING RADAR ENTRY
    // ========================================================

    const {
      data: existing,
      error: existingError
    } =
      await supabaseAdmin
        .from("premium_radar")
        .select("*")
        .eq("sport", sport)
        .eq("game_id", gameId)
        .maybeSingle();


    if (existingError) {
      console.error(
        "Premium Radar lookup error:",
        existingError.message
      );

      return {
        ok: false,
        error: existingError.message
      };
    }


    // ========================================================
    // 2. NEVER PREMIUM + NEVER IN RADAR
    //
    // Do nothing.
    //
    // We do NOT fill premium_radar with every game.
    // A game enters Radar only after CashEdge itself marks it
    // Premium at least once.
    // ========================================================

    if (!existing && !premiumNow) {
      return {
        ok: true,
        skipped: true,
        reason: "never_premium"
      };
    }


    // ========================================================
    // 3. FIRST TIME THE GAME ENTERS PREMIUM RADAR
    // ========================================================

    if (!existing && premiumNow) {

      const lineMovement =
        canonicalOpeningLine !== null &&
        canonicalCurrentLine !== null
          ? Number(
              (
                canonicalCurrentLine -
                canonicalOpeningLine
              ).toFixed(3)
            )
          : null;


      const {
        data: createdRadar,
        error: insertRadarError
      } =
        await supabaseAdmin
          .from("premium_radar")
          .insert({
            source_daily_pick_id:
              sourceDailyPickId || null,

            sport,
            game_id: gameId,
            game_date: gameDate,

            away_team: awayTeam,
            home_team: homeTeam,

            first_seen_at: now,
            first_premium_at: now,

            /*
             * IMPORTANT:
             *
             * opening_market_line is ONLY populated
             * if we truly know the opening line.
             *
             * We do not invent an opening line.
             */
            opening_market_line:
              canonicalOpeningLine,

            first_premium_market_line:
              canonicalCurrentLine,

            current_market_line:
              canonicalCurrentLine,

            line_movement:
              lineMovement,

            current_is_premium: true,

            current_pick:
              pick,

            current_confidence:
              canonicalConfidence,

            current_edge:
              canonicalEdge,

            current_projection:
              projection,

            current_recommendation:
              recommendation,

            game_status:
              "scheduled",

            result:
              "pending",

            source_updated_at:
              sourceUpdatedAt || null,

            last_synced_at:
              now,

            updated_at:
              now
          })
          .select("id")
          .single();


      if (insertRadarError) {
        console.error(
          "Premium Radar insert error:",
          insertRadarError.message
        );

        return {
          ok: false,
          error: insertRadarError.message
        };
      }


      // ======================================================
      // FIRST SNAPSHOT
      // ======================================================

      const {
        error: firstVersionError
      } =
        await supabaseAdmin
          .from("analysis_versions")
          .insert({
            radar_id:
              createdRadar.id,

            sport,
            game_id:
              gameId,

            pick,

            confidence:
              canonicalConfidence,

            edge:
              canonicalEdge,

            projection,

            recommendation,

            premium_status:
              true,

            market_line:
              canonicalCurrentLine,

            injury_adjustment:
              injuryAdjustment,

            weather_adjustment:
              weatherAdjustment,

            starter_state:
              starterState,

            pitcher_id:
              pitcherId || null,

            reason_code:
              "PREMIUM_ENTERED",

            /*
             * Message engine comes later.
             * Do NOT invent human explanations here.
             */
            reason_text:
              null,

            source_updated_at:
              sourceUpdatedAt || null
          });


      if (firstVersionError) {
        console.error(
          "Premium Radar first snapshot error:",
          firstVersionError.message
        );
      }


      return {
        ok: true,
        created: true,
        radarId:
          createdRadar.id,
        event:
          "PREMIUM_ENTERED"
      };
    }


    // ========================================================
    // 4. GAME ALREADY EXISTS IN RADAR
    // ========================================================

    const wasPremium =
      existing.current_is_premium === true;


    let reasonCode = null;


    // ========================================================
    // PREMIUM STATUS CHANGE
    // Highest priority in B1
    // ========================================================

    if (
      wasPremium === false &&
      premiumNow === true
    ) {
      reasonCode =
        "PREMIUM_ENTERED";

    } else if (
      wasPremium === true &&
      premiumNow === false
    ) {
      reasonCode =
        "PREMIUM_EXITED";
    }


    // ========================================================
    // PICK CHANGE
    //
    // We preserve it because a change in canonical
    // recommendation is always material.
    //
    // Later we can refine MODEL_UPDATE into more specific
    // reason codes if CashEdge knows the real cause.
    // ========================================================

    if (
      !reasonCode &&
      !sameText(
        existing.current_pick,
        pick
      )
    ) {
      reasonCode =
        "MODEL_UPDATE";
    }


    // ========================================================
    // UPDATE MARKET MOVEMENT
    //
    // Only calculate OPEN -> CURRENT when a real OPEN exists.
    // ========================================================

    const storedOpeningLine =
      radarNum(
        existing.opening_market_line
      );

    const effectiveOpeningLine =
      storedOpeningLine !== null
        ? storedOpeningLine
        : canonicalOpeningLine;


    const lineMovement =
      effectiveOpeningLine !== null &&
      canonicalCurrentLine !== null
        ? Number(
            (
              canonicalCurrentLine -
              effectiveOpeningLine
            ).toFixed(3)
          )
        : null;


    // ========================================================
    // UPDATE CURRENT STATE
    //
    // This reflects canonical CashEdge.
    // Radar does NOT reinterpret anything.
    // ========================================================

    const {
      error: updateError
    } =
      await supabaseAdmin
        .from("premium_radar")
        .update({
          source_daily_pick_id:
            sourceDailyPickId ||
            existing.source_daily_pick_id ||
            null,

          game_date:
            gameDate ||
            existing.game_date,

          away_team:
            awayTeam ||
            existing.away_team,

          home_team:
            homeTeam ||
            existing.home_team,

          opening_market_line:
            effectiveOpeningLine,

          current_market_line:
            canonicalCurrentLine,

          line_movement:
            lineMovement,

          current_is_premium:
            premiumNow,

          current_pick:
            pick,

          current_confidence:
            canonicalConfidence,

          current_edge:
            canonicalEdge,

          current_projection:
            projection,

          current_recommendation:
            recommendation,

          source_updated_at:
            sourceUpdatedAt || null,

          last_synced_at:
            now,

          updated_at:
            now
        })
        .eq(
          "id",
          existing.id
        );


    if (updateError) {
      console.error(
        "Premium Radar update error:",
        updateError.message
      );

      return {
        ok: false,
        error: updateError.message
      };
    }


    // ========================================================
    // 5. NO MATERIAL CHANGE
    //
    // Current state was updated, but we do NOT create
    // unnecessary timeline snapshots.
    // ========================================================

    if (!reasonCode) {

      return {
        ok: true,
        updated: true,
        snapshotCreated: false
      };
    }


    // ========================================================
    // 6. MATERIAL SNAPSHOT
    // ========================================================

    const {
      error: versionError
    } =
      await supabaseAdmin
        .from("analysis_versions")
        .insert({
          radar_id:
            existing.id,

          sport,

          game_id:
            gameId,

          pick,

          confidence:
            canonicalConfidence,

          edge:
            canonicalEdge,

          projection,

          recommendation,

          premium_status:
            premiumNow,

          market_line:
            canonicalCurrentLine,

          injury_adjustment:
            injuryAdjustment,

          weather_adjustment:
            weatherAdjustment,

          starter_state:
            starterState,

          pitcher_id:
            pitcherId || null,

          reason_code:
            reasonCode,

          reason_text:
            null,

          source_updated_at:
            sourceUpdatedAt || null
        });


    if (versionError) {
      console.error(
        "Premium Radar snapshot error:",
        versionError.message
      );
    }


    return {
      ok: true,
      updated: true,
      snapshotCreated:
        !versionError,
      event:
        reasonCode
    };


  } catch (error) {

    console.error(
      "Premium Radar unexpected error:",
      error.message
    );

    /*
     * NEVER throw.
     *
     * The canonical CashEdge analysis must continue
     * even if Radar has a problem.
     */
    return {
      ok: false,
      error:
        error.message
    };
  }
}


module.exports = {
  syncPremiumRadar
};

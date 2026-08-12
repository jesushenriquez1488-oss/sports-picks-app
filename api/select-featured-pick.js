const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TIME_ZONE = "America/Chicago";

/* =========================================================
   FECHAS CASHEDGE — AMERICA/CHICAGO
========================================================= */

function chicagoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function shiftDate(ymd, days) {
  const [year, month, day] =
    String(ymd).split("-").map(Number);

  const d = new Date(
    Date.UTC(year, month - 1, day + days)
  );

  return d.toISOString().slice(0, 10);
}

function getWeekStart(ymd) {
  const [year, month, day] =
    String(ymd).split("-").map(Number);

  const d = new Date(
    Date.UTC(year, month - 1, day, 12)
  );

  const dayOfWeek = d.getUTCDay();

  // domingo=0, lunes=1...
  const daysSinceMonday =
    (dayOfWeek + 6) % 7;

  return shiftDate(
    ymd,
    -daysSinceMonday
  );
}

function getDayOfWeek(ymd) {
  const [year, month, day] =
    String(ymd).split("-").map(Number);

  return new Date(
    Date.UTC(year, month - 1, day, 12)
  ).getUTCDay();
}

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function randomItem(arr) {
  if (!Array.isArray(arr) || !arr.length) {
    return null;
  }

  return arr[
    Math.floor(Math.random() * arr.length)
  ];
}

/* =========================================================
   SANITIZAR SNAPSHOT
   NUNCA DEVOLVER fullResponse NI OBJETOS INTERNOS
========================================================= */

function sanitizeBasketballAnalysis(
  analysis,
  history
) {
  const premium = analysis?.premium || {};
  const publicData = analysis?.public || {};

  return {
    public: {
      confidence:
        safeNumber(
          publicData.confidence,
          history.confidence
        ),

      risk:
        publicData.risk || null,

      verdict:
        publicData.verdict || null,

      hasPremium: true
    },

    premium: {
      pick:
        premium.pick ||
        history.pick ||
        null,

      confidence:
        safeNumber(
          premium.confidence,
          history.confidence
        ),

      risk:
        premium.risk || null,

      verdict:
        premium.verdict || null,

      mainEdge:
        safeNumber(premium.mainEdge),

      odds_american:
        safeNumber(
          premium.odds_american,
          history.odds_american
        ),

      spreadDiff:
        safeNumber(premium.spreadDiff),

      projA:
        safeNumber(premium.projA),

      projB:
        safeNumber(premium.projB),

      totalProj:
        safeNumber(premium.totalProj),

      totalLine:
        safeNumber(
          premium.totalLine,
          history.line
        ),

      modelAnalysis:
        premium.modelAnalysis || null,

      awayRestNote:
        premium.awayRestNote || null,

      homeRestNote:
        premium.homeRestNote || null,

      awayInjuryPublic:
        premium.awayInjuryPublic || null,

      homeInjuryPublic:
        premium.homeInjuryPublic || null,

      awayRecentForm:
        premium.awayRecentForm || null,

      homeRecentForm:
        premium.homeRecentForm || null
    }
  };
}

function sanitizeMlbAnalysis(
  analysis,
  history
) {
  const premium = analysis?.premium || {};
  const publicData = analysis?.public || {};

  const cards =
    Array.isArray(premium.recommendedCards)
      ? premium.recommendedCards.map(card => ({
          title: card?.title || null,
          play: card?.play || null,
          percentage:
            safeNumber(card?.percentage),
          type: card?.type || null,
          team: card?.team || null,
          odds_american:
            safeNumber(card?.odds_american)
        }))
      : [];

  return {
    public: {
      awayTeam:
        publicData.awayTeam || null,

      homeTeam:
        publicData.homeTeam || null,

      totalLine:
        safeNumber(
          publicData.totalLine,
          history.line
        ),

      confidence:
        safeNumber(
          publicData.confidence,
          history.confidence
        )
    },

    premium: {
      recommendedCards: cards,

      favoriteToWin:
        premium.favoriteToWin || null,

      favoriteProb:
        safeNumber(premium.favoriteProb),

      expectedRunsA:
        safeNumber(premium.expectedRunsA),

      expectedRunsB:
        safeNumber(premium.expectedRunsB),

      projectedTotal:
        safeNumber(premium.projectedTotal),

      totalLine:
        safeNumber(
          premium.totalLine,
          history.line
        ),

      totalDiff:
        safeNumber(premium.totalDiff),

      overProbability:
        safeNumber(premium.overProbability),

      underProbability:
        safeNumber(premium.underProbability),

      totalPick:
        premium.totalPick || null,

      totalEdge:
        safeNumber(premium.totalEdge),

      venue: premium.venue
        ? {
            name:
              premium.venue.name || null,

            parkFactor:
              safeNumber(
                premium.venue.parkFactor
              ),

            roof:
              premium.venue.roof || null
          }
        : null,

      weather: premium.weather
        ? {
            raw:
              premium.weather.raw || null,

            direction:
              premium.weather.direction || null,

            speed:
              safeNumber(
                premium.weather.speed
              ),

            temp:
              safeNumber(
                premium.weather.temp
              ),

            active:
              premium.weather.active === true
          }
        : null,

      weatherFactor:
        safeNumber(premium.weatherFactor),

      parkFactor:
        safeNumber(premium.parkFactor),

      runEnvironmentFactor:
        safeNumber(
          premium.runEnvironmentFactor
        ),

      weatherImpactPercent:
        safeNumber(
          premium.weatherImpactPercent
        ),

      parkImpactPercent:
        safeNumber(
          premium.parkImpactPercent
        ),

      combinedEnvironmentImpactPercent:
        safeNumber(
          premium.combinedEnvironmentImpactPercent
        )
    }
  };
}

function sanitizeFootballAnalysis(
  analysis,
  history
) {
  const premium = analysis?.premium || {};
  const publicData = analysis?.public || {};

  return {
    public: {
      confidence:
        safeNumber(
          publicData.confidence,
          history.confidence
        ),

      projectedTotal:
        safeNumber(
          publicData.projectedTotal
        ),

      projectedSpread:
        safeNumber(
          publicData.projectedSpread
        ),

      hasPremium: true
    },

    premium: {
      pick:
        premium.pick ||
        history.pick ||
        null,

      confidence:
        safeNumber(
          premium.confidence,
          history.confidence
        ),

      mainEdge:
        safeNumber(premium.mainEdge),

      odds_american:
        safeNumber(
          premium.odds_american,
          history.odds_american
        ),

      projectedTotal:
        safeNumber(
          premium.projectedTotal
        ),

      projectedSpread:
        safeNumber(
          premium.projectedSpread
        ),

      projectedScore:
        premium.projectedScore &&
        typeof premium.projectedScore === "object"
          ? premium.projectedScore
          : null
    }
  };
}

function buildDisplayPayload(
  history,
  dailyPick
) {
  const sport =
    String(history.sport || "")
      .toLowerCase();

  const analysis =
    dailyPick?.analysis_json || {};

  let safeAnalysis;

  if (
    sport === "nba" ||
    sport === "wnba" ||
    sport === "ncaab"
  ) {
    safeAnalysis =
      sanitizeBasketballAnalysis(
        analysis,
        history
      );

  } else if (sport === "mlb") {

    safeAnalysis =
      sanitizeMlbAnalysis(
        analysis,
        history
      );

  } else if (
    sport === "nfl" ||
    sport === "ncaaf"
  ) {

    safeAnalysis =
      sanitizeFootballAnalysis(
        analysis,
        history
      );

  } else {
    return null;
  }

  return {
    game_id: history.game_id,
    sport,

    game_date:
      history.game_date,

    away_team:
      history.away_team,

    home_team:
      history.home_team,

    pick:
      history.pick,

    confidence:
      safeNumber(history.confidence),

    line:
      safeNumber(history.line),

    pick_type:
      history.pick_type || null,

    pick_team:
      history.pick_team || null,

    pick_direction:
      history.pick_direction || null,

    odds_american:
      safeNumber(
        history.odds_american
      ),

    result:
      String(history.result || "")
        .toLowerCase(),

    final_score:
      history.final_score || null,

    graded_at:
      history.graded_at || null,

    analysis:
      safeAnalysis
  };
}

/* =========================================================
   LÓGICA WIN / LOSS DEL LANDING
========================================================= */

function chooseResult({
  dayOfWeek,
  weeklyWins,
  weeklyLosses,
  winsAvailable,
  lossesAvailable
}) {

  if (
    !winsAvailable &&
    !lossesAvailable
  ) {
    return null;
  }

  /*
    LUNES:
    buscar WIN siempre que exista.
  */
  if (dayOfWeek === 1) {
    return winsAvailable
      ? "win"
      : "loss";
  }

  /*
    Si ya mostramos 2+ losses:
    WIN tiene prioridad absoluta.

    Si ayer no hubo WIN,
    mostramos LOSS igualmente.
  */
  if (weeklyLosses >= 2) {
    return winsAvailable
      ? "win"
      : "loss";
  }

  /*
    Si arrancamos 3-0:
    intentar mostrar una pérdida.

    Si ayer todos ganaron,
    seguimos mostrando WIN.
  */
  if (
    weeklyWins >= 3 &&
    weeklyLosses === 0
  ) {
    return lossesAvailable
      ? "loss"
      : "win";
  }

  /*
    DÍAS NEUTROS:
    selección aleatoria,
    pero WIN tiene ventaja 70/30.
  */
  if (
    winsAvailable &&
    lossesAvailable
  ) {
    return Math.random() < 0.70
      ? "win"
      : "loss";
  }

  /*
    Solo existe un tipo de resultado.
  */
  return winsAvailable
    ? "win"
    : "loss";
}

/* =========================================================
   HANDLER
========================================================= */

module.exports = async function handler(
  req,
  res
) {
  try {

    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    /* ==============================
       SEGURIDAD CRON
    ============================== */

    const expectedSecret =
      process.env.CRON_SECRET;

    const authHeader =
      String(
        req.headers.authorization || ""
      );

    if (
      !expectedSecret ||
      authHeader !==
        `Bearer ${expectedSecret}`
    ) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }
    /* ==============================
   SOLO 8 AM EN KANSAS
   Maneja automáticamente CDT/CST
============================== */

const chicagoHour = Number(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false
  }).format(new Date())
);

if (chicagoHour !== 8) {
  return res.status(200).json({
    ok: true,
    skipped: true,
    reason: "Outside featured-pick selection hour"
  });
}

    /* ==============================
       FECHAS
    ============================== */

    const displayDate =
      chicagoDate();

    const sourceGameDate =
      shiftDate(displayDate, -1);

    const weekStart =
      getWeekStart(displayDate);

    const dayOfWeek =
      getDayOfWeek(displayDate);

    /* ==============================
       EVITAR CAMBIAR PICK DEL DÍA
    ============================== */

    const {
      data: existing,
      error: existingError
    } = await supabaseAdmin
      .from("landing_featured_picks")
      .select(
        "display_date, game_id, result"
      )
      .eq(
        "display_date",
        displayDate
      )
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return res.status(200).json({
        ok: true,
        alreadySelected: true,
        displayDate,
        featured: existing
      });
    }

    /* ==============================
       RÉCORD MOSTRADO ESTA SEMANA
    ============================== */

    const {
      data: weeklyRows,
      error: weeklyError
    } = await supabaseAdmin
      .from("landing_featured_picks")
      .select("result")
      .gte(
        "display_date",
        weekStart
      )
      .lt(
        "display_date",
        displayDate
      );

    if (weeklyError) {
      throw weeklyError;
    }

    const weeklyWins =
      (weeklyRows || []).filter(
        row =>
          String(row.result)
            .toLowerCase() === "win"
      ).length;

    const weeklyLosses =
      (weeklyRows || []).filter(
        row =>
          String(row.result)
            .toLowerCase() === "loss"
      ).length;

    /* ==============================
       RESULTADOS EXCLUSIVAMENTE AYER
    ============================== */

    const {
      data: historyRows,
      error: historyError
    } = await supabaseAdmin
      .from("picks_history")
      .select(`
        id,
        game_id,
        sport,
        away_team,
        home_team,
        game_date,
        pick,
        confidence,
        result,
        final_score,
        graded_at,
        is_premium,
        pick_type,
        pick_team,
        pick_direction,
        line,
        odds_american
      `)
      .eq(
        "game_date",
        sourceGameDate
      )
      .eq(
        "is_premium",
        true
      )
      .in(
        "result",
        ["win", "loss"]
      )
      .order(
        "graded_at",
        { ascending: false }
      );

    if (historyError) {
      throw historyError;
    }

    if (
      !historyRows ||
      !historyRows.length
    ) {
      return res.status(200).json({
        ok: true,
        selected: false,
        displayDate,
        sourceGameDate,
        message:
          "No finalized Premium Picks found for yesterday."
      });
    }

    /* ==============================
       BUSCAR SNAPSHOTS EN daily_picks
    ============================== */

    const {
      data: dailyRows,
      error: dailyError
    } = await supabaseAdmin
      .from("daily_picks")
      .select(`
        sport,
        game_id,
        away_team,
        home_team,
        game_date,
        analysis_json
      `)
      .eq(
        "game_date",
        sourceGameDate
      );

    if (dailyError) {
      throw dailyError;
    }

    const dailyMap = new Map();

    for (const row of dailyRows || []) {
      dailyMap.set(
        `${row.sport}|${row.game_id}`,
        row
      );
    }

    /* ==============================
       SOLO PICKS QUE PUEDEN PINTARSE
    ============================== */

    const candidateMap =
      new Map();

    for (const history of historyRows) {

      const key =
        `${history.sport}|${history.game_id}`;

      const dailyPick =
        dailyMap.get(key);

      if (
        !dailyPick ||
        !dailyPick.analysis_json
      ) {
        continue;
      }

      const payload =
        buildDisplayPayload(
          history,
          dailyPick
        );

      if (!payload) {
        continue;
      }

      /*
        Evitar duplicados del mismo
        game/pick si existieran.
      */
      const candidateKey =
        `${history.sport}|` +
        `${history.game_id}|` +
        `${history.pick}`;

      if (
        !candidateMap.has(candidateKey)
      ) {
        candidateMap.set(
          candidateKey,
          {
            history,
            payload
          }
        );
      }
    }

    const candidates =
      [...candidateMap.values()];

    const wins =
      candidates.filter(
        c =>
          String(
            c.history.result
          ).toLowerCase() === "win"
      );

    const losses =
      candidates.filter(
        c =>
          String(
            c.history.result
          ).toLowerCase() === "loss"
      );

    if (
      !wins.length &&
      !losses.length
    ) {
      return res.status(200).json({
        ok: true,
        selected: false,
        displayDate,
        sourceGameDate,
        message:
          "Yesterday has graded picks, but no matching safe daily_picks snapshot was found."
      });
    }

    /* ==============================
       DECIDIR WIN O LOSS
    ============================== */

    const targetResult =
      chooseResult({
        dayOfWeek,
        weeklyWins,
        weeklyLosses,
        winsAvailable:
          wins.length > 0,
        lossesAvailable:
          losses.length > 0
      });

    const targetPool =
      targetResult === "loss"
        ? losses
        : wins;

    let selected =
      randomItem(targetPool);

    /*
      Fallback:
      nunca dejar landing vacío
      si existe el otro resultado.
    */
    if (!selected) {
      selected =
        randomItem(
          targetResult === "loss"
            ? wins
            : losses
        );
    }

    if (!selected) {
      return res.status(200).json({
        ok: true,
        selected: false,
        message:
          "No valid featured candidate."
      });
    }

    /* ==============================
       GUARDAR ELECCIÓN DEL DÍA
    ============================== */

    const rowToInsert = {
      display_date:
        displayDate,

      source_game_date:
        sourceGameDate,

      pick_history_id:
        selected.history.id,

      game_id:
        selected.history.game_id,

      sport:
        selected.history.sport,

      result:
        String(
          selected.history.result
        ).toLowerCase(),

      final_score:
        selected.history.final_score,

      display_payload:
        selected.payload
    };

    const {
      data: inserted,
      error: insertError
    } = await supabaseAdmin
      .from("landing_featured_picks")
      .insert(rowToInsert)
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    return res.status(200).json({
      ok: true,
      selected: true,

      logic: {
        displayDate,
        sourceGameDate,
        weekStart,
        weeklyWins,
        weeklyLosses,
        targetResult,

        yesterdayWins:
          wins.length,

        yesterdayLosses:
          losses.length
      },

      featured: {
        display_date:
          inserted.display_date,

        source_game_date:
          inserted.source_game_date,

        game_id:
          inserted.game_id,

        sport:
          inserted.sport,

        result:
          inserted.result,

        final_score:
          inserted.final_score
      }
    });

  } catch (error) {

    console.error(
      "SELECT FEATURED PICK ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};

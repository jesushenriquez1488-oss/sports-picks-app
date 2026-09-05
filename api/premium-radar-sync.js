const { createClient } = require("@supabase/supabase-js");
const { syncPremiumRadar } = require("../lib/premiumRadar");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ============================================================
// CENTRAL DATE
// ============================================================

function getCentralDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}


// ============================================================
// SAFE NUMBER
// ============================================================

function safeNum(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// GET CURRENT MARKET LINE FROM CANONICAL ANALYSIS
//
// IMPORTANT:
// We DO NOT calculate a betting recommendation here.
// We only identify the line belonging to the pick that
// CashEdge already selected.
// ============================================================

function getBasketballCurrentLine({
  analysis,
  awayTeam,
  homeTeam
}) {

  const premium =
    analysis?.premium || {};

  const market =
    analysis?.marketSnapshot || {};

  const pick =
    String(premium.pick || "")
      .trim();

  const normalized =
    pick.toLowerCase();


  if (
    normalized === "over" ||
    normalized.includes("over ")
  ) {
    return safeNum(
      market.total
    );
  }


  if (
    normalized === "under" ||
    normalized.includes("under ")
  ) {
    return safeNum(
      market.total
    );
  }


  if (
    awayTeam &&
    pick.includes(awayTeam)
  ) {
    return safeNum(
      market.awaySpread
    );
  }


  if (
    homeTeam &&
    pick.includes(homeTeam)
  ) {
    return safeNum(
      market.homeSpread
    );
  }


  return null;
}


// ============================================================
// BUILD PROJECTION SNAPSHOT
//
// These numbers are copied from the canonical CashEdge
// basketball analysis.
//
// Radar does NOT calculate them.
// ============================================================

function getBasketballProjection(analysis) {

  const premium =
    analysis?.premium;

  if (!premium) {
    return null;
  }


  const projection = {
    away:
      safeNum(premium.projA),

    home:
      safeNum(premium.projB),

    total:
      safeNum(premium.totalProj),

    margin:
      safeNum(premium.spreadDiff)
  };


  const hasAnyValue =
    Object.values(projection)
      .some(value => value !== null);


  return hasAnyValue
    ? projection
    : null;
}

// ============================================================
// MLB — CANONICAL VALUES
//
// Radar does NOT calculate a new MLB edge.
// It uses the same edge concept already used by CashEdge
// to rank MLB Premium candidates:
// TOTAL   -> totalEdge
// RUNLINE -> protectedEdge
// ML      -> projectedMargin
// ============================================================

function getMLBCard(analysis) {
  return (
    analysis?.premium
      ?.recommendedCards?.[0] ||
    null
  );
}


function getMLBCanonicalEdge(card) {

  if (!card) {
    return null;
  }

  if (
    card.type === "OVER" ||
    card.type === "UNDER"
  ) {
    return safeNum(
      card.totalEdge
    );
  }

  if (
    card.type === "RUNLINE"
  ) {
    return safeNum(
      card.protectedEdge
    );
  }

  if (
    card.type === "ML"
  ) {
    return safeNum(
      card.projectedMargin
    );
  }

  return null;
}


// ============================================================
// MLB CURRENT MARKET LINE
//
// TOTAL:
//   8.5 / 9 / etc.
//
// RUNLINE:
//   -1.5 / +1.5
//
// ML:
//   We intentionally return NULL.
//
// Moneyline price (-125, +140...) is not the same concept
// as a spread/total line. We will handle market prices
// separately later rather than mixing incompatible values.
// ============================================================

function getMLBCurrentLine(
  analysis
) {

  const card =
    getMLBCard(analysis);

  if (!card) {
    return null;
  }

  if (
    card.type === "OVER" ||
    card.type === "UNDER"
  ) {
    return safeNum(
      analysis?.premium?.totalLine
    );
  }

  if (
    card.type === "RUNLINE"
  ) {
    return safeNum(
      card.spread
    );
  }

  return null;
}


// ============================================================
// MLB PROJECTION SNAPSHOT
//
// All values come directly from the canonical MLB analysis.
// ============================================================

function getMLBProjection(
  analysis
) {

  const premium =
    analysis?.premium;

  if (!premium) {
    return null;
  }


  const away =
    safeNum(
      premium.expectedRunsA
    );

  const home =
    safeNum(
      premium.expectedRunsB
    );

  const total =
    safeNum(
      premium.projectedTotal
    );


  const projection = {

    away,

    home,

    total,

    margin:
      away !== null &&
      home !== null
        ? Number(
            (away - home)
              .toFixed(3)
          )
        : null
  };


  const hasAny =
    Object.values(projection)
      .some(
        value =>
          value !== null
      );


  return hasAny
    ? projection
    : null;
}
// ============================================================
// HANDLER
// ============================================================

module.exports = async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );


  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }


  if (
    req.method !== "GET" &&
    req.method !== "POST"
  ) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    // ========================================================
    // SECURITY
    // Same secret already used by CashEdge daily generation.
    // ========================================================

    const authHeader =
      req.headers.authorization || "";

    const bearerToken =
      authHeader.replace("Bearer ", "");

    const querySecret =
      req.query.secret;


    const validSecret =
      process.env.CRON_SECRET ||
      process.env.GENERATE_DAILY_SECRET;


    if (!validSecret) {
      return res.status(500).json({
        error:
          "Missing CRON_SECRET / GENERATE_DAILY_SECRET"
      });
    }


    if (
      bearerToken !== validSecret &&
      querySecret !== validSecret
    ) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }


    const gameDate =
      getCentralDate();


    // ========================================================
    // READ CANONICAL DAILY PICKS
    //
    // BASKETBALL ONLY FOR FIRST TEST:
    // NBA / WNBA / NCAAB
    // ========================================================

    const {
      data: rows,
      error: rowsError
    } =
      await supabaseAdmin
        .from("daily_picks")
        .select(`
          id,
          sport,
          game_id,
          game_date,
          away_team,
          home_team,
          analysis_json,
          updated_at
        `)
       .in(
  "sport",
  [
    "nba",
    "wnba",
    "ncaab",
    "mlb"
  ]
)
        .eq(
          "game_date",
          gameDate
        );


    if (rowsError) {
      return res.status(500).json({
        error:
          rowsError.message
      });
    }


    const report = {

      date:
        gameDate,

      checked:
        0,

      currentPremium:
        0,

      created:
        0,

      updated:
        0,

      skipped:
        0,

      errors:
        0,

      details:
        []
    };


    // ========================================================
    // SYNC EACH CANONICAL ANALYSIS
    // ========================================================

    for (const row of rows || []) {

      report.checked += 1;


      try {

    const analysis =
  row.analysis_json || {};

const premium =
  analysis.premium || null;

const isPremium =
  analysis.isPremiumPick === true;


if (isPremium) {
  report.currentPremium += 1;
}


// ==========================================================
// NORMALIZE CANONICAL VALUES BY SPORT
// ==========================================================

let pick = null;
let confidence = null;
let edge = null;
let currentMarketLine = null;
let projection = null;


// ==========================================================
// MLB
// ==========================================================

if (row.sport === "mlb") {

  const card =
    getMLBCard(
      analysis
    );

  pick =
    card?.play ||
    null;

  confidence =
    safeNum(
      card?.percentage ??
      analysis?.public?.confidence
    );

  edge =
    getMLBCanonicalEdge(
      card
    );

  currentMarketLine =
    getMLBCurrentLine(
      analysis
    );

  projection =
    getMLBProjection(
      analysis
    );


// ==========================================================
// NBA / WNBA / NCAAB
// ==========================================================

} else {

  pick =
    premium?.pick ||
    null;

  confidence =
    safeNum(
      premium?.confidence ??
      analysis?.public?.confidence
    );

  edge =
    safeNum(
      premium?.mainEdge
    );

  currentMarketLine =
    getBasketballCurrentLine({
      analysis,
      awayTeam:
        row.away_team,
      homeTeam:
        row.home_team
    });

  projection =
    getBasketballProjection(
      analysis
    );
}

        const result =
          await syncPremiumRadar({

            supabaseAdmin,

            sourceDailyPickId:
              row.id,

            sport:
              row.sport,

            gameId:
              row.game_id,

            gameDate:
              row.game_date,

            awayTeam:
              row.away_team,

            homeTeam:
              row.home_team,

            isPremium,

           pick,
            
            confidence,

            edge,

            projection,

            /*
             * Basketball does not currently expose a separate
             * canonical "recommendation" field that Radar
             * should reinterpret.
             */
            recommendation:
              null,

            openingMarketLine:
              null,

            currentMarketLine,

            /*
             * We add detailed injury snapshots later,
             * after validating their exact canonical shape.
             */
            injuryAdjustment:
              null,

            weatherAdjustment:
              null,

            starterState:
              null,

            pitcherId:
              null,

            sourceUpdatedAt:
              row.updated_at
          });


        if (
          result?.created === true
        ) {
          report.created += 1;

        } else if (
          result?.updated === true
        ) {
          report.updated += 1;

        } else if (
          result?.skipped === true
        ) {
          report.skipped += 1;
        }


        if (
          result?.ok === false
        ) {
          report.errors += 1;
        }


        report.details.push({

          sport:
            row.sport,

          gameId:
            row.game_id,

          isPremium,

          pick:
            premium?.pick || null,

          confidence,

          edge,

          radar:
            result
        });


      } catch (rowError) {

        report.errors += 1;


        report.details.push({

          sport:
            row.sport,

          gameId:
            row.game_id,

          error:
            rowError.message
        });


        /*
         * One bad game must not stop
         * the rest of the Radar sync.
         */
        console.error(
          "Premium Radar basketball row error:",
          row.game_id,
          rowError.message
        );
      }
    }


    return res.status(200).json({
      ok: true,
      ...report
    });


  } catch (error) {

    console.error(
      "Premium Radar sync endpoint error:",
      error
    );


    return res.status(500).json({
      ok: false,
      error:
        error.message
    });
  }
};

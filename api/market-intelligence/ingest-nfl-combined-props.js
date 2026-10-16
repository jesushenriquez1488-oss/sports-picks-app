const crypto = require("crypto");

const {
  createClient
} = require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


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

function cleanText(
  value
) {

  const text =
    String(
      value || ""
    ).trim();

  return text || null;
}


function cleanNumber(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const number =
    Number(value);


  return Number.isFinite(number)
    ? number
    : null;
}


function cleanInteger(
  value
) {

  const number =
    cleanNumber(value);


  return number === null
    ? null
    : Math.round(number);
}


function cleanDate(
  value
) {

  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }


  return date.toISOString();
}


function normalizeBookmaker(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}


function normalizeMarket(
  value
) {

  const market =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


  if (
    market ===
    "pass_rush_yards"
  ) {
    return market;
  }


  if (
    market ===
    "rush_rec_yards"
  ) {
    return market;
  }


  return null;
}


// ============================================================
// ALTERNATE LINES
// ============================================================

function normalizeAlternateLines(
  value
) {

  if (
    !Array.isArray(value)
  ) {
    return [];
  }


  const output = [];


  for (
    const alternate
    of value
  ) {

    if (
      !alternate ||
      typeof alternate !==
        "object"
    ) {
      continue;
    }


    const line =
      cleanNumber(
        alternate.line
      );


    const odds =
      cleanInteger(
        alternate.odds
      );


    const kind =
      cleanText(
        alternate.kind
      );


    /*
     * Preserve milestone exactly.
     *
     * We DO NOT convert:
     *
     * 200+
     *
     * into:
     *
     * Over 200.5
     */

    output.push({

      line,

      odds,

      kind,

      selectionId:
        cleanText(
          alternate.selectionId ??
          alternate.selection_id
        ),

      marketId:
        cleanText(
          alternate.marketId ??
          alternate.market_id
        )
    });
  }


  return output;
}


// ============================================================
// ROW NORMALIZATION
// ============================================================

function normalizeCombinedProp(
  item
) {

  const providerEventId =
    cleanText(
      item?.provider_event_id ??
      item?.providerEventId
    );


  const player =
    cleanText(
      item?.player
    );


  const market =
    normalizeMarket(
      item?.market
    );


  const bookmaker =
    normalizeBookmaker(
      item?.bookmaker ??
      item?.book
    );


  if (
    !providerEventId ||
    !player ||
    !market ||
    !bookmaker
  ) {

    return {
      valid: false,

      reason:
        "Missing required combined prop fields"
    };
  }


  const now =
    new Date()
      .toISOString();


  return {

    valid: true,

    row: {

      source:
        "owls",

      provider_event_id:
        providerEventId,

      commence_time:
        cleanDate(
          item?.commence_time ??
          item?.commenceTime
        ),

      home_team:
        cleanText(
          item?.home_team ??
          item?.homeTeam
        ),

      away_team:
        cleanText(
          item?.away_team ??
          item?.awayTeam
        ),

      player,

      market,

      bookmaker,

     structure:
  cleanText(
    item?.structure ??
    item?.marketStructure
  ) ||
  "unknown",

      line:
        cleanNumber(
          item?.line
        ),

      over_odds:
        cleanInteger(
          item?.over_odds ??
          item?.over
        ),

      under_odds:
        cleanInteger(
          item?.under_odds ??
          item?.under
        ),

      alternate_lines:
        normalizeAlternateLines(
          item?.alternate_lines ??
          item?.alternateLines
        ),

      provider_market_id:
        cleanText(
          item?.provider_market_id ??
          item?.providerMarketId ??
          item?.marketId
        ),

      provider_updated_at:
        cleanDate(
          item?.provider_updated_at ??
          item?.providerUpdatedAt ??
          item?.updatedAt
        ),

      raw_json:
        item?.raw_json ??
        item?.rawJson ??
        item,

      ingested_at:
        now,

      updated_at:
        now
    }
  };
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    // ========================================================
    // POST ONLY
    // ========================================================

    if (
      req.method !==
      "POST"
    ) {

      return res
        .status(405)
        .json({

          ok: false,

          error:
            "POST required"
        });
    }


    try {

      // ======================================================
      // AUTH
      // ======================================================

      const configuredSecret =
        process.env
          .MARKET_INGEST_SECRET;


      if (
        !configuredSecret
      ) {

        return res
          .status(500)
          .json({

            ok: false,

            error:
              "MARKET_INGEST_SECRET is not configured"
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

            ok: false,

            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // BODY
      // ======================================================

      const body =
        req.body || {};


      /*
       * Railway should send:
       *
       * {
       *   items: [...]
       * }
       *
       * One request can therefore
       * update the entire NFL board.
       */

      const items =
        Array.isArray(
          body.items
        )
          ? body.items
          : [];


      if (
        !items.length
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "items array is required"
          });
      }


      /*
       * Safety limit.
       *
       * Current Owls audit showed only
       * a few hundred combined-market
       * records, so 2000 is generous.
       */

      if (
        items.length >
        2000
      ) {

        return res
          .status(413)
          .json({

            ok: false,

            error:
              "Too many items"
          });
      }


      // ======================================================
      // NORMALIZE
      // ======================================================

     const rowsByKey =
  new Map();

const rejected = [];


for (
  let index = 0;
  index < items.length;
  index++
) {

  const normalized =
    normalizeCombinedProp(
      items[index]
    );


  if (
    !normalized.valid
  ) {

    rejected.push({

      index,

      reason:
        normalized.reason
    });

    continue;
  }


  const row =
    normalized.row;


  const key =
    [
      row.provider_event_id,
      row.player
        .trim()
        .toLowerCase(),
      row.market,
      row.bookmaker
    ].join("|");


  const existing =
    rowsByKey.get(
      key
    );


  if (
    !existing
  ) {

    rowsByKey.set(
      key,
      row
    );

    continue;
  }


  // ==========================================================
  // DUPLICATE FROM OWLS
  //
  // Prefer a real Over/Under main market over another structure.
  // ==========================================================

  const existingIsOverUnder =
    existing.structure ===
    "over_under";


  const incomingIsOverUnder =
    row.structure ===
    "over_under";


  let preferred =
    existing;


  if (
    !existingIsOverUnder &&
    incomingIsOverUnder
  ) {

    preferred =
      row;

  } else if (
    existingIsOverUnder ===
      incomingIsOverUnder
  ) {

    const existingComplete =
      existing.line !== null &&
      existing.over_odds !== null &&
      existing.under_odds !== null;


    const incomingComplete =
      row.line !== null &&
      row.over_odds !== null &&
      row.under_odds !== null;


    if (
      !existingComplete &&
      incomingComplete
    ) {

      preferred =
        row;
    }
  }


  // ==========================================================
  // MERGE ALTERNATIVE LINES
  //
  // Do not lose milestones/alternatives just because Owls
  // returned the player more than once.
  // ==========================================================

  const mergedAlternates =
    new Map();


  for (
    const alternate
    of [
      ...(Array.isArray(
        existing.alternate_lines
      )
        ? existing.alternate_lines
        : []),

      ...(Array.isArray(
        row.alternate_lines
      )
        ? row.alternate_lines
        : [])
    ]
  ) {

    const alternateKey =
      [
        alternate?.kind ??
          "",
        alternate?.line ??
          "",
        alternate?.odds ??
          "",
        alternate?.selectionId ??
          "",
        alternate?.marketId ??
          ""
      ].join("|");


    mergedAlternates.set(
      alternateKey,
      alternate
    );
  }


  rowsByKey.set(
    key,
    {
      ...preferred,

      alternate_lines:
        Array.from(
          mergedAlternates.values()
        )
    }
  );
}


const rows =
  Array.from(
    rowsByKey.values()
  );


      if (
        !rows.length
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "No valid combined props",

            received:
              items.length,

            rejected
          });
      }


      // ======================================================
      // UPSERT
      // ======================================================

      const {
        data,
        error
      } =
        await supabaseAdmin
          .from(
            "nfl_combined_props_market_cache"
          )
          .upsert(
            rows,
            {
              onConflict:
                "provider_event_id,player,market,bookmaker",

              ignoreDuplicates:
                false
            }
          )
          .select(
            `
              id,
              provider_event_id,
              player,
              market,
              bookmaker,
              line,
              over_odds,
              under_odds,
              updated_at
            `
          );


      if (
        error
      ) {

        console.error(
          "NFL COMBINED PROPS INGEST ERROR:",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "Unable to save combined props",

            details:
              error.message
          });
      }


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          mode:
            "nfl-combined-props-ingest",

          received:
            items.length,

          accepted:
            rows.length,

          rejected:
            rejected.length,

          written:
            Array.isArray(data)
              ? data.length
              : rows.length,

          rejectedItems:
            rejected.slice(
              0,
              20
            ),

          updatedAt:
            new Date()
              .toISOString()
        });


    } catch (error) {

      console.error(
        "NFL COMBINED PROPS INGEST FATAL:",
        error
      );


      return res
        .status(500)
        .json({

          ok: false,

          error:
            error?.message ||
            String(error)
        });
    }
  };

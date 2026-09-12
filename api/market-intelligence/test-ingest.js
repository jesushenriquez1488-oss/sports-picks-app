module.exports = async function handler(req, res) {
  try {
    const secret =
      String(req.query.secret || "");

    const validSecret =
      process.env.CRON_SECRET ||
      process.env.GENERATE_DAILY_SECRET;

    if (!validSecret) {
      return res.status(500).json({
        ok: false,
        error: "Missing CRON_SECRET / GENERATE_DAILY_SECRET"
      });
    }

    if (secret !== validSecret) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    const ingestSecret =
      process.env.MARKET_INGEST_SECRET;

    if (!ingestSecret) {
      return res.status(500).json({
        ok: false,
        error: "MARKET_INGEST_SECRET missing"
      });
    }

    const endpoint =
      "https://www.cashedgeapp.com/api/market-intelligence/ingest-quote";

    const basePayload = {
      sport: "mlb",

      cashedge_game_id:
        "mlb-2026-09-12-Colorado Rockies-Detroit Tigers-824224",

      provider: "manual-test",

      provider_event_id:
        "test-824224",

      sportsbook_key:
        "cashedge_testbook",

      sportsbook_name:
        "CashEdge Test Book",

      market_type:
        "total",

      selection_key:
        "under",

      selection_name:
        "UNDER"
    };


    async function sendQuote(
      line,
      price
    ) {
      const response =
        await fetch(endpoint, {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${ingestSecret}`
          },

          body: JSON.stringify({
            ...basePayload,

            line,

            price_american:
              price,

            provider_timestamp:
              new Date()
                .toISOString()
          })
        });

      const data =
        await response.json();

      return {
        status:
          response.status,

        data
      };
    }


    // ========================================================
    // TEST 1 — BASELINE
    // ========================================================

    const baseline =
      await sendQuote(
        8.5,
        -105
      );


    // ========================================================
    // TEST 2 — SAME QUOTE
    // ========================================================

    const unchanged =
      await sendQuote(
        8.5,
        -105
      );


    // ========================================================
    // TEST 3 — REAL CHANGE
    // ========================================================

    const changed =
      await sendQuote(
        8.0,
        -110
      );


    return res
      .status(200)
      .json({
        ok: true,

        baseline,

        unchanged,

        changed
      });


  } catch (error) {

    console.error(
      "MARKET INGEST TEST ERROR:",
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

const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const pixelId =
      process.env.TIKTOK_PIXEL_ID;

    const accessToken =
      process.env.TIKTOK_EVENTS_API_TOKEN;

    if (!pixelId || !accessToken) {
      return res.status(500).json({
        error: "Missing TikTok credentials"
      });
    }

    const forwardedFor =
      req.headers["x-forwarded-for"];

    const ip =
      typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : "";

    const userAgent =
      req.headers["user-agent"] || "";

    const payload = {
      event_source: "web",

      event_source_id: pixelId,

      data: [
        {
          event: "Purchase",

          event_time:
            Math.floor(Date.now() / 1000),

          event_id:
            crypto.randomUUID(),

          test_event_code:
            "TEST82466",

          user: {
            ...(ip ? { ip } : {}),
            ...(userAgent
              ? { user_agent: userAgent }
              : {})
          },

          properties: {
            content_type: "product",

            contents: [
              {
                content_id:
                  "premium_monthly",

                content_name:
                  "CashEdge Premium",

                content_type:
                  "product",

                quantity: 1,

                price: 19.99
              }
            ],

            currency: "USD",

            value: 19.99
          },

          page: {
            url:
              "https://www.cashedgeapp.com/"
          }
        }
      ]
    };

    const response = await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Access-Token":
            accessToken
        },

        body:
          JSON.stringify(payload)
      }
    );

    const result =
      await response.json();

    console.log(
      "TikTok TEST result:",
      result
    );

    return res.status(
      response.ok ? 200 : 500
    ).json({
      ok:
        response.ok &&
        result.code === 0,

      tiktok:
        result
    });

  } catch (error) {
    console.error(
      "TikTok TEST error:",
      error
    );

    return res.status(500).json({
      error:
        error.message
    });
  }
};

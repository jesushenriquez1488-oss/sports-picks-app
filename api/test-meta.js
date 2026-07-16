const crypto = require("crypto");

const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

module.exports = async function handler(req, res) {
  const hashedEmail = crypto
    .createHash("sha256")
    .update("supportcashedge@gmail.com".toLowerCase())
    .digest("hex");

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        test_event_code: "TEST93082",
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            user_data: {
              em: [hashedEmail],
            },
            custom_data: {
              currency: "USD",
              value: 19.99,
            },
          },
        ],
      }),
    }
  );

  const result = await response.json();

  return res.status(200).json(result);
};

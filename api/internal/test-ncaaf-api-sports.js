const crypto = require("crypto");

function secureEqual(supplied, expected) {
  if (!supplied || !expected) return false;

  const a = crypto
    .createHash("sha256")
    .update(String(supplied))
    .digest();

  const b = crypto
    .createHash("sha256")
    .update(String(expected))
    .digest();

  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  try {
    const expectedSecret = String(
      process.env.CRON_SECRET ||
      process.env.GENERATE_DAILY_SECRET ||
      ""
    );

    const suppliedSecret = String(
      req.headers["x-internal-secret"] || ""
    );

    if (!secureEqual(suppliedSecret, expectedSecret)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    const apiKey = String(
      process.env.API_SPORTS_KEY || ""
    ).trim();

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "API_SPORTS_KEY missing"
      });
    }

    const TEAM_ID = 106; // Alabama

    const url =
  `https://v1.american-football.api-sports.io/injuries?team=${TEAM_ID}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey
      }
    });

    const data = await response.json();

    const apiErrors =
      data?.errors || [];

    const hasErrors =
      Array.isArray(apiErrors)
        ? apiErrors.length > 0
        : Object.keys(apiErrors || {}).length > 0;

    if (hasErrors) {
      return res.status(400).json({
        ok: false,
        apiErrors
      });
    }

    const injuries =
      Array.isArray(data?.response)
        ? data.response
        : [];

    return res.status(200).json({
      ok: true,
      teamId: TEAM_ID,
      teamName: "Alabama",
      results: data?.results ?? injuries.length,
      injuries,
      apiErrors
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
};

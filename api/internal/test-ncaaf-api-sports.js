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

    const url =
      "https://v1.american-football.api-sports.io/leagues?id=2&season=2026";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        httpStatus: response.status,
        apiResponse: data
      });
    }

    const league = data?.response?.[0] || null;

    const season =
      league?.seasons?.find(
        item => Number(item?.year) === 2026
      ) || null;

    return res.status(200).json({
      ok: true,

      apiResults:
        data?.results ?? null,

      league: {
        id: league?.league?.id ?? null,
        name: league?.league?.name ?? null
      },

      season: season?.year ?? null,

      current: season?.current ?? null,

      injuriesCoverage:
        season?.coverage?.injuries ?? null,

      coverage:
        season?.coverage ?? null,

      apiErrors:
        data?.errors ?? null
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
};

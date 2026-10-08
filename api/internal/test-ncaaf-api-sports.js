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
      "https://v1.american-football.api-sports.io/teams?league=2&season=2026";


    const response = await fetch(url, {
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


    const teams =
      Array.isArray(data?.response)
        ? data.response
        : [];


    const selectedNames = [
      "Ohio State",
      "Alabama",
      "Georgia",
      "Texas",
      "Notre Dame"
    ];


    const selected =
      teams
        .filter(team => {
          const name =
            String(team?.name || "")
              .toLowerCase();

          return selectedNames.some(
            target =>
              name.includes(
                target.toLowerCase()
              )
          );
        })
        .map(team => ({
          id: team?.id ?? null,
          name: team?.name ?? null,
          code: team?.code ?? null
        }));


    return res.status(200).json({
      ok: true,

      apiResults:
        data?.results ?? teams.length,

      totalTeams:
        teams.length,

      selected,

      first10:
        teams
          .slice(0, 10)
          .map(team => ({
            id: team?.id ?? null,
            name: team?.name ?? null,
            code: team?.code ?? null
          })),

      apiErrors
    });

  } catch (error) {

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        String(error)
    });
  }
};

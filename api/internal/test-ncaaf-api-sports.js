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


async function apiSportsGet(path, apiKey) {
  const response = await fetch(
    `https://v1.american-football.api-sports.io${path}`,
    {
      headers: {
        "x-apisports-key": apiKey
      }
    }
  );

  const data = await response.json();

  const errors = data?.errors || [];

  const hasErrors =
    Array.isArray(errors)
      ? errors.length > 0
      : Object.keys(errors || {}).length > 0;

  if (!response.ok || hasErrors) {
    throw new Error(
      JSON.stringify({
        path,
        status: response.status,
        errors
      })
    );
  }

  return data;
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


    // ========================================================
    // 1. NFL 2026 COVERAGE
    // ========================================================

    const leagueData =
      await apiSportsGet(
        "/leagues?id=1&season=2026",
        apiKey
      );

    const league =
      leagueData?.response?.[0] || null;

    const season =
      league?.seasons?.find(
        item => Number(item?.year) === 2026
      ) || null;


    // ========================================================
    // 2. NFL TEAMS
    // ========================================================

    const teamsData =
      await apiSportsGet(
        "/teams?league=1&season=2026",
        apiKey
      );

    const teams =
      Array.isArray(teamsData?.response)
        ? teamsData.response
        : [];


    // ========================================================
    // 3. INJURIES — ALL NFL TEAMS
    // ========================================================

    const results = [];

    const BATCH_SIZE = 8;

    for (
      let i = 0;
      i < teams.length;
      i += BATCH_SIZE
    ) {
      const batch =
        teams.slice(
          i,
          i + BATCH_SIZE
        );

      const batchResults =
        await Promise.all(
          batch.map(async team => {
            try {
              const data =
                await apiSportsGet(
                  `/injuries?team=${team.id}`,
                  apiKey
                );

              const injuries =
                Array.isArray(data?.response)
                  ? data.response
                  : [];

              return {
                teamId: team.id,
                teamName: team.name,
                count: injuries.length,
                injuries
              };

            } catch (error) {
              return {
                teamId: team.id,
                teamName: team.name,
                count: 0,
                injuries: [],
                error: error.message
              };
            }
          })
        );

      results.push(
        ...batchResults
      );
    }


    const teamsWithInjuries =
      results.filter(
        team =>
          team.count > 0
      );


    const totalInjuries =
      teamsWithInjuries.reduce(
        (sum, team) =>
          sum + team.count,
        0
      );


    return res.status(200).json({
      ok: true,

      league:
        league?.league?.name || null,

      season:
        season?.year || null,

      injuriesCoverage:
        season?.coverage?.injuries ?? null,

      nflTeams:
        teams.length,

      teamsChecked:
        results.length,

      teamsWithInjuries:
        teamsWithInjuries.length,

      totalInjuries,

      results:
        teamsWithInjuries,

      errors:
        results.filter(
          team => team.error
        )
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

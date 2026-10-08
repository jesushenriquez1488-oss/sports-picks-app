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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    const teamsData =
      await apiSportsGet(
        "/teams?league=2&season=2026",
        apiKey
      );

    const allTeams =
      Array.isArray(teamsData?.response)
        ? teamsData.response
        : [];

    const wantedNames = [
      "Alabama",
      "Georgia",
      "Ohio State",
      "Notre Dame",
      "Texas",
      "Texas A&M",
      "LSU",
      "Florida",
      "Tennessee",
      "Oregon",
      "Penn State",
      "Michigan",
      "Clemson",
      "Miami",
      "USC",
      "Oklahoma",
      "Auburn",
      "Missouri"
    ];

    const teams =
      wantedNames
        .map(name =>
          allTeams.find(
            team =>
              String(team?.name || "")
                .toLowerCase() ===
              name.toLowerCase()
          )
        )
        .filter(Boolean);

    const results = [];

    for (const team of teams) {
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

        results.push({
          teamId: team.id,
          teamName: team.name,
          count: injuries.length,
          injuries
        });

      } catch (error) {
        results.push({
          teamId: team.id,
          teamName: team.name,
          count: 0,
          injuries: [],
          error: error.message
        });
      }

      // ~20 requests/minuto máximo
      await sleep(3000);
    }

    const teamsWithInjuries =
      results.filter(
        team => team.count > 0
      );

    const totalInjuries =
      teamsWithInjuries.reduce(
        (sum, team) =>
          sum + team.count,
        0
      );

    return res.status(200).json({
      ok: true,
      teamsChecked: results.length,
      teamsWithInjuries:
        teamsWithInjuries.length,
      totalInjuries,
      results,
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

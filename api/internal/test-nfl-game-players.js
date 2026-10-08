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

async function apiSports(path, apiKey) {
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
        httpStatus: response.status,
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

    // Kansas City Chiefs
    const teamId = 17;
    const season = 2026;

    // ========================================================
    // 1. BUSCAR PARTIDOS DE KC
    // ========================================================

    const gamesData = await apiSports(
      `/games?team=${teamId}&season=${season}`,
      apiKey
    );

    const games =
      Array.isArray(gamesData?.response)
        ? gamesData.response
        : [];

    const completed =
      games
        .filter(item => {
          const status =
            String(
              item?.game?.status?.short ||
              ""
            ).toUpperCase();

          return (
            status === "FT" ||
            status === "AOT"
          );
        })
        .sort((a, b) => {
          const ta =
            Number(
              a?.game?.date?.timestamp ||
              0
            );

          const tb =
            Number(
              b?.game?.date?.timestamp ||
              0
            );

          return tb - ta;
        });

    const latest =
      completed[0] || null;

    if (!latest?.game?.id) {
      return res.status(404).json({
        ok: false,
        error: "No completed game found",
        gamesFound: games.length
      });
    }

    const gameId =
      latest.game.id;

    // ========================================================
    // 2. PLAYER STATS DEL PARTIDO
    // ========================================================

    const statsData =
      await apiSports(
        `/games/statistics/players?id=${gameId}`,
        apiKey
      );

    const stats =
      Array.isArray(statsData?.response)
        ? statsData.response
        : [];

    return res.status(200).json({
      ok: true,

      latestGame: {
        id: gameId,

        date:
          latest?.game?.date?.date ||
          null,

        week:
          latest?.game?.week ||
          null,

        status:
          latest?.game?.status ||
          null,

        home:
          latest?.teams?.home ||
          null,

        away:
          latest?.teams?.away ||
          null
      },

      gamesFound:
        games.length,

      completedGames:
        completed.length,

      playerStatsResults:
        statsData?.results ?? null,

      responseItems:
        stats.length,

      sample:
        stats.slice(0, 2)
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

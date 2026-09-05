module.exports = async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const cronSecret =
    String(process.env.CRON_SECRET || "");

  const authHeader =
    String(req.headers.authorization || "");

  if (
    !cronSecret ||
    authHeader !== `Bearer ${cronSecret}`
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }


  try {

    const origin =
      "https://www.cashedgeapp.com";

    const url =
      `${origin}/api/analyze-nba` +
      `?mode=generate-daily` +
      `&sport=americanfootball_ncaaf` +
      `&managed=true` +
      `&limit=4`;

    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${cronSecret}`
        }
      });

    const data =
      await response
        .json()
        .catch(() => null);


    return res
      .status(response.status)
      .json({
        ok: response.ok,
        cron: "ncaaf-managed",
        data
      });

  } catch (error) {

    return res.status(500).json({
      ok: false,
      cron: "ncaaf-managed",
      error:
        error.message
    });
  }
};

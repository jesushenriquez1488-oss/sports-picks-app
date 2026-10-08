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

async function getJson(url) {
  const response = await fetch(
    String(url).replace(/^http:/, "https:")
  );

  if (!response.ok) {
    throw new Error(
      `ESPN HTTP ${response.status}: ${url}`
    );
  }

  return response.json();
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

    // ESPN ID Alabama = 333
    const teamId =
      String(req.query.teamId || "333");

    const url =
      `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/teams/${teamId}/injuries?limit=100`;

    const collection =
      await getJson(url);

    const items =
      Array.isArray(collection?.items)
        ? collection.items
        : [];

    const injuries = [];

    for (const item of items) {
      try {

        const detail =
          item?.$ref
            ? await getJson(item.$ref)
            : item;

        let athlete = null;

        if (detail?.athlete?.$ref) {
          try {
            athlete =
              await getJson(
                detail.athlete.$ref
              );
          } catch {}
        }

        injuries.push({
          id:
            detail?.id ||
            null,

          playerId:
            athlete?.id ||
            null,

          playerName:
            athlete?.displayName ||
            athlete?.fullName ||
            null,

          position:
            athlete?.position?.abbreviation ||
            athlete?.position?.name ||
            null,

          status:
            detail?.status ||
            detail?.type?.description ||
            detail?.type?.name ||
            null,

          date:
            detail?.date ||
            null,

          returnDate:
            detail?.details?.returnDate ||
            null,

          description:
            detail?.details?.detail ||
            detail?.details?.type ||
            detail?.shortComment ||
            detail?.longComment ||
            null
        });

      } catch (error) {

        injuries.push({
          error: error.message,
          ref: item?.$ref || null
        });
      }
    }

    return res.status(200).json({
      ok: true,

      teamId,

      espnCount:
        collection?.count ?? null,

      itemsReturned:
        items.length,

      injuries
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

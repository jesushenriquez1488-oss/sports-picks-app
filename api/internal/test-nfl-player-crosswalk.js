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

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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

    const apiSportsPlayerId =
      Number(req.query.playerId || 157);

    // Kansas City Chiefs ESPN ID
    const espnTeamId = "12";


    // ========================================================
    // API-SPORTS PROFILE
    // ========================================================

    const apiSportsRes = await fetch(
      `https://v1.american-football.api-sports.io/players?id=${apiSportsPlayerId}`,
      {
        headers: {
          "x-apisports-key": apiKey
        }
      }
    );

    const apiSportsData =
      await apiSportsRes.json();

    const player =
      apiSportsData?.response?.[0] || null;

    if (!player) {
      return res.status(404).json({
        ok: false,
        error: "API-Sports player not found"
      });
    }


    // ========================================================
    // ESPN TEAM ROSTER
    // ========================================================

    const espnUrl =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeamId}/roster`;

    const espnRes =
      await fetch(espnUrl);

    if (!espnRes.ok) {
      throw new Error(
        `ESPN roster HTTP ${espnRes.status}`
      );
    }

    const espnData =
      await espnRes.json();


    const roster = [];

    const groups =
      Array.isArray(espnData?.athletes)
        ? espnData.athletes
        : [];

    for (const group of groups) {
      const items =
        Array.isArray(group?.items)
          ? group.items
          : [];

      for (const athlete of items) {
        roster.push({
          id:
            athlete?.id || null,

          name:
            athlete?.displayName ||
            athlete?.fullName ||
            athlete?.shortName ||
            null,

          position:
            athlete?.position?.abbreviation ||
            null,

          jersey:
            athlete?.jersey ||
            null
        });
      }
    }


    // ========================================================
    // MATCH BY NAME
    // ========================================================

    const targetName =
      normalizeName(player.name);

    const exactMatches =
      roster.filter(
        athlete =>
          normalizeName(athlete.name) ===
          targetName
      );


    return res.status(200).json({
      ok: true,

      apiSports: {
        id: player.id,
        name: player.name,
        position: player.position,
        number: player.number
      },

      espnTeamId,

      rosterCount:
        roster.length,

      exactMatches,

      sampleRoster:
        roster.slice(0, 10)
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

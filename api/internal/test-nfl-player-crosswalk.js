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

function normalizeStatus(status, description) {
  const raw =
    `${status || ""} ${description || ""}`
      .toLowerCase();

  if (
    raw.includes("questionable")
  ) {
    return "Questionable";
  }

  if (
    raw.includes("doubtful")
  ) {
    return "Doubtful";
  }

  if (
    raw.includes("out for") ||
    raw.includes("sidelined") ||
    raw.includes("i.l.") ||
    raw.includes("injured reserve") ||
    raw.includes("pup")
  ) {
    return "Out";
  }

  return String(status || "Unknown");
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

  const errors =
    data?.errors || [];

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
    // KANSAS CITY
    // API-SPORTS = 17
    // ESPN       = 12
    // ========================================================

    const apiTeamId = 17;
    const espnTeamId = "12";
    const season = 2026;


    // ========================================================
    // 1. CURRENT INJURIES
    // ========================================================

    const injuriesData =
      await apiSports(
        `/injuries?team=${apiTeamId}`,
        apiKey
      );

    const injuries =
      Array.isArray(injuriesData?.response)
        ? injuriesData.response
        : [];


    // ========================================================
    // 2. API-SPORTS TEAM PLAYERS
    // ========================================================

    const playersData =
      await apiSports(
        `/players?team=${apiTeamId}&season=${season}`,
        apiKey
      );

    const apiPlayers =
      Array.isArray(playersData?.response)
        ? playersData.response
        : [];


    const apiPlayersById =
      new Map(
        apiPlayers.map(player => [
          String(player?.id),
          player
        ])
      );


    // ========================================================
    // 3. ESPN TEAM ROSTER
    // ========================================================

    const espnResponse = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeamId}/roster`
    );

    if (!espnResponse.ok) {
      throw new Error(
        `ESPN roster HTTP ${espnResponse.status}`
      );
    }

    const espnData =
      await espnResponse.json();

    const espnRoster = [];

    for (
      const group of
      Array.isArray(espnData?.athletes)
        ? espnData.athletes
        : []
    ) {
      for (
        const athlete of
        Array.isArray(group?.items)
          ? group.items
          : []
      ) {
        espnRoster.push({
          id:
            String(athlete?.id || ""),

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
    // 4. CROSSWALK ALL CURRENT INJURIES
    // ========================================================

    const resolved =
      injuries.map(injury => {

        const apiPlayerId =
          String(
            injury?.player?.id ||
            ""
          );

        const apiProfile =
          apiPlayersById.get(
            apiPlayerId
          ) || null;

        const injuryName =
          injury?.player?.name ||
          apiProfile?.name ||
          null;

        const targetName =
          normalizeName(
            injuryName
          );

        const position =
          apiProfile?.position ||
          null;


        let espnMatch =
          espnRoster.find(player =>
            normalizeName(player.name) ===
              targetName &&
            (
              !position ||
              !player.position ||
              String(player.position)
                .toUpperCase() ===
              String(position)
                .toUpperCase()
            )
          ) || null;


        if (!espnMatch) {
          espnMatch =
            espnRoster.find(player =>
              normalizeName(player.name) ===
              targetName
            ) || null;
        }


        return {
          apiSportsPlayerId:
            apiPlayerId || null,

          espnAthleteId:
            espnMatch?.id ||
            null,

          name:
            injuryName,

          position:
            position ||
            espnMatch?.position ||
            null,

          rawStatus:
            injury?.status ||
            null,

          normalizedStatus:
            normalizeStatus(
              injury?.status,
              injury?.description
            ),

          reportDate:
            injury?.date ||
            null,

          description:
            injury?.description ||
            null,

          matched:
            Boolean(
              apiProfile &&
              espnMatch
            )
        };
      });


    const matched =
      resolved.filter(
        player => player.matched
      );

    const unmatched =
      resolved.filter(
        player => !player.matched
      );


    return res.status(200).json({
      ok: true,

      team: "Kansas City Chiefs",

      apiSportsTeamId:
        apiTeamId,

      espnTeamId,

      injuryCount:
        injuries.length,

      apiPlayersCount:
        apiPlayers.length,

      espnRosterCount:
        espnRoster.length,

      matchedCount:
        matched.length,

      unmatchedCount:
        unmatched.length,

      matched,

      unmatched
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

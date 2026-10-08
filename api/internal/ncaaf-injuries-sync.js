const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// SECURITY
// ============================================================

function secureEqual(
  supplied,
  expected
) {

  if (
    !supplied ||
    !expected
  ) {
    return false;
  }


  const a =
    crypto
      .createHash("sha256")
      .update(
        String(supplied)
      )
      .digest();


  const b =
    crypto
      .createHash("sha256")
      .update(
        String(expected)
      )
      .digest();


  return crypto
    .timingSafeEqual(
      a,
      b
    );
}


// ============================================================
// SPORTS DATA IO
// ============================================================

async function fetchSportsDataIO(
  endpoint
) {

  const apiKey =
    process.env.SPORTSDATAIO_KEY ||
    process.env.SPORTSDATA_API_KEY;


  if (!apiKey) {
    throw new Error(
      "SportsDataIO API key not configured"
    );
  }


  const response =
    await fetch(
      `https://api.sportsdata.io/v3/cfb/scores/json/${endpoint}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key":
            apiKey
        }
      }
    );


  if (!response.ok) {
    throw new Error(
      `SportsDataIO ${endpoint} HTTP ${response.status}`
    );
  }


  return await response.json();
}


// ============================================================
// NORMALIZE INJURIES
// ============================================================

function normalizeInjuries(
  raw
) {

  if (!Array.isArray(raw)) {
    return [];
  }


  return raw
    .map(
      player => ({

        name:
          `${player.FirstName || ""} ${player.LastName || ""}`
            .trim(),

        position:
          player.Position ||
          null,

        athleteId:
          player.PlayerID != null
            ? String(player.PlayerID)
            : null,

        sportsDataTeamId:
          player.TeamID != null
            ? String(player.TeamID)
            : null,

        teamKey:
          player.Team ||
          null,

        status:
          player.InjuryStatus ||
          null,

        startDate:
          player.InjuryStartDate ||
          null,

        returnDate:
          null,

        notes:
          player.InjuryNotes ||
          "",

        bodyPart:
          player.InjuryBodyPart ||
          null,

        updatedAt:
          player.Updated ||
          null
      })
    )
    .sort(
      (a, b) => {

        const aKey =
          `${a.sportsDataTeamId || ""}|${a.athleteId || ""}|${a.status || ""}`;

        const bKey =
          `${b.sportsDataTeamId || ""}|${b.athleteId || ""}|${b.status || ""}`;

        return aKey.localeCompare(
          bKey
        );
      }
    );
}


// ============================================================
// FINGERPRINT
// ============================================================

function buildFingerprint(
  injuries
) {

  const relevant =
    injuries.map(
      player => ({

        athleteId:
          player.athleteId,

        teamId:
          player.sportsDataTeamId,

        status:
          player.status,

        startDate:
          player.startDate,

        bodyPart:
          player.bodyPart,

        updatedAt:
          player.updatedAt
      })
    );


  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        relevant
      )
    )
    .digest("hex");
}


// ============================================================
// TEAMS
// ============================================================

async function shouldRefreshTeams() {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "ncaaf_sportsdata_teams"
      )
      .select(
        "updated_at"
      )
      .order(
        "updated_at",
        {
          ascending: false
        }
      )
      .limit(1);


  if (error) {
    throw error;
  }


  const latest =
    data?.[0]?.updated_at;


  if (!latest) {
    return true;
  }


  const age =
    Date.now() -
    new Date(
      latest
    ).getTime();


  return (
    age >
    7 *
      24 *
      60 *
      60 *
      1000
  );
}


async function refreshTeams() {

  const raw =
    await fetchSportsDataIO(
      "Teams"
    );


  if (!Array.isArray(raw)) {
    throw new Error(
      "SportsDataIO Teams returned invalid data"
    );
  }


  const now =
    new Date()
      .toISOString();


  const rows =
    raw
      .filter(
        team =>
          team?.TeamID != null
      )
      .map(
        team => ({

          team_id:
            Number(
              team.TeamID
            ),

          team_key:
            team.Key ||
            null,

          school:
            team.School ||
            null,

          name:
            team.Name ||
            null,

          full_name:
            `${team.School || ""} ${team.Name || ""}`
              .trim() ||
            null,

          short_display_name:
            team.ShortDisplayName ||
            null,

          updated_at:
            now
        })
      );


  if (!rows.length) {
    return 0;
  }


  const {
    error
  } =
    await supabaseAdmin
      .from(
        "ncaaf_sportsdata_teams"
      )
      .upsert(
        rows,
        {
          onConflict:
            "team_id"
        }
      );


  if (error) {
    throw error;
  }


  return rows.length;
}


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    if (
      req.method !== "GET" &&
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });
    }


    try {

      const expectedSecret =
        String(
          process.env.CRON_SECRET ||
          process.env.GENERATE_DAILY_SECRET ||
          ""
        );


      const internalSecret =
        String(
          req.headers[
            "x-internal-secret"
          ] ||
          ""
        );


      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );


      const bearerSecret =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : "";


      const authorized =
        secureEqual(
          internalSecret,
          expectedSecret
        ) ||
        secureEqual(
          bearerSecret,
          expectedSecret
        );


      if (!authorized) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // 1. REFRESH TEAMS ONLY WHEN NECESSARY
      // ======================================================

      let teamsRefreshed =
        false;

      let teamsSaved =
        0;


      const forceTeams =
        String(
          req.query?.forceTeams ||
          ""
        ) === "1";


      if (
        forceTeams ||
        await shouldRefreshTeams()
      ) {

        teamsSaved =
          await refreshTeams();

        teamsRefreshed =
          true;
      }


      // ======================================================
      // 2. ONE SPORTS DATA IO INJURY CALL
      // ======================================================

      const raw =
        await fetchSportsDataIO(
          "InjuredPlayers"
        );


      const injuries =
        normalizeInjuries(
          raw
        );


      const fingerprint =
        buildFingerprint(
          injuries
        );


      const {
        data: previous,
        error: previousError
      } =
        await supabaseAdmin
          .from(
            "ncaaf_injury_state"
          )
          .select(
            "fingerprint, changed_at"
          )
          .eq(
            "cache_key",
            "global"
          )
          .maybeSingle();


      if (previousError) {
        throw previousError;
      }


      const now =
        new Date()
          .toISOString();


      const changed =
        !previous ||
        String(
          previous.fingerprint ||
          ""
        ) !==
        fingerprint;


      const changedAt =
        changed
          ? now
          : previous?.changed_at ||
            now;


      const {
        error: saveError
      } =
        await supabaseAdmin
          .from(
            "ncaaf_injury_state"
          )
          .upsert(
            {
              cache_key:
                "global",

              provider:
                "sportsdataio",

              injuries,

              fingerprint,

              fetched_at:
                now,

              changed_at:
                changedAt,

              updated_at:
                now
            },
            {
              onConflict:
                "cache_key"
            }
          );


      if (saveError) {
        throw saveError;
      }


      return res
        .status(200)
        .json({

          ok:
            true,

          source:
            "sportsdataio",

          injuriesReceived:
            injuries.length,

          changed,

          fetchedAt:
            now,

          teamsRefreshed,

          teamsSaved,

          sample:
            injuries.slice(
              0,
              5
            )
        });


    } catch (error) {

      console.error(
        "NCAAF INJURY SYNC ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok:
            false,

          error:
            error?.message ||
            String(error)
        });
    }
  };

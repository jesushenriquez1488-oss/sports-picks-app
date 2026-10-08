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
// NAME NORMALIZER
// ============================================================

function normalizeName(
  value
) {

  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\b(jr|sr|ii|iii|iv|v)\b/gi,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}


// ============================================================
// CSV PARSER
// ============================================================

function parseCSV(
  text
) {

  const rows =
    [];

  let row =
    [];

  let field =
    "";

  let quoted =
    false;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];

    const next =
      text[i + 1];


    if (
      char === "\""
    ) {

      if (
        quoted &&
        next === "\""
      ) {

        field += "\"";
        i++;

      } else {

        quoted =
          !quoted;
      }

      continue;
    }


    if (
      char === "," &&
      !quoted
    ) {

      row.push(
        field
      );

      field =
        "";

      continue;
    }


    if (
      (
        char === "\n" ||
        char === "\r"
      ) &&
      !quoted
    ) {

      if (
        char === "\r" &&
        next === "\n"
      ) {
        i++;
      }


      row.push(
        field
      );

      field =
        "";


      if (
        row.some(
          value =>
            String(
              value
            ).trim() !== ""
        )
      ) {

        rows.push(
          row
        );
      }


      row =
        [];

      continue;
    }


    field +=
      char;
  }


  if (
    field.length ||
    row.length
  ) {

    row.push(
      field
    );

    rows.push(
      row
    );
  }


  if (
    !rows.length
  ) {
    return [];
  }


  const headers =
    rows[0]
      .map(
        value =>
          String(
            value || ""
          )
            .replace(
              /^\uFEFF/,
              ""
            )
            .trim()
      );


  return rows
    .slice(1)
    .map(
      values => {

        const result =
          {};


        for (
          let i = 0;
          i < headers.length;
          i++
        ) {

          result[
            headers[i]
          ] =
            values[i] ??
            "";
        }


        return result;
      }
    );
}


// ============================================================
// FETCH NFLVERSE ROSTER
// ============================================================

async function getNFLVerseRoster(
  season
) {

  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`;


  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "CashEdge-NFL-Crosswalk/1.0"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `NFLverse roster HTTP ${response.status}`
    );
  }


  const text =
    await response.text();


  return parseCSV(
    text
  );
}


// ============================================================
// API-SPORTS INJURIES
// ============================================================

async function getAPISportsInjuries(
  teamId
) {

  const response =
    await fetch(
      `https://v1.american-football.api-sports.io/injuries?team=${encodeURIComponent(
        teamId
      )}`,
      {
        headers: {
          "x-apisports-key":
            process.env.API_SPORTS_KEY
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `API-Sports HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  // API-Sports puede responder HTTP 200
  // y mandar error dentro del body.
  const errors =
    data?.errors;


  if (
    errors &&
    (
      Array.isArray(errors)
        ? errors.length
        : Object.keys(
            errors
          ).length
    )
  ) {

    throw new Error(
      `API-Sports: ${JSON.stringify(
        errors
      )}`
    );
  }


  return Array.isArray(
    data?.response
  )
    ? data.response
    : [];
}


// ============================================================
// SAVE CROSSWALK
// ============================================================

async function saveCrosswalks(
  rows
) {

  if (
    !rows.length
  ) {
    return 0;
  }


  const {
    error
  } =
    await supabaseAdmin
      .from(
        "nfl_player_crosswalk"
      )
      .upsert(
        rows,
        {
          onConflict:
            "api_sports_player_id"
        }
      );


  if (
    error
  ) {

    throw new Error(
      `nfl_player_crosswalk: ${error.message}`
    );
  }


  return rows.length;
}


// ============================================================
// MAIN
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    try {

      // ======================================================
      // AUTH
      // ======================================================

      const expectedSecret =
        String(
          process.env.CRON_SECRET ||
          process.env
            .GENERATE_DAILY_SECRET ||
          ""
        );


      const suppliedSecret =
        String(
          req.headers[
            "x-internal-secret"
          ] ||
          ""
        );


      if (
        !secureEqual(
          suppliedSecret,
          expectedSecret
        )
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // FIXED TEST
      // Kansas City Chiefs
      // API-Sports team id = 17
      // NFLverse team = KC
      // ======================================================

      const season =
        2026;

      const apiTeamId =
        "17";

      const apiTeamName =
        "Kansas City Chiefs";

      const nflverseTeam =
        "KC";


      // ======================================================
      // LOAD
      // ======================================================

      const [
        injuries,
        roster
      ] =
        await Promise.all([

          getAPISportsInjuries(
            apiTeamId
          ),

          getNFLVerseRoster(
            season
          )

        ]);


      // ======================================================
      // KC ROSTER ONLY
      // ======================================================

      const kcRows =
        roster.filter(
          row =>
            String(
              row.team ||
              ""
            )
              .toUpperCase()
              .trim() ===
            nflverseTeam
        );


      // ======================================================
      // DEDUPE PLAYERS
      //
      // Weekly roster repite el jugador por semana.
      // Conservamos la fila más reciente.
      // ======================================================

      const rosterByGsis =
        new Map();


      for (
        const row of kcRows
      ) {

        const gsisId =
          String(
            row.gsis_id ||
            ""
          ).trim();


        const name =
          String(
            row.full_name ||
            ""
          ).trim();


        if (
          !gsisId ||
          !name
        ) {
          continue;
        }


        const current =
          rosterByGsis.get(
            gsisId
          );


        const rowWeek =
          Number(
            row.week ||
            0
          );


        const currentWeek =
          Number(
            current?.week ||
            0
          );


        if (
          !current ||
          rowWeek >=
          currentWeek
        ) {

          rosterByGsis.set(
            gsisId,
            row
          );
        }
      }


      const players =
        Array.from(
          rosterByGsis.values()
        );


      // ======================================================
      // NAME INDEX
      // ======================================================

      const playersByName =
        new Map();


      for (
        const player of players
      ) {

        const normalized =
          normalizeName(
            player.full_name
          );


        if (
          !normalized
        ) {
          continue;
        }


        if (
          !playersByName.has(
            normalized
          )
        ) {

          playersByName.set(
            normalized,
            []
          );
        }


        playersByName
          .get(
            normalized
          )
          .push(
            player
          );
      }


      // ======================================================
      // MATCH
      // ======================================================

      const matches =
        [];

      const unmatched =
        [];

      const ambiguous =
        [];

      const saveRows =
        [];


      for (
        const injury of injuries
      ) {

        const apiPlayerId =
          String(
            injury?.player?.id ??
            injury?.player_id ??
            ""
          ).trim();


        const apiPlayerName =
          String(
            injury?.player?.name ??
            injury?.player?.full_name ??
            injury?.player_name ??
            ""
          ).trim();


        if (
          !apiPlayerId ||
          !apiPlayerName
        ) {

          unmatched.push({
            apiPlayerId:
              apiPlayerId ||
              null,

            apiPlayerName:
              apiPlayerName ||
              null,

            reason:
              "Missing API-Sports player id/name"
          });

          continue;
        }


        const normalized =
          normalizeName(
            apiPlayerName
          );


        const candidates =
          playersByName.get(
            normalized
          ) ||
          [];


        if (
          candidates.length ===
          0
        ) {

          unmatched.push({
            apiPlayerId,
            apiPlayerName,

            status:
              injury?.status ??
              null,

            description:
              injury?.description ??
              null,

            reason:
              "No NFLverse exact-name match"
          });

          continue;
        }


        if (
          candidates.length >
          1
        ) {

          ambiguous.push({
            apiPlayerId,
            apiPlayerName,

            candidates:
              candidates.map(
                player => ({
                  gsis_id:
                    player.gsis_id,

                  full_name:
                    player.full_name,

                  position:
                    player.position,

                  status:
                    player.status,

                  week:
                    player.week
                })
              )
          });

          continue;
        }


        const player =
          candidates[0];


        const result =
          {
            api_sports_player_id:
              apiPlayerId,

            api_sports_player_name:
              apiPlayerName,

            gsis_player_id:
              String(
                player.gsis_id
              ),

            nflverse_name:
              player.full_name,

            position:
              player.position ||
              null,

            roster_status:
              player.status ||
              null,

            nflverse_week:
              Number(
                player.week ||
                0
              ) ||
              null,

            injury_status:
              injury?.status ??
              null,

            injury_description:
              injury?.description ??
              null,

            match_method:
              "exact_name_team",

            confidence:
              1
          };


        matches.push(
          result
        );


        saveRows.push({
          api_sports_player_id:
            apiPlayerId,

          gsis_player_id:
            String(
              player.gsis_id
            ),

          player_name:
            apiPlayerName,

          position:
            player.position ||
            null,

          api_sports_team_id:
            apiTeamId,

          nflverse_team_id:
            nflverseTeam,

          api_sports_team_name:
            apiTeamName,

          match_method:
            "exact_name_team",

          confidence:
            1,

          updated_at:
            new Date()
              .toISOString()
        });
      }


      // ======================================================
      // SAVE ONLY EXACT MATCHES
      // ======================================================

      const saved =
        await saveCrosswalks(
          saveRows
        );


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          season,

          team: {
            apiSportsId:
              apiTeamId,

            apiSportsName:
              apiTeamName,

            nflverse:
              nflverseTeam
          },

          injuriesFound:
            injuries.length,

          nflversePlayers:
            players.length,

          matched:
            matches.length,

          unmatched:
            unmatched.length,

          ambiguous:
            ambiguous.length,

          saved,

          matches,

          unmatchedPlayers:
            unmatched,

          ambiguousPlayers:
            ambiguous

        });


    } catch (error) {

      return res
        .status(500)
        .json({
          ok: false,

          error:
            error?.message ||
            String(error)
        });
    }
  };

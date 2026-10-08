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
// CONFIG
// ============================================================

const NFLVERSE_TEAM_BY_NAME = {

  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",

  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",

  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",

  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA",

  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",

  "New York Giants": "NYG",
  "New York Jets": "NYJ",

  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",

  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",

  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",

  "Washington Commanders": "WAS"
};


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
      .update(String(supplied))
      .digest();


  const b =
    crypto
      .createHash("sha256")
      .update(String(expected))
      .digest();


  return crypto
    .timingSafeEqual(
      a,
      b
    );
}


// ============================================================
// NORMALIZE
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
// CSV
// ============================================================

function parseCSV(text) {

  const rows = [];

  let row = [];
  let field = "";
  let quoted = false;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];

    const next =
      text[i + 1];


    if (char === "\"") {

      if (
        quoted &&
        next === "\""
      ) {
        field += "\"";
        i++;
      } else {
        quoted = !quoted;
      }

      continue;
    }


    if (
      char === "," &&
      !quoted
    ) {

      row.push(field);

      field = "";

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


      row.push(field);

      field = "";


      if (
        row.some(
          value =>
            String(value)
              .trim() !== ""
        )
      ) {
        rows.push(row);
      }


      row = [];

      continue;
    }


    field += char;
  }


  if (
    field.length ||
    row.length
  ) {
    row.push(field);
    rows.push(row);
  }


  if (!rows.length) {
    return [];
  }


  const headers =
    rows[0].map(
      value =>
        String(value || "")
          .replace(/^\uFEFF/, "")
          .trim()
    );


  return rows
    .slice(1)
    .map(values => {

      const output = {};


      for (
        let i = 0;
        i < headers.length;
        i++
      ) {

        output[
          headers[i]
        ] =
          values[i] ?? "";
      }


      return output;
    });
}


// ============================================================
// NFLVERSE ROSTER
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


  if (!response.ok) {
    throw new Error(
      `NFLverse roster HTTP ${response.status}`
    );
  }


  return parseCSV(
    await response.text()
  );
}


// ============================================================
// API SPORTS
// ============================================================

async function apiSports(
  path
) {

  const response =
    await fetch(
      `https://v1.american-football.api-sports.io${path}`,
      {
        headers: {
          "x-apisports-key":
            process.env.API_SPORTS_KEY
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `API-Sports HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  const errors =
    data?.errors;


  const hasErrors =
    Array.isArray(errors)
      ? errors.length > 0
      : (
          errors &&
          typeof errors === "object" &&
          Object.keys(errors).length > 0
        );


  if (hasErrors) {

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
// SAVE
// ============================================================

async function saveCrosswalk(
  rows
) {

  if (!rows.length) {
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


  if (error) {
    throw new Error(
      error.message
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

      const expected =
        String(
          process.env.CRON_SECRET ||
          process.env
            .GENERATE_DAILY_SECRET ||
          ""
        );


      const supplied =
        String(
          req.headers[
            "x-internal-secret"
          ] ||
          ""
        );


      if (
        !secureEqual(
          supplied,
          expected
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
      // INPUT
      // ======================================================

      const season =
        Number(
          req.query.season ||
          2026
        );


      const start =
        Math.max(
          0,
          Number(
            req.query.start ||
            0
          )
        );


      const limit =
        Math.min(
          8,
          Math.max(
            1,
            Number(
              req.query.limit ||
              8
            )
          )
        );


      // ======================================================
      // LOAD TEAMS + ROSTER
      // ======================================================

      const [
        teamResponse,
        roster
      ] =
        await Promise.all([

          apiSports(
            `/teams?league=1&season=${season}`
          ),

          getNFLVerseRoster(
            season
          )

        ]);


      // ======================================================
      // NORMALIZE API TEAM RESPONSE
      // ======================================================

      const teams =
        teamResponse
          .map(item => {

            const team =
              item?.team ||
              item;


            return {
              id:
                String(
                  team?.id ||
                  ""
                ),

              name:
                String(
                  team?.name ||
                  ""
                )
            };

          })
          .filter(
            team =>
              team.id &&
              team.name
          )
          .sort(
            (a, b) =>
              a.name.localeCompare(
                b.name
              )
          );


      const batch =
        teams.slice(
          start,
          start + limit
        );


      // ======================================================
      // ROSTER INDEX
      // ======================================================

      const rosterByTeamName =
        new Map();


      for (
        const row of roster
      ) {

        const team =
          String(
            row.team ||
            ""
          )
            .toUpperCase()
            .trim();


        const name =
          normalizeName(
            row.full_name
          );


        const gsis =
          String(
            row.gsis_id ||
            ""
          ).trim();


        if (
          !team ||
          !name ||
          !gsis
        ) {
          continue;
        }


        const key =
          `${team}|${name}`;


        if (
          !rosterByTeamName.has(
            key
          )
        ) {

          rosterByTeamName.set(
            key,
            new Map()
          );
        }


        rosterByTeamName
          .get(key)
          .set(
            gsis,
            row
          );
      }


      // ======================================================
      // PROCESS BATCH
      // ======================================================

      const teamResults =
        [];

      const saveRows =
        [];


      let injuriesFound =
        0;

      let matched =
        0;

      let unmatched =
        0;

      let ambiguous =
        0;


      for (
        const team of batch
      ) {

        const nflverseTeam =
          NFLVERSE_TEAM_BY_NAME[
            team.name
          ];


        if (!nflverseTeam) {

          teamResults.push({
            team:
              team.name,

            apiTeamId:
              team.id,

            ok:
              false,

            error:
              "Missing NFLverse team mapping"
          });

          continue;
        }


        const injuries =
          await apiSports(
            `/injuries?team=${encodeURIComponent(
              team.id
            )}`
          );


        injuriesFound +=
          injuries.length;


        let teamMatched =
          0;

        let teamUnmatched =
          0;

        let teamAmbiguous =
          0;


        const unmatchedNames =
          [];


        for (
          const injury of injuries
        ) {

          const apiId =
            String(
              injury?.player?.id ??
              injury?.player_id ??
              ""
            ).trim();


          const apiName =
            String(
              injury?.player?.name ??
              injury?.player_name ??
              ""
            ).trim();


          if (
            !apiId ||
            !apiName
          ) {

            teamUnmatched++;
            unmatched++;

            continue;
          }


          const key =
            `${nflverseTeam}|${normalizeName(
              apiName
            )}`;


          const candidateMap =
            rosterByTeamName.get(
              key
            );


          const candidates =
            candidateMap
              ? Array.from(
                  candidateMap.values()
                )
              : [];


          if (
            candidates.length ===
            0
          ) {

            teamUnmatched++;
            unmatched++;

            unmatchedNames.push(
              apiName
            );

            continue;
          }


          if (
            candidates.length >
            1
          ) {

            teamAmbiguous++;
            ambiguous++;

            continue;
          }


          const player =
            candidates[0];


          teamMatched++;
          matched++;


          saveRows.push({

            api_sports_player_id:
              apiId,

            gsis_player_id:
              String(
                player.gsis_id
              ),

            player_name:
              apiName,

            position:
              player.position ||
              null,

            api_sports_team_id:
              team.id,

            nflverse_team_id:
              nflverseTeam,

            api_sports_team_name:
              team.name,

            match_method:
              "exact_name_team",

            confidence:
              1,

            updated_at:
              new Date()
                .toISOString()
          });
        }


        teamResults.push({

          team:
            team.name,

          apiTeamId:
            team.id,

          nflverseTeam,

          injuries:
            injuries.length,

          matched:
            teamMatched,

          unmatched:
            teamUnmatched,

          ambiguous:
            teamAmbiguous,

          unmatchedNames

        });
      }


      // ======================================================
      // SAVE
      // ======================================================

      const saved =
        await saveCrosswalk(
          saveRows
        );


      return res
        .status(200)
        .json({

          ok: true,

          season,

          totalTeams:
            teams.length,

          start,

          limit,

          processedTeams:
            batch.length,

          nextStart:
            start +
            batch.length,

          done:
            (
              start +
              batch.length
            ) >=
            teams.length,

          injuriesFound,

          matched,

          unmatched,

          ambiguous,

          saved,

          teamResults

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

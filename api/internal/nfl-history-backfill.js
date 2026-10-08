const crypto = require("crypto");

const {
  createClient
} = require("@supabase/supabase-js");


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
  if (!supplied || !expected) {
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

  return crypto.timingSafeEqual(
    a,
    b
  );
}


// ============================================================
// CSV PARSER
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
      (char === "\n" ||
       char === "\r") &&
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
            String(value).trim() !== ""
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

      const result = {};

      for (
        let i = 0;
        i < headers.length;
        i++
      ) {
        result[
          headers[i]
        ] =
          values[i] ?? "";
      }

      return result;
    });
}


// ============================================================
// FETCH CSV
// ============================================================

async function fetchCSV(url) {

  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "CashEdge-NFL-History/1.0"
        }
      }
    );


  if (!response.ok) {
    throw new Error(
      `NFLverse HTTP ${response.status}: ${url}`
    );
  }


  const text =
    await response.text();


  return parseCSV(text);
}


// ============================================================
// HELPERS
// ============================================================

function normalizeName(value) {

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


function normalizePosition(value) {

  const pos =
    String(
      value || ""
    )
      .toUpperCase()
      .trim();


  if (pos === "QB") {
    return "QB";
  }


  if (
    pos === "RB" ||
    pos === "HB" ||
    pos === "FB"
  ) {
    return "RB";
  }


  if (pos === "WR") {
    return "WR";
  }


  if (pos === "TE") {
    return "TE";
  }


  return null;
}


function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const n =
    Number(value);


  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// ROSTER STATUS
//
// Estos estados significan que el jugador
// todavía pertenece al equipo / está bajo control del equipo.
//
// NO incluimos CUT / UFA / practice squad.
// ============================================================

const VALID_TEAM_STATUSES =
  new Set([
    "ACT",
    "INA",
    "PUP",
    "RES",
    "RSN",
    "EXE",
    "SUS"
  ]);


function rosterStatusCounts(
  status
) {

  return VALID_TEAM_STATUSES.has(
    String(
      status || ""
    )
      .toUpperCase()
      .trim()
  );
}


// ============================================================
// UPSERT
// ============================================================

async function upsertChunks(
  table,
  rows,
  onConflict
) {

  if (!rows.length) {
    return 0;
  }


  let saved = 0;

  const chunkSize =
    500;


  for (
    let i = 0;
    i < rows.length;
    i += chunkSize
  ) {

    const chunk =
      rows.slice(
        i,
        i + chunkSize
      );


    const {
      error
    } =
      await supabaseAdmin
        .from(table)
        .upsert(
          chunk,
          {
            onConflict
          }
        );


    if (error) {
      throw new Error(
        `${table}: ${error.message}`
      );
    }


    saved +=
      chunk.length;
  }


  return saved;
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
      // INPUT
      // ======================================================

      const season =
        Number(
          req.query.season ||
          2025
        );


      const week =
        Number(
          req.query.week ||
          1
        );


      if (
        ![2025, 2026]
          .includes(season)
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "season must be 2025 or 2026"
          });
      }


      if (
        !Number.isInteger(week) ||
        week < 1 ||
        week > 22
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Invalid week"
          });
      }


      // ======================================================
      // NFLVERSE URLS
      // ======================================================

      const rosterUrl =
        `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`;


      const snapsUrl =
        `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;


      const scheduleUrl =
        "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";


      // ======================================================
      // LOAD DATA
      // ======================================================

      const [
        rosterData,
        snapData,
        scheduleData
      ] =
        await Promise.all([
          fetchCSV(
            rosterUrl
          ),

          fetchCSV(
            snapsUrl
          ),

          fetchCSV(
            scheduleUrl
          )
        ]);


      // ======================================================
      // SCHEDULE FOR THIS WEEK
      // REGULAR SEASON ONLY
      // ======================================================

      const games =
        scheduleData.filter(
          game =>
            Number(
              game.season
            ) === season &&
            Number(
              game.week
            ) === week &&
            String(
              game.game_type ||
              ""
            )
              .toUpperCase() ===
              "REG"
        );


      if (!games.length) {

        return res
          .status(200)
          .json({
            ok: true,
            season,
            week,
            games: 0,
            message:
              "No regular-season games found for this week."
          });
      }


      // ======================================================
      // GAME MAP BY TEAM
      // ======================================================

      const gameByTeam =
        new Map();


      for (
        const game of games
      ) {

        const home =
          String(
            game.home_team ||
            ""
          ).trim();


        const away =
          String(
            game.away_team ||
            ""
          ).trim();


        if (
          !home ||
          !away ||
          !game.game_id
        ) {
          continue;
        }


        gameByTeam.set(
          home,
          {
            ...game,
            team:
              home,

            opponent:
              away,

            isHome:
              true,

            teamScore:
              numberOrNull(
                game.home_score
              ),

            opponentScore:
              numberOrNull(
                game.away_score
              )
          }
        );


        gameByTeam.set(
          away,
          {
            ...game,
            team:
              away,

            opponent:
              home,

            isHome:
              false,

            teamScore:
              numberOrNull(
                game.away_score
              ),

            opponentScore:
              numberOrNull(
                game.home_score
              )
          }
        );
      }


      // ======================================================
      // TEAM GAME ROWS
      // ======================================================

      const teamGameRows =
        [];


      for (
        const game of games
      ) {

        const gameId =
          String(
            game.game_id ||
            ""
          );


        const date =
          String(
            game.gameday ||
            ""
          );


        const home =
          String(
            game.home_team ||
            ""
          );


        const away =
          String(
            game.away_team ||
            ""
          );


        const homeScore =
          numberOrNull(
            game.home_score
          );


        const awayScore =
          numberOrNull(
            game.away_score
          );


        if (
          !gameId ||
          !date ||
          !home ||
          !away
        ) {
          continue;
        }


        // No guardamos partidos
        // todavía no terminados.
        if (
          homeScore === null ||
          awayScore === null
        ) {
          continue;
        }


        teamGameRows.push(
          {
            sport:
              "nfl",

            season,

            game_id:
              gameId,

            provider_game_id:
              gameId,

            game_date:
              date,

            team_id:
              home,

            team_name:
              home,

            opponent_id:
              away,

            opponent_name:
              away,

            is_home:
              true,

            team_points:
              homeScore,

            opponent_points:
              awayScore,

            updated_at:
              new Date()
                .toISOString()
          },

          {
            sport:
              "nfl",

            season,

            game_id:
              gameId,

            provider_game_id:
              gameId,

            game_date:
              date,

            team_id:
              away,

            team_name:
              away,

            opponent_id:
              home,

            opponent_name:
              home,

            is_home:
              false,

            team_points:
              awayScore,

            opponent_points:
              homeScore,

            updated_at:
              new Date()
                .toISOString()
          }
        );
      }


      // ======================================================
      // SNAP COUNTS FOR WEEK
      // ======================================================

      const weekSnaps =
        snapData.filter(
          row =>
            Number(
              row.season
            ) === season &&
            Number(
              row.week
            ) === week &&
            String(
              row.game_type ||
              ""
            )
              .toUpperCase() ===
              "REG"
        );


      // ======================================================
      // INDEX SNAP COUNTS
      // Preferimos PFR ID.
      // Nombre es fallback.
      // ======================================================

      const snapsByPfr =
        new Map();


      const snapsByName =
        new Map();


      for (
        const snap of
        weekSnaps
      ) {

        const team =
          String(
            snap.team ||
            ""
          ).trim();


        if (!team) {
          continue;
        }


        const pfrId =
          String(
            snap.pfr_player_id ||
            ""
          ).trim();


        if (pfrId) {

          snapsByPfr.set(
            `${team}|${pfrId}`,
            snap
          );
        }


        const normalizedName =
          normalizeName(
            snap.player
          );


        if (normalizedName) {

          snapsByName.set(
            `${team}|${normalizedName}`,
            snap
          );
        }
      }


      // ======================================================
      // WEEKLY ROSTER
      // ======================================================

      const weekRoster =
        rosterData.filter(
          row =>
            Number(
              row.season
            ) === season &&
            Number(
              row.week
            ) === week &&
            String(
              row.game_type ||
              "REG"
            )
              .toUpperCase() ===
              "REG"
        );


      // ======================================================
      // DEDUPE ROSTER
      // ======================================================

      const rosterMap =
        new Map();


      for (
        const player of
        weekRoster
      ) {

        const team =
          String(
            player.team ||
            ""
          ).trim();


        const gsisId =
          String(
            player.gsis_id ||
            ""
          ).trim();


        const position =
          normalizePosition(
            player.position ||
            player
              .depth_chart_position
          );


        if (
          !team ||
          !gsisId ||
          !position
        ) {
          continue;
        }


        if (
          !rosterStatusCounts(
            player.status
          )
        ) {
          continue;
        }


        if (
          !gameByTeam.has(
            team
          )
        ) {

          // Bye week / no game.
          continue;
        }


        rosterMap.set(
          `${team}|${gsisId}`,
          {
            ...player,
            team,
            gsisId,
            position
          }
        );
      }


      // ======================================================
      // BUILD PLAYER GAME ROWS
      // ======================================================

      const playerRows =
        [];


      let withOffensiveSnaps =
        0;


      let withoutOffensiveSnaps =
        0;


      let matchedByPfr =
        0;


      let matchedByName =
        0;


      for (
        const player of
        rosterMap.values()
      ) {

        const game =
          gameByTeam.get(
            player.team
          );


        if (
          !game?.game_id
        ) {
          continue;
        }


        // Only completed games.
        if (
          game.teamScore === null ||
          game.opponentScore === null
        ) {
          continue;
        }


        const pfrId =
          String(
            player.pfr_id ||
            ""
          ).trim();


        let snap =
          null;


        if (pfrId) {

          snap =
            snapsByPfr.get(
              `${player.team}|${pfrId}`
            ) ||
            null;


          if (snap) {
            matchedByPfr++;
          }
        }


        if (!snap) {

          snap =
            snapsByName.get(
              `${player.team}|${normalizeName(
                player.full_name
              )}`
            ) ||
            null;


          if (snap) {
            matchedByName++;
          }
        }


        const offenseSnaps =
          snap
            ? (
                numberOrNull(
                  snap.offense_snaps
                ) || 0
              )
            : 0;


        const offensePct =
          snap
            ? numberOrNull(
                snap.offense_pct
              )
            : 0;


        // IMPORTANT:
        // "played" aquí significa:
        // participó ofensivamente.
        //
        // Para nuestro modelo QB/RB/WR/TE
        // eso es lo que interesa.
        const played =
          offenseSnaps > 0;


        if (played) {
          withOffensiveSnaps++;
        } else {
          withoutOffensiveSnaps++;
        }


        playerRows.push({
          sport:
            "nfl",

          season,

          game_id:
            String(
              game.game_id
            ),

          provider_game_id:
            String(
              game.game_id
            ),

          game_date:
            String(
              game.gameday
            ),

          team_id:
            String(
              player.team
            ),

          player_id:
            String(
              player.gsisId
            ),

          player_name:
            player.full_name ||
            snap?.player ||
            null,

          position:
            player.position,

          played,

          offense_snaps:
            offenseSnaps,

          offense_pct:
            offensePct,

          pfr_player_id:
            pfrId ||
            snap?.pfr_player_id ||
            null,

          gsis_player_id:
            String(
              player.gsisId
            ),

          source:
            "nflverse",

          updated_at:
            new Date()
              .toISOString()
        });
      }


      // ======================================================
      // SAVE
      // ======================================================

      const teamGamesSaved =
        await upsertChunks(
          "football_team_games",
          teamGameRows,
          "sport,game_id,team_id"
        );


      const playerGamesSaved =
        await upsertChunks(
          "football_player_game_stats",
          playerRows,
          "sport,game_id,team_id,player_id"
        );


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          source:
            "nflverse",

          season,

          week,

          gamesFound:
            games.length,

          completedGamesSaved:
            teamGameRows.length /
            2,

          teamGamesSaved,

          rosterRowsRaw:
            weekRoster.length,

          rosterPlayersEligible:
            rosterMap.size,

          snapRowsRaw:
            weekSnaps.length,

          playerGamesSaved,

          withOffensiveSnaps,

          withoutOffensiveSnaps,

          matchedByPfr,

          matchedByName,

          samplePlayed:
            playerRows
              .filter(
                row =>
                  row.played
              )
              .slice(
                0,
                5
              ),

          sampleWithout:
            playerRows
              .filter(
                row =>
                  !row.played
              )
              .slice(
                0,
                5
              )
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

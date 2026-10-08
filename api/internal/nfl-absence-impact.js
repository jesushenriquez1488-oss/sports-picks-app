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
// HELPERS
// ============================================================

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function avg(values) {

  const clean =
    values
      .map(num)
      .filter(
        value =>
          value !== null
      );

  if (!clean.length) {
    return null;
  }

  return (
    clean.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    clean.length
  );
}


function round(
  value,
  decimals = 3
) {

  const n =
    num(value);

  if (n === null) {
    return null;
  }

  const power =
    10 ** decimals;

  return (
    Math.round(
      n * power
    ) /
    power
  );
}


// ============================================================
// RELIABILITY
//
// NFL tiene muestras pequeñas.
// 8 WITH + 4 WITHOUT = confiabilidad máxima.
// ============================================================

function getReliability(
  gamesWith,
  gamesWithout
) {

  if (
    gamesWith < 1 ||
    gamesWithout < 1
  ) {
    return 0;
  }

  const withScore =
    Math.min(
      gamesWith / 8,
      1
    );

  const withoutScore =
    Math.min(
      gamesWithout / 4,
      1
    );

  return round(
    Math.sqrt(
      withScore *
      withoutScore
    ),
    3
  );
}

// ============================================================
// READ PAGED
// ============================================================

async function readAll(
  table,
  select,
  filters = []
) {

  const PAGE_SIZE =
    1000;

  let from =
    0;

  const output =
    [];


  while (true) {

    let query =
      supabaseAdmin
        .from(table)
        .select(select);


    for (
      const filter of
      filters
    ) {

      query =
        query.eq(
          filter.column,
          filter.value
        );
    }


    const {
      data,
      error
    } =
      await query
        .range(
          from,
          from +
          PAGE_SIZE -
          1
        );


    if (error) {
      throw new Error(
        `${table}: ${error.message}`
      );
    }


    const rows =
      data || [];


    output.push(
      ...rows
    );


    if (
      rows.length <
      PAGE_SIZE
    ) {
      break;
    }


    from +=
      PAGE_SIZE;
  }


  return output;
}


// ============================================================
// UPSERT
// ============================================================

async function upsertChunks(
  rows
) {

  const chunkSize =
    250;

  let saved =
    0;


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
        .from(
          "football_player_absence_impact"
        )
        .upsert(
          chunk,
          {
            onConflict:
              "sport,season,team_id,player_id"
          }
        );


    if (error) {
      throw new Error(
        `football_player_absence_impact: ${error.message}`
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
      // SEASON
      // ======================================================

      const season =
        Number(
          req.query.season ||
          2025
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


      // ======================================================
      // LOAD DATA
      // ======================================================

      const [
        games,
        playerGames
      ] =
        await Promise.all([

          readAll(
            "football_team_games",
            `
              sport,
              season,
              game_id,
              game_date,
              team_id,
              opponent_id,
              is_home,
              team_points,
              opponent_points
            `,
            [
              {
                column:
                  "sport",
                value:
                  "nfl"
              },
              {
                column:
                  "season",
                value:
                  season
              }
            ]
          ),

          readAll(
            "football_player_game_stats",
            `
              sport,
              season,
              game_id,
              game_date,
              team_id,
              player_id,
              player_name,
              position,
              played,
              offense_snaps,
              offense_pct,
              roster_status
            `,
            [
              {
                column:
                  "sport",
                value:
                  "nfl"
              },
              {
                column:
                  "season",
                value:
                  season
              }
            ]
          )

        ]);


      // ======================================================
      // GAME LOOKUP
      // ======================================================

      const gameMap =
        new Map();


      const gamesByTeam =
        new Map();


      for (
        const game of games
      ) {

        const key =
          `${game.game_id}|${game.team_id}`;


        gameMap.set(
          key,
          game
        );


        const teamKey =
          String(
            game.team_id
          );


        if (
          !gamesByTeam.has(
            teamKey
          )
        ) {
          gamesByTeam.set(
            teamKey,
            []
          );
        }


        gamesByTeam
          .get(teamKey)
          .push(game);
      }


      // ======================================================
      // OPPONENT BASELINE
      //
      // IMPORTANT:
      // excluimos el partido actual para no usar el mismo
      // resultado como parte de la fuerza del rival.
      // ======================================================

      function opponentBaseline(
        opponentId,
        excludeGameId
      ) {

        const rows =
          (
            gamesByTeam.get(
              String(
                opponentId
              )
            ) ||
            []
          )
            .filter(
              row =>
                String(
                  row.game_id
                ) !==
                String(
                  excludeGameId
                )
            );


        if (!rows.length) {
          return null;
        }


        const pointsScored =
          avg(
            rows.map(
              row =>
                row.team_points
            )
          );


        const pointsAllowed =
          avg(
            rows.map(
              row =>
                row.opponent_points
            )
          );


        if (
          pointsScored === null ||
          pointsAllowed === null
        ) {
          return null;
        }


        return {
          pointsScored,
          pointsAllowed
        };
      }


      // ======================================================
      // BUILD PLAYER PROFILES
      // ======================================================

      const profiles =
        new Map();


      for (
        const player of
        playerGames
      ) {

        const profileKey =
          [
            player.team_id,
            player.player_id
          ].join("|");


        if (
          !profiles.has(
            profileKey
          )
        ) {

          profiles.set(
            profileKey,
            {
              teamId:
                String(
                  player.team_id
                ),

              playerId:
                String(
                  player.player_id
                ),

              playerName:
                player.player_name ||
                null,

              position:
                player.position ||
                null,

              with:
                [],

              without:
                []
            }
          );
        }


        const game =
          gameMap.get(
            `${player.game_id}|${player.team_id}`
          );


        if (!game) {
          continue;
        }


        const baseline =
          opponentBaseline(
            game.opponent_id,
            game.game_id
          );


        const teamPoints =
          num(
            game.team_points
          );

        const opponentPoints =
          num(
            game.opponent_points
          );


        if (
          teamPoints === null ||
          opponentPoints === null
        ) {
          continue;
        }


        const record = {

          gameId:
            game.game_id,

          teamPoints,

          opponentPoints,

          total:
            teamPoints +
            opponentPoints,

          margin:
            teamPoints -
            opponentPoints,

          offensePct:
            num(
              player.offense_pct
            ) || 0,

          offenseSnaps:
            num(
              player.offense_snaps
            ) || 0,

          offenseResidual:
            baseline
              ? (
                  teamPoints -
                  baseline
                    .pointsAllowed
                )
              : null,

          defenseResidual:
            baseline
              ? (
                  opponentPoints -
                  baseline
                    .pointsScored
                )
              : null
        };


        const profile =
          profiles.get(
            profileKey
          );


        if (
          player.played ===
          true
        ) {

          profile.with.push(
            record
          );

        } else if (
          player.played ===
          false
        ) {

          profile.without.push(
            record
          );
        }
      }


      // ======================================================
      // CALCULATE
      // ======================================================

      const outputRows =
        [];


      for (
        const profile of
        profiles.values()
      ) {

        const withPlayer =
          profile.with;

        const withoutPlayer =
          profile.without;


        // No absence = no injury history.
        if (
          withoutPlayer.length <
          1
        ) {
          continue;
        }


        const gamesWith =
          withPlayer.length;

        const gamesWithout =
          withoutPlayer.length;


        // ====================================================
        // RAW
        // ====================================================

        const teamPointsWith =
          avg(
            withPlayer.map(
              row =>
                row.teamPoints
            )
          );


        const teamPointsWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.teamPoints
            )
          );


        const opponentPointsWith =
          avg(
            withPlayer.map(
              row =>
                row.opponentPoints
            )
          );


        const opponentPointsWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.opponentPoints
            )
          );


        const totalWith =
          avg(
            withPlayer.map(
              row =>
                row.total
            )
          );


        const totalWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.total
            )
          );


        const marginWith =
          avg(
            withPlayer.map(
              row =>
                row.margin
            )
          );


        const marginWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.margin
            )
          );


        // ====================================================
        // CONTROLLED
        // ====================================================

        const offenseWith =
          avg(
            withPlayer.map(
              row =>
                row.offenseResidual
            )
          );


        const offenseWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.offenseResidual
            )
          );


        const defenseWith =
          avg(
            withPlayer.map(
              row =>
                row.defenseResidual
            )
          );


        const defenseWithout =
          avg(
            withoutPlayer.map(
              row =>
                row.defenseResidual
            )
          );


        const offenseControlled =
          offenseWith !== null &&
          offenseWithout !== null
            ? (
                offenseWithout -
                offenseWith
              )
            : null;


        const defenseControlled =
          defenseWith !== null &&
          defenseWithout !== null
            ? (
                defenseWithout -
                defenseWith
              )
            : null;


        const marginControlled =
          offenseControlled !== null &&
          defenseControlled !== null
            ? (
                offenseControlled -
                defenseControlled
              )
            : null;


        // ====================================================
        // PLAYER USAGE
        // ====================================================

        const avgOffensePctWith =
          avg(
            withPlayer.map(
              row =>
                row.offensePct
            )
          );


        const avgOffenseSnapsWith =
          avg(
            withPlayer.map(
              row =>
                row.offenseSnaps
            )
          );


        // ====================================================
        // SAMPLE QUALITY
        // ====================================================

        const reliability =
          getReliability(
            gamesWith,
            gamesWithout
          );


        const matchedWeight =
          round(
            Math.min(
              gamesWith,
              gamesWithout
            ) *
            reliability,
            3
          );


        outputRows.push({

          sport:
            "nfl",

          season,

          team_id:
            profile.teamId,

          player_id:
            profile.playerId,

          player_name:
            profile.playerName,

          position:
            profile.position,

          games_with:
            gamesWith,

          games_without:
            gamesWithout,


          team_points_with:
            round(
              teamPointsWith
            ),

          team_points_without:
            round(
              teamPointsWithout
            ),

          team_points_change:
            teamPointsWith !== null &&
            teamPointsWithout !== null
              ? round(
                  teamPointsWithout -
                  teamPointsWith
                )
              : null,


          opponent_points_with:
            round(
              opponentPointsWith
            ),

          opponent_points_without:
            round(
              opponentPointsWithout
            ),

          opponent_points_change:
            opponentPointsWith !== null &&
            opponentPointsWithout !== null
              ? round(
                  opponentPointsWithout -
                  opponentPointsWith
                )
              : null,


          total_with:
            round(
              totalWith
            ),

          total_without:
            round(
              totalWithout
            ),

          total_change:
            totalWith !== null &&
            totalWithout !== null
              ? round(
                  totalWithout -
                  totalWith
                )
              : null,


          margin_with:
            round(
              marginWith
            ),

          margin_without:
            round(
              marginWithout
            ),

          margin_change:
            marginWith !== null &&
            marginWithout !== null
              ? round(
                  marginWithout -
                  marginWith
                )
              : null,


          offense_change_controlled:
            round(
              offenseControlled
            ),

          defense_change_controlled:
            round(
              defenseControlled
            ),

          margin_change_controlled:
            round(
              marginControlled
            ),


          avg_offense_pct_with:
            round(
              avgOffensePctWith
            ),

          avg_offense_snaps_with:
            round(
              avgOffenseSnapsWith
            ),


          matched_weight:
            matchedWeight,

          reliability,

          updated_at:
            new Date()
              .toISOString()
        });
      }


      // ======================================================
      // SAVE
      // ======================================================

      const rowsSaved =
        await upsertChunks(
          outputRows
        );


      // ======================================================
      // RESPONSE
      // ======================================================

      const usable =
        outputRows.filter(
          row =>
            row.games_with >= 1 &&
            row.games_without >= 1 &&
            row
              .margin_change_controlled !==
              null
        );


      const strongUsage =
        usable.filter(
          row =>
            Number(
              row.avg_offense_pct_with ||
              0
            ) >=
            0.50
        );


      return res
        .status(200)
        .json({

          ok: true,

          season,

          teamGames:
            games.length,

          playerGameRows:
            playerGames.length,

          profiles:
            profiles.size,

          rowsSaved,

          usableProfiles:
            usable.length,

          strongUsageProfiles:
            strongUsage.length,

          sample:
            usable
              .sort(
                (a, b) =>
                  b.reliability -
                  a.reliability
              )
              .slice(
                0,
                10
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

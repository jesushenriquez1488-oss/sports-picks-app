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
// TEAM MAP — ESPN
// ============================================================

const ESPN_TEAM_IDS = {
  "arizona cardinals": "22",
  "atlanta falcons": "1",
  "baltimore ravens": "33",
  "buffalo bills": "2",
  "carolina panthers": "29",
  "chicago bears": "3",
  "cincinnati bengals": "4",
  "cleveland browns": "5",
  "dallas cowboys": "6",
  "denver broncos": "7",
  "detroit lions": "8",
  "green bay packers": "9",
  "houston texans": "34",
  "indianapolis colts": "11",
  "jacksonville jaguars": "30",
  "kansas city chiefs": "12",
  "las vegas raiders": "13",
  "los angeles chargers": "24",
  "los angeles rams": "14",
  "miami dolphins": "15",
  "minnesota vikings": "16",
  "new england patriots": "17",
  "new orleans saints": "18",
  "new york giants": "19",
  "new york jets": "20",
  "philadelphia eagles": "21",
  "pittsburgh steelers": "23",
  "san francisco 49ers": "25",
  "seattle seahawks": "26",
  "tampa bay buccaneers": "27",
  "tennessee titans": "10",
  "washington commanders": "28"
};


// ============================================================
// HELPERS
// ============================================================

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(jr|sr|ii|iii|iv|v)\b/gi,
      ""
    )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}


function normalizePosition(value) {
  const pos =
    String(value || "")
      .toUpperCase()
      .trim();

  if (pos === "QB") return "QB";

  if (
    pos === "RB" ||
    pos === "HB" ||
    pos === "FB"
  ) {
    return "RB";
  }

  if (pos === "WR") return "WR";

  if (pos === "TE") return "TE";

  return null;
}


function getESPNTeamId(name) {
  return (
    ESPN_TEAM_IDS[
      String(name || "")
        .toLowerCase()
        .trim()
    ] ||
    null
  );
}


function hasApiErrors(errors) {
  if (Array.isArray(errors)) {
    return errors.length > 0;
  }

  return (
    errors &&
    typeof errors === "object" &&
    Object.keys(errors).length > 0
  );
}


// ============================================================
// API SPORTS
// ============================================================

async function apiSports(
  path,
  apiKey
) {
  const response =
    await fetch(
      `https://v1.american-football.api-sports.io${path}`,
      {
        headers: {
          "x-apisports-key":
            apiKey
        }
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    hasApiErrors(
      data?.errors
    )
  ) {
    throw new Error(
      `API-Sports ${path}: ` +
      JSON.stringify(
        data?.errors ||
        response.status
      )
    );
  }

  return data;
}


// ============================================================
// ESPN
// ============================================================

async function espnJson(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `ESPN ${response.status}`
    );
  }

  return response.json();
}


const scoreboardCache =
  new Map();


async function getESPNScoreboard(
  date
) {
  const key =
    String(date)
      .replace(/-/g, "");

  if (
    scoreboardCache.has(key)
  ) {
    return scoreboardCache.get(
      key
    );
  }

  const data =
    await espnJson(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${key}&limit=100`
    );

  scoreboardCache.set(
    key,
    data
  );

  return data;
}


async function findESPNGame({
  date,
  homeTeamId,
  awayTeamId
}) {
  const data =
    await getESPNScoreboard(
      date
    );

  const events =
    Array.isArray(data?.events)
      ? data.events
      : [];

  for (const event of events) {
    const competition =
      event?.competitions?.[0];

    const competitors =
      competition?.competitors ||
      [];

    const ids =
      competitors.map(
        item =>
          String(
            item?.team?.id ||
            ""
          )
      );

    if (
      ids.includes(
        String(homeTeamId)
      ) &&
      ids.includes(
        String(awayTeamId)
      )
    ) {
      return event;
    }
  }

  return null;
}


async function getESPNSummary(
  gameId
) {
  return espnJson(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`
  );
}


// ============================================================
// ESPN PLAYER PARSER
// ============================================================

function parseESPNPlayers(
  summary,
  teamId
) {
  const teamBlocks =
    Array.isArray(
      summary?.boxscore?.players
    )
      ? summary.boxscore.players
      : [];

  const block =
    teamBlocks.find(
      item =>
        String(
          item?.team?.id ||
          ""
        ) ===
        String(teamId)
    );

  if (!block) {
    return [];
  }

  const map =
    new Map();

  for (
    const group of
    block.statistics || []
  ) {
    for (
      const entry of
      group?.athletes || []
    ) {
      const athlete =
        entry?.athlete;

      const athleteId =
        String(
          athlete?.id ||
          ""
        );

      if (!athleteId) {
        continue;
      }

      const position =
        normalizePosition(
          athlete?.position
            ?.abbreviation
        );

      // Solo posiciones que usa
      // actualmente el modelo NFL.
      if (!position) {
        continue;
      }

      const existing =
        map.get(athleteId) ||
        {
          athleteId,

          name:
            athlete?.displayName ||
            athlete?.fullName ||
            null,

          position,

          starter: false,

          playedExplicit:
            false,

          didNotPlayExplicit:
            false
        };

      if (
        entry?.starter ===
        true
      ) {
        existing.starter =
          true;
      }

      if (
        entry?.didNotPlay ===
        true
      ) {
        existing.didNotPlayExplicit =
          true;
      }

      if (
        entry?.didNotPlay ===
        false
      ) {
        existing.playedExplicit =
          true;
      }

      map.set(
        athleteId,
        existing
      );
    }
  }

  return Array.from(
    map.values()
  );
}


// ============================================================
// API-SPORTS APPEARANCES
// ============================================================

function parseApiAppearances(
  statsData,
  apiTeamId
) {
  const response =
    Array.isArray(
      statsData?.response
    )
      ? statsData.response
      : [];

  const team =
    response.find(
      item =>
        String(
          item?.team?.id ||
          ""
        ) ===
        String(apiTeamId)
    );

  if (!team) {
    return [];
  }

  const map =
    new Map();

  for (
    const group of
    team.groups || []
  ) {
    for (
      const entry of
      group?.players || []
    ) {
      const player =
        entry?.player;

      if (!player?.id) {
        continue;
      }

      const id =
        String(player.id);

      if (
        !map.has(id)
      ) {
        map.set(id, {
          id,

          name:
            player?.name ||
            null
        });
      }
    }
  }

  return Array.from(
    map.values()
  );
}


// ============================================================
// UPSERT HELPER
// ============================================================

async function upsertRows(
  table,
  rows,
  onConflict
) {
  if (!rows.length) {
    return 0;
  }

  const {
    error
  } =
    await supabaseAdmin
      .from(table)
      .upsert(
        rows,
        {
          onConflict
        }
      );

  if (error) {
    throw new Error(
      `${table}: ${error.message}`
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


      const apiKey =
        String(
          process.env
            .API_SPORTS_KEY ||
          ""
        ).trim();

      if (!apiKey) {
        throw new Error(
          "API_SPORTS_KEY missing"
        );
      }


      // ======================================================
      // INPUT
      // ======================================================

      const season =
        Number(
          req.query.season ||
          2025
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
          4,
          Math.max(
            1,
            Number(
              req.query.limit ||
              4
            )
          )
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
              "Use season 2025 or 2026"
          });
      }


      // ======================================================
      // FULL SEASON SCHEDULE
      // ======================================================

      const gamesData =
        await apiSports(
          `/games?league=1&season=${season}`,
          apiKey
        );

      const allGames =
        Array.isArray(
          gamesData?.response
        )
          ? gamesData.response
          : [];


      const completed =
        allGames
          .filter(item => {

            const status =
              String(
                item?.game?.status
                  ?.short ||
                ""
              )
                .toUpperCase();

            const stage =
              String(
                item?.game?.stage ||
                ""
              )
                .toLowerCase();

            const week =
              String(
                item?.game?.week ||
                ""
              )
                .toLowerCase();

            const finished =
              status === "FT" ||
              status === "AOT";

            const preseason =
              stage.includes(
                "pre"
              ) ||
              week.includes(
                "pre"
              );

            return (
              finished &&
              !preseason
            );
          })
          .sort(
            (a, b) =>
              Number(
                a?.game?.date
                  ?.timestamp ||
                0
              ) -
              Number(
                b?.game?.date
                  ?.timestamp ||
                0
              )
          );


      const batch =
        completed.slice(
          start,
          start + limit
        );


      // ======================================================
      // NOTHING LEFT
      // ======================================================

      if (!batch.length) {
        return res
          .status(200)
          .json({
            ok: true,
            season,
            totalGames:
              completed.length,
            start,
            processed: 0,
            nextStart: null,
            done: true
          });
      }


      const playerRows = [];
      const teamGameRows = [];
      const crosswalkRows = [];

      const failures = [];

      let apiPlayersSeen = 0;
      let espnPlayersSeen = 0;
      let classifiedPlayers = 0;
      let explicitDNP = 0;


      // ======================================================
      // PROCESS GAMES
      // ======================================================

      for (
        const game of
        batch
      ) {
        try {

          const apiGameId =
            game?.game?.id;

          const gameDate =
            game?.game?.date?.date;

          const home =
            game?.teams?.home;

          const away =
            game?.teams?.away;


          if (
            !apiGameId ||
            !gameDate ||
            !home?.id ||
            !away?.id
          ) {
            throw new Error(
              "Invalid API game"
            );
          }


          const homeESPN =
            getESPNTeamId(
              home.name
            );

          const awayESPN =
            getESPNTeamId(
              away.name
            );


          if (
            !homeESPN ||
            !awayESPN
          ) {
            throw new Error(
              "ESPN team mapping missing"
            );
          }


          // ================================================
          // FIND ESPN GAME
          // ================================================

          const espnGame =
            await findESPNGame({
              date:
                gameDate,

              homeTeamId:
                homeESPN,

              awayTeamId:
                awayESPN
            });


          if (!espnGame?.id) {
            throw new Error(
              "ESPN game not found"
            );
          }


          const espnGameId =
            String(
              espnGame.id
            );


          // ================================================
          // LOAD BOTH DATA SOURCES
          // ================================================

          const [
            statsData,
            summary
          ] =
            await Promise.all([
              apiSports(
                `/games/statistics/players?id=${apiGameId}`,
                apiKey
              ),

              getESPNSummary(
                espnGameId
              )
            ]);


          // ================================================
          // SCORES
          // ================================================

          const homePoints =
            Number(
              game?.scores?.home
                ?.total
            );

          const awayPoints =
            Number(
              game?.scores?.away
                ?.total
            );


          if (
            Number.isFinite(
              homePoints
            ) &&
            Number.isFinite(
              awayPoints
            )
          ) {

            teamGameRows.push(
              {
                sport:
                  "nfl",

                season,

                game_id:
                  espnGameId,

                provider_game_id:
                  String(
                    apiGameId
                  ),

                game_date:
                  gameDate,

                team_id:
                  homeESPN,

                team_name:
                  home.name,

                opponent_id:
                  awayESPN,

                opponent_name:
                  away.name,

                is_home:
                  true,

                team_points:
                  homePoints,

                opponent_points:
                  awayPoints,

                updated_at:
                  new Date()
                    .toISOString()
              },

              {
                sport:
                  "nfl",

                season,

                game_id:
                  espnGameId,

                provider_game_id:
                  String(
                    apiGameId
                  ),

                game_date:
                  gameDate,

                team_id:
                  awayESPN,

                team_name:
                  away.name,

                opponent_id:
                  homeESPN,

                opponent_name:
                  home.name,

                is_home:
                  false,

                team_points:
                  awayPoints,

                opponent_points:
                  homePoints,

                updated_at:
                  new Date()
                    .toISOString()
              }
            );
          }


          // ================================================
          // EACH TEAM
          // ================================================

          const teams = [
            {
              apiTeamId:
                home.id,

              espnTeamId:
                homeESPN,

              teamName:
                home.name
            },

            {
              apiTeamId:
                away.id,

              espnTeamId:
                awayESPN,

              teamName:
                away.name
            }
          ];


          for (
            const team of teams
          ) {

            const apiAppearances =
              parseApiAppearances(
                statsData,
                team.apiTeamId
              );

            const espnPlayers =
              parseESPNPlayers(
                summary,
                team.espnTeamId
              );


            apiPlayersSeen +=
              apiAppearances.length;

            espnPlayersSeen +=
              espnPlayers.length;


            const apiByName =
              new Map(
                apiAppearances.map(
                  player => [
                    normalizeName(
                      player.name
                    ),
                    player
                  ]
                )
              );


            for (
              const player of
              espnPlayers
            ) {

              const apiMatch =
                apiByName.get(
                  normalizeName(
                    player.name
                  )
                ) ||
                null;


              // ------------------------------------------
              // PLAYED =
              // API-Sports says appeared
              // OR ESPN explicitly says played
              // OR ESPN says starter.
              //
              // ABSENT =
              // ONLY when ESPN explicitly says DNP.
              //
              // Unknown = do not invent.
              // ------------------------------------------

              let played =
                null;

              if (
                apiMatch ||
                player.playedExplicit ||
                player.starter
              ) {
                played =
                  true;
              } else if (
                player
                  .didNotPlayExplicit
              ) {
                played =
                  false;
              }


              if (
                played ===
                null
              ) {
                continue;
              }


              classifiedPlayers++;


              if (
                played ===
                false
              ) {
                explicitDNP++;
              }


              playerRows.push({
                sport:
                  "nfl",

                season,

                game_id:
                  espnGameId,

                provider_game_id:
                  String(
                    apiGameId
                  ),

                game_date:
                  gameDate,

                team_id:
                  String(
                    team.espnTeamId
                  ),

                player_id:
                  String(
                    player.athleteId
                  ),

                api_sports_player_id:
                  apiMatch?.id
                    ? String(
                        apiMatch.id
                      )
                    : null,

                player_name:
                  player.name,

                position:
                  player.position,

                played:
                  played === true,

                starter:
                  player.starter ===
                  true,

                explicit_dnp:
                  player
                    .didNotPlayExplicit ===
                  true,

                source:
                  apiMatch
                    ? "api-sports+espn"
                    : "espn",

                updated_at:
                  new Date()
                    .toISOString()
              });


              // ==========================================
              // CROSSWALK
              // ==========================================

              if (
                apiMatch?.id
              ) {
                crosswalkRows.push({
                  api_sports_player_id:
                    String(
                      apiMatch.id
                    ),

                  espn_athlete_id:
                    String(
                      player.athleteId
                    ),

                  player_name:
                    player.name,

                  position:
                    player.position,

                  api_sports_team_id:
                    String(
                      team.apiTeamId
                    ),

                  espn_team_id:
                    String(
                      team.espnTeamId
                    ),

                  match_method:
                    "game-name-team",

                  confidence:
                    1,

                  updated_at:
                    new Date()
                      .toISOString()
                });
              }
            }
          }


        } catch (error) {

          failures.push({
            apiGameId:
              game?.game?.id ||
              null,

            date:
              game?.game?.date
                ?.date ||
              null,

            home:
              game?.teams?.home
                ?.name ||
              null,

            away:
              game?.teams?.away
                ?.name ||
              null,

            error:
              error?.message ||
              String(error)
          });
        }
      }


      // ======================================================
      // DEDUPE CROSSWALK
      // ======================================================

      const crosswalkMap =
        new Map();

      for (
        const row of
        crosswalkRows
      ) {
        crosswalkMap.set(
          row
            .api_sports_player_id,
          row
        );
      }


      // ======================================================
      // SAVE
      // ======================================================

      const teamGamesSaved =
        await upsertRows(
          "football_team_games",
          teamGameRows,
          "sport,game_id,team_id"
        );


      const playerGamesSaved =
        await upsertRows(
          "football_player_game_stats",
          playerRows,
          "sport,game_id,team_id,player_id"
        );


      const crosswalkSaved =
        await upsertRows(
          "nfl_player_crosswalk",
          Array.from(
            crosswalkMap.values()
          ),
          "api_sports_player_id"
        );


      const nextStart =
        start +
        batch.length;


      return res
        .status(200)
        .json({

          ok: true,

          season,

          totalGames:
            completed.length,

          start,

          batchRequested:
            limit,

          processed:
            batch.length,

          nextStart:
            nextStart >=
            completed.length
              ? null
              : nextStart,

          done:
            nextStart >=
            completed.length,

          teamGamesSaved,

          playerGamesSaved,

          crosswalkSaved,

          apiPlayersSeen,

          espnPlayersSeen,

          classifiedPlayers,

          explicitDNP,

          failures
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

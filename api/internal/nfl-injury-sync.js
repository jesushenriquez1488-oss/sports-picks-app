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


  if (
    !response.ok
  ) {

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


  if (
    hasErrors
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
// PAGED SUPABASE READ
// ============================================================

async function readAll(
  table,
  select
) {

  const output =
    [];

  const PAGE_SIZE =
    1000;

  let from =
    0;


  while (
    true
  ) {

    const {
      data,
      error
    } =
      await supabaseAdmin
        .from(table)
        .select(select)
        .range(
          from,
          from +
          PAGE_SIZE -
          1
        );


    if (
      error
    ) {

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
// STATUS NORMALIZATION
//
// Misma interpretación que usamos en el modelo.
// ============================================================

function normalizeStatus(
  status,
  description
) {

  const s =
    String(
      status || ""
    )
      .toLowerCase()
      .trim();


  const d =
    String(
      description || ""
    )
      .toLowerCase()
      .trim();


  const combined =
    `${s} ${d}`;


  if (
    combined.includes(
      "injured reserve"
    ) ||
    s === "i.l." ||
    s === "il" ||
    combined.includes(
      " i.l."
    )
  ) {

    return "Out";
  }


  if (
    s === "pup" ||
    combined.includes(
      "physically unable to perform"
    )
  ) {

    return "Out";
  }


  if (
    s.includes("out") ||
    d.includes("out for week") ||
    d.includes("ruled out")
  ) {

    return "Out";
  }


  if (
    s.includes("sidelined")
  ) {

    if (
      d.includes("out") ||
      d.includes("will not play") ||
      d.includes("inactive")
    ) {

      return "Out";
    }


    return "Sidelined-Unconfirmed";
  }


  if (
    s.includes("doubtful") ||
    d.includes("doubtful")
  ) {

    return "Doubtful";
  }


  if (
    s.includes("questionable") ||
    d.includes("questionable")
  ) {

    return "Questionable";
  }


  if (
    s.includes("day-to-day") ||
    s.includes("day to day") ||
    d.includes("day-to-day") ||
    d.includes("day to day")
  ) {

    return "Day-to-Day";
  }


  if (
    s.includes("probable") ||
    d.includes("probable")
  ) {

    return "Probable";
  }


  return (
    status ||
    "Unknown"
  );
}


// ============================================================
// NORMALIZATION HELPERS
// ============================================================

function cleanText(
  value
) {

  const text =
    String(
      value ??
      ""
    ).trim();


  return text ||
    null;
}


function sameValue(
  a,
  b
) {

  return (
    String(
      a ??
      ""
    ).trim() ===
    String(
      b ??
      ""
    ).trim()
  );
}


// ============================================================
// HISTORY EVENT
// ============================================================

async function insertHistory({
  teamId,
  playerId,
  teamName,
  playerName,
  position,
  rawStatus,
  normalizedStatus,
  reportDate,
  description,
  eventType,
  observedAt
}) {

  const {
    error
  } =
    await supabaseAdmin
      .from(
        "nfl_injury_history"
      )
      .insert({

        api_sports_team_id:
          teamId,

        api_sports_player_id:
          playerId,

        team_name:
          teamName,

        player_name:
          playerName,

        position:
          position,

        raw_status:
          rawStatus,

        normalized_status:
          normalizedStatus,

        report_date:
          reportDate,

        description:
          description,

        event_type:
          eventType,

        observed_at:
          observedAt

      });


  if (
    error
  ) {

    throw new Error(
      `nfl_injury_history: ${error.message}`
    );
  }
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


      const observedAt =
        new Date()
          .toISOString();


      // ======================================================
      // LOAD CROSSWALK + TEAMS
      // ======================================================

      const [
        crosswalkRows,
        apiTeams
      ] =
        await Promise.all([

          readAll(
            "nfl_player_crosswalk",
            `
              api_sports_player_id,
              player_name,
              position,
              api_sports_team_id,
              nflverse_team_id
            `
          ),

          apiSports(
            `/teams?league=1&season=${season}`
          )

        ]);


      // ======================================================
      // CROSSWALK INDEX
      // ======================================================

      const crosswalkByApiId =
        new Map();


      for (
        const row of crosswalkRows
      ) {

        const apiPlayerId =
          String(
            row.api_sports_player_id ||
            ""
          ).trim();


        if (
          !apiPlayerId
        ) {
          continue;
        }


        crosswalkByApiId.set(
          apiPlayerId,
          row
        );
      }


      // ======================================================
      // NORMALIZE TEAMS
      // ======================================================

      const teams =
        apiTeams
          .map(
            item => {

              const team =
                item?.team ||
                item;


              return {

                id:
                  String(
                    team?.id ||
                    ""
                  ).trim(),

                name:
                  String(
                    team?.name ||
                    ""
                  ).trim()
              };
            }
          )
          .filter(
            team =>
              team.id &&
              team.name
          )
          .sort(
            (
              a,
              b
            ) =>
              a.name.localeCompare(
                b.name
              )
          );


      const batch =
        teams.slice(
          start,
          start +
          limit
        );


      // ======================================================
      // SUMMARY COUNTERS
      // ======================================================

      const totals = {

        reported:
          0,

        inserted:
          0,

        changed:
          0,

        reactivated:
          0,

        unchanged:
          0,

        deactivated:
          0,

        protectedEmptyTeams:
          0,

        failedTeams:
          0
      };


      const teamResults =
        [];


      // ======================================================
      // TEAM LOOP
      // ======================================================

      for (
        const team of batch
      ) {

        try {

          // ==================================================
          // LOAD EXISTING STATE FIRST
          //
          // Important:
          // if provider fails afterwards, existing data
          // remains completely untouched.
          // ==================================================

          const {
            data:
              existingRows,
            error:
              existingError
          } =
            await supabaseAdmin
              .from(
                "nfl_injury_state"
              )
              .select("*")
              .eq(
                "api_sports_team_id",
                team.id
              );


          if (
            existingError
          ) {

            throw new Error(
              `nfl_injury_state: ${existingError.message}`
            );
          }


          const existing =
            existingRows ||
            [];


          const activeExisting =
            existing.filter(
              row =>
                row.active ===
                true
            );


          const existingByPlayer =
            new Map();


          for (
            const row of existing
          ) {

            existingByPlayer.set(
              String(
                row.api_sports_player_id
              ),
              row
            );
          }


          // ==================================================
          // PROVIDER CALL
          // ==================================================

          const injuries =
            await apiSports(
              `/injuries?team=${encodeURIComponent(
                team.id
              )}`
            );


          totals.reported +=
            injuries.length;


          // ==================================================
          // EMPTY RESPONSE PROTECTION
          //
          // If we previously had active injuries and provider
          // suddenly sends ZERO, do NOT wipe the snapshot.
          //
          // This protects us against temporary provider issues.
          // ==================================================

          if (
            injuries.length === 0 &&
            activeExisting.length > 0
          ) {

            totals
              .protectedEmptyTeams++;


            teamResults.push({

              team:
                team.name,

              apiTeamId:
                team.id,

              reported:
                0,

              previousActive:
                activeExisting.length,

              protectedEmpty:
                true,

              message:
                "Empty provider response preserved previous active snapshot"
            });


            continue;
          }


          // ==================================================
          // CURRENT PROVIDER PLAYERS
          // ==================================================

          const currentPlayerIds =
            new Set();


          let inserted =
            0;

          let changed =
            0;

          let reactivated =
            0;

          let unchanged =
            0;

          let deactivated =
            0;


          // ==================================================
          // INCOMING INJURIES
          // ==================================================

          for (
            const injury of injuries
          ) {

            const playerId =
              String(
                injury?.player?.id ??
                injury?.player_id ??
                ""
              ).trim();


            if (
              !playerId
            ) {
              continue;
            }


            currentPlayerIds.add(
              playerId
            );


            const crosswalk =
              crosswalkByApiId.get(
                playerId
              );


            const playerName =
              cleanText(
                injury?.player?.name ??
                injury?.player_name ??
                crosswalk?.player_name
              );


            const position =
              cleanText(
                crosswalk?.position ??
                injury?.player?.position ??
                injury?.position
              );


            const rawStatus =
              cleanText(
                injury?.status
              );


            const description =
              cleanText(
                injury?.description
              );


            const reportDate =
              cleanText(
                injury?.date ??
                injury?.report_date
              );


            const normalizedStatus =
              normalizeStatus(
                rawStatus,
                description
              );


            const previous =
              existingByPlayer.get(
                playerId
              );


            // =================================================
            // NEW INJURY
            // =================================================

            if (
              !previous
            ) {

              const {
                error:
                  insertError
              } =
                await supabaseAdmin
                  .from(
                    "nfl_injury_state"
                  )
                  .insert({

                    api_sports_team_id:
                      team.id,

                    api_sports_player_id:
                      playerId,

                    team_name:
                      team.name,

                    player_name:
                      playerName,

                    position,

                    raw_status:
                      rawStatus,

                    normalized_status:
                      normalizedStatus,

                    report_date:
                      reportDate,

                    description,

                    first_seen_at:
                      observedAt,

                    last_seen_at:
                      observedAt,

                    active:
                      true,

                    updated_at:
                      observedAt

                  });


              if (
                insertError
              ) {

                throw new Error(
                  `insert nfl_injury_state: ${insertError.message}`
                );
              }


              await insertHistory({

                teamId:
                  team.id,

                playerId,

                teamName:
                  team.name,

                playerName,

                position,

                rawStatus,

                normalizedStatus,

                reportDate,

                description,

                eventType:
                  "new",

                observedAt
              });


              inserted++;
              totals.inserted++;

              continue;
            }


            // =================================================
            // EXISTING INJURY
            // =================================================

            const statusChanged =
              !sameValue(
                previous.raw_status,
                rawStatus
              ) ||
              !sameValue(
                previous.normalized_status,
                normalizedStatus
              );


            const detailChanged =
              !sameValue(
                previous.description,
                description
              ) ||
              !sameValue(
                previous.report_date,
                reportDate
              ) ||
              !sameValue(
                previous.position,
                position
              );


            const wasInactive =
              previous.active !==
              true;


            const {
              error:
                updateError
            } =
              await supabaseAdmin
                .from(
                  "nfl_injury_state"
                )
                .update({

                  team_name:
                    team.name,

                  player_name:
                    playerName,

                  position,

                  raw_status:
                    rawStatus,

                  normalized_status:
                    normalizedStatus,

                  report_date:
                    reportDate,

                  description,

                  last_seen_at:
                    observedAt,

                  active:
                    true,

                  updated_at:
                    observedAt

                })
                .eq(
                  "api_sports_team_id",
                  team.id
                )
                .eq(
                  "api_sports_player_id",
                  playerId
                );


            if (
              updateError
            ) {

              throw new Error(
                `update nfl_injury_state: ${updateError.message}`
              );
            }


            if (
              wasInactive
            ) {

              await insertHistory({

                teamId:
                  team.id,

                playerId,

                teamName:
                  team.name,

                playerName,

                position,

                rawStatus,

                normalizedStatus,

                reportDate,

                description,

                eventType:
                  "reactivated",

                observedAt
              });


              reactivated++;
              totals.reactivated++;

            } else if (
              statusChanged
            ) {

              await insertHistory({

                teamId:
                  team.id,

                playerId,

                teamName:
                  team.name,

                playerName,

                position,

                rawStatus,

                normalizedStatus,

                reportDate,

                description,

                eventType:
                  "status_change",

                observedAt
              });


              changed++;
              totals.changed++;

            } else if (
              detailChanged
            ) {

              await insertHistory({

                teamId:
                  team.id,

                playerId,

                teamName:
                  team.name,

                playerName,

                position,

                rawStatus,

                normalizedStatus,

                reportDate,

                description,

                eventType:
                  "updated",

                observedAt
              });


              changed++;
              totals.changed++;

            } else {

              unchanged++;
              totals.unchanged++;
            }
          }


          // ==================================================
          // PLAYERS NO LONGER RETURNED BY PROVIDER
          //
          // Only happens when provider response was non-empty.
          //
          // Empty response is protected above.
          // ==================================================

          if (
            injuries.length > 0
          ) {

            for (
              const previous of activeExisting
            ) {

              const playerId =
                String(
                  previous
                    .api_sports_player_id ||
                  ""
                );


              if (
                currentPlayerIds.has(
                  playerId
                )
              ) {
                continue;
              }


              const {
                error:
                  deactivateError
              } =
                await supabaseAdmin
                  .from(
                    "nfl_injury_state"
                  )
                  .update({

                    active:
                      false,

                    updated_at:
                      observedAt

                  })
                  .eq(
                    "api_sports_team_id",
                    team.id
                  )
                  .eq(
                    "api_sports_player_id",
                    playerId
                  );


              if (
                deactivateError
              ) {

                throw new Error(
                  `deactivate nfl_injury_state: ${deactivateError.message}`
                );
              }


              await insertHistory({

                teamId:
                  team.id,

                playerId,

                teamName:
                  previous.team_name ||
                  team.name,

                playerName:
                  previous.player_name,

                position:
                  previous.position,

                rawStatus:
                  previous.raw_status,

                normalizedStatus:
                  previous.normalized_status,

                reportDate:
                  previous.report_date,

                description:
                  previous.description,

                eventType:
                  "inactive",

                observedAt
              });


              deactivated++;
              totals.deactivated++;
            }
          }


          // ==================================================
          // TEAM RESULT
          // ==================================================

          teamResults.push({

            team:
              team.name,

            apiTeamId:
              team.id,

            reported:
              injuries.length,

            previousActive:
              activeExisting.length,

            inserted,

            changed,

            reactivated,

            unchanged,

            deactivated,

            protectedEmpty:
              false
          });


        } catch (
          teamError
        ) {

          // ==================================================
          // FAILURE PROTECTION
          //
          // We do NOT alter/delete the previous good snapshot
          // when this team's provider call fails.
          // ==================================================

          totals.failedTeams++;


          teamResults.push({

            team:
              team.name,

            apiTeamId:
              team.id,

            error:
              teamError?.message ||
              String(
                teamError
              ),

            snapshotPreserved:
              true
          });
        }
      }


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok:
            totals.failedTeams ===
            0,

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

          totals,

          teamResults

        });


    } catch (
      error
    ) {

      return res
        .status(500)
        .json({

          ok: false,

          error:
            error?.message ||
            String(
              error
            )

        });
    }
  };

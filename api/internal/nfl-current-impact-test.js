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


const ELIGIBLE_POSITIONS =
  new Set([
    "QB",
    "RB",
    "WR",
    "TE"
  ]);


const DEF_CROSSOVER = {
  QB: 0.35,
  RB: 0.15,
  WR: 0.10,
  TE: 0.10
};


const LEGACY_TEAM_CAP =
  10;


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
// HELPERS
// ============================================================

function round(
  value,
  decimals = 3
) {

  const n =
    Number(value);


  if (
    !Number.isFinite(n)
  ) {
    return 0;
  }


  const p =
    10 ** decimals;


  return (
    Math.round(
      n * p
    ) /
    p
  );
}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function numberOrNull(
  value
) {

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
  select,
  filters = []
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

    let query =
      supabaseAdmin
        .from(table)
        .select(select);


    for (
      const filter of filters
    ) {

      if (
        filter.type === "eq"
      ) {

        query =
          query.eq(
            filter.column,
            filter.value
          );

      } else if (
        filter.type === "in"
      ) {

        query =
          query.in(
            filter.column,
            filter.value
          );
      }
    }


    const {
      data,
      error
    } =
      await query.range(
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
// STATUS WEIGHT
//
// Importante:
// esto es probabilidad / severidad ACTUAL.
//
// NO multiplica por "cantidad de lesionados".
// ============================================================

function getStatusWeight(
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


  // =========================================================
  // CONFIRMED UNAVAILABLE
  // =========================================================

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

    return {
      weight: 1,
      normalizedStatus: "Out"
    };
  }


  if (
    s === "pup" ||
    combined.includes(
      "physically unable to perform"
    )
  ) {

    return {
      weight: 1,
      normalizedStatus: "Out"
    };
  }


  if (
    s.includes("out") ||
    d.includes("out for week") ||
    d.includes("ruled out")
  ) {

    return {
      weight: 1,
      normalizedStatus: "Out"
    };
  }


  // Sidelined solamente cuenta como OUT
  // cuando la descripción confirma ausencia.
  if (
    s.includes("sidelined")
  ) {

    if (
      d.includes("out") ||
      d.includes("will not play") ||
      d.includes("inactive")
    ) {

      return {
        weight: 1,
        normalizedStatus: "Out"
      };
    }


    return {
      weight: 0,
      normalizedStatus: "Sidelined-Unconfirmed"
    };
  }


  // =========================================================
  // UNCERTAIN AVAILABILITY
  // =========================================================

  if (
    s.includes("doubtful") ||
    d.includes("doubtful")
  ) {

    return {
      weight: 0.75,
      normalizedStatus: "Doubtful"
    };
  }


  if (
    s.includes("questionable") ||
    d.includes("questionable")
  ) {

    return {
      weight: 0.40,
      normalizedStatus: "Questionable"
    };
  }


  if (
    s.includes("day-to-day") ||
    s.includes("day to day") ||
    d.includes("day-to-day") ||
    d.includes("day to day")
  ) {

    return {
      weight: 0.25,
      normalizedStatus: "Day-to-Day"
    };
  }


  if (
    s.includes("probable") ||
    d.includes("probable")
  ) {

    return {
      weight: 0.10,
      normalizedStatus: "Probable"
    };
  }


  return {
    weight: 0,
    normalizedStatus:
      status || "Unknown"
  };
}


// ============================================================
// SEASON WEIGHTS
//
// MISMA lógica que ya validamos.
// ============================================================

function getSeasonWeights(
  currentGamesWithout
) {

  const games =
    Math.max(
      0,
      Number(
        currentGamesWithout ||
        0
      )
    );


  if (
    games <= 0
  ) {

    return {
      current: 0,
      previous: 1
    };
  }


  if (
    games === 1
  ) {

    return {
      current: 0.20,
      previous: 0.80
    };
  }


  if (
    games === 2
  ) {

    return {
      current: 0.35,
      previous: 0.65
    };
  }


  if (
    games === 3
  ) {

    return {
      current: 0.50,
      previous: 0.50
    };
  }


  if (
    games === 4
  ) {

    return {
      current: 0.60,
      previous: 0.40
    };
  }


  if (
    games === 5
  ) {

    return {
      current: 0.70,
      previous: 0.30
    };
  }


  return {
    current: 0.80,
    previous: 0.20
  };
}


// ============================================================
// HISTORY HELPERS
// ============================================================

function hasHistory(
  row
) {

  return Boolean(
    row &&
    Number(
      row.games_with ||
      0
    ) >= 1 &&
    Number(
      row.games_without ||
      0
    ) >= 1
  );
}


function getComponent(
  row,
  controlledKey,
  rawKey
) {

  if (
    !hasHistory(row)
  ) {
    return null;
  }


  const controlled =
    numberOrNull(
      row[
        controlledKey
      ]
    );


  if (
    controlled !== null
  ) {
    return controlled;
  }


  return numberOrNull(
    row[
      rawKey
    ]
  );
}


function weightedValue(
  currentValue,
  previousValue,
  currentWeight,
  previousWeight
) {

  const values =
    [];


  if (
    currentValue !== null &&
    currentWeight > 0
  ) {

    values.push({
      value:
        currentValue,

      weight:
        currentWeight
    });
  }


  if (
    previousValue !== null &&
    previousWeight > 0
  ) {

    values.push({
      value:
        previousValue,

      weight:
        previousWeight
    });
  }


  if (
    !values.length
  ) {
    return null;
  }


  const totalWeight =
    values.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.weight,
      0
    );


  if (
    totalWeight <= 0
  ) {
    return null;
  }


  return (
    values.reduce(
      (
        sum,
        item
      ) =>
        sum +
        (
          item.value *
          item.weight
        ),
      0
    ) /
    totalWeight
  );
}


// ============================================================
// BUILD ONE BLENDED PLAYER PROFILE
// ============================================================

function buildBlendedProfile(
  current,
  previous
) {

  const currentHas =
    hasHistory(
      current
    );


  const previousHas =
    hasHistory(
      previous
    );


  if (
    !currentHas &&
    !previousHas
  ) {
    return null;
  }


  // =========================================================
  // SEASON WEIGHTS
  // =========================================================

  let baseWeights =
    getSeasonWeights(
      current?.games_without ||
      0
    );


  if (
    currentHas &&
    !previousHas
  ) {

    baseWeights = {
      current: 1,
      previous: 0
    };

  } else if (
    !currentHas &&
    previousHas
  ) {

    baseWeights = {
      current: 0,
      previous: 1
    };
  }


  // =========================================================
  // RELIABILITY
  // =========================================================

  const currentReliability =
    currentHas
      ? clamp(
          Number(
            current.reliability ||
            0
          ),
          0,
          1
        )
      : 0;


  const previousReliability =
    previousHas
      ? clamp(
          Number(
            previous.reliability ||
            0
          ),
          0,
          1
        )
      : 0;


  let currentWeight =
    baseWeights.current *
    currentReliability;


  let previousWeight =
    baseWeights.previous *
    previousReliability;


  if (
    currentHas &&
    !previousHas
  ) {

    currentWeight =
      1;

    previousWeight =
      0;
  }


  if (
    !currentHas &&
    previousHas
  ) {

    currentWeight =
      0;

    previousWeight =
      1;
  }


  // =========================================================
  // OFFENSE
  // =========================================================

  const currentOffense =
    currentHas
      ? getComponent(
          current,
          "offense_change_controlled",
          "team_points_change"
        )
      : null;


  const previousOffense =
    previousHas
      ? getComponent(
          previous,
          "offense_change_controlled",
          "team_points_change"
        )
      : null;


  const blendedOffense =
    weightedValue(
      currentOffense,
      previousOffense,
      currentWeight,
      previousWeight
    );


  // =========================================================
  // DEFENSE / INDIRECT CROSSOVER
  // =========================================================

  const currentDefense =
    currentHas
      ? getComponent(
          current,
          "defense_change_controlled",
          "opponent_points_change"
        )
      : null;


  const previousDefense =
    previousHas
      ? getComponent(
          previous,
          "defense_change_controlled",
          "opponent_points_change"
        )
      : null;


  const blendedDefense =
    weightedValue(
      currentDefense,
      previousDefense,
      currentWeight,
      previousWeight
    );


  // =========================================================
  // USAGE
  // =========================================================

  const currentUsage =
    currentHas
      ? numberOrNull(
          current
            .avg_offense_pct_with
        )
      : null;


  const previousUsage =
    previousHas
      ? numberOrNull(
          previous
            .avg_offense_pct_with
        )
      : null;


  const blendedUsage =
    weightedValue(
      currentUsage,
      previousUsage,
      currentWeight,
      previousWeight
    );


  const usage =
    clamp(
      blendedUsage ??
      0,
      0,
      1
    );


  // =========================================================
  // THIS IS THE VERSION WE VALIDATED:
  //
  // 97% snaps -> 0.97
  // 50% snaps -> 0.50
  //  3% snaps -> 0.03
  // =========================================================

  const usageFactor =
    usage;


  // =========================================================
  // BLENDED RELIABILITY
  // =========================================================

  const reliability =
    weightedValue(
      currentReliability,
      previousReliability,
      currentWeight,
      previousWeight
    ) ??
    0;


  // Mantener exactamente como lo validamos.
  const sampleFactor =
    reliability *
    reliability;


  const shrinkFactor =
    sampleFactor *
    usageFactor;


  // =========================================================
  // ONLY ADVERSE HISTORICAL SIGNAL
  //
  // No premiamos artificialmente una lesión.
  // =========================================================

  const adverseOffense =
    blendedOffense !== null
      ? Math.min(
          0,
          blendedOffense
        )
      : 0;


  const adverseDefense =
    blendedDefense !== null
      ? Math.max(
          0,
          blendedDefense
        )
      : 0;


  const position =
    String(
      current?.position ||
      previous?.position ||
      ""
    )
      .toUpperCase()
      .trim();


  const defensiveCrossover =
    DEF_CROSSOVER[
      position
    ] ??
    0;


  const offenseImpact =
    adverseOffense *
    shrinkFactor;


  const defenseImpact =
    -(
      adverseDefense *
      shrinkFactor *
      defensiveCrossover
    );


  const pointsImpact =
    offenseImpact +
    defenseImpact;


  return {

    player_name:
      current?.player_name ||
      previous?.player_name ||
      null,

    position,

    current_games_with:
      Number(
        current?.games_with ||
        0
      ),

    current_games_without:
      Number(
        current?.games_without ||
        0
      ),

    previous_games_with:
      Number(
        previous?.games_with ||
        0
      ),

    previous_games_without:
      Number(
        previous?.games_without ||
        0
      ),

    current_reliability:
      round(
        currentReliability
      ),

    previous_reliability:
      round(
        previousReliability
      ),

    reliability:
      round(
        reliability
      ),

    usage:
      round(
        usage
      ),

    offense_change:
      round(
        blendedOffense
      ),

    defense_change:
      round(
        blendedDefense
      ),

    offense_impact:
      round(
        offenseImpact
      ),

    defense_impact:
      round(
        defenseImpact
      ),

    points_impact:
      round(
        pointsImpact
      )
  };
}


// ============================================================
// BUILD ALL HISTORICAL PROFILES
// ============================================================

function buildHistoricalProfiles(
  rows,
  currentSeason,
  previousSeason
) {

  const raw =
    new Map();


  for (
    const row of rows
  ) {

    const key =
      `${String(
        row.team_id
      )}|${String(
        row.player_id
      )}`;


    if (
      !raw.has(key)
    ) {

      raw.set(
        key,
        {
          current: null,
          previous: null
        }
      );
    }


    const profile =
      raw.get(key);


    if (
      Number(
        row.season
      ) ===
      currentSeason
    ) {

      profile.current =
        row;

    } else if (
      Number(
        row.season
      ) ===
      previousSeason
    ) {

      profile.previous =
        row;
    }
  }


  const output =
    new Map();


  for (
    const [
      key,
      profile
    ] of raw.entries()
  ) {

    const blended =
      buildBlendedProfile(
        profile.current,
        profile.previous
      );


    if (
      blended
    ) {

      output.set(
        key,
        blended
      );
    }
  }


  return output;
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

      const currentSeason =
        Number(
          req.query.season ||
          2026
        );


      const previousSeason =
        currentSeason -
        1;


      const start =
        Math.max(
          0,
          Number(
            req.query.start ||
            0
          )
        );


      // Seguimos usando lotes pequeños
      // por el rate limit de API-Sports.
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
      // LOAD STATIC DATA
      // ======================================================

      const [
        impactRows,
        crosswalkRows,
        apiTeams
      ] =
        await Promise.all([

          readAll(
            "football_player_absence_impact",
            `
              sport,
              season,
              team_id,
              player_id,
              player_name,
              position,
              games_with,
              games_without,
              team_points_change,
              opponent_points_change,
              offense_change_controlled,
              defense_change_controlled,
              margin_change_controlled,
              avg_offense_pct_with,
              avg_offense_snaps_with,
              reliability
            `,
            [
              {
                type: "eq",
                column: "sport",
                value: "nfl"
              },
              {
                type: "in",
                column: "season",
                value: [
                  previousSeason,
                  currentSeason
                ]
              }
            ]
          ),


          readAll(
            "nfl_player_crosswalk",
            `
              api_sports_player_id,
              gsis_player_id,
              player_name,
              position,
              api_sports_team_id,
              nflverse_team_id,
              api_sports_team_name,
              confidence
            `
          ),


          apiSports(
            `/teams?league=1&season=${currentSeason}`
          )

        ]);


      // ======================================================
      // HISTORICAL INDEX
      // ======================================================

      const historicalProfiles =
        buildHistoricalProfiles(
          impactRows,
          currentSeason,
          previousSeason
        );


      // ======================================================
      // CROSSWALK INDEX
      // ======================================================

      const crosswalkByApiId =
        new Map();


      for (
        const row of crosswalkRows
      ) {

        const apiId =
          String(
            row.api_sports_player_id ||
            ""
          ).trim();


        const gsis =
          String(
            row.gsis_player_id ||
            ""
          ).trim();


        if (
          !apiId ||
          !gsis
        ) {
          continue;
        }


        crosswalkByApiId.set(
          apiId,
          row
        );
      }


      // ======================================================
      // NORMALIZE TEAMS
      // ======================================================

      const teams =
        apiTeams
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
      // TEAM LOOP
      // ======================================================

      const teamResults =
        [];


      for (
        const team of batch
      ) {

        const nflverseTeam =
          NFLVERSE_TEAM_BY_NAME[
            team.name
          ];


        if (
          !nflverseTeam
        ) {

          teamResults.push({

            team:
              team.name,

            apiTeamId:
              team.id,

            error:
              "Missing NFLverse team mapping"
          });

          continue;
        }


        // ====================================================
        // CURRENT INJURIES
        // ====================================================

        const injuries =
          await apiSports(
            `/injuries?team=${encodeURIComponent(
              team.id
            )}`
          );


        const eligible =
          [];

        const noCrosswalk =
          [];

        const noHistory =
          [];

        const ignoredPosition =
          [];

        const ignoredStatus =
          [];


        // ====================================================
        // INJURY LOOP
        // ====================================================

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
              injury?.player_name ??
              ""
            ).trim();


          const originalStatus =
            String(
              injury?.status ??
              ""
            ).trim();


          const description =
            String(
              injury?.description ??
              ""
            ).trim();


          // ==================================================
          // CROSSWALK
          // ==================================================

          const crosswalk =
            crosswalkByApiId.get(
              apiPlayerId
            );


          if (
            !crosswalk
          ) {

            noCrosswalk.push({
              apiPlayerId,
              player:
                apiPlayerName,
              status:
                originalStatus
            });

            continue;
          }


          const gsis =
            String(
              crosswalk
                .gsis_player_id ||
              ""
            ).trim();


          const position =
            String(
              crosswalk.position ||
              ""
            )
              .toUpperCase()
              .trim();


          // ==================================================
          // ONLY QB/RB/WR/TE
          // ==================================================

          if (
            !ELIGIBLE_POSITIONS.has(
              position
            )
          ) {

            ignoredPosition.push({
              player:
                apiPlayerName,
              position,
              status:
                originalStatus
            });

            continue;
          }


          // ==================================================
          // CURRENT STATUS
          // ==================================================

          const statusInfo =
            getStatusWeight(
              originalStatus,
              description
            );


          if (
            statusInfo.weight <=
            0
          ) {

            ignoredStatus.push({
              player:
                apiPlayerName,
              position,
              status:
                originalStatus,
              description
            });

            continue;
          }


          // ==================================================
          // HISTORICAL PROFILE
          // ==================================================

          const historyKey =
            `${nflverseTeam}|${gsis}`;


          const history =
            historicalProfiles.get(
              historyKey
            );


          if (
            !history
          ) {

            noHistory.push({
              apiPlayerId,
              player:
                apiPlayerName,
              gsis,
              position,
              status:
                statusInfo
                  .normalizedStatus,
              statusWeight:
                statusInfo.weight
            });

            continue;
          }


          // ==================================================
          // STATUS-ADJUSTED IMPACT
          // ==================================================

          const historicalImpact =
            Number(
              history.points_impact ||
              0
            );


          const statusAdjustedImpact =
            historicalImpact *
            statusInfo.weight;


          // Historical model only produces
          // adverse impact, but keep this safety.
          if (
            statusAdjustedImpact >=
            0
          ) {
            continue;
          }


          eligible.push({

            apiPlayerId,

            gsisPlayerId:
              gsis,

            player:
              apiPlayerName,

            position,

            status:
              statusInfo
                .normalizedStatus,

            originalStatus,

            description,

            statusWeight:
              statusInfo.weight,

            usage:
              history.usage,

            reliability:
              history.reliability,

            historicalImpact:
              round(
                historicalImpact
              ),

            statusAdjustedImpact:
              round(
                statusAdjustedImpact
              ),

            currentGamesWithout:
              history
                .current_games_without,

            previousGamesWithout:
              history
                .previous_games_without
          });
        }


        // ====================================================
        // MULTIPLE INJURIES
        //
        // Biggest expected impact = 100%
        // Every additional one = 70%
        // ====================================================

        eligible.sort(
          (
            a,
            b
          ) =>
            a.statusAdjustedImpact -
            b.statusAdjustedImpact
        );


        const appliedPlayers =
          eligible.map(
            (
              player,
              index
            ) => {

              const multipleWeight =
                index === 0
                  ? 1
                  : 0.70;


              const finalImpact =
                player
                  .statusAdjustedImpact *
                multipleWeight;


              return {
                ...player,

                multipleWeight,

                finalImpact:
                  round(
                    finalImpact
                  )
              };
            }
          );


        // ====================================================
        // TOTALS
        // ====================================================

        const simpleSumImpact =
          eligible.reduce(
            (
              sum,
              player
            ) =>
              sum +
              player
                .statusAdjustedImpact,
            0
          );


        const rawCombinedImpact =
          appliedPlayers.reduce(
            (
              sum,
              player
            ) =>
              sum +
              player.finalImpact,
            0
          );


        // Comparison ONLY.
        // We are NOT deciding yet that production
        // should keep this cap.
        const legacyCap10Impact =
          Math.max(
            -LEGACY_TEAM_CAP,
            rawCombinedImpact
          );


        // ====================================================
        // RESPONSE PER TEAM
        // ====================================================

        teamResults.push({

          team:
            team.name,

          apiTeamId:
            team.id,

          nflverseTeam,

          injuriesReported:
            injuries.length,

          crossedInjuries:
            injuries.length -
            noCrosswalk.length,

          skillPositionInjuries:
            eligible.length +
            noHistory.length +
            ignoredStatus.length,

          usableHistoricalImpacts:
            eligible.length,

          appliedPlayers:
            appliedPlayers.length,

          simpleSumImpact:
            round(
              simpleSumImpact
            ),

          rawCombinedImpact:
            round(
              rawCombinedImpact
            ),

          legacyCap10Impact:
            round(
              legacyCap10Impact
            ),

          players:
            appliedPlayers,

          noHistory,

          noCrosswalk,

          ignoredStatus,

          ignoredPositionCount:
            ignoredPosition.length

        });
      }


      // ======================================================
      // WORST INJURY IMPACT FIRST
      // ======================================================

      teamResults.sort(
        (
          a,
          b
        ) =>
          Number(
            a.rawCombinedImpact ||
            0
          ) -
          Number(
            b.rawCombinedImpact ||
            0
          )
      );


      // ======================================================
      // BATCH SUMMARY
      // ======================================================

      const batchSummary = {

        teams:
          teamResults.length,

        injuriesReported:
          teamResults.reduce(
            (
              sum,
              team
            ) =>
              sum +
              Number(
                team.injuriesReported ||
                0
              ),
            0
          ),

        usableHistoricalImpacts:
          teamResults.reduce(
            (
              sum,
              team
            ) =>
              sum +
              Number(
                team
                  .usableHistoricalImpacts ||
                0
              ),
            0
          ),

        teamsWithImpact:
          teamResults.filter(
            team =>
              Number(
                team.rawCombinedImpact ||
                0
              ) <
              0
          ).length
      };


      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({

          ok: true,

          currentSeason,
          previousSeason,

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

          batchSummary,

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
            String(error)

        });
    }
  };

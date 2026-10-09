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
      normalizedStatus:
        "Sidelined-Unconfirmed"
    };
  }


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
// ABSENCE DECAY
// ============================================================

function getAbsenceDecay(
  gamesOut
) {

  const games =
    Math.max(
      0,
      Number(
        gamesOut ||
        0
      )
    );


  if (
    games <= 1
  ) {
    return 1;
  }


  if (
    games === 2
  ) {
    return 0.95;
  }


  if (
    games === 3
  ) {
    return 0.80;
  }


  if (
    games === 4
  ) {
    return 0.65;
  }


  if (
    games === 5
  ) {
    return 0.35;
  }


  if (
    games === 6
  ) {
    return 0.15;
  }


  return 0;
}


// ============================================================
// SEASON WEIGHTS
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
    controlled !==
    null
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


  const usageFactor =
    usage;


  const reliability =
    weightedValue(
      currentReliability,
      previousReliability,
      currentWeight,
      previousWeight
    ) ??
    0;


  const sampleFactor =
    reliability *
    reliability;


  const shrinkFactor =
    sampleFactor *
    usageFactor;


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


  let offenseImpact =
    adverseOffense *
    shrinkFactor;


  let defenseImpact =
    -(
      adverseDefense *
      shrinkFactor *
      defensiveCrossover
    );


  let pointsImpact =
    offenseImpact +
    defenseImpact;


  // ==========================================================
  // STARTING QB RULE
  // ==========================================================

  const isStartingQB =
    position === "QB" &&
    usage >= 0.70;


  if (
    isStartingQB
  ) {

    const rawQBOffenseImpact =
      adverseOffense *
      usageFactor;


    const rawQBDefenseImpact =
      -(
        adverseDefense *
        usageFactor *
        defensiveCrossover
      );


    const rawQBImpact =
      rawQBOffenseImpact +
      rawQBDefenseImpact;


    const reliableQBHistory =
      reliability >= 0.70;


    const qbHistoryWeight =
      reliableQBHistory
        ? 1
        : 0.70;


    offenseImpact =
      rawQBOffenseImpact *
      qbHistoryWeight;


    defenseImpact =
      rawQBDefenseImpact *
      qbHistoryWeight;


    pointsImpact =
      offenseImpact +
      defenseImpact;


    if (
      pointsImpact > -7
    ) {

      const missingImpact =
        -7 -
        pointsImpact;


      offenseImpact +=
        missingImpact;


      pointsImpact =
        -7;
    }
  }


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
      !raw.has(
        key
      )
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
      raw.get(
        key
      );


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
        playerGameRows,
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


          readAll(
            "football_player_game_stats",
            `
              sport,
              season,
              team_id,
              player_id,
              position,
              game_date,
              played,
              offense_snaps
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


          apiSports(
            `/teams?league=1&season=${currentSeason}`
          )

        ]);


      // ======================================================
      // CURRENT QB ROOM
      //
      // Primero identificamos los QBs que realmente aparecen
      // en el roster/juegos de la temporada actual.
      // ======================================================

      const currentSeasonQBsByTeam =
        new Map();


      for (
        const row of playerGameRows
      ) {

        const position =
          String(
            row.position ||
            ""
          )
            .toUpperCase()
            .trim();


        if (
          position !== "QB" ||
          Number(
            row.season
          ) !==
          currentSeason
        ) {
          continue;
        }


        const teamId =
          String(
            row.team_id ||
            ""
          ).trim();


        const playerId =
          String(
            row.player_id ||
            ""
          ).trim();


        if (
          !teamId ||
          !playerId
        ) {
          continue;
        }


        if (
          !currentSeasonQBsByTeam.has(
            teamId
          )
        ) {

          currentSeasonQBsByTeam.set(
            teamId,
            new Set()
          );
        }


        currentSeasonQBsByTeam
          .get(
            teamId
          )
          .add(
            playerId
          );
      }


      // ======================================================
      // QB HIERARCHY
      //
      // Usamos snaps 2025 + 2026,
      // PERO solamente entre QBs que siguen formando parte
      // del QB room de 2026.
      //
      // Así un QB viejo que ya salió del equipo no bloquea
      // la cadena actual.
      // ======================================================

      const qbSnapsByTeam =
        new Map();


      for (
        const row of playerGameRows
      ) {

        const position =
          String(
            row.position ||
            ""
          )
            .toUpperCase()
            .trim();


        if (
          position !== "QB"
        ) {
          continue;
        }


        const teamId =
          String(
            row.team_id ||
            ""
          ).trim();


        const playerId =
          String(
            row.player_id ||
            ""
          ).trim();


        if (
          !teamId ||
          !playerId
        ) {
          continue;
        }


        const currentQBs =
          currentSeasonQBsByTeam.get(
            teamId
          );


        if (
          !currentQBs ||
          !currentQBs.has(
            playerId
          )
        ) {
          continue;
        }


        if (
          !qbSnapsByTeam.has(
            teamId
          )
        ) {

          qbSnapsByTeam.set(
            teamId,
            new Map()
          );
        }


        const teamMap =
          qbSnapsByTeam.get(
            teamId
          );


        teamMap.set(
          playerId,
          (
            teamMap.get(
              playerId
            ) ||
            0
          ) +
          Number(
            row.offense_snaps ||
            0
          )
        );
      }


      const qbHierarchyByTeam =
        new Map();


      for (
        const [
          teamId,
          players
        ] of qbSnapsByTeam.entries()
      ) {

        const hierarchy =
          Array.from(
            players.entries()
          )
            .sort(
              (
                a,
                b
              ) =>
                b[1] -
                a[1]
            )
            .map(
              item =>
                item[0]
            );


        qbHierarchyByTeam.set(
          teamId,
          hierarchy
        );
      }


      // ======================================================
      // CONSECUTIVE ABSENCES
      //
      // Solo temporada actual.
      // ======================================================

      const currentGamesByPlayer =
        new Map();


      for (
        const row of playerGameRows
      ) {

        if (
          Number(
            row.season
          ) !==
          currentSeason
        ) {
          continue;
        }


        const teamId =
          String(
            row.team_id ||
            ""
          ).trim();


        const playerId =
          String(
            row.player_id ||
            ""
          ).trim();


        if (
          !teamId ||
          !playerId
        ) {
          continue;
        }


        const key =
          `${teamId}|${playerId}`;


        if (
          !currentGamesByPlayer.has(
            key
          )
        ) {

          currentGamesByPlayer.set(
            key,
            []
          );
        }


        currentGamesByPlayer
          .get(
            key
          )
          .push(
            row
          );
      }


      const consecutiveAbsencesByPlayer =
        new Map();


      for (
        const [
          key,
          rows
        ] of currentGamesByPlayer.entries()
      ) {

        rows.sort(
          (
            a,
            b
          ) =>
            new Date(
              b.game_date ||
              0
            ).getTime() -
            new Date(
              a.game_date ||
              0
            ).getTime()
        );


        let consecutive =
          0;


        for (
          const row of rows
        ) {

          if (
            row.played === false
          ) {

            consecutive++;

          } else {

            break;
          }
        }


        consecutiveAbsencesByPlayer.set(
          key,
          consecutive
        );
      }


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
                  ),

                name:
                  String(
                    team?.name ||
                    ""
                  )
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


        const qbStatusByGsis =
          new Map();


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
          // QB STATUS
          //
          // Lo guardamos aunque después no tenga historial.
          // Así el QB puede seguir condicionando al siguiente
          // QB de la cadena.
          // ==================================================

          if (
            position === "QB"
          ) {

            qbStatusByGsis.set(
              gsis,
              {

                weight:
                  statusInfo.weight,

                status:
                  statusInfo
                    .normalizedStatus
              }
            );
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


          const historicalImpact =
            Number(
              history.points_impact ||
              0
            );


          // ==================================================
          // QB ABSENCE DECAY
          // ==================================================

          const playerKey =
            `${nflverseTeam}|${gsis}`;


          const consecutiveGamesOut =
            position === "QB"
              ? (
                  consecutiveAbsencesByPlayer.get(
                    playerKey
                  ) ||
                  0
                )
              : 0;


          const absenceDecay =
            position === "QB"
              ? getAbsenceDecay(
                  consecutiveGamesOut
                )
              : 1;


          const fullAbsenceImpact =
            historicalImpact *
            absenceDecay;


          const statusAdjustedImpact =
            fullAbsenceImpact *
            statusInfo.weight;


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

            fullAbsenceImpact:
              round(
                fullAbsenceImpact
              ),

            consecutiveGamesOut,

            absenceDecay:
              round(
                absenceDecay
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
        // QB DEPTH / CONDITIONAL LOGIC
        // ====================================================

        const nonQBPlayers =
          eligible.filter(
            player =>
              player.position !==
              "QB"
          );


        const qbPlayersByGsis =
          new Map();


        for (
          const player of eligible
        ) {

          if (
            player.position ===
            "QB"
          ) {

            qbPlayersByGsis.set(
              player.gsisPlayerId,
              player
            );
          }
        }


        // ====================================================
        // EXPECTED IMPACT CANDIDATES
        // ====================================================

        const impactCandidates =
          [];


        // ----------------------------------------------------
        // NON-QB
        // ----------------------------------------------------

        for (
          const player of nonQBPlayers
        ) {

          impactCandidates.push({

            ...player,

            expectedImpact:
              player
                .statusAdjustedImpact,

            qbConditionalWeight:
              null
          });
        }


        // ----------------------------------------------------
        // QB CHAIN
        // ----------------------------------------------------

 const currentTeamQBs =
  Array.from(
    currentSeasonQBsByTeam.get(
      nflverseTeam
    ) ||
    []
  );


const hierarchy =
  currentTeamQBs
    .map(
      gsis => {

        const history =
          historicalProfiles.get(
            `${nflverseTeam}|${gsis}`
          );


        return {
          gsis,

          usage:
            Number(
              history?.usage ||
              0
            ),

          reliability:
            Number(
              history?.reliability ||
              0
            )
        };
      }
    )
    .sort(
      (
        a,
        b
      ) => {

        const usageDiff =
          b.usage -
          a.usage;


        if (
          Math.abs(
            usageDiff
          ) >
          0.01
        ) {

          return usageDiff;
        }


        return (
          b.reliability -
          a.reliability
        );
      }
    )
    .map(
      qb =>
        qb.gsis
    );

        let qbChainProbability =
          1;


        for (
          const qbGsis of hierarchy
        ) {

          const status =
            qbStatusByGsis.get(
              qbGsis
            );


          // ==================================================
          // QB SUPERIOR DISPONIBLE
          //
          // Si el QB de arriba no aparece con status que pese,
          // la cadena termina.
          //
          // Así un QB2 lesionado NO afecta si QB1 juega.
          // ==================================================

          if (
            !status ||
            status.weight <= 0
          ) {

            break;
          }


          const player =
            qbPlayersByGsis.get(
              qbGsis
            );


          if (
            player
          ) {

            const expectedImpact =
              player
                .fullAbsenceImpact *
              status.weight *
              qbChainProbability;


            impactCandidates.push({

              ...player,

              qbConditionalWeight:
                round(
                  qbChainProbability
                ),

              expectedImpact:
                round(
                  expectedImpact
                )
            });
          }


          // ==================================================
          // SIGUIENTE QB
          //
          // El siguiente QB solamente importa en el escenario
          // donde este QB también falta.
          // ==================================================

          qbChainProbability *=
            status.weight;


          if (
            qbChainProbability <=
            0
          ) {

            break;
          }
        }


        // ====================================================
        // FALLBACK QB LOGIC
        //
        // Solo si no tenemos hierarchy.
        // ====================================================

        if (
          !hierarchy.length
        ) {

          const fallbackQBs =
            eligible
              .filter(
                player =>
                  player.position ===
                  "QB"
              )
              .sort(
                (
                  a,
                  b
                ) =>
                  b.usage -
                  a.usage
              );


          let fallbackChain =
            1;


          for (
            const player of fallbackQBs
          ) {

            const expectedImpact =
              player
                .fullAbsenceImpact *
              player.statusWeight *
              fallbackChain;


            impactCandidates.push({

              ...player,

              qbConditionalWeight:
                round(
                  fallbackChain
                ),

              expectedImpact:
                round(
                  expectedImpact
                )
            });


            fallbackChain *=
              player.statusWeight;
          }
        }


        // ====================================================
        // MULTIPLE INJURY WEIGHT
        //
        // Mayor impacto esperado = 100%
        // Resto = 70%
        // ====================================================

        impactCandidates.sort(
          (
            a,
            b
          ) =>
            a.expectedImpact -
            b.expectedImpact
        );


        const appliedPlayers =
          impactCandidates.map(
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
                  .expectedImpact *
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
          impactCandidates.reduce(
            (
              sum,
              player
            ) =>
              sum +
              player
                .expectedImpact,
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
      // WORST IMPACT FIRST
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

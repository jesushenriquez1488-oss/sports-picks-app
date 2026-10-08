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


function round(
  value,
  decimals = 3
) {

  const n =
    numberOrNull(value);


  if (n === null) {
    return null;
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


// ============================================================
// NFL SEASON BLEND
//
// La temporada actual aumenta su peso
// conforme acumulamos juegos SIN el jugador.
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


  if (games <= 0) {
    return {
      current: 0,
      previous: 1
    };
  }


  if (games === 1) {
    return {
      current: 0.20,
      previous: 0.80
    };
  }


  if (games === 2) {
    return {
      current: 0.35,
      previous: 0.65
    };
  }


  if (games === 3) {
    return {
      current: 0.50,
      previous: 0.50
    };
  }


  if (games === 4) {
    return {
      current: 0.60,
      previous: 0.40
    };
  }


  if (games === 5) {
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
// DEFENSIVE CROSSOVER
//
// Conservamos la idea del modelo NFL actual:
// el efecto indirecto sobre defensa es mucho menor.
// ============================================================

const DEF_CROSSOVER = {
  QB: 0.35,
  RB: 0.15,
  WR: 0.10,
  TE: 0.10
};


// ============================================================
// COMPONENT
// ============================================================

function getComponent(
  row,
  controlledKey,
  rawKey
) {

  if (
    !row ||
    Number(
      row.games_without ||
      0
    ) < 1 ||
    Number(
      row.games_with ||
      0
    ) < 1
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


// ============================================================
// HAS HISTORY
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


// ============================================================
// WEIGHTED VALUE
// ============================================================

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


  if (!values.length) {
    return null;
  }


  const totalWeight =
    values.reduce(
      (sum, item) =>
        sum +
        item.weight,
      0
    );


  if (
    totalWeight <=
    0
  ) {
    return null;
  }


  return (
    values.reduce(
      (sum, item) =>
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
// READ ALL IMPACT ROWS
// ============================================================

async function readImpactRows(
  seasons
) {

  const output =
    [];

  const PAGE_SIZE =
    1000;

  let from =
    0;


  while (true) {

    const {
      data,
      error
    } =
      await supabaseAdmin
        .from(
          "football_player_absence_impact"
        )
        .select(
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
          `
        )
        .eq(
          "sport",
          "nfl"
        )
        .in(
          "season",
          seasons
        )
        .range(
          from,
          from +
          PAGE_SIZE -
          1
        );


    if (error) {
      throw new Error(
        error.message
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
      // SEASONS
      // ======================================================

      const currentSeason =
        Number(
          req.query.season ||
          2026
        );


      const previousSeason =
        currentSeason -
        1;


      const rows =
        await readImpactRows(
          [
            previousSeason,
            currentSeason
          ]
        );


      // ======================================================
      // INDEX
      // ======================================================

      const profiles =
        new Map();


      for (
        const row of rows
      ) {

        const key =
          `${row.team_id}|${row.player_id}`;


        if (
          !profiles.has(
            key
          )
        ) {

          profiles.set(
            key,
            {
              teamId:
                String(
                  row.team_id
                ),

              playerId:
                String(
                  row.player_id
                ),

              playerName:
                row.player_name,

              position:
                row.position,

              current:
                null,

              previous:
                null
            }
          );
        }


        const profile =
          profiles.get(
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


      // ======================================================
      // CALCULATE BLEND
      // ======================================================

      const output =
        [];


      for (
        const profile of
        profiles.values()
      ) {

        const current =
          profile.current;

        const previous =
          profile.previous;


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
          continue;
        }


        // ====================================================
        // BASIC SEASON WEIGHTS
        // ====================================================

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


        // ====================================================
        // RELIABILITY
        // ====================================================

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


        /*
         * La temporada no pesa solamente por recencia.
         * También pesa por calidad de muestra.
         */

        let currentWeight =
          baseWeights.current *
          currentReliability;


        let previousWeight =
          baseWeights.previous *
          previousReliability;


        /*
         * Si solamente tenemos una temporada,
         * mantenemos esa temporada como fuente,
         * pero la confiabilidad se aplicará luego
         * como shrinkage.
         */

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


        // ====================================================
        // HISTORICAL COMPONENTS
        // ====================================================

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


        const blendedOffense =
          weightedValue(
            currentOffense,
            previousOffense,
            currentWeight,
            previousWeight
          );


        const blendedDefense =
          weightedValue(
            currentDefense,
            previousDefense,
            currentWeight,
            previousWeight
          );


        // ====================================================
        // USAGE
        // ====================================================

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


        /*
         * No queremos que un jugador con 15-20%
         * de snaps cargue con todo el movimiento
         * del equipo.
         *
         * Pero tampoco lo llevamos automáticamente
         * a cero.
         */

        const usageFactor =
          0.35 +
          (
            0.65 *
            usage
          );


        // ====================================================
        // EVIDENCE RELIABILITY
        // ====================================================

        const reliability =
          weightedValue(
            currentReliability,
            previousReliability,
            currentWeight,
            previousWeight
          ) ??
          0;


        /*
         * Cuadramos reliability.
         *
         * Ejemplo:
         * 0.354 -> 0.125
         *
         * Esto evita que un 2 WITH / 2 WITHOUT
         * genere una locura de 30-40 puntos.
         */

        const sampleFactor =
          reliability *
          reliability;


        const shrinkFactor =
          sampleFactor *
          usageFactor;


        // ====================================================
        // IMPORTANT:
        //
        // Solo usamos el efecto ADVERSO.
        //
        // Una lesión nunca puede "premiar"
        // artificialmente al equipo porque la
        // muestra diga que jugaron mejor sin él.
        // ====================================================

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
            profile.position ||
            ""
          )
            .toUpperCase();


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


        output.push({

          team_id:
            profile.teamId,

          player_id:
            profile.playerId,

          player_name:
            profile.playerName,

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


          current_weight:
            round(
              currentWeight
            ),

          previous_weight:
            round(
              previousWeight
            ),


          avg_offense_pct:
            round(
              usage
            ),


          offense_change_blended:
            round(
              blendedOffense
            ),

          defense_change_blended:
            round(
              blendedDefense
            ),


          reliability:
            round(
              reliability
            ),

          sample_factor:
            round(
              sampleFactor
            ),

          usage_factor:
            round(
              usageFactor
            ),

          shrink_factor:
            round(
              shrinkFactor
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

        });
      }


      // ======================================================
      // OPTIONAL TEAM FILTER
      // ======================================================

      const requestedTeam =
        String(
          req.query.team ||
          ""
        )
          .toUpperCase()
          .trim();


      const filtered =
        requestedTeam
          ? output.filter(
              row =>
                row.team_id ===
                requestedTeam
            )
          : output;


      // Most harmful first.
      filtered.sort(
        (a, b) =>
          a.points_impact -
          b.points_impact
      );


      return res
        .status(200)
        .json({

          ok: true,

          currentSeason,

          previousSeason,

          profiles:
            filtered.length,

          sample:
            filtered.slice(
              0,
              25
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

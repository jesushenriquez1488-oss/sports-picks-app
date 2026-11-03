const {
  createClient
} = require("@supabase/supabase-js");


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


// ============================================================
// WNBA CACHE
// NO CAMBIAMOS SU LOGICA
// ============================================================

const cache =
  global.WNBA_RECENT_GAMES_CACHE || {
    data: null,
    time: 0
  };

global.WNBA_RECENT_GAMES_CACHE =
  cache;


// ============================================================
// NCAAB CACHE
// ============================================================

const ncaabCache =
  global.__NCAAB_ESPN_CACHE__ || {};

global.__NCAAB_ESPN_CACHE__ =
  ncaabCache;


// BPI completo por temporada.
// Se refresca solamente cada 24 horas.
const ncaabBpiCache =
  global.__NCAAB_BPI_SEASON_CACHE__ || {};

global.__NCAAB_BPI_SEASON_CACHE__ =
  ncaabBpiCache;


const CACHE_TIME =
  30 * 60 * 1000;


// BPI no necesita refrescarse
// cada 30 minutos.
const BPI_CACHE_TIME =
  24 * 60 * 60 * 1000;


const ESPN_TIMEOUT =
  10 * 1000;


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    res.setHeader(
      "Cache-Control",
      "private, no-store"
    );


    if (
      req.method === "OPTIONS"
    ) {
      return res
        .status(200)
        .end();
    }


    if (
      req.method !== "GET"
    ) {
      return res
        .status(405)
        .json({
          error:
            "Method not allowed"
        });
    }


    try {

      // ======================================================
      // AUTH
      // ======================================================

      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );


      const token =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : null;


      if (!token) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const {
        data: authData,
        error: authError
      } =
        await supabaseAdmin.auth.getUser(
          token
        );


      if (
        authError ||
        !authData?.user?.id
      ) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      // ======================================================
      // PARAMS
      // ======================================================

      const {
        team,
        league
      } =
        req.query;


      if (
        !team ||
        !league
      ) {
        return res
          .status(400)
          .json({
            error:
              "Missing params"
          });
      }


      // ======================================================
      // NCAAB
      // NUEVO
      // ======================================================

      if (
        league === "ncaab"
      ) {

        // opponent = rival de HOY (opcional).
        // Con él se ajusta cada juego al nivel
        // del rival de hoy usando la escala BPI
        // propia del equipo.
        const games =
          await getEspnNcaabRecentGames(
            team,
            req.query.opponent || null
          );


        if (
          games.length < 3
        ) {
          return res
            .status(404)
            .json({
              error:
                `No hay suficientes juegos reales para ${team}.`
            });
        }


        return res
          .status(200)
          .json(
            games
          );
      }


      // ======================================================
      // SOLO WNBA DESDE AQUI
      // ======================================================

      if (
        league !== "wnba"
      ) {
        return res
          .status(400)
          .json({
            error:
              "Liga no soportada."
          });
      }


      // ======================================================
      // WNBA
      // LOGICA ACTUAL
      // ======================================================

      const games =
        await getEspnWnbaGames();


      const completedGames =
        games
          .filter(
            g =>
              g.completed
          )
          .sort(
            (a, b) =>
              new Date(b.date) -
              new Date(a.date)
          );


      const teamGames =
        completedGames
          .filter(
            g =>
              teamMatches(
                g.homeTeam,
                team
              ) ||
              teamMatches(
                g.awayTeam,
                team
              )
          )
          .slice(
            0,
            10
          );


      const finalGames =
        [];


      for (
        const game
        of teamGames
      ) {

        const isHome =
          teamMatches(
            game.homeTeam,
            team
          );


        const scored =
          isHome
            ? game.homeScore
            : game.awayScore;


        const allowed =
          isHome
            ? game.awayScore
            : game.homeScore;


        const opponent =
          isHome
            ? game.awayTeam
            : game.homeTeam;


        const opponentPrevious =
          completedGames
            .filter(
              g =>
                new Date(g.date) <
                  new Date(game.date) &&
                (
                  teamMatches(
                    g.homeTeam,
                    opponent
                  ) ||
                  teamMatches(
                    g.awayTeam,
                    opponent
                  )
                )
            )
            .slice(
              0,
              3
            )
            .map(
              g => {

                const oppIsHome =
                  teamMatches(
                    g.homeTeam,
                    opponent
                  );


                return {
                  scored:
                    oppIsHome
                      ? g.homeScore
                      : g.awayScore,

                  allowed:
                    oppIsHome
                      ? g.awayScore
                      : g.homeScore
                };
              }
            );


        let opponentAvgScored =
          allowed;

        let opponentAvgAllowed =
          scored;


        if (
          opponentPrevious.length >
          0
        ) {

          opponentAvgScored =
            opponentPrevious.reduce(
              (
                sum,
                g
              ) =>
                sum +
                g.scored,
              0
            ) /
            opponentPrevious.length;


          opponentAvgAllowed =
            opponentPrevious.reduce(
              (
                sum,
                g
              ) =>
                sum +
                g.allowed,
              0
            ) /
            opponentPrevious.length;
        }


        finalGames.push({
          date:
            game.date,

          isHome,

          scored,

          allowed,

          opponent,

          opponentAvgScored,

          opponentAvgAllowed
        });


        if (
          finalGames.length >=
          3
        ) {
          break;
        }
      }


      if (
        finalGames.length <
        3
      ) {
        return res
          .status(404)
          .json({
            error:
              `No hay suficientes juegos reales 2026 para ${team}.`
          });
      }


      return res
        .status(200)
        .json(
          finalGames
        );


    } catch (error) {

      console.error(
        "BASKETBALL RECENT GAMES ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          error:
            error.message
        });
    }
  };


// ============================================================
// NCAAB — MAIN
// ============================================================

async function getEspnNcaabRecentGames(
  teamName,
  opponentName = null
) {

  const team =
    await resolveNcaabTeam(
      teamName
    );


  if (!team) {
    throw new Error(
      `NCAAB team not found: ${teamName}`
    );
  }


  const currentSeason =
    getCurrentNcaabSeason();

  const previousSeason =
    currentSeason - 1;


  // ==========================================================
  // RIVAL DE HOY (opcional)
  //
  // Si no se encuentra, el análisis sigue
  // pero sin ajuste de escala (puntos crudos).
  // ==========================================================

  let todayOpponent =
    null;

  if (opponentName) {
    try {
      todayOpponent =
        await resolveNcaabTeam(
          opponentName
        );
    } catch (error) {
      todayOpponent =
        null;
    }
  }


  // ==========================================================
  // BPI ACTUAL (esta temporada)
  // del equipo y del rival de hoy.
  // ==========================================================

  const [
    teamProfile,
    todayOpponentProfile
  ] =
    await Promise.all([

      getNcaabBpiProfile(
        team.id,
        currentSeason
      ),

      todayOpponent
        ? getNcaabBpiProfile(
            todayOpponent.id,
            currentSeason
          )
        : Promise.resolve(null)
    ]);


  const teamBpi =
    teamProfile?.bpi ??
    null;


  // ==========================================================
  // TEMPORADA COMPLETA (actual + anterior)
  //
  // Los 7 juegos de la fórmula siguen la regla
  // de siempre, pero la ESCALA BPI del equipo
  // se mide con todos sus juegos, porque en la
  // temporada completa enfrenta rivales fuertes
  // y débiles (fuera de conferencia).
  // ==========================================================

  const [
    currentGames,
    previousGames
  ] =
    await Promise.all([

      getNcaabTeamGames(
        team.id,
        currentSeason
      ),

      getNcaabTeamGames(
        team.id,
        previousSeason
      )
    ]);


  let selectedGames =
    [];


  // ==========================================================
  // REGLA DE TEMPORADA (SIN CAMBIOS)
  //
  // 5+ actuales:
  // solo temporada actual.
  //
  // menos de 5:
  // completar hasta 7 con temporada anterior.
  // ==========================================================

  if (
    currentGames.length >=
    5
  ) {

    selectedGames =
      currentGames.slice(
        0,
        7
      );

  } else {

    selectedGames =
      [
        ...currentGames,
        ...previousGames
      ]
        .sort(
          (
            a,
            b
          ) =>
            new Date(b.date) -
            new Date(a.date)
        )
        .slice(
          0,
          7
        );
  }


  // ==========================================================
  // BPI OFF / DEF DE CADA RIVAL
  // de la temporada de ese juego.
  // ==========================================================

  const seasonGames =
    [
      ...currentGames,
      ...previousGames
    ];


  const profiles =
    await mapWithLimit(
      seasonGames,
      8,
      game =>
        getNcaabBpiProfile(
          game.opponentId,
          game.season
        )
    );


  const seasonRows =
    seasonGames.map(
      (
        game,
        index
      ) => ({
        eventId:
          game.eventId,

        date:
          game.date,

        season:
          game.season,

        opponent:
          game.opponent,

        scored:
          game.scored,

        allowed:
          game.allowed,

        rivalBpi:
          profiles[index]?.bpi ?? null,

        rivalOff:
          profiles[index]?.off ?? null,

        rivalDef:
          profiles[index]?.def ?? null
      })
    );


  // ==========================================================
  // ESCALA BPI PROPIA DEL EQUIPO
  // ==========================================================

  const scale =
    calcNcaabTeamScale(
      seasonRows
    );


  // ==========================================================
  // VERIFICACIÓN: juegos de toda la temporada
  // contra rivales de BPI parecido al de hoy (±5)
  // ==========================================================

  const similarCheck =
    calcNcaabSimilarCheck(
      seasonRows,
      todayOpponentProfile
    );


  const rowByEvent =
    new Map(
      seasonRows.map(
        row => [
          row.eventId,
          row
        ]
      )
    );


  const enriched =
    await Promise.all(
      selectedGames.map(
        game =>
          enrichNcaabGame(
            team,
            game,
            teamBpi,
            rowByEvent.get(
              game.eventId
            ),
            scale,
            todayOpponentProfile,
            similarCheck,
            teamProfile
          )
      )
    );


  return enriched
    .filter(Boolean)
    .sort(
      (
        a,
        b
      ) =>
        new Date(b.date) -
        new Date(a.date)
    );
}


// ============================================================
// NCAAB — ESCALA BPI POR EQUIPO
//
// ATAQUE:  puntos anotados vs BPI DEF del rival.
//          Rival con mejor defensa → anota menos.
//          La escala no puede ser positiva.
//
// DEFENSA: puntos permitidos vs BPI OFF del rival.
//          Rival con mejor ataque → permite más.
//          La escala no puede ser negativa.
//
// Método: se compara cada par de juegos
// (cuántos puntos cambió / cuánto cambió el BPI)
// y se toma la MEDIANA. Así un juego raro
// no ensucia la escala.
//
// Sin topes. Sin promedios de liga.
// ============================================================

const NCAAB_SCALE_MIN_GAMES = 6;

const NCAAB_SCALE_MIN_BPI_GAP = 1;


function calcNcaabMedianPairSlope(
  points
) {

  const slopes =
    [];


  for (
    let i = 0;
    i < points.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < points.length;
      j++
    ) {

      const dx =
        points[j].x -
        points[i].x;


      // Rivales casi del mismo BPI
      // no dicen nada de la escala.
      if (
        Math.abs(dx) <
        NCAAB_SCALE_MIN_BPI_GAP
      ) {
        continue;
      }


      slopes.push(
        (
          points[j].y -
          points[i].y
        ) /
        dx
      );
    }
  }


  if (
    !slopes.length
  ) {
    return {
      slope: null,
      pairs: 0
    };
  }


  slopes.sort(
    (a, b) =>
      a - b
  );


  const middle =
    Math.floor(
      slopes.length / 2
    );


  const median =
    slopes.length % 2
      ? slopes[middle]
      : (
          slopes[middle - 1] +
          slopes[middle]
        ) / 2;


  return {
    slope:
      median,

    pairs:
      slopes.length
  };
}


function calcNcaabTeamScaleSide(
  rows,
  bpiKey,
  valueKey,
  expectedSign
) {

  const points =
    rows
      .filter(
        row =>
          Number.isFinite(
            row?.[bpiKey]
          ) &&
          Number.isFinite(
            row?.[valueKey]
          )
      )
      .map(
        row => ({
          x:
            row[bpiKey],

          y:
            row[valueKey]
        })
      );


  if (
    points.length <
    NCAAB_SCALE_MIN_GAMES
  ) {
    return {
      usable: false,
      reason: "few_games",
      games: points.length,
      pairs: 0,
      slope: null
    };
  }


  const {
    slope,
    pairs
  } =
    calcNcaabMedianPairSlope(
      points
    );


  if (
    !Number.isFinite(
      slope
    )
  ) {
    return {
      usable: false,
      reason: "no_range",
      games: points.length,
      pairs,
      slope: null
    };
  }


  // REGLA DE SIGNO
  const wrongDirection =
    (
      expectedSign < 0 &&
      slope > 0
    ) ||
    (
      expectedSign > 0 &&
      slope < 0
    );


  return {
    usable:
      !wrongDirection,

    reason:
      wrongDirection
        ? "wrong_direction"
        : "ok",

    games:
      points.length,

    pairs,

    slope
  };
}


function calcNcaabTeamScale(
  seasonRows
) {

  return {

    // puntos anotados por cada punto
    // de BPI DEF del rival
    offense:
      calcNcaabTeamScaleSide(
        seasonRows,
        "rivalDef",
        "scored",
        -1
      ),

    // puntos permitidos por cada punto
    // de BPI OFF del rival
    defense:
      calcNcaabTeamScaleSide(
        seasonRows,
        "rivalOff",
        "allowed",
        1
      )
  };
}


// ============================================================
// NCAAB — VERIFICACIÓN CON RIVALES PARECIDOS
//
// Juegos de toda la temporada (actual + anterior)
// contra rivales con BPI a 5 puntos o menos
// del rival de hoy. Lo que hizo el equipo
// de verdad contra ese nivel de rival.
// ============================================================

const NCAAB_SIMILAR_BPI_RANGE = 5;


function calcNcaabSimilarCheck(
  seasonRows,
  todayOpponentProfile
) {

  const target =
    todayOpponentProfile?.bpi;


  if (
    !Number.isFinite(
      target
    )
  ) {
    return null;
  }


  const similar =
    seasonRows.filter(
      row =>
        Number.isFinite(
          row.rivalBpi
        ) &&
        Math.abs(
          row.rivalBpi -
          target
        ) <=
          NCAAB_SIMILAR_BPI_RANGE
    );


  if (
    !similar.length
  ) {
    return {
      games: 0,
      range:
        NCAAB_SIMILAR_BPI_RANGE,
      avgScored: null,
      avgAllowed: null
    };
  }


  return {
    games:
      similar.length,

    range:
      NCAAB_SIMILAR_BPI_RANGE,

    avgScored:
      similar.reduce(
        (sum, row) =>
          sum + row.scored,
        0
      ) /
      similar.length,

    avgAllowed:
      similar.reduce(
        (sum, row) =>
          sum + row.allowed,
        0
      ) /
      similar.length,

    opponents:
      similar.map(
        row =>
          `${row.opponent} (${Number(row.rivalBpi).toFixed(1)}): ${row.scored}-${row.allowed}`
      )
  };
}


// ============================================================
// NCAAB — LÍMITE DE LLAMADAS EN PARALELO A ESPN
// ============================================================

async function mapWithLimit(
  items,
  limit,
  worker
) {

  const results =
    new Array(
      items.length
    );

  let next = 0;


  async function run() {

    while (
      next <
      items.length
    ) {

      const index =
        next++;

      try {
        results[index] =
          await worker(
            items[index],
            index
          );
      } catch (error) {
        results[index] =
          null;
      }
    }
  }


  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            limit,
            items.length
          )
      },
      run
    )
  );


  return results;
}



// ============================================================
// NCAAB — CURRENT SEASON
//
// ESPN college basketball usa el año
// en que termina la temporada.
//
// Oct 2026 -> temporada 2027.
// Jan 2027 -> temporada 2027.
// ============================================================

function getCurrentNcaabSeason() {

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    now.getMonth() + 1;


  if (
    month >= 7
  ) {
    return year + 1;
  }


  return year;
}


// ============================================================
// NCAAB — TEAMS
// ============================================================

async function getNcaabTeams() {

  const url =
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500";


  const data =
    await fetchEspnJson(
      url
    );


  const wrappers =
    data?.sports?.[0]
      ?.leagues?.[0]
      ?.teams ||
    data?.teams ||
    [];


  return wrappers
    .map(
      item =>
        item?.team ||
        item
    )
    .filter(
      team =>
        team?.id
    );
}


// ============================================================
// NCAAB — RESOLVE TEAM
// ============================================================

async function resolveNcaabTeam(
  teamName
) {

  const teams =
    await getNcaabTeams();


  const target =
    normalizeNcaabName(
      teamName
    );


  if (!target) {
    return null;
  }


  const exact =
    teams.find(
      team => {

        const names = [
          team.displayName,
          team.shortDisplayName,
          team.name,
          team.abbreviation,
          team.location
        ];


        return names
          .map(
            normalizeNcaabName
          )
          .filter(Boolean)
          .includes(
            target
          );
      }
    );


  if (exact) {
    return exact;
  }


  // ==========================================================
  // FALLBACK — NOMBRES DISTINTOS ENTRE THE ODDS API Y ESPN
  //
  // Ej: Odds API "Sam Houston St Bearkats"
  //     ESPN     "Sam Houston Bearkats"
  //
  // 1) Mismo mascota al final del nombre.
  // 2) Lo que queda (la escuela) debe coincidir
  //    con la location de ESPN:
  //    igual, o uno empieza con el otro,
  //    o comparten una palabra propia
  //    (ej. "CSU Bakersfield" / "Cal State Bakersfield").
  // 3) Solo se acepta si queda UN candidato.
  //    Si hay duda, no se adivina.
  // ==========================================================

  return findNcaabTeamByMascot(
    teams,
    teamName
  );
}


const NCAAB_GENERIC_WORDS =
  new Set([
    "st",
    "state",
    "saint",
    "university",
    "univ",
    "college",
    "of",
    "the",
    "at",
    "and",
    "north",
    "south",
    "east",
    "west",
    "northern",
    "southern",
    "eastern",
    "western",
    "central",
    "cal",
    "csu",
    "uc"
  ]);


function ncaabSchoolKey(
  value
) {

  // "state" y "st" cuentan como lo mismo
  // y se quitan al final del nombre
  // de la escuela.
  return normalizeNcaabName(
    value
  )
    .replace(
      /state$/,
      ""
    )
    .replace(
      /st$/,
      ""
    );
}


function ncaabSchoolWords(
  value
) {

  return String(
    value ||
    ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[̀-ͯ]/g,
      ""
    )
    .toLowerCase()
    .split(
      /[^a-z0-9]+/
    )
    .filter(
      word =>
        word.length >= 4 &&
        !NCAAB_GENERIC_WORDS.has(
          word
        )
    );
}


function findNcaabTeamByMascot(
  teams,
  teamName
) {

  const target =
    normalizeNcaabName(
      teamName
    );


  const candidates =
    [];


  for (
    const team
    of teams
  ) {

    const mascot =
      normalizeNcaabName(
        team.name
      );


    if (
      !mascot ||
      !target.endsWith(
        mascot
      ) ||
      target.length <=
        mascot.length
    ) {
      continue;
    }


    // Parte de la escuela en el nombre
    // de The Odds API (sin la mascota).
    const rawSchool =
      String(
        teamName
      )
        .trim()
        .slice(
          0,
          Math.max(
            0,
            String(teamName)
              .trim()
              .length -
              String(team.name || "")
                .length
          )
        );


    const oddsSchool =
      ncaabSchoolKey(
        rawSchool
      );


    const espnSchool =
      ncaabSchoolKey(
        team.location
      );


    if (
      !oddsSchool ||
      !espnSchool
    ) {
      continue;
    }


    // Nivel 1: misma escuela.
    if (
      oddsSchool ===
      espnSchool
    ) {
      candidates.push({
        team,
        level: 1
      });
      continue;
    }


    // Nivel 2: una empieza con la otra.
    if (
      Math.min(
        oddsSchool.length,
        espnSchool.length
      ) >= 4 &&
      (
        oddsSchool.startsWith(
          espnSchool
        ) ||
        espnSchool.startsWith(
          oddsSchool
        )
      )
    ) {
      candidates.push({
        team,
        level: 2
      });
      continue;
    }


    // Nivel 3: comparten una palabra propia.
    const oddsWords =
      ncaabSchoolWords(
        rawSchool
      );

    const espnWords =
      ncaabSchoolWords(
        team.location
      );


    if (
      oddsWords.some(
        word =>
          espnWords.includes(
            word
          )
      )
    ) {
      candidates.push({
        team,
        level: 3
      });
    }
  }


  if (
    !candidates.length
  ) {
    return null;
  }


  const bestLevel =
    Math.min(
      ...candidates.map(
        c => c.level
      )
    );


  const best =
    candidates.filter(
      c =>
        c.level ===
        bestLevel
    );


  // Si quedan 2+ con el mismo nivel,
  // no adivinamos.
  if (
    best.length !== 1
  ) {
    console.warn(
      "NCAAB team ambiguous:",
      teamName,
      best.map(
        c =>
          c.team.displayName
      )
    );

    return null;
  }


  return best[0].team;
}


// ============================================================
// NCAAB — TEAM SCHEDULE
// ============================================================

async function getNcaabTeamGames(
  teamId,
  season
) {

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${teamId}/schedule?season=${season}`;


  const data =
    await fetchEspnJson(
      url
    );


  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];


  const games =
    events
      .map(
        event =>
          mapNcaabScheduleEvent(
            event,
            teamId,
            season
          )
      )
      .filter(Boolean)
      .filter(
        game =>
          game.completed
      )
      .filter(
        game =>
          Number.isFinite(
            game.scored
          ) &&
          Number.isFinite(
            game.allowed
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          new Date(b.date) -
          new Date(a.date)
      );


  return games;
}


// ============================================================
// NCAAB — MAP SCHEDULE GAME
// ============================================================

function mapNcaabScheduleEvent(
  event,
  teamId,
  season
) {

  const competition =
    event?.competitions?.[0];


  if (!competition) {
    return null;
  }


  const competitors =
    competition.competitors ||
    [];


  const ourTeam =
    competitors.find(
      competitor =>
        String(
          competitor?.team?.id
        ) ===
        String(
          teamId
        )
    );


  const opponent =
    competitors.find(
      competitor =>
        String(
          competitor?.team?.id
        ) !==
        String(
          teamId
        )
    );


  if (
    !ourTeam ||
    !opponent
  ) {
    return null;
  }


  const completed =
    competition
      ?.status
      ?.type
      ?.completed === true;


  // ESPN schedule manda score como objeto
  // { value: 70, displayValue: "70" }.
  // El scoreboard lo manda como texto "70".
  // parseEspnScore acepta los dos formatos.
  const scored =
    parseEspnScore(
      ourTeam.score
    );


  const allowed =
    parseEspnScore(
      opponent.score
    );


  return {

    eventId:
      String(
        event.id
      ),

    date:
      event.date,

    season,

    completed,

    isHome:
      ourTeam.homeAway ===
      "home",

    scored,

    allowed,

    opponentId:
      String(
        opponent.team.id
      ),

    opponent:
      opponent.team.displayName ||
      opponent.team.shortDisplayName ||
      opponent.team.name ||
      opponent.team.abbreviation ||
      ""
  };
}


// ============================================================
// NCAAB — PARSE ESPN SCORE
// ============================================================

function parseEspnScore(
  score
) {

  if (
    score === null ||
    score === undefined ||
    score === ""
  ) {
    return NaN;
  }


  if (
    typeof score ===
    "object"
  ) {
    return Number(
      score.value ??
      score.displayValue
    );
  }


  return Number(
    score
  );
}


// ============================================================
// NCAAB — ENRICH HISTORICAL GAME
// ============================================================

async function enrichNcaabGame(
  team,
  game,
  teamBpi,
  row = null,
  scale = null,
  todayOpponentProfile = null,
  similarCheck = null,
  teamProfile = null
) {

  const opponentHistory =
    await getNcaabOpponentAverages(
      game.opponentId,
      game.date,
      game.season
    );


  const rivalBpi =
    row?.rivalBpi ?? null;

  const rivalOff =
    row?.rivalOff ?? null;

  const rivalDef =
    row?.rivalDef ?? null;


  // ==========================================================
  // AJUSTE DE ESTE JUEGO AL RIVAL DE HOY
  //
  // Anotados ajustados =
  //   anotados + escala ataque del equipo ×
  //   (BPI DEF rival de hoy − BPI DEF de ese rival)
  //
  // Permitidos ajustados =
  //   permitidos + escala defensa del equipo ×
  //   (BPI OFF rival de hoy − BPI OFF de ese rival)
  //
  // Si la escala no sirve (pocos juegos o
  // sentido al revés) o falta un BPI,
  // se deja el número crudo.
  // ==========================================================

  const todayDef =
    todayOpponentProfile?.def ?? null;

  const todayOff =
    todayOpponentProfile?.off ?? null;

  const todayBpi =
    todayOpponentProfile?.bpi ?? null;


  const canAdjustScored =
    scale?.offense?.usable === true &&
    Number.isFinite(todayDef) &&
    Number.isFinite(rivalDef);


  const canAdjustAllowed =
    scale?.defense?.usable === true &&
    Number.isFinite(todayOff) &&
    Number.isFinite(rivalOff);


  const adjustedScored =
    canAdjustScored
      ? game.scored +
        scale.offense.slope *
        (todayDef - rivalDef)
      : game.scored;


  const adjustedAllowed =
    canAdjustAllowed
      ? game.allowed +
        scale.defense.slope *
        (todayOff - rivalOff)
      : game.allowed;


  // ==========================================================
  // PESO DEL JUEGO
  //
  // Rival con BPI parecido al de hoy → pesa más.
  // Diferencia 0 → 1.00
  // Diferencia 5 → 0.50
  // Diferencia 10 → 0.20
  // Diferencia 20 → 0.06
  // Sin rival de hoy: todos pesan igual.
  // ==========================================================

  let similarityWeight =
    1;

  if (
    Number.isFinite(todayBpi)
  ) {

    similarityWeight =
      Number.isFinite(rivalBpi)
        ? 1 /
          (
            1 +
            Math.pow(
              Math.abs(rivalBpi - todayBpi) / 5,
              2
            )
          )
        : 0.05;
  }


  return {

    date:
      game.date,

    eventId:
      game.eventId,

    season:
      game.season,

    isHome:
      game.isHome,

    scored:
      game.scored,

    allowed:
      game.allowed,

    opponent:
      game.opponent,

    opponentId:
      game.opponentId,


    // Lo que el rival venia haciendo
    // ANTES de este partido.

    opponentAvgScored:
      opponentHistory
        ?.opponentAvgScored ??
      null,

    opponentAvgAllowed:
      opponentHistory
        ?.opponentAvgAllowed ??
      null,


    // BPI actual del equipo analizado
    // (igual en todos los registros).
    teamBpi:
      Number.isFinite(teamBpi)
        ? teamBpi
        : null,

    teamBpiOff:
      teamProfile?.off ?? null,

    teamBpiDef:
      teamProfile?.def ?? null,


    // BPI del rival de ESE juego
    // (de la temporada de ese juego).
    opponentBpi:
      Number.isFinite(rivalBpi)
        ? rivalBpi
        : null,

    opponentBpiOff:
      rivalOff,

    opponentBpiDef:
      rivalDef,


    // NUEVO — ajuste al rival de hoy
    adjustedScored,

    adjustedAllowed,

    scoredAdjusted:
      canAdjustScored,

    allowedAdjusted:
      canAdjustAllowed,

    similarityWeight,

    todayOpponentBpi:
      todayBpi,

    todayOpponentOff:
      todayOff,

    todayOpponentDef:
      todayDef,


    // Igual en todos los registros:
    // escala del equipo y verificación ±5.
    teamScale:
      scale,

    similarCheck
  };
}


// ============================================================
// NCAAB — OPPONENT HISTORICAL AVERAGES
//
// Miramos hasta 5 juegos del rival
// ANTERIORES al juego historico.
// ============================================================

async function getNcaabOpponentAverages(
  opponentId,
  beforeDate,
  season
) {

  const games =
    await getNcaabTeamGames(
      opponentId,
      season
    );


  const before =
    new Date(
      beforeDate
    );


  const previous =
    games
      .filter(
        game =>
          new Date(
            game.date
          ) <
          before
      )
      .sort(
        (
          a,
          b
        ) =>
          new Date(b.date) -
          new Date(a.date)
      )
      .slice(
        0,
        5
      );


  if (
    !previous.length
  ) {

    return {
      opponentAvgScored:
        null,

      opponentAvgAllowed:
        null
    };
  }


  const opponentAvgScored =
    previous.reduce(
      (
        sum,
        game
      ) =>
        sum +
        Number(
          game.scored
        ),
      0
    ) /
    previous.length;


  const opponentAvgAllowed =
    previous.reduce(
      (
        sum,
        game
      ) =>
        sum +
        Number(
          game.allowed
        ),
      0
    ) /
    previous.length;


  return {
    opponentAvgScored,
    opponentAvgAllowed
  };
}





// ============================================================
// NCAAB — TEAM SEASON BPI
//
// Usa el Power Index del equipo
// correspondiente a ESA temporada.
//
// Ejemplo:
// partido season 2027
// → BPI del rival en season 2027
//
// partido usado de season 2026
// → BPI del rival en season 2026
// ============================================================

// ============================================================
// NCAAB — TEAM SEASON BPI
//
// El Power Index completo de la temporada
// se descarga una vez y se guarda 24 horas.
//
// Después cada equipo es solamente
// un lookup local por ESPN teamId.
// ============================================================

async function getNcaabSeasonBpi(
  teamId,
  season
) {

  const profile =
    await getNcaabBpiProfile(
      teamId,
      season
    );


  return profile?.bpi ??
    null;
}


// ============================================================
// NCAAB — BPI POR EQUIPO (TOTAL, OFENSIVO, DEFENSIVO)
//
// La lista completa (getNcaabSeasonBpiMap) solo
// devuelve 25 equipos, así que se pide equipo
// por equipo. ESPN da:
//   bpi        = total (margen por 70 posesiones)
//   bpioffense = fuerza del ataque
//   bpidefense = fuerza de la defensa
//                (más alto = mejor defensa)
//
// Se guarda 24 horas por equipo y temporada,
// incluso si ESPN no lo tiene (null).
// ============================================================

async function getNcaabBpiProfile(
  teamId,
  season
) {

  if (
    !teamId ||
    !season
  ) {
    return null;
  }


  const cacheKey =
    `profile:${season}:${teamId}`;


  const cached =
    ncaabBpiCache[
      cacheKey
    ];


  if (
    cached &&
    Date.now() -
      cached.time <
      BPI_CACHE_TIME
  ) {
    return cached.data;
  }


  let profile =
    null;


  try {

    const url =
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/${season}/powerindex/${teamId}?lang=en&region=us`;


    const data =
      await fetchEspnJson(
        url
      );


    const bpi =
      extractNamedStat(
        data,
        "bpi"
      );

    const off =
      extractNamedStat(
        data,
        "bpioffense"
      );

    const def =
      extractNamedStat(
        data,
        "bpidefense"
      );


    profile =
      Number.isFinite(bpi)
        ? {
            bpi,
            off:
              Number.isFinite(off)
                ? off
                : null,
            def:
              Number.isFinite(def)
                ? def
                : null
          }
        : null;

  } catch (error) {

    // Rival sin BPI (ej. fuera de Division I).
    // No tumba el análisis.
    profile =
      null;
  }


  ncaabBpiCache[
    cacheKey
  ] = {

    data:
      profile,

    time:
      Date.now()
  };


  return profile;
}


// Lee una estadística por su nombre exacto
// (ej. "bpi", "bpioffense", "bpidefense").
function extractNamedStat(
  data,
  statName
) {

  const stats =
    Array.isArray(
      data?.stats
    )
      ? data.stats
      : [];


  const stat =
    stats.find(
      item =>
        String(
          item?.name || ""
        ).toLowerCase() ===
        statName
    );


  if (
    !stat ||
    stat.value === null ||
    stat.value === undefined ||
    stat.value === ""
  ) {
    return null;
  }


  const number =
    Number(
      stat.value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}



// ============================================================
// NCAAB — FULL SEASON BPI MAP
// ============================================================

async function getNcaabSeasonBpiMap(
  season
) {

  const cacheKey =
    String(season);


  const cached =
    ncaabBpiCache[
      cacheKey
    ];


  if (
    cached &&
    cached.data &&
    Date.now() -
      cached.time <
      BPI_CACHE_TIME
  ) {
    return cached.data;
  }


  const teamValues = {};

  let page = 1;
  let pageCount = 1;


  do {

    const url =
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/${season}/powerindex?limit=100&page=${page}&lang=en&region=us`;


    const data =
      await fetchEspnJson(
        url
      );


    const items =
      Array.isArray(
        data?.items
      )
        ? data.items
        : [];


    pageCount =
      Math.max(
        1,
        Number(
          data?.pageCount ||
          1
        )
      );


    for (
      const item
      of items
    ) {

      const teamRef =
        item?.team?.$ref ||
        "";


      const match =
        String(
          teamRef
        ).match(
          /\/teams\/(\d+)/
        );


      if (!match) {
        continue;
      }


      const teamId =
        String(
          match[1]
        );


      const bpi =
        extractBpiValue(
          item
        );


      if (
        !Number.isFinite(
          bpi
        )
      ) {
        continue;
      }


      const lastUpdated =
        new Date(
          item?.lastUpdated ||
          0
        ).getTime();


      const existing =
        teamValues[
          teamId
        ];


      // Si ESPN devuelve más de un
      // registro del mismo equipo
      // (regular/postseason),
      // conservamos el más actualizado.
      if (
        !existing ||
        lastUpdated >=
          existing.lastUpdated
      ) {

        teamValues[
          teamId
        ] = {
          value:
            bpi,

          lastUpdated:
            Number.isFinite(
              lastUpdated
            )
              ? lastUpdated
              : 0
        };
      }
    }


    page += 1;

  } while (
    page <= pageCount
  );


  const bpiMap = {};


  for (
    const [
      teamId,
      entry
    ]
    of Object.entries(
      teamValues
    )
  ) {

    bpiMap[
      teamId
    ] =
      entry.value;
  }


  ncaabBpiCache[
    cacheKey
  ] = {

    data:
      bpiMap,

    time:
      Date.now()
  };


  return bpiMap;
}

// ============================================================
// EXTRACT BPI RATING
// ============================================================

function extractBpiValue(
  data
) {

  const stats =
    Array.isArray(
      data?.stats
    )
      ? data.stats
      : Array.isArray(
          data?.statistics
        )
        ? data.statistics
        : [];


  if (!stats.length) {
    return null;
  }


  const preferredNames = [
    "bpi",
    "powerindex",
    "basketballpowerindex",
    "overallbpi",
    "bpirating",
    "rating"
  ];


  const stat =
    stats.find(
      item => {

        const names = [
          item?.name,
          item?.displayName,
          item?.abbreviation,
          item?.description
        ]
          .map(
            normalizeNcaabName
          )
          .filter(Boolean);


        return names.some(
          name =>
            preferredNames.includes(
              name
            )
        );
      }
    );


  if (!stat) {
    return null;
  }


  const rawValue =
    stat.value ??
    stat.displayValue ??
    null;


  if (
    rawValue === null ||
    rawValue === undefined ||
    rawValue === ""
  ) {
    return null;
  }


  const number =
    Number(
      String(rawValue)
        .replace(
          "%",
          ""
        )
        .trim()
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}

// ============================================================
// ESPN FETCH + CACHE
// ============================================================

async function fetchEspnJson(
  url
) {

  const cached =
    ncaabCache[url];


  if (
    cached &&
    Date.now() -
      cached.time <
      CACHE_TIME
  ) {
    return cached.data;
  }


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      ESPN_TIMEOUT
    );


  try {

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal
        }
      );


    if (!response.ok) {

      const body =
        await response.text();


      throw new Error(
        `ESPN ${response.status}: ${body.slice(0, 200)}`
      );
    }


    const data =
      await response.json();


    ncaabCache[url] = {
      data,
      time:
        Date.now()
    };


    return data;


  } finally {

    clearTimeout(
      timeout
    );
  }
}


// ============================================================
// ESPN WNBA
// ============================================================

async function getEspnWnbaGames() {

  if (
    cache.data &&
    Date.now() -
      cache.time <
      CACHE_TIME
  ) {
    return cache.data;
  }


  const year =
    new Date()
      .getFullYear();


  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?limit=1000&dates=${year}`;


  const response =
    await fetch(
      url
    );


  if (!response.ok) {

    const body =
      await response.text();


    throw new Error(
      `ESPN error ${response.status}: ${body.slice(0, 300)}`
    );
  }


  const data =
    await response.json();


  const events =
    data.events ||
    [];


  const games =
    events.map(
      event => {

        const competition =
          event.competitions?.[0];


        const competitors =
          competition
            ?.competitors ||
          [];


        const home =
          competitors.find(
            c =>
              c.homeAway ===
              "home"
          );


        const away =
          competitors.find(
            c =>
              c.homeAway ===
              "away"
          );


        return {

          date:
            event.date,

          completed:
            competition
              ?.status
              ?.type
              ?.completed ===
            true,

          homeTeam:
            getTeamNames(
              home
            ),

          awayTeam:
            getTeamNames(
              away
            ),

          homeScore:
            Number(
              home?.score ||
              0
            ),

          awayScore:
            Number(
              away?.score ||
              0
            )
        };
      }
    );


  cache.data =
    games;

  cache.time =
    Date.now();


  return games;
}


// ============================================================
// WNBA HELPERS
// ============================================================

function getTeamNames(
  competitor
) {

  const team =
    competitor?.team ||
    {};


  return {

    displayName:
      team.displayName ||
      "",

    shortDisplayName:
      team.shortDisplayName ||
      "",

    name:
      team.name ||
      "",

    abbreviation:
      team.abbreviation ||
      ""
  };
}


// ============================================================
// COMMON NORMALIZE
// ============================================================

function normalize(
  value
) {

  return String(
    value ||
    ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}


// ============================================================
// NCAAB NORMALIZE
// ============================================================

function normalizeNcaabName(
  value
) {

  return String(
    value ||
    ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      "and"
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}


// ============================================================
// WNBA TEAM MATCH
// ============================================================

function teamMatches(
  teamObj,
  target
) {

  const targetNames =
    typeof target ===
    "object"
      ? [
          target.displayName,
          target.shortDisplayName,
          target.name,
          target.abbreviation
        ]
      : [
          target
        ];


  const normalizedTargets =
    targetNames
      .map(
        normalize
      )
      .filter(Boolean);


  return [
    teamObj?.displayName,
    teamObj?.shortDisplayName,
    teamObj?.name,
    teamObj?.abbreviation
  ]
    .some(
      name =>
        normalizedTargets.includes(
          normalize(
            name
          )
        )
    );
}

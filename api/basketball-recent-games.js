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

        const games =
          await getEspnNcaabRecentGames(
            team
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
  teamName
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


// BPI ACTUAL DEL EQUIPO ANALIZADO.
//
// Sale del mismo mapa BPI de temporada
// que ya tenemos cacheado 24 horas.
// No genera una llamada individual
// por cada partido.
const teamBpi =
  await getNcaabSeasonBpi(
    team.id,
    currentSeason
  );


// Temporada actual.
const currentGames =
  await getNcaabTeamGames(
    team.id,
    currentSeason
  );

  let selectedGames =
    [];


  // ==========================================================
  // REGLA DE TEMPORADA
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

    const previousGames =
      await getNcaabTeamGames(
        team.id,
        previousSeason
      );


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


const enriched =
  await Promise.all(
    selectedGames.map(
      game =>
        enrichNcaabGame(
          team,
          game,
          teamBpi
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


  return exact || null;
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


  const scored =
    Number(
      ourTeam.score
    );


  const allowed =
    Number(
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
// NCAAB — ENRICH HISTORICAL GAME
// ============================================================

async function enrichNcaabGame(
  team,
  game,
  teamBpi
) {
  const [
  opponentHistory,
  pace,
  opponentBpi
] =
  await Promise.all([

    getNcaabOpponentAverages(
      game.opponentId,
      game.date,
      game.season
    ),

    getNcaabGamePace(
      game.eventId,
      team.id,
      game.opponentId
    ),

    getNcaabSeasonBpi(
      game.opponentId,
      game.season
    )

  ]);


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

// BPI ACTUAL DEL EQUIPO
// que estamos analizando.
//
// Es el mismo en todos los registros
// porque representa su fuerza actual
// para el matchup de hoy.

teamBpi:
  Number.isFinite(
    teamBpi
  )
    ? teamBpi
    : null,
    // BPI DEL RIVAL PARA ESE JUEGO.
    // null si ESPN no lo tiene.

    opponentBpi:
      Number.isFinite(
        opponentBpi
      )
        ? opponentBpi
        : null,


    // Posesiones estimadas del juego.

    pace:
      Number.isFinite(
        pace
      )
        ? pace
        : null
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
// NCAAB — PACE
//
// Possessions =
// FGA - OREB + TOV + 0.44 * FTA
//
// Calculamos posesiones de ambos equipos
// y usamos el promedio del juego.
// ============================================================

async function getNcaabGamePace(
  eventId,
  teamId,
  opponentId
) {

  try {

    const url =
      `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${eventId}`;


    const data =
      await fetchEspnJson(
        url
      );


    const teams =
      data?.boxscore?.teams ||
      [];


    const teamBox =
      teams.find(
        row =>
          String(
            row?.team?.id
          ) ===
          String(
            teamId
          )
      );


    const opponentBox =
      teams.find(
        row =>
          String(
            row?.team?.id
          ) ===
          String(
            opponentId
          )
      );


    if (
      !teamBox ||
      !opponentBox
    ) {
      return null;
    }


    const teamPossessions =
      calculatePossessionsFromEspnStats(
        teamBox.statistics
      );


    const opponentPossessions =
      calculatePossessionsFromEspnStats(
        opponentBox.statistics
      );


    if (
      !Number.isFinite(
        teamPossessions
      ) ||
      !Number.isFinite(
        opponentPossessions
      )
    ) {
      return null;
    }


    return (
      teamPossessions +
      opponentPossessions
    ) / 2;


  } catch (error) {

    console.error(
      `NCAAB PACE ERROR ${eventId}:`,
      error.message
    );

    return null;
  }
}


// ============================================================
// POSSESSIONS FROM ESPN BOX SCORE
// ============================================================

function calculatePossessionsFromEspnStats(
  stats
) {

  if (
    !Array.isArray(stats)
  ) {
    return null;
  }


  const fga =
    getAttemptStat(
      stats,
      [
        "fieldGoalsMade-fieldGoalsAttempted",
        "fieldGoalsMadeFieldGoalsAttempted",
        "fieldGoals"
      ]
    );


  const fta =
    getAttemptStat(
      stats,
      [
        "freeThrowsMade-freeThrowsAttempted",
        "freeThrowsMadeFreeThrowsAttempted",
        "freeThrows"
      ]
    );


  const offensiveRebounds =
    getNumericStat(
      stats,
      [
        "offensiveRebounds",
        "offRebounds"
      ]
    );


  const turnovers =
    getNumericStat(
      stats,
      [
        "turnovers",
        "totalTurnovers"
      ]
    );


  if (
    !Number.isFinite(fga) ||
    !Number.isFinite(fta) ||
    !Number.isFinite(
      offensiveRebounds
    ) ||
    !Number.isFinite(
      turnovers
    )
  ) {
    return null;
  }


  return (
    fga -
    offensiveRebounds +
    turnovers +
    0.44 * fta
  );
}


// ============================================================
// ESPN STAT HELPERS
// ============================================================

function getAttemptStat(
  stats,
  names
) {

  const stat =
    findEspnStat(
      stats,
      names
    );


  if (!stat) {
    return null;
  }


  // ESPN suele devolver:
  // "25-61"
  //
  // Queremos el segundo numero.

  const display =
    String(
      stat.displayValue ??
      stat.value ??
      ""
    );


  if (
    display.includes("-")
  ) {

    const parts =
      display.split("-");


    const attempts =
      Number(
        parts[
          parts.length - 1
        ]
      );


    return Number.isFinite(
      attempts
    )
      ? attempts
      : null;
  }


  const value =
    Number(
      stat.value
    );


  return Number.isFinite(
    value
  )
    ? value
    : null;
}


function getNumericStat(
  stats,
  names
) {

  const stat =
    findEspnStat(
      stats,
      names
    );


  if (!stat) {
    return null;
  }


  const value =
    Number(
      stat.value ??
      stat.displayValue
    );


  return Number.isFinite(
    value
  )
    ? value
    : null;
}


function findEspnStat(
  stats,
  names
) {

  const targets =
    names.map(
      normalizeNcaabName
    );


  return stats.find(
    stat => {

      const possibilities = [
        stat.name,
        stat.abbreviation,
        stat.label,
        stat.displayName
      ]
        .map(
          normalizeNcaabName
        )
        .filter(Boolean);


      return possibilities.some(
        value =>
          targets.includes(
            value
          )
      );
    }
  ) || null;
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

  if (
    !teamId ||
    !season
  ) {
    return null;
  }


  const bpiMap =
    await getNcaabSeasonBpiMap(
      season
    );


  const value =
    bpiMap[
      String(teamId)
    ];


  return Number.isFinite(
    value
  )
    ? value
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

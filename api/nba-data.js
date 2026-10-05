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
// CACHE
// ============================================================
//
// Solamente conservamos cache para TEAMS.
//
// Los juegos históricos salen de Supabase.
// No queremos guardar juegos en memoria 30 min
// porque después de una sincronización queremos
// que el nuevo resultado aparezca inmediatamente.
// ============================================================

const cache =
  global.NBA_DATA_CACHE || {};

global.NBA_DATA_CACHE =
  cache;


const TEAMS_CACHE_TIME =
  24 * 60 * 60 * 1000;


const TIMEOUT_MS =
  10000;


// ============================================================
// NBA SEASON
// ============================================================

function getCurrentNBASeason() {

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    now.getMonth() + 1;


  // NBA 2026-27 = season 2026
  // en BallDontLie.
  if (
    month >= 9
  ) {
    return year;
  }


  return year - 1;
}


const CURRENT_SEASON =
  getCurrentNBASeason();


const PREVIOUS_SEASON =
  CURRENT_SEASON - 1;


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
      "Content-Type, Authorization, X-Internal-Secret"
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

     const {
  type,
  teamId,
  season,
  full,
  limit
} =
  req.query;


      if (
        !type
      ) {
        return res
          .status(400)
          .json({
            error:
              "Falta type"
          });
      }


      // ======================================================
      // INTERNAL AUTH
      // ======================================================
      //
      // Se usa para sincronizaciones automáticas/manuales.
      // ======================================================

      const validSecret =
        process.env.CRON_SECRET ||
        process.env.GENERATE_DAILY_SECRET ||
        "";


      const suppliedSecret =
        String(
          req.headers[
            "x-internal-secret"
          ] ||
          req.query.secret ||
          ""
        );


      const isInternal =
        Boolean(validSecret) &&
        suppliedSecret ===
          validSecret;


      // ======================================================
      // SYNC
      // ======================================================
      //
      // Nunca se ejecuta automáticamente al pedir un análisis.
      //
      // full=true
      // → backfill completo.
      //
      // sin full
      // → solamente últimos 3 días.
      // ======================================================

      if (
        type === "sync"
      ) {

        if (
          !isInternal
        ) {
          return res
            .status(401)
            .json({
              error:
                "Unauthorized sync"
            });
        }


        if (
          !process.env
            .BALLDONTLIE_API_KEY
        ) {
          return res
            .status(500)
            .json({
              error:
                "BALLDONTLIE_API_KEY no configurada"
            });
        }


        const requestedSeason =
          season !== undefined &&
          season !== null &&
          season !== ""
            ? Number(season)
            : CURRENT_SEASON;


        if (
          !isValidSeason(
            requestedSeason
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "Temporada NBA inválida"
            });
        }


        const fullSync =
          String(full) ===
            "true";


        const result =
          await syncSeasonToSupabase(
            requestedSeason,
            {
              full:
                fullSync
            }
          );


        return res
          .status(200)
          .json({
            ok: true,

            mode:
              fullSync
                ? "full-backfill"
                : "incremental",

            season:
              requestedSeason,

            ...result
          });
      }
// ============================================================
// SYNC NBA GAME STATS / PACE
// ============================================================
//
// Solo uso interno.
//
// Toma partidos que ya existen en nba_games
// pero todavía no tienen stats.
//
// Descarga boxscores una sola vez,
// calcula posesiones y los guarda en Supabase.
//
// NO corre durante un análisis normal.
// ============================================================

if (
  type === "sync-stats"
) {

  if (
    !isInternal
  ) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized sync"
      });
  }


  const requestedSeason =
    season !== undefined &&
    season !== null &&
    season !== ""
      ? Number(season)
      : CURRENT_SEASON;


  if (
    !isValidSeason(
      requestedSeason
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Temporada NBA inválida"
      });
  }


  const requestedLimit =
    Number(limit || 5);


  const maxDates =
    Number.isFinite(
      requestedLimit
    )
      ? Math.min(
          10,
          Math.max(
            1,
            Math.floor(
              requestedLimit
            )
          )
        )
      : 5;


  const result =
    await syncNBAStatsToSupabase(
      requestedSeason,
      maxDates
    );


  return res
    .status(200)
    .json({
      ok: true,
      mode:
        "sync-stats",
      season:
        requestedSeason,
      ...result
    });
}

      // ======================================================
      // NORMAL AUTH
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


      // Permitimos llamadas internas.
      // Si no es interna,
      // exigimos usuario autenticado.
      if (
        !isInternal
      ) {

        if (
          !token
        ) {
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
          await supabaseAdmin
            .auth
            .getUser(
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
      }


      // ======================================================
      // TEAMS
      // ======================================================
      //
      // Por ahora esta llamada sigue siendo BallDontLie.
      // Es una sola llamada pequeña y queda cacheada 24h.
      //
      // Después podemos eliminarla también si queremos.
      // ======================================================

      if (
        type === "teams"
      ) {

        if (
          !process.env
            .BALLDONTLIE_API_KEY
        ) {
          return res
            .status(500)
            .json({
              error:
                "BALLDONTLIE_API_KEY no configurada"
            });
        }


        const teams =
          await getTeams();


        return res
          .status(200)
          .json({
            data:
              teams
          });
      }


      // ======================================================
      // GAMES
      // ======================================================
      //
      // IMPORTANTE:
      //
      // Aquí YA NO llamamos BallDontLie.
      //
      // Todo sale de Supabase.
      // ======================================================

      if (
        type === "games"
      ) {

        if (
          !teamId
        ) {
          return res
            .status(400)
            .json({
              error:
                "Falta teamId"
            });
        }


        const requestedSeason =
          season !== undefined &&
          season !== null &&
          season !== ""
            ? Number(season)
            : CURRENT_SEASON;


        if (
          !isValidSeason(
            requestedSeason
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "Temporada NBA inválida"
            });
        }


        const games =
          await getGamesFromSupabase(
            teamId,
            requestedSeason
          );


        return res
          .status(200)
          .json({

            data:
              games,

            season:
              requestedSeason,

            currentSeason:
              CURRENT_SEASON,

            previousSeason:
              PREVIOUS_SEASON

          });
      }


      return res
        .status(400)
        .json({
          error:
            "Tipo inválido"
        });


    } catch (error) {

      console.error(
        "NBA DATA ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          error:
            "Error cargando data NBA",

          details:
            error.message
        });
    }
  };


// ============================================================
// VALID SEASON
// ============================================================

function isValidSeason(
  season
) {

  return (
    Number.isInteger(
      Number(season)
    ) &&
    (
      Number(season) ===
        CURRENT_SEASON ||

      Number(season) ===
        PREVIOUS_SEASON
    )
  );
}


// ============================================================
// TEAMS
// ============================================================

async function getTeams() {

  const key =
    "teams";


  if (
    cache[key] &&
    cache[key].data &&
    Date.now() -
      cache[key].time <
      TEAMS_CACHE_TIME
  ) {
    return cache[key].data;
  }


  const data =
    await fetchBalldontlie(
      "https://api.balldontlie.io/v1/teams"
    );


  const teams =
    (data.data || [])
      .map(
        team => ({
          id:
            team.id,

          abbreviation:
            team.abbreviation,

          city:
            team.city,

          name:
            team.name,

          full_name:
            team.full_name
        })
      );


  cache[key] = {
    data:
      teams,

    time:
      Date.now()
  };


  return teams;
}


// ============================================================
// READ GAMES FROM SUPABASE
// ============================================================

async function getGamesFromSupabase(
  teamId,
  season
) {

  const numericTeamId =
    Number(teamId);


  if (
    !Number.isFinite(
      numericTeamId
    )
  ) {
    throw new Error(
      "Invalid NBA teamId"
    );
  }


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from("nba_games")
      .select(
        `
          game_id,
          season,
          game_date,
          home_team_id,
          visitor_team_id,
          home_team_name,
          visitor_team_name,
          home_score,
          visitor_score
        `
      )
      .eq(
        "season",
        Number(season)
      )
      .or(
        `home_team_id.eq.${numericTeamId},visitor_team_id.eq.${numericTeamId}`
      )
      .order(
        "game_date",
        {
          ascending: false
        }
      );


  if (
    error
  ) {
    throw new Error(
      `Supabase nba_games: ${error.message}`
    );
  }


  return (
    data || []
  )
    .map(
      row => ({

        id:
          Number(
            row.game_id
          ),

        date:
          row.game_date,

        home_team_score:
          Number(
            row.home_score
          ),

        visitor_team_score:
          Number(
            row.visitor_score
          ),

        home_team: {
          id:
            Number(
              row.home_team_id
            ),

          full_name:
            row.home_team_name
        },

        visitor_team: {
          id:
            Number(
              row.visitor_team_id
            ),

          full_name:
            row.visitor_team_name
        },

        cashEdgeSeason:
          Number(
            row.season
          )

      })
    );
}


// ============================================================
// SYNC SEASON → SUPABASE
// ============================================================

async function syncSeasonToSupabase(
  season,
  options = {}
) {

  const full =
    options.full === true;


  let cursor =
    null;

  let pageCount =
    0;

  let downloaded =
    0;

  let completed =
    0;

  let saved =
    0;


  // ==========================================================
  // INCREMENTAL WINDOW
  // ==========================================================
  //
  // Si NO es backfill completo:
  // miramos los últimos 3 días.
  //
  // Esto permite:
  // - recoger juegos nuevos
  // - recoger correcciones recientes
  // - evitar descargar la temporada completa
  // ==========================================================

  let startDate =
    null;

  let endDate =
    null;


  if (
    !full
  ) {

    const now =
      new Date();


    const start =
      new Date(
        now.getTime() -
        3 *
        24 *
        60 *
        60 *
        1000
      );


    startDate =
      start
        .toISOString()
        .slice(
          0,
          10
        );


    endDate =
      now
        .toISOString()
        .slice(
          0,
          10
        );
  }


  do {

    const params =
      new URLSearchParams();


    params.append(
      "seasons[]",
      String(season)
    );


    params.set(
      "per_page",
      "100"
    );


    if (
      cursor
    ) {
      params.set(
        "cursor",
        String(cursor)
      );
    }


    if (
      startDate
    ) {
      params.set(
        "start_date",
        startDate
      );
    }


    if (
      endDate
    ) {
      params.set(
        "end_date",
        endDate
      );
    }


    const url =
      `https://api.balldontlie.io/v1/games?${params.toString()}`;


    const response =
      await fetchBalldontlie(
        url
      );


    const games =
      Array.isArray(
        response?.data
      )
        ? response.data
        : [];


    downloaded +=
      games.length;


    const finishedGames =
      games.filter(
        isCompletedGame
      );


    completed +=
      finishedGames.length;


    const rows =
      finishedGames
        .map(
          game =>
            mapGameForSupabase(
              game,
              season
            )
        )
        .filter(Boolean);


    if (
      rows.length
    ) {

      const {
        error
      } =
        await supabaseAdmin
          .from("nba_games")
          .upsert(
            rows,
            {
              onConflict:
                "game_id"
            }
          );


      if (
        error
      ) {
        throw new Error(
          `Supabase nba_games upsert: ${error.message}`
        );
      }


      saved +=
        rows.length;
    }


    cursor =
      response
        ?.meta
        ?.next_cursor ||
      null;


    pageCount++;


    // Protección por si la API
    // devolviera un cursor raro.
    if (
      pageCount > 25
    ) {
      throw new Error(
        "NBA sync exceeded 25 pages"
      );
    }


  } while (
    cursor
  );


  return {

    full,

    startDate,

    endDate,

    pages:
      pageCount,

    downloaded,

    completed,

    saved

  };
}


// ============================================================
// COMPLETED GAME
// ============================================================

function isCompletedGame(
  game
) {

  const state =
    String(
      game?.status_state ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    state
  ) {
    return (
      state === "final"
    );
  }


  const status =
    String(
      game?.status ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    status.includes(
      "final"
    )
  ) {
    return true;
  }


  const time =
    String(
      game?.time ||
      ""
    )
      .trim()
      .toLowerCase();


  return (
    time === "final" &&
    Number(
      game?.home_team_score || 0
    ) > 0 &&
    Number(
      game?.visitor_team_score || 0
    ) > 0
  );
}


// ============================================================
// MAP BALLDONTLIE → SUPABASE
// ============================================================

function mapGameForSupabase(
  game,
  season
) {

  const gameId =
    Number(
      game?.id
    );


  const homeTeamId =
    Number(
      game?.home_team?.id ??
      game?.home_team_id
    );


  const visitorTeamId =
    Number(
      game?.visitor_team?.id ??
      game?.visitor_team_id
    );


  const homeScore =
    Number(
      game?.home_team_score
    );


  const visitorScore =
    Number(
      game?.visitor_team_score
    );


  const gameDate =
    game?.datetime ||
    game?.date;


  if (
    !Number.isFinite(
      gameId
    ) ||
    !Number.isFinite(
      homeTeamId
    ) ||
    !Number.isFinite(
      visitorTeamId
    ) ||
    !Number.isFinite(
      homeScore
    ) ||
    !Number.isFinite(
      visitorScore
    ) ||
    !gameDate
  ) {
    return null;
  }


  return {

    game_id:
      gameId,

    season:
      Number(season),

    game_date:
      gameDate,

    home_team_id:
      homeTeamId,

    visitor_team_id:
      visitorTeamId,

    home_team_name:
      game?.home_team
        ?.full_name ||
      String(
        game?.home_team_name ||
        ""
      ),

    visitor_team_name:
      game?.visitor_team
        ?.full_name ||
      String(
        game?.visitor_team_name ||
        ""
      ),

    home_score:
      homeScore,

    visitor_score:
      visitorScore,

    // IMPORTANTE:
    // No mandamos FGA/OREB/TOV/FTA
    // ni possessions aquí.
    //
    // Cuando agreguemos esas estadísticas,
    // una sincronización básica de juegos
    // no deberá borrarlas.

    synced_at:
      new Date()
        .toISOString()

  };
}

// ============================================================
// NBA CALENDAR DATE
// ============================================================
//
// BallDontLie box_scores trabaja con
// la fecha NBA del partido.
//
// Como game_date puede estar guardada en UTC,
// convertimos a Eastern Time para evitar que
// un juego nocturno aparezca como el día siguiente.
// ============================================================

function getNBACalendarDate(
  dateValue
) {

  const parsed =
    new Date(dateValue);


  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }


  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "America/New_York",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit"
    }
  ).format(parsed);
}


// ============================================================
// SAFE NUMBER
// ============================================================

function nbaStatNumber(
  value
) {

  const number =
    Number(value);


  return Number.isFinite(
    number
  )
    ? number
    : 0;
}


// ============================================================
// TEAM TOTALS FROM BOXSCORE
// ============================================================

function getNBABoxscoreTeamTotals(
  team
) {

  const players =
    Array.isArray(
      team?.players
    )
      ? team.players
      : [];


  let fga = 0;
  let oreb = 0;
  let tov = 0;
  let fta = 0;


  for (
    const player
    of players
  ) {

    fga +=
      nbaStatNumber(
        player?.fga
      );


    oreb +=
      nbaStatNumber(
        player?.oreb
      );


    tov +=
      nbaStatNumber(
        player?.turnover ??
        player?.tov
      );


    fta +=
      nbaStatNumber(
        player?.fta
      );
  }


  return {
    fga,
    oreb,
    tov,
    fta
  };
}


// ============================================================
// POSSESSIONS
// ============================================================

function calculateNBAPossessions({
  fga,
  oreb,
  tov,
  fta
}) {

  const possessions =
    Number(fga) -
    Number(oreb) +
    Number(tov) +
    (
      0.44 *
      Number(fta)
    );


  return Number(
    possessions.toFixed(3)
  );
}


// ============================================================
// GAME PACE
// ============================================================
//
// Primero calculamos posesiones estimadas
// de ambos equipos.
//
// Luego promediamos.
//
// Si hubo overtime,
// normalizamos nuevamente a 48 minutos.
//
// Ejemplo:
//
// 53 minutos = 1 OT
// pace = raw possessions * 48 / 53
//
// Así un OT no infla artificialmente
// el ritmo del partido.
// ============================================================

function calculateNBAGamePace(
  homePossessions,
  visitorPossessions,
  period
) {

  const averagePossessions =
    (
      Number(homePossessions) +
      Number(visitorPossessions)
    ) / 2;


  const completedPeriods =
    Number.isFinite(
      Number(period)
    )
      ? Number(period)
      : 4;


  const overtimePeriods =
    Math.max(
      0,
      completedPeriods - 4
    );


  const gameMinutes =
    48 +
    (
      overtimePeriods *
      5
    );


  const pace =
    averagePossessions *
    (
      48 /
      gameMinutes
    );


  return Number(
    pace.toFixed(3)
  );
}


// ============================================================
// FETCH NBA BOXSCORES BY DATE
// ============================================================

async function getNBABoxscoresForDate(
  date
) {

  const url =
    "https://api.balldontlie.io/v1/box_scores" +
    `?date=${encodeURIComponent(date)}`;


  const response =
    await fetchBalldontlie(
      url
    );


  return Array.isArray(
    response?.data
  )
    ? response.data
    : [];
}


// ============================================================
// SYNC MISSING NBA STATS
// ============================================================

async function syncNBAStatsToSupabase(
  season,
  maxDates = 5
) {

  // ==========================================================
  // SOLAMENTE PARTIDOS SIN STATS
  // ==========================================================

  const {
    data: pendingGames,
    error: pendingError
  } =
    await supabaseAdmin
      .from("nba_games")
      .select(
        `
          game_id,
          season,
          game_date,
          home_team_id,
          visitor_team_id,
          home_team_name,
          visitor_team_name,
          home_score,
          visitor_score
        `
      )
      .eq(
        "season",
        Number(season)
      )
      .eq(
        "stats_complete",
        false
      )
      .order(
        "game_date",
        {
          ascending: true
        }
      )
      .limit(500);


  if (
    pendingError
  ) {
    throw new Error(
      `Supabase pending NBA stats: ${pendingError.message}`
    );
  }


  if (
    !pendingGames?.length
  ) {

    const paceResult =
      await rebuildNBATeamPace(
        season
      );


    return {
      selectedDates: [],
      gamesProcessed: 0,
      gamesSaved: 0,
      remaining: 0,
      paceRebuilt: true,
      paceTeams:
        paceResult.teams
    };
  }


  // ==========================================================
  // AGRUPAR POR FECHA NBA
  // ==========================================================

  const gamesByDate =
    new Map();


  for (
    const game
    of pendingGames
  ) {

    const nbaDate =
      getNBACalendarDate(
        game.game_date
      );


    if (
      !nbaDate
    ) {
      continue;
    }


    if (
      !gamesByDate.has(
        nbaDate
      )
    ) {
      gamesByDate.set(
        nbaDate,
        []
      );
    }


    gamesByDate
      .get(nbaDate)
      .push(game);
  }


  const selectedDates =
    Array.from(
      gamesByDate.keys()
    )
      .sort()
      .slice(
        0,
        maxDates
      );


  let gamesProcessed =
    0;

  let gamesSaved =
    0;

  let unmatched =
    0;


  const updateRows =
    [];


  // ==========================================================
  // DESCARGAR CADA FECHA
  // ==========================================================

  for (
    const nbaDate
    of selectedDates
  ) {

    const boxscores =
      await getNBABoxscoresForDate(
        nbaDate
      );


    const dateGames =
      gamesByDate.get(
        nbaDate
      ) || [];


    for (
      const dbGame
      of dateGames
    ) {

      gamesProcessed++;


      const boxscore =
        boxscores.find(
          box =>

            Number(
              box?.home_team?.id
            ) ===
              Number(
                dbGame.home_team_id
              ) &&

            Number(
              box?.visitor_team?.id
            ) ===
              Number(
                dbGame.visitor_team_id
              )
        );


      if (
        !boxscore
      ) {
        unmatched++;
        continue;
      }


      const homeStats =
        getNBABoxscoreTeamTotals(
          boxscore.home_team
        );


      const visitorStats =
        getNBABoxscoreTeamTotals(
          boxscore.visitor_team
        );


      const homePossessions =
        calculateNBAPossessions(
          homeStats
        );


      const visitorPossessions =
        calculateNBAPossessions(
          visitorStats
        );


      // Protección contra boxscores
      // incompletos o vacíos.
      if (
        homeStats.fga <= 0 ||
        visitorStats.fga <= 0 ||
        homePossessions <= 0 ||
        visitorPossessions <= 0
      ) {
        unmatched++;
        continue;
      }


      const gamePace =
        calculateNBAGamePace(
          homePossessions,
          visitorPossessions,
          boxscore.period
        );


      updateRows.push({

        game_id:
          Number(
            dbGame.game_id
          ),

        season:
          Number(
            dbGame.season
          ),

        game_date:
          dbGame.game_date,

        home_team_id:
          Number(
            dbGame.home_team_id
          ),

        visitor_team_id:
          Number(
            dbGame.visitor_team_id
          ),

        home_team_name:
          dbGame.home_team_name,

        visitor_team_name:
          dbGame.visitor_team_name,

        home_score:
          Number(
            dbGame.home_score
          ),

        visitor_score:
          Number(
            dbGame.visitor_score
          ),


        home_fga:
          homeStats.fga,

        home_oreb:
          homeStats.oreb,

        home_tov:
          homeStats.tov,

        home_fta:
          homeStats.fta,


        visitor_fga:
          visitorStats.fga,

        visitor_oreb:
          visitorStats.oreb,

        visitor_tov:
          visitorStats.tov,

        visitor_fta:
          visitorStats.fta,


        home_possessions:
          homePossessions,

        visitor_possessions:
          visitorPossessions,

        game_pace:
          gamePace,

        stats_complete:
          true,

        synced_at:
          new Date()
            .toISOString()

      });
    }
  }


  // ==========================================================
  // UN SOLO UPSERT A SUPABASE
  // ==========================================================

  if (
    updateRows.length
  ) {

    const {
      error: updateError
    } =
      await supabaseAdmin
        .from("nba_games")
        .upsert(
          updateRows,
          {
            onConflict:
              "game_id"
          }
        );


    if (
      updateError
    ) {
      throw new Error(
        `Supabase NBA stats upsert: ${updateError.message}`
      );
    }


    gamesSaved =
      updateRows.length;
  }


  // ==========================================================
  // CUÁNTOS FALTAN
  // ==========================================================

  const {
    count: remaining,
    error: countError
  } =
    await supabaseAdmin
      .from("nba_games")
      .select(
        "game_id",
        {
          count:
            "exact",

          head:
            true
        }
      )
      .eq(
        "season",
        Number(season)
      )
      .eq(
        "stats_complete",
        false
      );


  if (
    countError
  ) {
    throw new Error(
      `Supabase remaining NBA stats: ${countError.message}`
    );
  }


  let paceRebuilt =
    false;

  let paceTeams =
    0;


  // ==========================================================
  // CUANDO TERMINÓ EL BACKFILL,
  // CONSTRUIR SEASON PACE + PACE EDGE
  // ==========================================================

  if (
    Number(remaining || 0) === 0
  ) {

    const paceResult =
      await rebuildNBATeamPace(
        season
      );


    paceRebuilt =
      true;

    paceTeams =
      paceResult.teams;
  }


  return {

    selectedDates,

    gamesProcessed,

    gamesSaved,

    unmatched,

    remaining:
      Number(
        remaining || 0
      ),

    paceRebuilt,

    paceTeams

  };
}


// ============================================================
// READ ALL COMPLETED PACE GAMES
// ============================================================

async function getAllNBAPaceGames(
  season
) {

  const allGames =
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
        .from("nba_games")
        .select(
          `
            game_id,
            season,
            game_date,
            home_team_id,
            visitor_team_id,
            home_team_name,
            visitor_team_name,
            game_pace
          `
        )
        .eq(
          "season",
          Number(season)
        )
        .eq(
          "stats_complete",
          true
        )
        .order(
          "game_date",
          {
            ascending: true
          }
        )
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
        `Supabase NBA pace games: ${error.message}`
      );
    }


    const rows =
      data || [];


    allGames.push(
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


  return allGames;
}


// ============================================================
// AVERAGE
// ============================================================

function nbaAverage(
  values
) {

  const valid =
    values
      .map(Number)
      .filter(
        Number.isFinite
      );


  if (
    !valid.length
  ) {
    return null;
  }


  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    valid.length
  );
}


// ============================================================
// REBUILD SEASON PACE + PACE EDGE
// ============================================================
//
// MUY IMPORTANTE:
//
// Para calcular el PACE EDGE de un partido,
// miramos el PACE que el rival llevaba
// ANTES de ese partido.
//
// Nunca usamos el PACE final de temporada
// del rival para reconstruir un juego viejo.
//
// Ejemplo:
//
// rival pregame pace = 102
// actual game pace   = 98
//
// pace edge = -4
//
// ============================================================

async function rebuildNBATeamPace(
  season
) {

  const games =
    await getAllNBAPaceGames(
      season
    );


  const teams =
    new Map();


  function ensureTeam(
    teamId,
    teamName
  ) {

    const id =
      Number(teamId);


    if (
      !teams.has(id)
    ) {
      teams.set(
        id,
        {
          teamId:
            id,

          teamName:
            teamName,

          gamePaces:
            [],

          paceEdges:
            []
        }
      );
    }


    return teams.get(
      id
    );
  }


  // ==========================================================
  // RECORRER CRONOLÓGICAMENTE
  // ==========================================================

  for (
    const game
    of games
  ) {

    const gamePace =
      Number(
        game.game_pace
      );


    if (
      !Number.isFinite(
        gamePace
      )
    ) {
      continue;
    }


    const home =
      ensureTeam(
        game.home_team_id,
        game.home_team_name
      );


    const visitor =
      ensureTeam(
        game.visitor_team_id,
        game.visitor_team_name
      );


    // ========================================================
    // PACE DEL RIVAL ANTES DEL PARTIDO
    // ========================================================

    const visitorPregamePace =
      nbaAverage(
        visitor.gamePaces
      );


    const homePregamePace =
      nbaAverage(
        home.gamePaces
      );


    // ========================================================
    // HOME PACE EDGE
    // ========================================================
    //
    // ¿Cuánto cambió el ritmo normal
    // que traía el rival?
    // ========================================================

    if (
      Number.isFinite(
        visitorPregamePace
      )
    ) {
      home.paceEdges.push(
        gamePace -
        visitorPregamePace
      );
    }


    // ========================================================
    // VISITOR PACE EDGE
    // ========================================================

    if (
      Number.isFinite(
        homePregamePace
      )
    ) {
      visitor.paceEdges.push(
        gamePace -
        homePregamePace
      );
    }


    // ========================================================
    // IMPORTANTE:
    //
    // Guardamos el juego actual DESPUÉS
    // de calcular el edge.
    //
    // Así no entra información futura
    // ni el propio partido dentro del
    // promedio pregame.
    // ========================================================

    home.gamePaces.push(
      gamePace
    );


    visitor.gamePaces.push(
      gamePace
    );
  }


  const rows =
    [];


  for (
    const team
    of teams.values()
  ) {

    const seasonPace =
      nbaAverage(
        team.gamePaces
      );


    const paceEdge =
      nbaAverage(
        team.paceEdges
      );


    rows.push({

      season:
        Number(season),

      team_id:
        team.teamId,

      team_name:
        team.teamName,

      games_count:
        team.gamePaces.length,

      pace_edge_games:
        team.paceEdges.length,

      season_pace:
        seasonPace === null
          ? null
          : Number(
              seasonPace.toFixed(3)
            ),

      pace_edge:
        paceEdge === null
          ? null
          : Number(
              paceEdge.toFixed(3)
            ),

      updated_at:
        new Date()
          .toISOString()

    });
  }


  if (
    rows.length
  ) {

    const {
      error
    } =
      await supabaseAdmin
        .from(
          "nba_team_pace"
        )
        .upsert(
          rows,
          {
            onConflict:
              "season,team_id"
          }
        );


    if (
      error
    ) {
      throw new Error(
        `Supabase nba_team_pace: ${error.message}`
      );
    }
  }


  return {
    teams:
      rows.length
  };
}
// ============================================================
// BALLDONTLIE FETCH
// ============================================================

async function fetchBalldontlie(
  url
) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          headers: {
            Authorization:
              process.env
                .BALLDONTLIE_API_KEY
          },

          signal:
            controller.signal
        }
      );


    const text =
      await response.text();


    if (
      !response.ok
    ) {
      throw new Error(
        `BallDontLie error ${response.status}: ${text}`
      );
    }


    return JSON.parse(
      text
    );


  } catch (error) {

    if (
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "Timeout BallDontLie"
      );
    }


    throw error;


  } finally {

    clearTimeout(
      timeout
    );
  }
}

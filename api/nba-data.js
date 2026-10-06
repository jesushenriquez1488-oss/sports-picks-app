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


const authorizationHeader =
  String(
    req.headers.authorization ||
    ""
  );


const bearerSecret =
  authorizationHeader.startsWith(
    "Bearer "
  )
    ? authorizationHeader.slice(7)
    : "";


const headerSecret =
  String(
    req.headers[
      "x-internal-secret"
    ] ||
    ""
  );


const querySecret =
  String(
    req.query.secret ||
    ""
  );


const isInternal =
  Boolean(validSecret) &&
  (
    bearerSecret === validSecret ||
    headerSecret === validSecret ||
    querySecret === validSecret
  );

// ======================================================
// NBA DAILY MAINTENANCE
// ======================================================
//
// Flujo automático:
//
// 1. Sincroniza juegos NBA terminados recientes.
// 2. Descarga stats faltantes.
// 3. Calcula posesiones + game pace.
// 4. Si no quedan stats pendientes,
//    reconstruye nba_team_pace.
//
// NO corre durante análisis normales.
// ======================================================

if (
  type === "maintenance"
) {

  if (
    !isInternal
  ) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized maintenance"
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


  const gameSync =
    await syncSeasonToSupabase(
      CURRENT_SEASON,
      {
        full: false
      }
    );


  const statsSync =
    await syncNBAStatsToSupabase(
      CURRENT_SEASON,
      5
    );


  return res
    .status(200)
    .json({

      ok: true,

      mode:
        "maintenance",

      season:
        CURRENT_SEASON,

      gameSync,

      statsSync

    });
}
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
// NBA PLAYER HISTORY BACKFILL
// ======================================================

if (
  type === "sync-player-stats"
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
      : PREVIOUS_SEASON;


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
    Number(
      limit || 3
    );


  const maxDates =
    Number.isFinite(
      requestedLimit
    )
      ? Math.min(
          5,
          Math.max(
            1,
            Math.floor(
              requestedLimit
            )
          )
        )
      : 3;


  const result =
    await syncNBAPlayerHistoryToSupabase(
      requestedSeason,
      maxDates
    );


  return res
    .status(200)
    .json({

      ok: true,

      mode:
        "sync-player-stats",

      season:
        requestedSeason,

      ...result

    });
}
      // ======================================================
// REBUILD NBA PLAYER ABSENCE IMPACT
// ======================================================
//
// Solo uso interno.
//
// Usa únicamente históricos ya guardados en Supabase:
// - nba_games
// - nba_player_game_stats
//
// NO llama BallDontLie.
// NO cambia proyecciones ni picks.
// ======================================================

if (
  type === "rebuild-absence-impact"
) {

  if (
    !isInternal
  ) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized rebuild"
      });
  }


  const requestedSeason =
    season !== undefined &&
    season !== null &&
    season !== ""
      ? Number(season)
      : PREVIOUS_SEASON;


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


  const result =
    await rebuildNBAPlayerAbsenceImpact(
      requestedSeason
    );


  return res
    .status(200)
    .json({

      ok: true,

      mode:
        "rebuild-absence-impact",

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
postseason:
  game?.postseason === true,

ist_stage:
  game?.ist_stage ??
  null,
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

function getNBAPlayerStatTotals(
  playerStats
) {

  const rows =
    Array.isArray(
      playerStats
    )
      ? playerStats
      : [];


  let fga = 0;
  let oreb = 0;
  let tov = 0;
  let fta = 0;


  for (
    const stat
    of rows
  ) {

    fga +=
      nbaStatNumber(
        stat?.fga
      );


    oreb +=
      nbaStatNumber(
        stat?.oreb
      );


    tov +=
      nbaStatNumber(
        stat?.turnover ??
        stat?.tov
      );


    fta +=
      nbaStatNumber(
        stat?.fta
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

async function getNBAPlayerStatsForDate(
  date
) {

  const allStats =
    [];


  let cursor =
    null;


  let pageCount =
    0;


  do {

    const params =
      new URLSearchParams();


    params.append(
      "dates[]",
      String(date)
    );


    params.set(
      "per_page",
      "100"
    );


    // 0 = stats completas del juego.
    params.set(
      "period",
      "0"
    );


    if (
      cursor
    ) {
      params.set(
        "cursor",
        String(cursor)
      );
    }


    const url =
      "https://api.balldontlie.io/v1/stats?" +
      params.toString();


    const response =
      await fetchBalldontlie(
        url
      );


    const rows =
      Array.isArray(
        response?.data
      )
        ? response.data
        : [];


    allStats.push(
      ...rows
    );


    cursor =
      response
        ?.meta
        ?.next_cursor ||
      null;


    pageCount++;


    if (
      pageCount > 20
    ) {
      throw new Error(
        `NBA stats pagination exceeded 20 pages for ${date}`
      );
    }


  } while (
    cursor
  );


  return allStats;
}
// ============================================================
// NBA PLAYER GAME HISTORY
// ============================================================

function parseNBAPlayerMinutes(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }


  const raw =
    String(value).trim();


  // Ejemplo:
  // "34:30" = 34.5 minutos
  if (
    raw.includes(":")
  ) {

    const [
      minutesRaw,
      secondsRaw
    ] =
      raw.split(":");


    const minutes =
      Number(minutesRaw);

    const seconds =
      Number(secondsRaw);


    if (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds)
    ) {
      return Number(
        (
          minutes +
          seconds / 60
        ).toFixed(2)
      );
    }
  }


  const numeric =
    Number(raw);


  return Number.isFinite(numeric)
    ? Number(
        numeric.toFixed(2)
      )
    : 0;
}


// ============================================================
// CONVERTIR PLAYER STATS DE BDL → SUPABASE
// ============================================================

function buildNBAPlayerGameRows(
  playerStats,
  games,
  season
) {

  const gameMap =
    new Map(
      (games || [])
        .map(
          game => [
            Number(
              game.game_id
            ),
            game
          ]
        )
    );


  const rows =
    new Map();


  for (
    const stat
    of playerStats || []
  ) {

    const gameId =
      Number(
        stat?.game?.id
      );

    const playerId =
      Number(
        stat?.player?.id
      );

    const teamId =
      Number(
        stat?.team?.id ??
        stat?.player?.team_id
      );


    if (
      !Number.isFinite(gameId) ||
      !Number.isFinite(playerId) ||
      !Number.isFinite(teamId)
    ) {
      continue;
    }


    const game =
      gameMap.get(
        gameId
      );


    if (
      !game
    ) {
      continue;
    }


    // Protección:
    // solamente jugadores de los dos equipos
    // que pertenecen al partido guardado.
    if (
      teamId !==
        Number(
          game.home_team_id
        ) &&
      teamId !==
        Number(
          game.visitor_team_id
        )
    ) {
      continue;
    }


    const minutes =
      parseNBAPlayerMinutes(
        stat?.min
      );


    // DNP / jugador que no participó.
    // La ausencia se representa precisamente
    // porque NO existe fila para ese juego.
    if (
      minutes <= 0
    ) {
      continue;
    }


    const firstName =
      String(
        stat?.player?.first_name ||
        ""
      ).trim();

    const lastName =
      String(
        stat?.player?.last_name ||
        ""
      ).trim();

    const playerName =
      `${firstName} ${lastName}`
        .trim();


    if (
      !playerName
    ) {
      continue;
    }


    const row = {

      game_id:
        gameId,

      season:
        Number(season),

      game_date:
        game.game_date,

      team_id:
        teamId,

      player_id:
        playerId,

      player_name:
        playerName,

      minutes:
        minutes,

      points:
        Math.round(
          nbaStatNumber(
            stat?.pts
          )
        ),

      rebounds:
        Math.round(
          nbaStatNumber(
            stat?.reb
          )
        ),

      assists:
        Math.round(
          nbaStatNumber(
            stat?.ast
          )
        ),

      synced_at:
        new Date()
          .toISOString()

    };


    rows.set(
      `${gameId}:${playerId}`,
      row
    );
  }


  return Array.from(
    rows.values()
  );
}


// ============================================================
// GUARDAR PLAYER GAME STATS
// ============================================================

async function saveNBAPlayerGameRows(
  rows
) {

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return 0;
  }


  let saved =
    0;


  // Evitamos mandar payloads enormes
  // a Supabase.
  const chunkSize =
    500;


  for (
    let index = 0;
    index < rows.length;
    index += chunkSize
  ) {

    const chunk =
      rows.slice(
        index,
        index + chunkSize
      );


    const {
      error
    } =
      await supabaseAdmin
        .from(
          "nba_player_game_stats"
        )
        .upsert(
          chunk,
          {
            onConflict:
              "game_id,player_id"
          }
        );


    if (
      error
    ) {
      throw new Error(
        `Supabase nba_player_game_stats: ${error.message}`
      );
    }


    saved +=
      chunk.length;
  }


  return saved;
}


// ============================================================
// HISTORICAL PLAYER STATS BACKFILL
// ============================================================
// Procesa pocas fechas por llamada.
// Diseñado principalmente para llenar 2025.
// También puede usarse para completar 2026 si hiciera falta.
// ============================================================

async function syncNBAPlayerHistoryToSupabase(
  season,
  maxDates = 3
) {

  const numericSeason =
    Number(season);


  // ==========================================================
  // ÚLTIMO PARTIDO YA GUARDADO
  // ==========================================================

  const {
    data: lastRows,
    error: lastError
  } =
    await supabaseAdmin
      .from(
        "nba_player_game_stats"
      )
      .select(
        "game_date"
      )
      .eq(
        "season",
        numericSeason
      )
      .order(
        "game_date",
        {
          ascending: false
        }
      )
      .limit(1);


  if (
    lastError
  ) {
    throw new Error(
      `Supabase player history progress: ${lastError.message}`
    );
  }


  const lastGameDate =
    lastRows?.[0]?.game_date ||
    null;


  // ==========================================================
  // SIGUIENTES JUEGOS
  // ==========================================================

  let query =
    supabaseAdmin
      .from(
        "nba_games"
      )
      .select(
        `
          game_id,
          season,
          game_date,
          home_team_id,
          visitor_team_id,
          home_team_name,
          visitor_team_name
        `
      )
      .eq(
        "season",
        numericSeason
      )
      .eq(
        "postseason",
        false
      )
      .or(
        "ist_stage.is.null,ist_stage.neq.Championship"
      )
      .order(
        "game_date",
        {
          ascending: true
        }
      )
      .limit(150);


  if (
    lastGameDate
  ) {
    query =
      query.gt(
        "game_date",
        lastGameDate
      );
  }


  const {
    data: games,
    error: gamesError
  } =
    await query;


  if (
    gamesError
  ) {
    throw new Error(
      `Supabase NBA player history games: ${gamesError.message}`
    );
  }


  if (
    !games?.length
  ) {
    return {
      selectedDates: [],
      gamesProcessed: 0,
      playerRowsSaved: 0,
      completed: true,
      lastGameDate
    };
  }


  // ==========================================================
  // AGRUPAR POR FECHA NBA
  // ==========================================================

  const gamesByDate =
    new Map();


  for (
    const game
    of games
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

  let playerRowsSaved =
    0;


  // ==========================================================
  // DESCARGAR + GUARDAR
  // ==========================================================

  for (
    const nbaDate
    of selectedDates
  ) {

    const dateGames =
      gamesByDate.get(
        nbaDate
      ) || [];


    const playerStats =
      await getNBAPlayerStatsForDate(
        nbaDate
      );


    // Validamos que BallDontLie realmente
    // devolvió stats para cada partido.
    const expectedGameIds =
      new Set(
        dateGames.map(
          game =>
            Number(
              game.game_id
            )
        )
      );


    const returnedGameIds =
      new Set(
        (playerStats || [])
          .map(
            stat =>
              Number(
                stat?.game?.id
              )
          )
          .filter(
            gameId =>
              expectedGameIds.has(
                gameId
              )
          )
      );


    const missingGameIds =
      Array.from(
        expectedGameIds
      )
        .filter(
          gameId =>
            !returnedGameIds.has(
              gameId
            )
        );


    if (
      missingGameIds.length
    ) {
      throw new Error(
        `Missing BallDontLie player stats for ${nbaDate}: ${missingGameIds.join(", ")}`
      );
    }


    const rows =
      buildNBAPlayerGameRows(
        playerStats,
        dateGames,
        numericSeason
      );


    if (
      !rows.length
    ) {
      throw new Error(
        `No NBA player rows generated for ${nbaDate}`
      );
    }


    playerRowsSaved +=
      await saveNBAPlayerGameRows(
        rows
      );


    gamesProcessed +=
      dateGames.length;
  }


  return {

    selectedDates,

    gamesProcessed,

    playerRowsSaved,

    completed:
      selectedDates.length === 0,

    lastProcessedDate:
      selectedDates[
        selectedDates.length - 1
      ] || null

  };
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
.eq(
  "postseason",
  false
)
.or(
  "ist_stage.is.null,ist_stage.neq.Championship"
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
  playerRowsSaved: 0,
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

let playerRowsSaved =
  0;

let unmatched =
  0;


const updateRows =
  [];

const playerUpdateRows =
  [];


  // ==========================================================
  // DESCARGAR CADA FECHA
  // ==========================================================

  for (
    const nbaDate
    of selectedDates
  ) {

    const playerStats =
  await getNBAPlayerStatsForDate(
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


   const gameStats =
  playerStats.filter(
    stat =>
      Number(
        stat?.game?.id
      ) ===
      Number(
        dbGame.game_id
      )
  );


if (
  !gameStats.length
) {
  unmatched++;
  continue;
}


// ==========================================================
// SEPARAR JUGADORES POR EQUIPO
// ==========================================================

const homePlayerStats =
  gameStats.filter(
    stat =>

      Number(
        stat?.team?.id ??
        stat?.player?.team_id
      ) ===
      Number(
        dbGame.home_team_id
      )
  );


const visitorPlayerStats =
  gameStats.filter(
    stat =>

      Number(
        stat?.team?.id ??
        stat?.player?.team_id
      ) ===
      Number(
        dbGame.visitor_team_id
      )
  );


if (
  !homePlayerStats.length ||
  !visitorPlayerStats.length
) {
  unmatched++;
  continue;
}


const homeStats =
  getNBAPlayerStatTotals(
    homePlayerStats
  );


const visitorStats =
  getNBAPlayerStatTotals(
    visitorPlayerStats
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

// ==========================================================
// PLAYER GAME HISTORY
// ==========================================================
// Guardamos solamente jugadores de partidos
// que ya pasaron las validaciones del boxscore.
//
// Reutilizamos gameStats.
// NO hacemos otra llamada a BallDontLie.
// ==========================================================

const playerGameRows =
  buildNBAPlayerGameRows(
    gameStats,
    [dbGame],
    season
  );


playerUpdateRows.push(
  ...playerGameRows
);
     const gamePeriod =
  Number(
    gameStats?.[0]
      ?.game
      ?.period ||
    4
  );


const gamePace =
  calculateNBAGamePace(
    homePossessions,
    visitorPossessions,
    gamePeriod
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
// GUARDAR PLAYER GAME HISTORY
// ==========================================================
// Primero guardamos los jugadores.
//
// Si esto falla, NO marcamos todavía
// nba_games como stats_complete.
// Así el maintenance podrá reintentarlo.
// ==========================================================

if (
  playerUpdateRows.length
) {
  playerRowsSaved =
    await saveNBAPlayerGameRows(
      playerUpdateRows
    );
}


// ==========================================================
// UN SOLO UPSERT A SUPABASE
// ==========================================================
// Solo después de guardar correctamente
// el historial de jugadores marcamos
// los juegos como stats_complete.
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
)
.eq(
  "postseason",
  false
)
.or(
  "ist_stage.is.null,ist_stage.neq.Championship"
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

  playerRowsSaved,

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
// NBA PLAYER ABSENCE IMPACT
// ============================================================
//
// Una fila por:
// season + team_id + player_id
//
// Todos los jugadores aparecen como target.
//
// Ausencia:
// si NO existe fila en nba_player_game_stats
// para ese jugador en ese partido.
//
// Solo contamos juegos entre first_seen y last_seen
// para no convertir partidos fuera de su etapa
// con el equipo en falsas ausencias.
// ============================================================

async function getAllNBAAbsenceGames(
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
            home_score,
            visitor_score,
            game_pace,
            postseason,
            ist_stage
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
        .eq(
          "postseason",
          false
        )
        .or(
          "ist_stage.is.null,ist_stage.neq.Championship"
        )
        .not(
          "game_pace",
          "is",
          null
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
        `Supabase NBA absence games: ${error.message}`
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
// READ ALL PLAYER HISTORY
// ============================================================

async function getAllNBAPlayerHistoryRows(
  season
) {

  const allRows =
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
        .from(
          "nba_player_game_stats"
        )
        .select(
          `
            game_id,
            season,
            game_date,
            team_id,
            player_id,
            player_name,
            minutes,
            points,
            rebounds,
            assists
          `
        )
        .eq(
          "season",
          Number(season)
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
        `Supabase NBA player history read: ${error.message}`
      );
    }


    const rows =
      data || [];


    allRows.push(
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


  return allRows;
}


// ============================================================
// SAFE ROUND
// ============================================================

function nbaRoundOrNull(
  value,
  digits = 3
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const numeric =
    Number(value);


  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }


  return Number(
    numeric.toFixed(
      digits
    )
  );
}


// ============================================================
// NBA DATE DIFFERENCE
// ============================================================

function nbaDateDifference(
  currentDate,
  previousDate
) {

  if (
    !currentDate ||
    !previousDate
  ) {
    return null;
  }


  const current =
    Date.parse(
      `${currentDate}T00:00:00Z`
    );

  const previous =
    Date.parse(
      `${previousDate}T00:00:00Z`
    );


  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return null;
  }


  return Math.round(
    (
      current -
      previous
    ) /
    86400000
  );
}


// ============================================================
// AVERAGE FIELD
// ============================================================

function nbaAverageField(
  rows,
  field
) {

  const values =
    (rows || [])
      .map(
        row =>
          row?.[field]
      )
      .filter(
        value =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          Number.isFinite(
            Number(value)
          )
      )
      .map(Number);


  if (
    !values.length
  ) {
    return null;
  }


  return nbaAverage(
    values
  );
}


// ============================================================
// SAMPLE LABEL
// ============================================================
//
// Esto NO modifica el impacto.
//
// Solo nos dice cuánto histórico tenemos.
// ============================================================

function nbaReliabilityLabel(
  gamesWithout,
  matchedWeight
) {

  const absences =
    Number(
      gamesWithout || 0
    );

  const weight =
    Number(
      matchedWeight || 0
    );


  if (
    absences >= 15 &&
    weight >= 10
  ) {
    return "HIGH";
  }


  if (
    absences >= 8 &&
    weight >= 6
  ) {
    return "MEDIUM";
  }


  if (
    absences >= 5
  ) {
    return "LOW";
  }


  return "VERY LOW";
}


// ============================================================
// REBUILD PLAYER ABSENCE IMPACT
// ============================================================

async function rebuildNBAPlayerAbsenceImpact(
  season
) {

  const numericSeason =
    Number(season);


  const [
    games,
    playerRows
  ] =
    await Promise.all([

      getAllNBAAbsenceGames(
        numericSeason
      ),

      getAllNBAPlayerHistoryRows(
        numericSeason
      )

    ]);


  if (
    !games.length ||
    !playerRows.length
  ) {
    return {

      games:
        games.length,

      playerHistoryRows:
        playerRows.length,

      players:
        0,

      rowsSaved:
        0

    };
  }


  // ==========================================================
  // HOME ADVANTAGE REAL DE LA TEMPORADA
  // ==========================================================

  const homeEdge =
    nbaAverage(
      games.map(
        game =>
          Number(
            game.home_score
          ) -
          Number(
            game.visitor_score
          )
      )
    ) || 0;


  // ==========================================================
  // CONTEXTO PRE-GAME
  // ==========================================================
  //
  // Lo hacemos cronológicamente.
  //
  // El partido actual nunca entra dentro
  // de su propio promedio pre-game.
  // ==========================================================

  const teamState =
    new Map();


  const teamGames =
    [];


  function getTeamState(
    teamId
  ) {

    const id =
      Number(teamId);


    if (
      !teamState.has(id)
    ) {

      teamState.set(
        id,
        {

          ortgValues:
            [],

          drtgValues:
            [],

          previousNbaDate:
            null

        }
      );
    }


    return teamState.get(id);
  }


  for (
    const game
    of games
  ) {

    const pace =
      Number(
        game.game_pace
      );


    const homeScore =
      Number(
        game.home_score
      );


    const visitorScore =
      Number(
        game.visitor_score
      );


    if (
      !Number.isFinite(pace) ||
      pace <= 0 ||
      !Number.isFinite(homeScore) ||
      !Number.isFinite(visitorScore)
    ) {
      continue;
    }


    const nbaDate =
      getNBACalendarDate(
        game.game_date
      );


    if (
      !nbaDate
    ) {
      continue;
    }


    const homeTeamId =
      Number(
        game.home_team_id
      );


    const visitorTeamId =
      Number(
        game.visitor_team_id
      );


    const homeState =
      getTeamState(
        homeTeamId
      );


    const visitorState =
      getTeamState(
        visitorTeamId
      );


    const homePreOrtg =
      nbaAverage(
        homeState.ortgValues
      );


    const homePreDrtg =
      nbaAverage(
        homeState.drtgValues
      );


    const visitorPreOrtg =
      nbaAverage(
        visitorState.ortgValues
      );


    const visitorPreDrtg =
      nbaAverage(
        visitorState.drtgValues
      );


    // ========================================================
    // REAL ORTG / DRTG DEL PARTIDO
    // ========================================================

    const homeOrtg =
      100 *
      homeScore /
      pace;


    const homeDrtg =
      100 *
      visitorScore /
      pace;


    const visitorOrtg =
      100 *
      visitorScore /
      pace;


    const visitorDrtg =
      100 *
      homeScore /
      pace;


    // ========================================================
    // REST
    // ========================================================

    const homeRestDays =
      nbaDateDifference(
        nbaDate,
        homeState.previousNbaDate
      );


    const visitorRestDays =
      nbaDateDifference(
        nbaDate,
        visitorState.previousNbaDate
      );


    let homeRestMargin =
      0;


    if (
      homeRestDays === 1 &&
      visitorRestDays === 2
    ) {

      homeRestMargin =
        -2;

    } else if (
      homeRestDays === 1 &&
      visitorRestDays !== null &&
      visitorRestDays >= 3
    ) {

      homeRestMargin =
        -3;

    } else if (
      visitorRestDays === 1 &&
      homeRestDays === 2
    ) {

      homeRestMargin =
        2;

    } else if (
      visitorRestDays === 1 &&
      homeRestDays !== null &&
      homeRestDays >= 3
    ) {

      homeRestMargin =
        3;
    }


    const visitorRestMargin =
      -homeRestMargin;


    // ========================================================
    // NECESITAMOS 5 JUEGOS PREVIOS
    // PARA EL RESULTADO CONTROLADO
    // ========================================================

    const matureContext =
      homeState.ortgValues.length >= 5 &&
      visitorState.ortgValues.length >= 5 &&
      Number.isFinite(homePreOrtg) &&
      Number.isFinite(homePreDrtg) &&
      Number.isFinite(visitorPreOrtg) &&
      Number.isFinite(visitorPreDrtg);


    // ========================================================
    // EXPECTED OFFENSE / DEFENSE
    // ========================================================

    const homeExpectedFor =
      matureContext
        ? (
            (
              homePreOrtg +
              visitorPreDrtg
            ) /
            2
          ) *
          pace /
          100
        : null;


    const homeExpectedAgainst =
      matureContext
        ? (
            (
              visitorPreOrtg +
              homePreDrtg
            ) /
            2
          ) *
          pace /
          100
        : null;


    const visitorExpectedFor =
      matureContext
        ? homeExpectedAgainst
        : null;


    const visitorExpectedAgainst =
      matureContext
        ? homeExpectedFor
        : null;


    // ========================================================
    // HOME TEAM ROW
    // ========================================================

    teamGames.push({

      gameId:
        Number(
          game.game_id
        ),

      gameDate:
        game.game_date,

      nbaDate,

      teamId:
        homeTeamId,

      opponentId:
        visitorTeamId,

      isHome:
        true,

      pointsFor:
        homeScore,

      pointsAgainst:
        visitorScore,

      pace,

      ortg:
        homeOrtg,

      drtg:
        homeDrtg,

      opponentStrength:
        matureContext
          ? visitorPreOrtg -
            visitorPreDrtg
          : null,

      offenseResidual:
        matureContext
          ? homeScore -
            homeExpectedFor
          : null,

      defenseResidual:
        matureContext
          ? visitorScore -
            homeExpectedAgainst
          : null,

      marginResidual:
        matureContext
          ? (
              homeScore -
              visitorScore
            ) -
            (
              homeExpectedFor -
              homeExpectedAgainst +
              homeEdge +
              homeRestMargin
            )
          : null,

      contextReady:
        matureContext

    });


    // ========================================================
    // VISITOR TEAM ROW
    // ========================================================

    teamGames.push({

      gameId:
        Number(
          game.game_id
        ),

      gameDate:
        game.game_date,

      nbaDate,

      teamId:
        visitorTeamId,

      opponentId:
        homeTeamId,

      isHome:
        false,

      pointsFor:
        visitorScore,

      pointsAgainst:
        homeScore,

      pace,

      ortg:
        visitorOrtg,

      drtg:
        visitorDrtg,

      opponentStrength:
        matureContext
          ? homePreOrtg -
            homePreDrtg
          : null,

      offenseResidual:
        matureContext
          ? visitorScore -
            visitorExpectedFor
          : null,

      defenseResidual:
        matureContext
          ? homeScore -
            visitorExpectedAgainst
          : null,

      marginResidual:
        matureContext
          ? (
              visitorScore -
              homeScore
            ) -
            (
              visitorExpectedFor -
              visitorExpectedAgainst -
              homeEdge +
              visitorRestMargin
            )
          : null,

      contextReady:
        matureContext

    });


    // ========================================================
    // ACTUALIZAR HISTÓRICO DESPUÉS DEL JUEGO
    // ========================================================

    homeState
      .ortgValues
      .push(
        homeOrtg
      );


    homeState
      .drtgValues
      .push(
        homeDrtg
      );


    homeState.previousNbaDate =
      nbaDate;


    visitorState
      .ortgValues
      .push(
        visitorOrtg
      );


    visitorState
      .drtgValues
      .push(
        visitorDrtg
      );


    visitorState.previousNbaDate =
      nbaDate;
  }


  // ==========================================================
  // PLAYER PROFILES + PARTICIPATION
  // ==========================================================

  const profiles =
    new Map();


  const participation =
    new Set();


  for (
    const row
    of playerRows
  ) {

    const teamId =
      Number(
        row.team_id
      );


    const playerId =
      Number(
        row.player_id
      );


    const gameId =
      Number(
        row.game_id
      );


    if (
      !Number.isFinite(teamId) ||
      !Number.isFinite(playerId) ||
      !Number.isFinite(gameId)
    ) {
      continue;
    }


    participation.add(
      `${gameId}:${teamId}:${playerId}`
    );


    const key =
      `${teamId}:${playerId}`;


    if (
      !profiles.has(key)
    ) {

      profiles.set(
        key,
        {

          teamId,

          playerId,

          playerName:
            String(
              row.player_name ||
              ""
            ),

          firstSeen:
            row.game_date,

          lastSeen:
            row.game_date,

          minutes:
            [],

          points:
            [],

          rebounds:
            [],

          assists:
            []

        }
      );
    }


    const profile =
      profiles.get(key);


    if (
      new Date(row.game_date) <
      new Date(profile.firstSeen)
    ) {

      profile.firstSeen =
        row.game_date;
    }


    if (
      new Date(row.game_date) >
      new Date(profile.lastSeen)
    ) {

      profile.lastSeen =
        row.game_date;
    }


    profile.minutes.push(
      Number(
        row.minutes || 0
      )
    );


    profile.points.push(
      Number(
        row.points || 0
      )
    );


    profile.rebounds.push(
      Number(
        row.rebounds || 0
      )
    );


    profile.assists.push(
      Number(
        row.assists || 0
      )
    );
  }


  // ==========================================================
  // COMPAÑEROS IMPORTANTES
  // ==========================================================
  //
  // IMPORTANTE:
  //
  // TODOS los jugadores entran en la tabla final.
  //
  // Este filtro SOLO sirve para medir
  // otras ausencias importantes simultáneas.
  // ==========================================================

  const importantByTeam =
    new Map();


  for (
    const profile
    of profiles.values()
  ) {

    const gamesPlayed =
      profile.minutes.length;


    const avgMinutes =
      nbaAverage(
        profile.minutes
      ) || 0;


    const avgPoints =
      nbaAverage(
        profile.points
      ) || 0;


    const avgRebounds =
      nbaAverage(
        profile.rebounds
      ) || 0;


    const avgAssists =
      nbaAverage(
        profile.assists
      ) || 0;


    profile.gamesPlayed =
      gamesPlayed;


    profile.avgMinutes =
      avgMinutes;


    profile.avgPoints =
      avgPoints;


    profile.avgRebounds =
      avgRebounds;


    profile.avgAssists =
      avgAssists;


    const important =
      gamesPlayed >= 20 &&
      avgMinutes >= 25 &&
      (
        avgPoints >= 12 ||
        avgAssists >= 5 ||
        avgRebounds >= 7
      );


    if (
      important
    ) {

      if (
        !importantByTeam.has(
          profile.teamId
        )
      ) {

        importantByTeam.set(
          profile.teamId,
          []
        );
      }


      importantByTeam
        .get(
          profile.teamId
        )
        .push(
          profile
        );
    }
  }


  // ==========================================================
  // TEAM GAMES MAP
  // ==========================================================

  const gamesByTeam =
    new Map();


  for (
    const game
    of teamGames
  ) {

    if (
      !gamesByTeam.has(
        game.teamId
      )
    ) {

      gamesByTeam.set(
        game.teamId,
        []
      );
    }


    gamesByTeam
      .get(
        game.teamId
      )
      .push(
        game
      );
  }


  const outputRows =
    [];


  // ==========================================================
  // CALCULAR PERFIL DE AUSENCIA DE CADA JUGADOR
  // ==========================================================

  for (
    const profile
    of profiles.values()
  ) {

    const firstTime =
      new Date(
        profile.firstSeen
      ).getTime();


    const lastTime =
      new Date(
        profile.lastSeen
      ).getTime();


    const relevantGames =
      (
        gamesByTeam.get(
          profile.teamId
        ) || []
      )
        .filter(
          game => {

            const gameTime =
              new Date(
                game.gameDate
              ).getTime();


            return (
              gameTime >= firstTime &&
              gameTime <= lastTime
            );
          }
        )
        .map(
          game => {

            const played =
              participation.has(
                `${game.gameId}:${profile.teamId}:${profile.playerId}`
              );


            const importantTeammates =
              importantByTeam.get(
                profile.teamId
              ) || [];


            let otherImportantAbsent =
              0;


            const gameTime =
              new Date(
                game.gameDate
              ).getTime();


            for (
              const teammate
              of importantTeammates
            ) {

              if (
                teammate.playerId ===
                profile.playerId
              ) {
                continue;
              }


              const teammateFirst =
                new Date(
                  teammate.firstSeen
                ).getTime();


              const teammateLast =
                new Date(
                  teammate.lastSeen
                ).getTime();


              if (
                gameTime <
                  teammateFirst ||
                gameTime >
                  teammateLast
              ) {
                continue;
              }


              const teammatePlayed =
                participation.has(
                  `${game.gameId}:${profile.teamId}:${teammate.playerId}`
                );


              if (
                !teammatePlayed
              ) {

                otherImportantAbsent++;
              }
            }


            return {

              ...game,

              played,

              otherImportantAbsent,

              totalPoints:
                game.pointsFor +
                game.pointsAgainst,

              margin:
                game.pointsFor -
                game.pointsAgainst

            };
          }
        );


    const withPlayer =
      relevantGames.filter(
        game =>
          game.played
      );


    const withoutPlayer =
      relevantGames.filter(
        game =>
          !game.played
      );


    // ========================================================
    // RAW CON / SIN
    // ========================================================

    const paceWith =
      nbaAverageField(
        withPlayer,
        "pace"
      );


    const paceWithout =
      nbaAverageField(
        withoutPlayer,
        "pace"
      );


    const ortgWith =
      nbaAverageField(
        withPlayer,
        "ortg"
      );


    const ortgWithout =
      nbaAverageField(
        withoutPlayer,
        "ortg"
      );


    const drtgWith =
      nbaAverageField(
        withPlayer,
        "drtg"
      );


    const drtgWithout =
      nbaAverageField(
        withoutPlayer,
        "drtg"
      );


    const teamPointsWith =
      nbaAverageField(
        withPlayer,
        "pointsFor"
      );


    const teamPointsWithout =
      nbaAverageField(
        withoutPlayer,
        "pointsFor"
      );


    const opponentPointsWith =
      nbaAverageField(
        withPlayer,
        "pointsAgainst"
      );


    const opponentPointsWithout =
      nbaAverageField(
        withoutPlayer,
        "pointsAgainst"
      );


    const totalWith =
      nbaAverageField(
        withPlayer,
        "totalPoints"
      );


    const totalWithout =
      nbaAverageField(
        withoutPlayer,
        "totalPoints"
      );


    const marginWith =
      nbaAverageField(
        withPlayer,
        "margin"
      );


    const marginWithout =
      nbaAverageField(
        withoutPlayer,
        "margin"
      );


    const opponentStrengthWith =
      nbaAverageField(
        withPlayer,
        "opponentStrength"
      );


    const opponentStrengthWithout =
      nbaAverageField(
        withoutPlayer,
        "opponentStrength"
      );


    const homePctWith =
      withPlayer.length
        ? 100 *
          withPlayer.filter(
            game =>
              game.isHome
          ).length /
          withPlayer.length
        : null;


    const homePctWithout =
      withoutPlayer.length
        ? 100 *
          withoutPlayer.filter(
            game =>
              game.isHome
          ).length /
          withoutPlayer.length
        : null;


    const otherAbsentWith =
      nbaAverageField(
        withPlayer,
        "otherImportantAbsent"
      );


    const otherAbsentWithout =
      nbaAverageField(
        withoutPlayer,
        "otherImportantAbsent"
      );


    // ========================================================
    // CONTROL POR CO-AUSENCIAS
    // ========================================================
    //
    // 0
    // 1
    // 2+
    //
    // Solo comparamos un bucket si existen:
    // >=2 juegos CON jugador
    // >=2 juegos SIN jugador
    // ========================================================

    const buckets =
      new Map([
        ["0", []],
        ["1", []],
        ["2+", []]
      ]);


    for (
      const game
      of relevantGames
    ) {

      if (
        !game.contextReady
      ) {
        continue;
      }


      const bucket =
        game.otherImportantAbsent === 0
          ? "0"
          : game.otherImportantAbsent === 1
            ? "1"
            : "2+";


      buckets
        .get(bucket)
        .push(
          game
        );
    }


    let matchedWeight =
      0;


    let offenseWeighted =
      0;


    let defenseWeighted =
      0;


    let marginWeighted =
      0;


    for (
      const bucketRows
      of buckets.values()
    ) {

      const bucketWith =
        bucketRows.filter(
          game =>
            game.played
        );


      const bucketWithout =
        bucketRows.filter(
          game =>
            !game.played
        );


      if (
        bucketWith.length < 2 ||
        bucketWithout.length < 2
      ) {
        continue;
      }


      const weight =
        Math.min(
          bucketWith.length,
          bucketWithout.length
        );


      const offenseChange =
        nbaAverageField(
          bucketWithout,
          "offenseResidual"
        ) -
        nbaAverageField(
          bucketWith,
          "offenseResidual"
        );


      const defenseChange =
        nbaAverageField(
          bucketWithout,
          "defenseResidual"
        ) -
        nbaAverageField(
          bucketWith,
          "defenseResidual"
        );


      const marginChange =
        nbaAverageField(
          bucketWithout,
          "marginResidual"
        ) -
        nbaAverageField(
          bucketWith,
          "marginResidual"
        );


      if (
        !Number.isFinite(
          offenseChange
        ) ||
        !Number.isFinite(
          defenseChange
        ) ||
        !Number.isFinite(
          marginChange
        )
      ) {
        continue;
      }


      matchedWeight +=
        weight;


      offenseWeighted +=
        offenseChange *
        weight;


      defenseWeighted +=
        defenseChange *
        weight;


      marginWeighted +=
        marginChange *
        weight;
    }


    const offenseControlled =
      matchedWeight > 0
        ? offenseWeighted /
          matchedWeight
        : null;


    const defenseControlled =
      matchedWeight > 0
        ? defenseWeighted /
          matchedWeight
        : null;


    const marginControlled =
      matchedWeight > 0
        ? marginWeighted /
          matchedWeight
        : null;


    // ========================================================
    // FINAL ROW
    // ========================================================

    outputRows.push({

      season:
        numericSeason,

      team_id:
        profile.teamId,

      player_id:
        profile.playerId,

      player_name:
        profile.playerName,

      first_seen:
        profile.firstSeen,

      last_seen:
        profile.lastSeen,

      games_with:
        withPlayer.length,

      games_without:
        withoutPlayer.length,


      pace_with:
        nbaRoundOrNull(
          paceWith
        ),

      pace_without:
        nbaRoundOrNull(
          paceWithout
        ),

      pace_change:
        paceWith !== null &&
        paceWithout !== null
          ? nbaRoundOrNull(
              paceWithout -
              paceWith
            )
          : null,


      ortg_with:
        nbaRoundOrNull(
          ortgWith
        ),

      ortg_without:
        nbaRoundOrNull(
          ortgWithout
        ),

      ortg_change:
        ortgWith !== null &&
        ortgWithout !== null
          ? nbaRoundOrNull(
              ortgWithout -
              ortgWith
            )
          : null,


      drtg_with:
        nbaRoundOrNull(
          drtgWith
        ),

      drtg_without:
        nbaRoundOrNull(
          drtgWithout
        ),

      drtg_change:
        drtgWith !== null &&
        drtgWithout !== null
          ? nbaRoundOrNull(
              drtgWithout -
              drtgWith
            )
          : null,


      team_points_with:
        nbaRoundOrNull(
          teamPointsWith
        ),

      team_points_without:
        nbaRoundOrNull(
          teamPointsWithout
        ),

      team_points_change:
        teamPointsWith !== null &&
        teamPointsWithout !== null
          ? nbaRoundOrNull(
              teamPointsWithout -
              teamPointsWith
            )
          : null,


      opponent_points_with:
        nbaRoundOrNull(
          opponentPointsWith
        ),

      opponent_points_without:
        nbaRoundOrNull(
          opponentPointsWithout
        ),

      opponent_points_change:
        opponentPointsWith !== null &&
        opponentPointsWithout !== null
          ? nbaRoundOrNull(
              opponentPointsWithout -
              opponentPointsWith
            )
          : null,


      total_with:
        nbaRoundOrNull(
          totalWith
        ),

      total_without:
        nbaRoundOrNull(
          totalWithout
        ),

      total_change:
        totalWith !== null &&
        totalWithout !== null
          ? nbaRoundOrNull(
              totalWithout -
              totalWith
            )
          : null,


      margin_with:
        nbaRoundOrNull(
          marginWith
        ),

      margin_without:
        nbaRoundOrNull(
          marginWithout
        ),

      margin_change:
        marginWith !== null &&
        marginWithout !== null
          ? nbaRoundOrNull(
              marginWithout -
              marginWith
            )
          : null,


      opponent_strength_with:
        nbaRoundOrNull(
          opponentStrengthWith
        ),

      opponent_strength_without:
        nbaRoundOrNull(
          opponentStrengthWithout
        ),


      home_pct_with:
        nbaRoundOrNull(
          homePctWith,
          2
        ),

      home_pct_without:
        nbaRoundOrNull(
          homePctWithout,
          2
        ),


      other_absent_with:
        nbaRoundOrNull(
          otherAbsentWith
        ),

      other_absent_without:
        nbaRoundOrNull(
          otherAbsentWithout
        ),


      offense_change_controlled:
        nbaRoundOrNull(
          offenseControlled
        ),

      defense_change_controlled:
        nbaRoundOrNull(
          defenseControlled
        ),

      margin_change_controlled:
        nbaRoundOrNull(
          marginControlled
        ),


      matched_weight:
        matchedWeight,


      reliability:
        nbaReliabilityLabel(
          withoutPlayer.length,
          matchedWeight
        ),


      updated_at:
        new Date()
          .toISOString()

    });
  }


  // ==========================================================
  // SAVE
  // ==========================================================

  const chunkSize =
    250;


  let rowsSaved =
    0;


  for (
    let index = 0;
    index < outputRows.length;
    index += chunkSize
  ) {

    const chunk =
      outputRows.slice(
        index,
        index +
        chunkSize
      );


    const {
      error
    } =
      await supabaseAdmin
        .from(
          "nba_player_absence_impact"
        )
        .upsert(
          chunk,
          {
            onConflict:
              "season,team_id,player_id"
          }
        );


    if (
      error
    ) {
      throw new Error(
        `Supabase nba_player_absence_impact: ${error.message}`
      );
    }


    rowsSaved +=
      chunk.length;
  }


  return {

    games:
      games.length,

    playerHistoryRows:
      playerRows.length,

    players:
      profiles.size,

    rowsSaved

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
    game_pace,
    postseason,
    ist_stage
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
      .eq(
  "postseason",
  false
)
.or(
  "ist_stage.is.null,ist_stage.neq.Championship"
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

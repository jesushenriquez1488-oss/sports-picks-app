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
        full
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

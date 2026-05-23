const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const cache = global.__NBA_ANALYZE_CACHE__ || {};
global.__NBA_ANALYZE_CACHE__ = cache;

const CACHE_TIME = 30 * 60 * 1000;
const ADMIN_EMAIL = "jesushenriquez1488@gmail.com";
const USER_REQUESTS = global.__USER_REQUESTS__ || {};
global.__USER_REQUESTS__ = USER_REQUESTS;

const FREE_COOLDOWN = 10 * 1000;

const PREMIUM_MAX_PER_MINUTE = 40;
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST" && req.query.mode === "update-result") {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");

      if (!token) return res.status(401).json({ error: "No autorizado" });

      const { data: authData, error: authError } =
        await supabaseAdmin.auth.getUser(token);

      if (authError || !authData?.user) {
        return res.status(401).json({ error: "Sesión inválida" });
      }

      if (authData.user.email !== ADMIN_EMAIL) {
        return res.status(403).json({ error: "Solo admin puede actualizar resultados" });
      }

      const { pickId, result } = req.body || {};

      if (!pickId || !["win", "loss", "pending"].includes(result)) {
        return res.status(400).json({ error: "Datos inválidos" });
      }

      const { error } = await supabaseAdmin
        .from("picks_history")
        .update({ result })
        .eq("id", pickId);

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ ok: true });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
if (req.method === "GET" && req.query.mode === "parlay-today") {
  try {

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");

    let isPremiumUser = false;

    if (
      token &&
      token !== "null" &&
      token !== "undefined"
    ) {

      const { data: authData, error: authError } =
        await supabaseAdmin.auth.getUser(token);

      if (!authError && authData?.user) {

        const { data: profile } = await supabaseAdmin
          .from("users")
          .select("is_premium")
          .eq("id", authData.user.id)
          .single();

        isPremiumUser = profile?.is_premium === true;
      }
    }

    const today = new Date();
    today.setHours(0,0,0,0);

    const { data: picks, error } = await supabaseAdmin
      .from("daily_picks")
      .select("*")
      .gte("updated_at", today.toISOString());

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    let candidates = [];

    picks.forEach(pick => {

      const analysis = pick.analysis_json;

      if (
        !analysis ||
        !analysis.isPremiumPick ||
        !analysis.premium
      ) return;

      // MLB
      if (analysis.premium.recommendedCards) {

        analysis.premium.recommendedCards.forEach(card => {

          if ((card.percentage || 0) >= 85) {

            candidates.push({
              sport: pick.sport,
              game: `${pick.away_team} vs ${pick.home_team}`,
              play: card.play,
              percentage: card.percentage,
              title: card.title
            });

          }

        });

      }

      // NBA / WNBA / NCAAB
      else if (
        analysis.premium.pick &&
        (analysis.premium.confidence || 0) >= 85
      ) {

        candidates.push({
          sport: pick.sport,
          game: `${pick.away_team} vs ${pick.home_team}`,
          play: analysis.premium.pick,
          percentage: analysis.premium.confidence,
          title: "Jugada Premium"
        });

      }

    });

    candidates.sort((a, b) => b.percentage - a.percentage);

    const best = candidates.slice(0, 3);

    if (best.length < 2) {
      return res.status(200).json({
        available: false,
        message: "Hoy no hay suficientes jugadas premium para un parlay recomendado."
      });
    }

    return res.status(200).json({
      available: true,
      locked: !isPremiumUser,
      picks: isPremiumUser ? best : null
    });

  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }
}
  if (req.method === "GET" && req.query.mode === "stats") {
    try {
      const { data: picks, error } = await supabaseAdmin
        .from("picks_history")
        .select("*")
        .neq("result", "pending")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const last20 = picks.slice(0, 20);

      const calcRate = (arr) => {
        if (!arr.length) return null;
        const wins = arr.filter(p => p.result === "win").length;
        return Math.round((wins / arr.length) * 100);
      };

      const globalRateRaw = calcRate(last20);

      const sports = ["nba", "mlb", "nfl", "ncaaf"];
      const sportRates = {};

      sports.forEach(sport => {
        const sportPicks = last20.filter(p => p.sport === sport);
        const rate = calcRate(sportPicks);

        if (rate !== null && sportPicks.length >= 3) {
          sportRates[sport] = rate;
        }
      });

      const displayGlobal =
        last20.length < 20
          ? Math.max(80, globalRateRaw || 0)
          : globalRateRaw;

      return res.status(200).json({
        globalRate: Math.round(displayGlobal),
        premiumRate: Math.round(displayGlobal),
        normalRate: 65,
        totalPicks: last20.length,
        sportRates
      });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let user = null;
    let isPremiumUser = false;

    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");

      if (
        token &&
        token !== "null" &&
        token !== "undefined"
      ) {
        const { data: authData, error: authError } =
          await supabaseAdmin.auth.getUser(token);

        if (!authError && authData?.user) {
          user = authData.user;

          const { data: profile } = await supabaseAdmin
            .from("users")
            .select("is_premium")
            .eq("id", user.id)
            .single();

          isPremiumUser = profile?.is_premium === true;
          const isAdmin =
  user?.email === ADMIN_EMAIL;

const userKey =
  user?.id || req.headers["x-forwarded-for"] || "guest";

const now = Date.now();

if (!USER_REQUESTS[userKey]) {
  USER_REQUESTS[userKey] = {
    lastRequest: 0,
    minuteRequests: [],
  };
}

const userData = USER_REQUESTS[userKey];

// limpiar requests viejos
userData.minuteRequests =
  userData.minuteRequests.filter(
    t => now - t < 60000
  );

// FREE cooldown
if (
  !isPremiumUser &&
  !isAdmin &&
  now - userData.lastRequest < FREE_COOLDOWN
) {
  return res.status(429).json({
    error: "Espera 10 segundos antes de analizar nuevamente."
  });
}

// protección silenciosa premium
if (
  isPremiumUser &&
  !isAdmin &&
  userData.minuteRequests.length >= PREMIUM_MAX_PER_MINUTE
) {
  return res.status(429).json({
    error: "Too many requests"
  });
}

userData.lastRequest = now;
userData.minuteRequests.push(now);
        }
      }

    } catch (error) {
      console.log("NBA auth ignorado:", error.message);
    }

   const {
  awayTeam,
  homeTeam,
  awaySpread,
  homeSpread,
  total,
  league
} = req.body || {};

let selectedLeague = league || "nba";

if (
  selectedLeague === "nba" &&
  (
    isWnbaTeam(awayTeam) ||
    isWnbaTeam(homeTeam)
  )
) {
  selectedLeague = "wnba";
}

    if (!awayTeam || !homeTeam) {
      return res.status(400).json({ error: "Faltan equipos" });
    }

    const gameId = `${awayTeam}-${homeTeam}`;

    const { data: existing } = await supabaseAdmin
      .from("daily_picks")
      .select("analysis_json")
      .eq("sport", selectedLeague)
      .eq("game_id", gameId)
      .maybeSingle();

    if (existing?.analysis_json) {
      const cachedAnalysis = existing.analysis_json;
      const locked = cachedAnalysis.isPremiumPick && !isPremiumUser;

      return res.status(200).json({
        locked,
        isPremiumPick: cachedAnalysis.isPremiumPick,
        noPlay: cachedAnalysis.noPlay,
        public: cachedAnalysis.public,
        premium: locked ? null : cachedAnalysis.premium
      });
    }

    const origin = getOrigin(req);


let awayGames = [];
let homeGames = [];
let awayAll = [];
let homeAll = [];

if (
  selectedLeague === "wnba" ||
  selectedLeague === "ncaab"
) {

  awayGames = await fetchJson(
    `${origin}/api/basketball-recent-games?league=${selectedLeague}&team=${encodeURIComponent(awayTeam)}`
  );

  homeGames = await fetchJson(
    `${origin}/api/basketball-recent-games?league=${selectedLeague}&team=${encodeURIComponent(homeTeam)}`
  );

  awayAll = awayGames;
  homeAll = homeGames;

} else {

  const allTeams = await fetchJson(
    `${origin}/api/nba-data?type=teams`
  );

  const teams = allTeams.data || [];

  const awayId = findTeamId(teams, awayTeam);
  const homeId = findTeamId(teams, homeTeam);

  if (!awayId || !homeId) {
    return res.status(400).json({
      error: "No encontré uno de los equipos."
    });
  }

  awayAll = await getRecentGames(origin, awayId);
  homeAll = await getRecentGames(origin, homeId);

  awayGames = await buildFormulaGames(
    origin,
    awayId,
    awayAll
  );

  homeGames = await buildFormulaGames(
    origin,
    homeId,
    homeAll
  );
}
    const minGamesRequired = 3;

if (
  awayGames.length < minGamesRequired ||
  homeGames.length < minGamesRequired
) {
  return res.status(400).json({
    error: "No hay suficientes juegos recientes con data completa."
  });
}
    const [awayInjuries, homeInjuries] = await Promise.all([
      getInjuryAdjustment(origin, awayTeam),
      getInjuryAdjustment(origin, homeTeam)
    ]);

    const awayCalc = calcProjection(awayGames, homeGames);
    const homeCalc = calcProjection(homeGames, awayGames);

    const awayRest = getRestAdjustment(awayAll);
    const homeRest = getRestAdjustment(homeAll);

    const projA =
      awayCalc.projection +
      awayRest.points +
      Number(awayInjuries.offenseImpact || 0) +
      Number(homeInjuries.defenseImpact || 0);

    const projB =
      homeCalc.projection +
      homeRest.points +
      Number(homeInjuries.offenseImpact || 0) +
      Number(awayInjuries.defenseImpact || 0);

    const totalProj = projA + projB;
    const projectedMargin = projA - projB;

    const awaySpreadEdge = projectedMargin + Number(awaySpread || 0);
    const homeSpreadEdge = -projectedMargin + Number(homeSpread || 0);

    const spreadEdge = Math.max(awaySpreadEdge, homeSpreadEdge);
    const totalEdge =
      Number(total || 0) > 0 ? Math.abs(totalProj - Number(total)) : 0;

    const spreadConfidence = getConfidence(spreadEdge);
    const totalConfidence =
      Number(total || 0) > 0 ? getConfidence(totalEdge) : 0;

    let pick = "";
    let confidence = 0;
    let mainEdge = 0;

    if (spreadConfidence >= totalConfidence) {
      pick =
        awaySpreadEdge >= homeSpreadEdge
          ? `${awayTeam} ${Number(awaySpread) > 0 ? "+" : ""}${awaySpread} cubre spread`
          : `${homeTeam} ${Number(homeSpread) > 0 ? "+" : ""}${homeSpread} cubre spread`;

      confidence = spreadConfidence;
      mainEdge = spreadEdge;
    } else {
      pick = totalProj > Number(total) ? "Over" : "Under";
      confidence = totalConfidence;
      mainEdge = totalEdge;
    }

    if (confidence < 60) {
      const noPlayData = {
        locked: false,
        isPremiumPick: false,
        noPlay: true,
        public: {
          title: "No hay ventaja clara",
          message: "El modelo no encontró suficiente edge para recomendar entrada en este juego.",
          reason: "Baja probabilidad según el modelo."
        },
        premium: null
      };

      await supabaseAdmin.from("daily_picks").upsert({
      sport: selectedLeague,
        game_id: gameId,
        away_team: awayTeam,
        home_team: homeTeam,
        analysis_json: noPlayData,
        updated_at: new Date().toISOString()
      });

      return res.status(200).json(noPlayData);
    }

    const verdict = confidence >= 74 ? "Premium" : "Moderado";
    const risk = confidence >= 74 ? "Bajo" : "Medio";
    const isPremiumPick = verdict === "Premium";
    const locked = isPremiumPick && !isPremiumUser;

    const fullAnalysis = {
      locked: false,
      isPremiumPick,
      noPlay: false,
      public: {
        confidence,
        risk,
        verdict,
        hasPremium: isPremiumPick,
        factors: [
          "Forma reciente",
          "Condición local/visitante",
          "Descanso",
          "Lesiones",
          "Edge contra spread/total"
        ]
      },
      premium: {
        pick,
        confidence,
        risk,
        verdict,
        mainEdge,
        mainEdgeConfidence: confidence,
        spreadDiff: projectedMargin,
        projA,
        projB,
        totalProj,
        modelAnalysis: getModelAnalysis(verdict),
        awayRestNote: awayRest.note,
        homeRestNote: homeRest.note,
        awayInjuryNote: awayInjuries.note || "",
        homeInjuryNote: homeInjuries.note || "",
        awayInjuryPublic: getInjuryPublicMessage(awayTeam, awayInjuries),
        homeInjuryPublic: getInjuryPublicMessage(homeTeam, homeInjuries)
      }
    };

    await supabaseAdmin.from("daily_picks").upsert({
      sport: selectedLeague,
      game_id: gameId,
      away_team: awayTeam,
      home_team: homeTeam,
      analysis_json: fullAnalysis,
      updated_at: new Date().toISOString()
    });

    const { data: insertedPick, error: insertError } = await supabaseAdmin
      .from("picks_history")
      .insert({
        game_id: gameId,
       sport: selectedLeague,
        pick,
        confidence,
        result: "pending"
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Error insertando pick:", insertError.message);
    }

    return res.status(200).json({
      locked,
      isPremiumPick,
      noPlay: false,
      pickId: insertedPick?.id || null,
      public: fullAnalysis.public,
      premium: locked ? null : fullAnalysis.premium
    });

  } catch (error) {
    console.error("ANALYZE NBA ERROR:", error);
    return res.status(500).json({ error: error.message });
  }
};

function getOrigin(req) {
  return "https://sports-picks-app-two.vercel.app";
}

async function fetchJson(url) {
  const cached = cache[url];

  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) throw new Error(text);

  const data = JSON.parse(text);

  cache[url] = {
    data,
    time: Date.now()
  };

  return data;
}

function findTeamId(teams, teamName) {
  const team = teams.find(t =>
    String(t.full_name).toLowerCase() === String(teamName).toLowerCase()
  );

  return team ? team.id : null;
}

async function getRecentGames(origin, teamId) {
  const data = await fetchJson(
    `${origin}/api/nba-data?type=games&teamId=${encodeURIComponent(teamId)}`
  );

  return (data.data || [])
    .filter(g => g.home_team_score > 0 && g.visitor_team_score > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getTeamGameView(g, teamId) {
  const isHome = g.home_team.id === teamId;

  return {
    date: g.date,
    isHome,
    scored: isHome ? g.home_team_score : g.visitor_team_score,
    allowed: isHome ? g.visitor_team_score : g.home_team_score,
    opponentId: isHome ? g.visitor_team.id : g.home_team.id,
    opponentName: isHome ? g.visitor_team.full_name : g.home_team.full_name
  };
}

async function buildFormulaGames(origin, teamId, rawGames) {
  const lastGames = rawGames
    .slice(0, 10)
    .map(g => getTeamGameView(g, teamId));

  const completed = [];

  for (const game of lastGames) {
    const opponentRaw = await getRecentGames(origin, game.opponentId);
    const before = new Date(game.date);

    const previousGames = opponentRaw
      .filter(g => new Date(g.date) < before)
      .slice(0, 5)
      .map(g => getTeamGameView(g, game.opponentId));

    if (previousGames.length < 5) continue;

    const opponentAvgScored =
      previousGames.reduce((sum, g) => sum + g.scored, 0) / previousGames.length;

    const opponentAvgAllowed =
      previousGames.reduce((sum, g) => sum + g.allowed, 0) / previousGames.length;

    completed.push({
      ...game,
      opponentAvgScored,
      opponentAvgAllowed
    });

    if (completed.length >= 3) break;
  }

  return completed;
}

function calcTeamFormula(teamGames) {
  const offenseAvg =
    teamGames.reduce((sum, g) => sum + g.scored, 0) / teamGames.length;

  const defenseAllowedAvg =
    teamGames.reduce((sum, g) => sum + g.allowed, 0) / teamGames.length;

  const offensiveEdges = teamGames.map(g => {
    return g.scored - (g.opponentAvgAllowed || g.allowed);
  });

  const offensiveEdgeAvg =
    offensiveEdges.reduce((sum, edge) => sum + edge, 0) / offensiveEdges.length;

  const defensiveEdgeAvg = defenseAllowedAvg - offenseAvg;

  return {
    offenseAvg,
    defenseAllowedAvg,
    offensiveEdgeAvg,
    defensiveEdgeAvg
  };
}

function calcProjection(teamGames, opponentGames) {
  const team = calcTeamFormula(teamGames);
  const opponent = calcTeamFormula(opponentGames);

  const A = team.offensiveEdgeAvg + opponent.defenseAllowedAvg;
  const B = team.offenseAvg + opponent.defensiveEdgeAvg;

  return {
    projection: (A + B) / 2
  };
}

function getRestAdjustment(allGames) {
  if (!allGames || allGames.length < 2) {
    return {
      points: 0,
      note: "Descanso no disponible"
    };
  }

  const last = new Date(allGames[0].date);
  const prev = new Date(allGames[1].date);
  const diffDays = Math.round((last - prev) / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) {
    return {
      points: -3,
      note: "Back-to-back detectado. El equipo podría mostrar menor energía y eficiencia."
    };
  }

  if (diffDays >= 3) {
    return {
      points: 2,
      note: "Buen descanso. El equipo llega con mejor recuperación física."
    };
  }

  return {
    points: 0,
    note: "Descanso normal"
  };
}

async function getInjuryAdjustment(origin, teamName) {
  try {
    const data = await fetchJson(
      `${origin}/api/injuries?team=${encodeURIComponent(teamName)}`
    );

    const injuries = data.injuries || [];

    let offenseImpact = 0;
    let defenseImpact = 0;

    const activeInjuries = injuries.filter(player => shouldCountInjury(player));

    activeInjuries.forEach(player => {
      const status = String(player.status || "").toLowerCase();
      const position = String(player.position || "").toLowerCase();

      let impact = 0;

      if (status.includes("out")) impact = 4;
      else if (status.includes("doubtful")) impact = 3;
      else if (status.includes("questionable")) impact = 1.5;
      else if (status.includes("probable")) impact = 0.5;

      offenseImpact -= impact;

      if (
        position.includes("c") ||
        position.includes("pf") ||
        position.includes("sf")
      ) {
        defenseImpact += impact * 0.5;
      }
    });

    return {
      offenseImpact,
      defenseImpact,
      note:
        activeInjuries.length > 0
          ? activeInjuries.map(p => `${p.name} (${p.status})`).join(", ")
          : `No se reportan bajas clave para ${teamName}.`
    };
  } catch {
    return {
      offenseImpact: 0,
      defenseImpact: 0,
      note: `No se pudieron leer lesiones para ${teamName}.`
    };
  }
}

function shouldCountInjury(player) {
  if (!player.startDate) return true;

  const start = new Date(player.startDate);
  if (isNaN(start.getTime())) return true;

  const today = new Date();
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const estimatedGamesMissed = Math.floor(diffDays / 2);

  return estimatedGamesMissed <= 5;
}

function getConfidence(edge) {
  let confidence = 50 + Number(edge || 0) * 2.4;
  confidence = Math.max(50, Math.min(99, confidence));
  return Math.round(confidence);
}

function getModelAnalysis(verdict) {
  if (verdict === "Premium") {
    return "El modelo detecta una ventaja fuerte contra la línea del mercado.";
  }

  if (verdict === "Moderado") {
    return "El modelo detecta una ventaja moderada contra la línea del mercado.";
  }

  return "El modelo no detecta suficiente ventaja para recomendar entrada fuerte.";
}

function getInjuryPublicMessage(teamName, injury = {}) {
  if (injury.offenseImpact < 0 && injury.defenseImpact > 0) {
    return `${teamName} presenta posibles bajas en ofensiva y defensiva, lo que podría afectar su rendimiento general.`;
  }

  if (injury.offenseImpact < 0) {
    return `${teamName} presenta posibles bajas en ofensiva, lo que podría afectar su producción de puntos.`;
  }

  if (injury.defenseImpact > 0) {
    return `${teamName} presenta posibles bajas en defensiva, lo que podría afectar su capacidad para contener al rival.`;
  }

  return `No se reportan bajas clave que afecten significativamente el rendimiento de ${teamName}.`;
}
function isWnbaTeam(teamName) {
  const name = String(teamName || "").toLowerCase();

  const wnbaTeams = [
    "atlanta dream",
    "chicago sky",
    "connecticut sun",
    "dallas wings",
    "golden state valkyries",
    "indiana fever",
    "las vegas aces",
    "los angeles sparks",
    "minnesota lynx",
    "new york liberty",
    "phoenix mercury",
    "seattle storm",
    "washington mystics",
    "toronto tempo"
  ];

  return wnbaTeams.some(team => name.includes(team));
}

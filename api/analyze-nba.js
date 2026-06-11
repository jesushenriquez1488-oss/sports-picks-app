const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const cache = global.__NBA_ANALYZE_CACHE__ || {};
global.__NBA_ANALYZE_CACHE__ = cache;

const CACHE_TIME = 30 * 60 * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
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
  if (req.method === "GET" && req.query.mode === "refresh-all-daily") {
  try {
    const authHeader = req.headers.authorization || "";
    const cronToken = authHeader.replace("Bearer ", "");
    const manualSecret = req.query.secret;

    const validSecret =
      process.env.CRON_SECRET ||
      process.env.GENERATE_DAILY_SECRET;

    if (!validSecret) {
      return res.status(500).json({
        error: "Falta configurar CRON_SECRET en Vercel"
      });
    }

    if (cronToken !== validSecret && manualSecret !== validSecret) {
      return res.status(401).json({
        error: "No autorizado"
      });
    }

    const origin = getOrigin(req);

    const jobs = [
      "sport=basketball_nba&limit=4&offset=0",
      "sport=basketball_nba&limit=4&offset=4",
      "sport=basketball_nba&limit=4&offset=8",

      "sport=basketball_wnba&limit=4&offset=0",
      "sport=basketball_wnba&limit=4&offset=4",

      "sport=baseball_mlb&limit=4&offset=0",
      "sport=baseball_mlb&limit=4&offset=4",
      "sport=baseball_mlb&limit=4&offset=8",
      "sport=baseball_mlb&limit=4&offset=12",
      "sport=baseball_mlb&limit=4&offset=16",

      "sport=basketball_ncaab&limit=4&offset=0",
      "sport=basketball_ncaab&limit=4&offset=4",
      "sport=basketball_ncaab&limit=4&offset=8",
      "sport=basketball_ncaab&limit=4&offset=12",
      "sport=basketball_ncaab&limit=4&offset=16",
      "sport=basketball_ncaab&limit=4&offset=20"
    ];

    const results = [];

    for (const job of jobs) {
      const url =
        `${origin}/api/analyze-nba?mode=generate-daily&${job}&force=true&secret=${validSecret}`;

      const response = await fetch(url);
      const data = await response.json().catch(() => null);

      results.push({
        job,
        ok: response.ok,
        data
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "refresh-all-daily",
      jobs: results.length,
      results
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
if (req.method === "GET" && req.query.mode === "generate-daily") {
  try {
   const authHeader = req.headers.authorization || "";
const cronToken = authHeader.replace("Bearer ", "");
const manualSecret = req.query.secret;

const validSecret =
  process.env.CRON_SECRET ||
  process.env.GENERATE_DAILY_SECRET;

if (!validSecret) {
  return res.status(500).json({
    error: "Falta configurar CRON_SECRET en Vercel"
  });
}

if (
  cronToken !== validSecret &&
  manualSecret !== validSecret
) {
  return res.status(401).json({
    error: "No autorizado"
  });
}

   

    const origin = getOrigin(req);

  const sports = [
  { key: "basketball_nba", league: "nba", endpoint: "/api/analyze-nba" },
  { key: "basketball_wnba", league: "wnba", endpoint: "/api/analyze-nba" },
  { key: "basketball_ncaab", league: "ncaab", endpoint: "/api/analyze-nba" },
  { key: "baseball_mlb", league: "mlb", endpoint: "/api/analyze-mlb" }
];
const onlySport = req.query.sport;

const selectedSports = onlySport
  ? sports.filter(s => s.key === onlySport)
  : sports;
    const results = [];

    function getMarket(game, marketKey) {
      const bookmakers = game.bookmakers || [];

      for (const book of bookmakers) {
        const market = (book.markets || []).find(m => m.key === marketKey);
        if (market) return market;
      }

      return null;
    }

    function getSpread(game, teamName) {
      const market = getMarket(game, "spreads");
      const outcome = market?.outcomes?.find(o => o.name === teamName);
      return outcome?.point ?? 0;
    }

    function getTotal(game) {
      const market = getMarket(game, "totals");
      const outcome = market?.outcomes?.[0];
      return outcome?.point ?? null;
    }

    function getH2HOutcomes(game) {
      const market = getMarket(game, "h2h");
      return market?.outcomes || [];
    }

   for (const sport of selectedSports) {
      try {
        const oddsRes = await fetch(
          `${origin}/api/odds?sport=${encodeURIComponent(sport.key)}`
        );

        const oddsText = await oddsRes.text();

        if (!oddsRes.ok) {
          results.push({
            sport: sport.key,
            ok: false,
            error: oddsText
          });
          continue;
        }

        const games = JSON.parse(oddsText);

function getKansasDate(dateValue) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(dateValue));
}

const todayKansas = getKansasDate(new Date());

const todayGames = games.filter(game => {
  const gameTime =
    game.commence_time ||
    game.game_time ||
    game.start_time ||
    game.date;

  if (!gameTime) return true;

  return getKansasDate(gameTime) === todayKansas;
});

const limit = Math.max(1, Number(req.query.limit || 4));
const offset = Math.max(0, Number(req.query.offset || 0));

const selectedGames = todayGames.slice(offset, offset + limit);
        for (const game of selectedGames) {
          const awayTeam = game.away_team || game.awayTeam;
          const homeTeam = game.home_team || game.homeTeam;

          if (!awayTeam || !homeTeam) {
            results.push({
              sport: sport.key,
              ok: false,
              error: "Juego sin away/home team"
            });
            continue;
          }

          const awaySpread = getSpread(game, awayTeam);
          const homeSpread = getSpread(game, homeTeam);
          const totalLine = getTotal(game);
          const outcomes = getH2HOutcomes(game);
const analyzeBody =
  sport.league === "mlb"
    ? {
        userId: "system-generate-daily",
        awayTeam,
        homeTeam,
        awaySpread,
        homeSpread,
        outcomes,
        totalLine: totalLine || 8,
        forceRefresh: req.query.force === "true"
      }
    : {
        awayTeam,
        homeTeam,
        awaySpread,
        homeSpread,
        total: totalLine,
        league: sport.league,
        forceRefresh: req.query.force === "true"
      };

          const analyzeRes = await fetch(`${origin}${sport.endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(analyzeBody)
          });

          const analyzeData = await analyzeRes.json().catch(() => null);

          results.push({
            sport: sport.key,
            game: `${awayTeam} vs ${homeTeam}`,
            ok: analyzeRes.ok,
            isPremiumPick: analyzeData?.isPremiumPick || false,
            noPlay: analyzeData?.noPlay || false,
            error: analyzeRes.ok ? null : analyzeData?.error || "Error analizando"
          });
        }

      } catch (error) {
        results.push({
          sport: sport.key,
          ok: false,
          error: error.message
        });
      }
    }
const premiumLimitReport = await enforceDailyPremiumLimits();
    const summary = {
      ok: true,
      totalGames: results.length,
      analyzed: results.filter(r => r.ok).length,
      premium: results.filter(r => r.isPremiumPick).length,
      errors: results.filter(r => !r.ok).length,
      premiumLimitReport,
      results
    };

    return res.status(200).json(summary);

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
  if (req.method === "GET" && req.query.mode === "send-premium-alerts") {
  try {
    const authHeader = req.headers.authorization || "";
    const cronToken = authHeader.replace("Bearer ", "");
    const manualSecret = req.query.secret;

    const validSecret = process.env.CRON_SECRET;

    if (!validSecret) {
      return res.status(500).json({ error: "Falta CRON_SECRET" });
    }

    if (cronToken !== validSecret && manualSecret !== validSecret) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !apiKey) {
      return res.status(500).json({
        error: "Faltan variables de OneSignal"
      });
    }

    const todayDate = new Date().toISOString().split("T")[0];

    const { data: picks, error } = await supabaseAdmin
      .from("daily_picks")
      .select("*")
      .eq("game_date", todayDate);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let alerts = [];

    for (const pick of picks || []) {
      const analysis = pick.analysis_json;

      if (!analysis?.isPremiumPick || !analysis?.premium) continue;

      if (analysis.premium.recommendedCards) {
        for (const card of analysis.premium.recommendedCards) {
          const percentage = Number(card.percentage || 0);

          if (percentage >= 95) {
            alerts.push({
              title: percentage >= 99 ? "👑 ELITE AI ALERT" : "🔥 HOT PICK ALERT",
              message: `${card.play} — ${percentage.toFixed(1)}%`,
              percentage
            });
          }
        }
      } else if (analysis.premium.pick && analysis.public?.confidence >= 95) {
        alerts.push({
          title: analysis.public.confidence >= 99 ? "👑 ELITE AI ALERT" : "🔥 HOT PICK ALERT",
          message: `${analysis.premium.pick} — ${analysis.public.confidence}%`,
          percentage: Number(analysis.public.confidence)
        });
      }
    }

    alerts = alerts
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 1);

    if (alerts.length === 0) {
      return res.status(200).json({
        ok: true,
        sent: 0,
        message: "No hay picks premium 95%+ para enviar"
      });
    }

    const sent = [];

    for (const alert of alerts) {
      const response = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${apiKey}`
        },
        body: JSON.stringify({
          app_id: appId,
         included_segments: ["Active Subscriptions"],
          headings: { en: alert.title },
          contents: {
            en: `${alert.message}\nDisponible ahora en CashEdge.`
          },
          url: "https://cashedgeapp.com"
        })
      });

      const data = await response.json().catch(() => null);

      sent.push({
        ok: response.ok,
        alert,
        response: data
      });
    }

    return res.status(200).json({
      ok: true,
      sent: sent.length,
      alerts: sent
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
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

    if (token && token !== "null" && token !== "undefined") {
      const { data: authData, error: authError } =
        await supabaseAdmin.auth.getUser(token);

      if (!authError && authData?.user) {
        const { data: profile } = await supabaseAdmin
          .from("users")
          .select("is_premium")
          .eq("id", authData.user.id)
          .single();

        isPremiumUser =
          profile?.is_premium === true ||
          authData.user.email === ADMIN_EMAIL;
      }
    }

    const todayDate = new Date().toISOString().split("T")[0];

    // 1) Primero buscar si ya existe parlay fijo para hoy
    const { data: existingParlay, error: existingError } = await supabaseAdmin
      .from("daily_parlays")
      .select("*")
      .eq("game_date", todayDate)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({
        error: existingError.message
      });
    }

    if (existingParlay?.picks?.length >= 2) {
      return res.status(200).json({
        available: true,
        locked: !isPremiumUser,
        picks: isPremiumUser ? existingParlay.picks : null
      });
    }

    // 2) Si no existe, crearlo una sola vez desde daily_picks
    const { data: picks, error } = await supabaseAdmin
      .from("daily_picks")
      .select("*")
      .eq("game_date", todayDate);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    let candidates = [];

    (picks || []).forEach(pick => {
      const analysis = pick.analysis_json;

      if (!analysis || !analysis.isPremiumPick || !analysis.premium) return;

      // MLB
      if (analysis.premium.recommendedCards) {
        analysis.premium.recommendedCards.forEach(card => {
          const percentage = Number(card.percentage || 0);
          const edge = Number(card.edge || analysis.premium.totalDiff || 0);

          if (percentage >= 77) {
            candidates.push({
              sport: pick.sport,
              game: `${pick.away_team} vs ${pick.home_team}`,
              play: card.play,
              percentage,
              edge,
              title: card.title
            });
          }
        });
      }

      // NBA / WNBA / NCAAB
      else if (
        analysis.premium.pick &&
        Number(analysis.premium.confidence || 0) >= 77
      ) {
        candidates.push({
          sport: pick.sport,
          game: `${pick.away_team} vs ${pick.home_team}`,
          play: analysis.premium.pick,
          percentage: Number(analysis.premium.confidence || 0),
          edge: Number(analysis.premium.mainEdge || 0),
          title: "Jugada Premium"
        });
      }
    });

    candidates.sort((a, b) => {
      if (b.percentage !== a.percentage) return b.percentage - a.percentage;
      return b.edge - a.edge;
    });

    const usedGames = new Set();

    const best = candidates
      .filter(candidate => {
        const gameKey = candidate.game;
        if (usedGames.has(gameKey)) return false;
        usedGames.add(gameKey);
        return true;
      })
      .slice(0, 3);

    if (best.length < 2) {
      return res.status(200).json({
        available: false,
        message: "Hoy no hay suficientes jugadas premium para un parlay recomendado."
      });
    }

    // 3) Guardar parlay fijo del día
    const { data: savedParlay, error: saveError } = await supabaseAdmin
      .from("daily_parlays")
      .upsert({
        game_date: todayDate,
        picks: best
      }, { onConflict: "game_date" })
      .select()
      .single();

    if (saveError) {
      return res.status(500).json({
        error: saveError.message
      });
    }

    return res.status(200).json({
      available: true,
      locked: !isPremiumUser,
      picks: isPremiumUser ? savedParlay.picks : null
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
  if (req.method === "GET" && req.query.mode === "send-parlay-alert") {
  try {
    const authHeader = req.headers.authorization || "";
    const cronToken = authHeader.replace("Bearer ", "");
    const manualSecret = req.query.secret;

    const validSecret = process.env.CRON_SECRET;

    if (!validSecret) {
      return res.status(500).json({ error: "Falta CRON_SECRET" });
    }

    if (cronToken !== validSecret && manualSecret !== validSecret) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !apiKey) {
      return res.status(500).json({
        error: "Faltan variables de OneSignal"
      });
    }

    const todayDate = new Date().toISOString().split("T")[0];

    const { data: picks, error } = await supabaseAdmin
      .from("daily_picks")
      .select("*")
      .eq("game_date", todayDate);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let candidates = [];

    (picks || []).forEach(pick => {
      const analysis = pick.analysis_json;

      if (!analysis || !analysis.isPremiumPick || !analysis.premium) return;

      if (analysis.premium.recommendedCards) {
        analysis.premium.recommendedCards.forEach(card => {
          if ((card.percentage || 0) >= 85) {
            candidates.push({
              sport: pick.sport,
              game: `${pick.away_team} vs ${pick.home_team}`,
              play: card.play,
              percentage: Number(card.percentage || 0),
              title: card.title
            });
          }
        });
      } else if (
        analysis.premium.pick &&
        (analysis.premium.confidence || 0) >= 85
      ) {
        candidates.push({
          sport: pick.sport,
          game: `${pick.away_team} vs ${pick.home_team}`,
          play: analysis.premium.pick,
          percentage: Number(analysis.premium.confidence || 0),
          title: "Jugada Premium"
        });
      }
    });

  candidates.sort((a, b) => b.percentage - a.percentage);

const usedGames = new Set();

const best = candidates
  .filter(candidate => {
    const gameKey = candidate.game;

    if (usedGames.has(gameKey)) return false;

    usedGames.add(gameKey);
    return true;
  })
  .slice(0, 3);

    if (best.length < 2) {
      return res.status(200).json({
        ok: true,
        sent: 0,
        message: "No hay suficientes picks 85%+ para Parlay AI"
      });
    }

    const parlayText = best
      .map((p, i) => `${i + 1}. ${p.play} (${p.percentage.toFixed(1)}%)`)
      .join("\n");

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${apiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        included_segments: ["Active Subscriptions"],
        headings: { en: "💰 PARLAY AI DEL DÍA" },
        contents: {
          en: `${best.length} picks premium combinados:\n${parlayText}\nDisponible ahora en CashEdge.`
        },
        url: "https://cashedgeapp.com"
      })
    });

    const data = await response.json().catch(() => null);

    return res.status(200).json({
      ok: response.ok,
      sent: response.ok ? 1 : 0,
      parlay: best,
      response: data
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
  if (req.method === "GET" && req.query.mode === "grade-pending") {
  try {
    const authHeader = req.headers.authorization || "";
    const cronToken = authHeader.replace("Bearer ", "");
    const manualSecret = req.query.secret;

    const validSecret =
      process.env.CRON_SECRET ||
      process.env.GENERATE_DAILY_SECRET;

    if (!validSecret) {
      return res.status(500).json({
        error: "Falta configurar CRON_SECRET en Vercel"
      });
    }

    if (
      cronToken !== validSecret &&
      manualSecret !== validSecret
    ) {
      return res.status(401).json({
        error: "No autorizado"
      });
    }

    const { data: pendingPicks, error } = await supabaseAdmin
      .from("picks_history")
      .select("*")
      .eq("result", "pending")
      .eq("is_premium", true)
      .in("sport", ["nba", "wnba", "ncaab"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const results = [];

    for (const pick of pendingPicks || []) {
      try {
        const graded = await gradeBasketballPick(pick);

        if (!graded || !graded.result) {
          results.push({
            id: pick.id,
            game_id: pick.game_id,
            graded: false,
            reason: "Resultado final no encontrado todavía"
          });
          continue;
        }

        await supabaseAdmin
          .from("picks_history")
          .update({
            result: graded.result,
            final_score: graded.finalScore,
            graded_at: new Date().toISOString()
          })
          .eq("id", pick.id);

        await updateSportRecordAuto(pick.sport, graded.result);

        results.push({
          id: pick.id,
          game_id: pick.game_id,
          pick: pick.pick,
          result: graded.result,
          finalScore: graded.finalScore
        });

      } catch (err) {
        results.push({
          id: pick.id,
          game_id: pick.game_id,
          graded: false,
          error: err.message
        });
      }
    }

    return res.status(200).json({
      ok: true,
      checked: pendingPicks?.length || 0,
      results
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
  if (req.method === "GET" && req.query.mode === "performance") {
  try {
  const { data: records, error } = await supabaseAdmin
 .from("sport_record_summary")
.select("*")
  .order("display_name", { ascending: true });
    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    const safeRecords = records || [];

 const totalWins = safeRecords.reduce(
  (sum, r) => sum + Number(r.total_wins || 0),
  0
);

const totalLosses = safeRecords.reduce(
  (sum, r) => sum + Number(r.total_losses || 0),
  0
);

const totalPushes = safeRecords.reduce(
  (sum, r) => sum + Number(r.pushes || 0),
  0
);

const countedPicks = totalWins + totalLosses;

const overallAccuracy =
  countedPicks > 0
    ? Number(((totalWins / countedPicks) * 100).toFixed(1))
    : 80.0;

return res.status(200).json({
  ok: true,
  overall: {
    accuracy: overallAccuracy,
    wins: totalWins,
    losses: totalLosses,
    pushes: totalPushes,
    countedPicks
  },
  sports: safeRecords
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

const FREE_MAX_PER_HOUR = 10;

if (!USER_REQUESTS[userKey]) {
  USER_REQUESTS[userKey] = {
    lastRequest: 0,
    minuteRequests: [],
    hourRequests: [],
  };
}

const userData = USER_REQUESTS[userKey];

// limpiar requests viejos por minuto
userData.minuteRequests =
  userData.minuteRequests.filter(
    t => now - t < 60000
  );

// limpiar requests viejos por hora
userData.hourRequests =
  userData.hourRequests.filter(
    t => now - t < 60 * 60 * 1000
  );

// FREE cooldown
if (
  !isPremiumUser &&
  !isAdmin &&
  now - userData.lastRequest < FREE_COOLDOWN
) {
  return res.status(429).json({
    error: "⏳ Estás usando el acceso gratuito de CashEdge AI. Espera unos segundos o mejora a Premium para análisis ilimitados y acceso completo."
  });
}

// límite FREE por hora
if (
  !isPremiumUser &&
  !isAdmin &&
  userData.hourRequests.length >= FREE_MAX_PER_HOUR
) {
  return res.status(429).json({
   error: "🔒 Has alcanzado el límite gratuito de CashEdge AI. Obtén CashEdge Premium para análisis ilimitados, picks exclusivos y acceso prioritario."
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
userData.hourRequests.push(now);
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
  league,
  gameTime
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

    const teamsSorted = [awayTeam, homeTeam]
  .map(t => String(t).trim())
  .sort();

const gameDate = new Date().toISOString().split("T")[0];

const gameId =
  `${selectedLeague}-${gameDate}-${teamsSorted.join("-")}`;

    const { data: existing } = await supabaseAdmin
      .from("daily_picks")
     .select("analysis_json, game_date")
      .eq("sport", selectedLeague)
      .eq("game_id", gameId)
      .maybeSingle();
const forceRefresh =
  req.query.force === "true" ||
  req.body?.force === true ||
  req.body?.forceRefresh === true;
    
    if (existing?.analysis_json && !forceRefresh) {
      if (!existing.game_date) {
  await supabaseAdmin
    .from("daily_picks")
    .update({
      game_date: gameDate,
      updated_at: new Date().toISOString()
    })
    .eq("sport", selectedLeague)
    .eq("game_id", gameId);
}
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
updated_at: new Date().toISOString(),
game_date: new Date().toISOString().split("T")[0]
      });

      return res.status(200).json(noPlayData);
    }

    const isPremiumPick = mainEdge >= 13;

const verdict = isPremiumPick ? "Premium" : "Moderado";
const risk = isPremiumPick ? "Bajo" : "Medio";
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
updated_at: new Date().toISOString(),
game_date: new Date().toISOString().split("T")[0]
    });
let pickType = "spread";
let pickTeam = null;
let pickLine = null;
let pickDirection = null;

const normalizedPick = String(pick || "").toLowerCase();

if (normalizedPick.includes("over")) {
  pickType = "total";
  pickTeam = null;
  pickLine = Number(total);
  pickDirection = "OVER";
} else if (normalizedPick.includes("under")) {
  pickType = "total";
  pickTeam = null;
  pickLine = Number(total);
  pickDirection = "UNDER";
} else {
  pickType = "spread";
  pickDirection = null;

  if (pick.includes(awayTeam)) {
    pickTeam = awayTeam;
    pickLine = Number(awaySpread);
  } else if (pick.includes(homeTeam)) {
    pickTeam = homeTeam;
    pickLine = Number(homeSpread);
  }
}
    await supabaseAdmin
  .from("picks_history")
  .delete()
  .eq("sport", selectedLeague)
  .eq("game_id", gameId)
  .eq("result", "pending");
const { data: insertedPick, error: insertError } = await supabaseAdmin
  .from("picks_history")
  .insert({
  game_id: gameId,
  sport: selectedLeague,

  away_team: awayTeam,
  home_team: homeTeam,
  game_date: new Date().toISOString().split("T")[0],

  pick,
  confidence,
  result: "pending",
  is_premium: isPremiumPick === true,

  pick_type: pickType,
  pick_team: pickTeam,
  pick_direction: pickDirection,
  line: pickLine
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
  const safeEdge = Math.abs(Number(edge || 0));

  if (!Number.isFinite(safeEdge)) return 0;

  if (safeEdge < 13) {
    return Math.round(Math.min(74, Math.max(50, 50 + safeEdge * 1.5)));
  }

  if (safeEdge >= 25) return 99;

  const confidence = 75 + ((safeEdge - 13) / 12) * 24;

  return Number(confidence.toFixed(1));
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
async function gradeBasketballPick(pick) {
  const sport = String(pick.sport || "").toLowerCase();

  const normalize = (value = "") =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const sportPath =
    sport === "nba"
      ? "basketball/nba"
      : sport === "wnba"
      ? "basketball/wnba"
      : "basketball/mens-college-basketball";

  const baseDate = pick.game_date || pick.created_at;
  const created = new Date(baseDate);
  const dates = [];

  for (let i = 0; i <= 4; i++) {
    const d = new Date(created);
    d.setDate(d.getDate() + i);
    dates.push(
      d.toISOString().split("T")[0].replaceAll("-", "")
    );
  }

  for (const date of dates) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${date}`;
    const res = await fetch(url);
    const data = await res.json();

    const events = data.events || [];

    for (const event of events) {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      if (!competition || competitors.length < 2) continue;

      const completed =
        competition.status?.type?.completed === true ||
        competition.status?.type?.name === "STATUS_FINAL";

      if (!completed) continue;

      const teams = competitors.map(c => ({
        name: c.team?.displayName,
        shortName: c.team?.shortDisplayName,
        score: Number(c.score || 0),
        homeAway: c.homeAway
      }));

      const pickAway = normalize(pick.away_team);
      const pickHome = normalize(pick.home_team);

      const gameHasAway = teams.some(t =>
        normalize(t.name) === pickAway ||
        normalize(t.shortName) === pickAway ||
        normalize(t.name).includes(pickAway) ||
        pickAway.includes(normalize(t.name))
      );

      const gameHasHome = teams.some(t =>
        normalize(t.name) === pickHome ||
        normalize(t.shortName) === pickHome ||
        normalize(t.name).includes(pickHome) ||
        pickHome.includes(normalize(t.name))
      );

      if (!gameHasAway || !gameHasHome) continue;

      const home = teams.find(t => t.homeAway === "home");
      const away = teams.find(t => t.homeAway === "away");

      if (!home || !away) continue;

      return calculateBasketballResult({
        pick,
        home,
        away
      });
    }
  }

  return null;
}

function calculateBasketballResult({ pick, home, away }) {
  const normalize = (value = "") =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const pickType = String(pick.pick_type || "").toLowerCase();
  const line = Number(pick.line);

  if (!Number.isFinite(line)) return null;

  const finalScore = `${away.name} ${away.score} - ${home.name} ${home.score}`;

  if (pickType === "total") {
    const totalScore = away.score + home.score;

    const direction = String(
      pick.pick_direction ||
      pick.direction ||
      pick.selection ||
      pick.pick ||
      ""
    ).toLowerCase();

    if (direction.includes("over")) {
      if (totalScore > line) return { result: "win", finalScore };
      if (totalScore < line) return { result: "loss", finalScore };
      return { result: "push", finalScore };
    }

    if (direction.includes("under")) {
      if (totalScore < line) return { result: "win", finalScore };
      if (totalScore > line) return { result: "loss", finalScore };
      return { result: "push", finalScore };
    }

    return null;
  }

  if (pickType === "spread") {
    const pickTeam = normalize(pick.pick_team);

    const selected =
      normalize(home.name) === pickTeam ||
      normalize(home.shortName) === pickTeam ||
      normalize(home.name).includes(pickTeam) ||
      pickTeam.includes(normalize(home.name))
        ? home
        : normalize(away.name) === pickTeam ||
          normalize(away.shortName) === pickTeam ||
          normalize(away.name).includes(pickTeam) ||
          pickTeam.includes(normalize(away.name))
        ? away
        : null;

    const opponent =
      selected?.homeAway === "home" ? away : home;

    if (!selected || !opponent) return null;

    const adjustedScore = selected.score + line;

    if (adjustedScore > opponent.score) {
      return { result: "win", finalScore };
    }

    if (adjustedScore < opponent.score) {
      return { result: "loss", finalScore };
    }

    return { result: "push", finalScore };
  }

  return null;
}
async function updateSportRecordAuto(sport, result) {
  const recordSport = String(sport || "").toLowerCase();

  if (!["win", "loss", "push"].includes(result)) return;

  const { data: currentRecord, error } = await supabaseAdmin
    .from("sport_records")
    .select("real_wins, real_losses, pushes")
    .eq("sport", recordSport)
    .maybeSingle();

  if (error || !currentRecord) return;

  const updates = {
    real_wins: Number(currentRecord.real_wins || 0),
    real_losses: Number(currentRecord.real_losses || 0),
    pushes: Number(currentRecord.pushes || 0),
    updated_at: new Date().toISOString()
  };

  if (result === "win") updates.real_wins += 1;
  if (result === "loss") updates.real_losses += 1;
  if (result === "push") updates.pushes += 1;

  await supabaseAdmin
    .from("sport_records")
    .update(updates)
    .eq("sport", recordSport);
}
async function enforceDailyPremiumLimits() {
  const todayDate = new Date().toISOString().split("T")[0];

  const PREMIUM_LIMITS = {
    nba: 5,
    wnba: 5,
    mlb: 5,
    nfl: 5,
    ncaaf: 7,
    ncaab: 7
  };

  const report = [];

  function getScore(row) {
    const analysis = row.analysis_json || {};
    const premium = analysis.premium || {};

    const card = premium.recommendedCards?.[0];

    const confidence =
      Number(analysis.public?.confidence) ||
      Number(premium.confidence) ||
      Number(card?.percentage) ||
      0;

    const edge =
      Number(premium.mainEdge) ||
      Number(card?.edge) ||
      Number(card?.protectedEdge) ||
      Number(card?.totalEdge) ||
      Math.abs(Number(premium.totalDiff || 0)) ||
      0;

    return { confidence, edge };
  }

  for (const sport of Object.keys(PREMIUM_LIMITS)) {
    const limit = PREMIUM_LIMITS[sport];

    const { data: rows, error } = await supabaseAdmin
      .from("daily_picks")
      .select("*")
      .eq("sport", sport)
      .eq("game_date", todayDate);

    if (error || !rows?.length) {
      report.push({ sport, checked: 0, kept: 0, removed: 0 });
      continue;
    }

    const premiumRows = rows
      .filter(row => row.analysis_json?.isPremiumPick === true)
      .map(row => {
        const score = getScore(row);
        return {
          ...row,
          confidenceScore: score.confidence,
          edgeScore: score.edge
        };
      })
      .sort((a, b) => {
        if (b.confidenceScore !== a.confidenceScore) {
          return b.confidenceScore - a.confidenceScore;
        }

        return b.edgeScore - a.edgeScore;
      });

    const allowed = premiumRows.slice(0, limit);
    const rejected = premiumRows.slice(limit);

    const allowedIds = new Set(allowed.map(row => row.game_id));

    for (const row of rows) {
      const analysis = row.analysis_json;

      if (!analysis) continue;

      const shouldBePremium =
        analysis.isPremiumPick === true &&
        allowedIds.has(row.game_id);

      const shouldBeNormal =
        analysis.isPremiumPick === true &&
        !allowedIds.has(row.game_id);

      if (shouldBeNormal) {
        analysis.isPremiumPick = false;
        analysis.locked = false;

        if (analysis.public) {
          analysis.public.hasPremium = false;
          analysis.public.verdict = "Moderado";
          analysis.public.risk = "Medio";
        }

        if (analysis.premium) {
          analysis.premium.verdict = "Moderado";
          analysis.premium.risk = "Medio";
        }

        await supabaseAdmin
          .from("daily_picks")
          .update({
            analysis_json: analysis,
            updated_at: new Date().toISOString()
          })
          .eq("sport", sport)
          .eq("game_id", row.game_id);
      }

      if (shouldBePremium) {
        analysis.isPremiumPick = true;

        await supabaseAdmin
          .from("daily_picks")
          .update({
            analysis_json: analysis,
            updated_at: new Date().toISOString()
          })
          .eq("sport", sport)
          .eq("game_id", row.game_id);
      }
    }

    const rejectedGameIds = rejected.map(row => row.game_id);
    const allowedGameIds = allowed.map(row => row.game_id);

    if (rejectedGameIds.length > 0) {
      await supabaseAdmin
        .from("picks_history")
        .update({ is_premium: false })
        .eq("sport", sport)
        .eq("game_date", todayDate)
        .eq("result", "pending")
        .in("game_id", rejectedGameIds);
    }

    if (allowedGameIds.length > 0) {
      await supabaseAdmin
        .from("picks_history")
        .update({ is_premium: true })
        .eq("sport", sport)
        .eq("game_date", todayDate)
        .eq("result", "pending")
        .in("game_id", allowedGameIds);
    }

    report.push({
      sport,
      checked: rows.length,
      premiumFound: premiumRows.length,
      kept: allowed.length,
      removed: rejected.length
    });
  }

  return report;
}

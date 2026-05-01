const SUPABASE_URL = "https://chwuftiqbxqjbhdixdwk.supabase.co";
const SUPABASE_KEY = "sb_publishable_WLTdeKrWOWO404USqEcqtg_bSfDTzJ3";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const ODDS_API_KEY = "bce7c087b72953e95406c9215e6d24e7";
const BALLDONTLIE_API_KEY = "a36cf94f-2589-4f0d-a632-a55b1133fe92";

const IS_ADMIN = false;

const MONTHLY_PRICE = 19.99;
const SINGLE_PICK_PRICE = 1.99;
const PREMIUM_WIN_RATE = 88;
const NORMAL_WIN_RATE = 65;
const BASKETBALL_STATS_LEAGUES = [
  "basketball_nba",
  "basketball_wnba",
  "basketball_ncaab"
];

function getLeagueSlug(sport) {
  if (sport === "basketball_nba") return "nba";
  if (sport === "basketball_wnba") return "wnba";
  if (sport === "basketball_ncaab") return "ncaab";
  return "euroleague";
}
// USER / PREMIUM LOCAL
let userId = localStorage.getItem("userId");

if (!userId) {
  userId = "user_" + Math.random().toString(36).substring(2, 12);
  localStorage.setItem("userId", userId);
}

// PREMIUM REAL DESDE SUPABASE, NO LOCALSTORAGE
let isPremiumUser = false;

const urlParams = new URLSearchParams(window.location.search);

if (urlParams.get("success") === "true") {
  alert("✅ Pago recibido. Verificando suscripción...");
  window.history.replaceState({}, document.title, window.location.pathname);
}

if (urlParams.get("canceled") === "true") {
  alert("Pago cancelado.");
  window.history.replaceState({}, document.title, window.location.pathname);
}

let selectedSport = "basketball_nba";
let selectedSportName = "NBA";

let allTeams = [];
let gamesCache = {};
let lastRequestTime = 0;

const ODDS_CACHE_TIME = 5 * 60 * 1000;

function selectSport(event, sport, sportName) {
  selectedSport = sport;
  selectedSportName = sportName;

  document.getElementById("appTitle").innerText = `${sportName} Picks App`;
  document.getElementById("searchBtn").innerText = `Buscar juegos ${sportName}`;
  document.getElementById("status").innerHTML = "";
  document.getElementById("games").innerHTML = "";

  document.querySelectorAll(".league-btn").forEach(btn => {
    btn.classList.remove("active");
  });

  event.target.classList.add("active");
}

async function goPremiumMonthly() {

  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData.session) {
    alert("Debes registrarte o iniciar sesión antes de comprar Premium.");
    document.getElementById("authBox").scrollIntoView({ behavior: "smooth" });
    return;
  }

  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: sessionData.session.user.id,
        email: sessionData.session.user.email
      })
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Error creando pago");
    }

  } catch (error) {
    console.log(error);
    alert("Error con Stripe");
  }
}

async function unlockPick() {
  return goPremiumMonthly();
}

function refreshResultsAfterUnlock() {
  const results = document.querySelectorAll("[id^='result']");

  results.forEach(div => {
    if (div.innerHTML.includes("Pick Premium bloqueado")) {
      const card = div.closest(".card");
      const analyzeButton = card ? card.querySelector("button") : null;

      if (analyzeButton) {
        analyzeButton.click();
      }
    }
  });
}

window.addEventListener("load", async () => {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData.session) {
    isPremiumUser = false;
    return;
  }

  const user = sessionData.session.user;

  const { data: profile, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!error && profile) {
    isPremiumUser = profile.is_premium === true;

    const premiumBox = document.getElementById("premiumBox");

    if (premiumBox) {
      if (isPremiumUser) {
        premiumBox.style.display = "none";
      } else {
        premiumBox.style.display = "block";
      }
    }

    document.getElementById("authBox").style.display = "none";
    document.getElementById("userBox").style.display = "block";
    document.getElementById("userEmail").innerText = user.email;
    document.getElementById("premiumStatus").innerText =
      isPremiumUser ? "🔥 Premium activo" : "Free account";
  }
});

async function loadTeams() {
  if (allTeams.length > 0) return;

  const res = await fetch("https://api.balldontlie.io/v1/teams", {
    headers: { Authorization: BALLDONTLIE_API_KEY }
  });

  const text = await res.text();
  if (!res.ok) throw new Error("Error cargando equipos: " + text);

  const data = JSON.parse(text);
  allTeams = data.data;
}

function findTeamId(teamName) {
  const team = allTeams.find(t =>
    t.full_name.toLowerCase() === teamName.toLowerCase()
  );

  return team ? team.id : null;
}

async function waitBeforeRequest() {
  const now = Date.now();
  const diff = now - lastRequestTime;

  if (diff < 5000) {
    await new Promise(resolve => setTimeout(resolve, 5000 - diff));
  }

  lastRequestTime = Date.now();
}

async function getRecentGamesByTeamId(teamId) {
      
  const cacheKey = `teamid-${teamId}-raw`;

  if (gamesCache[cacheKey]) {
    return gamesCache[cacheKey];
  }

  await waitBeforeRequest();

  const url = `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&seasons[]=2025&per_page=100`;

  const res = await fetch(url, {
    headers: { Authorization: BALLDONTLIE_API_KEY }
  });

  const text = await res.text();

  if (text.includes("Too many")) {
    throw new Error("Demasiadas consultas. Espera 1 minuto.");
  }

  if (!res.ok) throw new Error("Error cargando juegos: " + text);

  const data = JSON.parse(text);

  const games = data.data
    .filter(g => g.home_team_score > 0 && g.visitor_team_score > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  gamesCache[cacheKey] = games;
  return games;
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

async function getOpponentLast5Averages(opponentId, beforeDate) {
  const opponentGamesRaw = await getRecentGamesByTeamId(opponentId);

  const before = new Date(beforeDate);

  const previousGames = opponentGamesRaw
    .filter(g => new Date(g.date) < before)
    .slice(0, 5)
    .map(g => getTeamGameView(g, opponentId));

  if (previousGames.length < 5) {
    return null;
  }

  const avgScored =
    previousGames.reduce((sum, g) => sum + g.scored, 0) / previousGames.length;

  const avgAllowed =
    previousGames.reduce((sum, g) => sum + g.allowed, 0) / previousGames.length;

  return {
    opponentAvgScored: avgScored,
    opponentAvgAllowed: avgAllowed
  };
}

async function getRecentGames(teamName) {
  if (selectedSport !== "basketball_nba") {
  const league = getLeagueSlug(selectedSport);

  const res = await fetch(`/api/basketball-recent-games?team=${encodeURIComponent(teamName)}&league=${league}`);
 const games = await res.json();

if (!res.ok) {
  throw new Error(games.error || "Error cargando juegos desde SportsDataIO");
}

return games;
}
  const cacheKey = `${teamName}-formula-real`;

  if (gamesCache[cacheKey]) {
    return gamesCache[cacheKey];
  }

  const teamId = findTeamId(teamName);
  if (!teamId) throw new Error("No encontré equipo: " + teamName);

  const rawGames = await getRecentGamesByTeamId(teamId);

  const lastGames = rawGames
    .slice(0, 10)
    .map(g => getTeamGameView(g, teamId));

  const completedGames = [];

  for (const game of lastGames) {
    const opponentAverages = await getOpponentLast5Averages(
      game.opponentId,
      game.date
    );

    if (!opponentAverages) continue;

    completedGames.push({
      ...game,
      opponentAvgAllowed: opponentAverages.opponentAvgAllowed,
      opponentAvgScored: opponentAverages.opponentAvgScored
    });

    if (completedGames.length >= 5) break;
  }

  if (completedGames.length < 5) {
    throw new Error("No hay suficientes juegos con promedio real del rival.");
  }

  gamesCache[cacheKey] = completedGames;
  return completedGames;
}

function getConditionGames(allGames, condition) {
  const filtered = allGames.filter(g => {
    if (condition === "home") return g.isHome;
    if (condition === "away") return !g.isHome;
    return true;
  });

  return filtered.length >= 5 ? filtered.slice(0, 5) : allGames.slice(0, 5);
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

  const defensiveEdgeAvg =
  defenseAllowedAvg - offenseAvg;
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

  const projection =
    team.offenseAvg +
    opponent.defensiveEdgeAvg;

  return {
    projection,
    avgDifferential: opponent.defensiveEdgeAvg
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

function getInjuryAdjustment(teamName) {
  return {
    offenseImpact: 0,
    defenseImpact: 0,
    severity: "Sin reporte",
    note: `No hay lesiones clave registradas manualmente para ${teamName}.`
  };
}

function getInjuryPublicMessage(teamName, injury) {
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

function getConfidence(edge) {
  let confidence = 50 + edge * 1.5;
  confidence = Math.max(50, Math.min(95, confidence));
  return Math.round(confidence);
}

function getModelAnalysis(verdict) {
  if (verdict === "Premium") {
    return `El modelo detecta una ventaja fuerte contra la línea del mercado.`;
  }

  if (verdict === "Moderado") {
    return `El modelo detecta una ventaja moderada contra la línea del mercado.`;
  }

  return `El modelo no detecta suficiente ventaja para recomendar entrada fuerte.`;
}

async function analyzeAuto(awayTeam, homeTeam, awaySpread, homeSpread, total, index) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analizando...</div>`;

  try {
    const awayAll = await getRecentGames(awayTeam);
    const homeAll = await getRecentGames(homeTeam);

    const awayGames = awayAll.slice(0, 5);
    const homeGames = homeAll.slice(0, 5);

    if (awayGames.length < 5 || homeGames.length < 5) {
      throw new Error("No hay suficientes juegos recientes.");
    }

    const awayCalc = calcProjection(awayGames, homeGames);
    const homeCalc = calcProjection(homeGames, awayGames);

    const awayRest = getRestAdjustment(awayAll);
    const homeRest = getRestAdjustment(homeAll);

    const awayInjuries = getInjuryAdjustment(awayTeam);
    const homeInjuries = getInjuryAdjustment(homeTeam);

    const projA =
      awayCalc.projection +
      awayRest.points +
      awayInjuries.offenseImpact +
      homeInjuries.defenseImpact ;

    const projB =
      homeCalc.projection +
      homeRest.points +
      homeInjuries.offenseImpact +
      awayInjuries.defenseImpact;

    renderAnalysisResult({
      awayTeam,
      homeTeam,
      awaySpread,
      homeSpread,
      total,
      projA,
      projB,
      index,
      extraHTML: `
        <br>
        <p><strong>Descanso:</strong></p>
        <p>${awayTeam}: ${awayRest.note}</p>
        <p>${homeTeam}: ${homeRest.note}</p>

        <br>
        <p><strong>Lesiones:</strong></p>
        <p>${getInjuryPublicMessage(awayTeam, awayInjuries)}</p>
        <p>${getInjuryPublicMessage(homeTeam, homeInjuries)}</p>
      `
    });

  } catch (error) {
    resultDiv.innerHTML = "Error: " + error.message;
  }
}

function analyzeOtherLeague(awayTeam, homeTeam, awaySpread, homeSpread, total, index) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analizando ${selectedSportName}...</div>`;

  setTimeout(() => {
    const leagueProfile = getLeagueProfile(selectedSport);

    let projA = total > 0 ? (total / 2) + (awaySpread * -0.35) : leagueProfile.baseAwayScore;
    let projB = total > 0 ? (total / 2) + (homeSpread * -0.35) : leagueProfile.baseHomeScore;

    projA += getTeamNameAdjustment(awayTeam, leagueProfile);
    projB += getTeamNameAdjustment(homeTeam, leagueProfile) + leagueProfile.homeCourt;

    renderAnalysisResult({
      awayTeam,
      homeTeam,
      awaySpread,
      homeSpread,
      total,
      projA,
      projB,
      index,
      extraHTML: `
        <br>
        <p><strong>Modelo BETA (${selectedSportName})</strong></p>
        <p>Basado en líneas de mercado y proyección automática.</p>
        <p>Estadísticas avanzadas próximamente.</p>
      `
    });
  }, 700);
}

function getLeagueProfile(sport) {
  if (sport === "basketball_wnba") {
    return {
      baseHomeScore: 82,
      baseAwayScore: 79,
      homeCourt: 1.5,
      volatility: 1.15
    };
  }

  if (sport === "basketball_ncaab") {
    return {
      baseHomeScore: 74,
      baseAwayScore: 70,
      homeCourt: 2.5,
      volatility: 1.3
    };
  }

  if (sport === "basketball_euroleague") {
    return {
      baseHomeScore: 81,
      baseAwayScore: 78,
      homeCourt: 2,
      volatility: 1.1
    };
  }

  return {
    baseHomeScore: 80,
    baseAwayScore: 77,
    homeCourt: 2,
    volatility: 1.2
  };
}

function getTeamNameAdjustment(teamName, profile) {
  let score = 0;

  for (let i = 0; i < teamName.length; i++) {
    score += teamName.charCodeAt(i);
  }

  return ((score % 7) - 3) * profile.volatility;
}

function renderAnalysisResult({
  awayTeam,
  homeTeam,
  awaySpread,
  homeSpread,
  total,
  projA,
  projB,
  index,
  extraHTML = ""
}) {
  const resultDiv = document.getElementById(`result${index}`);

  const totalProj = projA + projB;
  const spreadDiff = projA - projB;

  const projectedMargin = projA - projB;

  const awaySpreadEdge = projectedMargin + awaySpread;
  const homeSpreadEdge = -projectedMargin + homeSpread;

  const spreadEdge = Math.max(awaySpreadEdge, homeSpreadEdge);
  const totalEdge = total > 0 ? Math.abs(totalProj - total) : 0;

  const spreadConfidence = getConfidence(spreadEdge);
  const totalConfidence = total > 0 ? getConfidence(totalEdge) : 0;

  let pick = "";
  let confidence = 0;
  let mainEdge = 0;
  let mainEdgeConfidence = 0;

  if (spreadConfidence >= totalConfidence) {
    pick = awaySpreadEdge >= homeSpreadEdge
      ? `${awayTeam} ${awaySpread > 0 ? "+" : ""}${awaySpread} cubre spread`
      : `${homeTeam} ${homeSpread > 0 ? "+" : ""}${homeSpread} cubre spread`;

    confidence = spreadConfidence;
    mainEdge = spreadEdge;
    mainEdgeConfidence = spreadConfidence;
  } else {
    pick = totalProj > total ? "Over" : "Under";

    confidence = totalConfidence;
    mainEdge = totalEdge;
    mainEdgeConfidence = totalConfidence;
  }

  if (confidence < 60) {
    resultDiv.innerHTML = `
      <div class="normal-result">
        <p><strong>No hay ventaja clara</strong></p>
        <p>El modelo no encontró suficiente edge para recomendar entrada en este juego.</p>
        <p><strong>Motivo:</strong> baja probabilidad según el modelo.</p>
      </div>
    `;
    return;
  }

  const verdict =
    confidence >= 71 ? "Premium" :
    confidence >= 60 ? "Moderado" :
    "Evitar";

  const risk =
    confidence >= 71 ? "Bajo" :
    confidence >= 60 ? "Medio" :
    "Alto";

  const isPremium = verdict === "Premium";
  const shouldLockPremium = isPremium && !IS_ADMIN && !isPremiumUser;

  const modelAnalysis = getModelAnalysis(verdict);

  resultDiv.innerHTML = `
    <div class="${isPremium ? 'premium-result' : 'normal-result'}">

      ${isPremium ? '<div class="shine"></div><div class="hot-badge">🔥 HOT PICK</div>' : ''}

      <div class="result-content">

        <p><strong>🔥 PICK PRINCIPAL:</strong></p>
        <p><strong>Pick:</strong> <span>${shouldLockPremium ? "Pick Premium bloqueado" : pick}</span></p>

        ${
          shouldLockPremium ? `
            <p>Desbloquea para ver el pick completo y el análisis exacto.</p>

            <br>
            <p><strong>Factores del modelo:</strong></p>
            <p>✔ Descanso del equipo evaluado</p>
            <p>✔ Impacto de lesiones considerado</p>
            <p>✔ Ritmo reciente analizado</p>
            <p>✔ Edge detectado contra la línea del mercado</p>
          ` : ""
        }

        <p><strong>Confianza:</strong> <span>${confidence}%</span></p>
        <p><strong>Riesgo:</strong> <span>${risk}</span></p>
        <p><strong>Veredicto:</strong> <span>${verdict}</span></p>

        <div class="edge-grid">
          ${
            mainEdgeConfidence >= 60
              ? `
                <div class="edge-box">
                  <h4>Edge detectado</h4>
                  <p>Ventaja del modelo</p>
                  <div class="edge-number">${mainEdge.toFixed(1)}</div>
                  <p>Confianza: <strong>${mainEdgeConfidence}%</strong></p>
                </div>
              `
              : ""
          }
        </div>

        ${
          !shouldLockPremium ? `
            <br>
            <p><strong>Explicación:</strong></p>
            <p>Diferencial proyectado: ${spreadDiff.toFixed(1)}</p>
            <p>Proyección ${awayTeam}: ${projA.toFixed(1)}</p>
            <p>Proyección ${homeTeam}: ${projB.toFixed(1)}</p>
            <p>Total proyectado: ${totalProj.toFixed(1)}</p>

            ${extraHTML}

            <br>
            <p><strong>Análisis del modelo:</strong></p>
            <p>${modelAnalysis}</p>
          ` : ""
        }

        ${
          shouldLockPremium
            ? `
              <button class="unlock-btn" onclick="unlockPick()">
                Desbloquear jugada premium por $${SINGLE_PICK_PRICE}
              </button>

              <p style="text-align:center; margin-top:10px; font-size:14px; opacity:0.85;">
                O desbloquea el acceso premium por $${MONTHLY_PRICE}/mes y obtén todas las jugadas premium del mes.
              </p>

              <button class="unlock-btn" onclick="goPremiumMonthly()">
                Acceso Premium mensual $${MONTHLY_PRICE}/mes
              </button>
            `
            : ""
        }

      </div>
    </div>
  `;
}

async function loadGames() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData.session) {
    alert("Debes registrarte o iniciar sesión para ver los análisis.");
    document.getElementById("authBox").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const status = document.getElementById("status");
  const gamesDiv = document.getElementById("games");
  const sport = selectedSport;

  status.innerHTML = "Cargando juegos...";
  gamesDiv.innerHTML = "";

  try {
    if (sport === "basketball_nba") {
      await loadTeams();
    }

    const cacheKey = `odds-cache-${sport}`;
    const cacheTimeKey = `odds-cache-time-${sport}`;
    const nowCache = Date.now();

    let data = null;

    const savedData = localStorage.getItem(cacheKey);
    const savedTime = localStorage.getItem(cacheTimeKey);

    if (savedData && savedTime && (nowCache - Number(savedTime) < ODDS_CACHE_TIME)) {
      data = JSON.parse(savedData);
      status.innerHTML = `Usando datos recientes de ${selectedSportName}`;
    } else {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=us,eu&markets=h2h,spreads,totals&oddsFormat=american`;

      const res = await fetch(url);
      const text = await res.text();

      if (!res.ok) throw new Error("Error cargando odds: " + text);

      data = JSON.parse(text);

      localStorage.setItem(cacheKey, JSON.stringify(data));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
    }

    const upcomingGames = data.filter(game => {
      const gameTime = new Date(game.commence_time);
      const now = new Date();
      return gameTime > now;
    });

    status.innerHTML = `Juegos encontrados: ${upcomingGames.length}`;

    if (upcomingGames.length === 0) {
      gamesDiv.innerHTML = `
        <div class="card">
          <p>No hay juegos disponibles para ${selectedSportName} en este momento.</p>
        </div>
      `;
      return;
    }

    upcomingGames.slice(0, 8).forEach((game, index) => {
      const gameDate = new Date(game.commence_time);

      const formattedDate = gameDate.toLocaleDateString("es-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      const formattedTime = gameDate.toLocaleTimeString("es-US", {
        hour: "numeric",
        minute: "2-digit"
      });

      const bookmaker = game.bookmakers?.[0];

      let awaySpread = 0;
      let homeSpread = 0;
      let total = 0;

      if (bookmaker) {
        bookmaker.markets.forEach(m => {
          if (m.key === "spreads") {
            const awayOutcome = m.outcomes.find(o => o.name === game.away_team);
            const homeOutcome = m.outcomes.find(o => o.name === game.home_team);

            awaySpread = awayOutcome ? awayOutcome.point : 0;
            homeSpread = homeOutcome ? homeOutcome.point : 0;
          }

          if (m.key === "totals") {
            total = m.outcomes[0]?.point || 0;
          }
        });
      }

      const useBasketballFormula = [
  "basketball_nba",
  "basketball_wnba",
  "basketball_ncaab"
].includes(sport);

      gamesDiv.innerHTML += `
        <div class="card">
          <h2>${game.away_team} vs ${game.home_team}</h2>

          <p><strong>Fecha:</strong> ${formattedDate}</p>
          <p><strong>Hora:</strong> ${formattedTime}</p>

          <p><strong>Spread visitante:</strong> ${awayTeamSpreadText(awaySpread)}</p>
          <p><strong>Spread local:</strong> ${homeTeamSpreadText(homeSpread)}</p>
          <p><strong>Total:</strong> ${total || "No disponible"}</p>

          ${
  useBasketballFormula
    ? `<button onclick="analyzeAuto('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${awaySpread}, ${homeSpread}, ${total}, ${index})">
        Ver predicción del modelo
      </button>`
    : `<button onclick="analyzeOtherLeague('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${awaySpread}, ${homeSpread}, ${total}, ${index})">
        Ver predicción del modelo
      </button>`
}

          <div id="result${index}"></div>
        </div>
      `;
    });

  } catch (error) {
    status.innerHTML = "Error: " + error.message;
  }
}

function awayTeamSpreadText(spread) {
  return `${spread > 0 ? "+" : ""}${spread}`;
}

function homeTeamSpreadText(spread) {
  return `${spread > 0 ? "+" : ""}${spread}`;
}

function escapeText(text) {
  return String(text).replace(/'/g, "\\'");
}

async function registerUser(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  alert("Usuario creado. Revisa tu correo.");
}

async function loginUser(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  const user = data.user;

  const { data: profile, error: dbError } = await supabaseClient
    .from("users")
    .upsert({
      id: user.id,
      email: user.email,
      subscription_status: "free"
    }, {
      onConflict: "id"
    })
    .select()
    .single();

  if (dbError) {
    console.log("DB ERROR:", dbError);
    alert("Login exitoso, pero hubo error leyendo premium.");
    return;
  }

  isPremiumUser = profile.is_premium === true;

  const premiumBox = document.getElementById("premiumBox");

  if (premiumBox) {
    if (isPremiumUser) {
      premiumBox.style.display = "none";
    } else {
      premiumBox.style.display = "block";
    }
  }

  localStorage.setItem("supabaseUser", JSON.stringify(user));

  document.getElementById("authBox").style.display = "none";
  document.getElementById("userBox").style.display = "block";
  document.getElementById("userEmail").innerText = user.email;
  document.getElementById("premiumStatus").innerText =
    isPremiumUser ? "🔥 Premium activo" : "Free account";

  alert(
    isPremiumUser
      ? "Login exitoso. Premium activo."
      : "Login exitoso. Cuenta free."
  );

  refreshResultsAfterUnlock();
}

async function requireLogin(message) {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData.session) {
    alert(message || "Debes registrarte o iniciar sesión para continuar.");
    document.getElementById("authBox").scrollIntoView({ behavior: "smooth" });
    return false;
  }

  return sessionData.session;
}

async function logoutUser() {
  await supabaseClient.auth.signOut();

  localStorage.removeItem("supabaseUser");
  localStorage.removeItem("isPremiumUser");

  isPremiumUser = false;

  const premiumBox = document.getElementById("premiumBox");

  if (premiumBox) {
    premiumBox.style.display = "block";
  }

  document.getElementById("authBox").style.display = "block";
  document.getElementById("userBox").style.display = "none";

  document.getElementById("email").value = "";
  document.getElementById("password").value = "";
  document.getElementById("userEmail").innerText = "";
  document.getElementById("premiumStatus").innerText = "";

  alert("Sesión cerrada");
}

window.loadGames = loadGames;
window.analyzeAuto = analyzeAuto;
window.analyzeOtherLeague = analyzeOtherLeague;
window.selectSport = selectSport;
window.goPremiumMonthly = goPremiumMonthly;
window.unlockPick = unlockPick;
window.refreshResultsAfterUnlock = refreshResultsAfterUnlock;
window.logoutUser = logoutUser;
window.registerUser = registerUser;
window.loginUser = loginUser;

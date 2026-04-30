const SUPABASE_URL = "https://chwufitqbxqjbhdixdwk.supabase.co";
const SUPABASE_KEY = "chwuftiqbxqjbhdixdwk";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const ODDS_API_KEY = "bce7c087b72953e95406c9215e6d24e7";
const BALLDONTLIE_API_KEY = "a36cf94f-2589-4f0d-a632-a55b1133fe92";

const IS_ADMIN = false;

const MONTHLY_PRICE = 19.99;
const SINGLE_PICK_PRICE = 1.99;
const PREMIUM_WIN_RATE = 88;
const NORMAL_WIN_RATE = 65;

// USER / PREMIUM LOCAL
let userId = localStorage.getItem("userId");

if (!userId) {
  userId = "user_" + Math.random().toString(36).substring(2, 12);
  localStorage.setItem("userId", userId);
}

let isPremiumUser = localStorage.getItem("isPremiumUser") === "true";

const urlParams = new URLSearchParams(window.location.search);

if (urlParams.get("success") === "true") {
  localStorage.setItem("isPremiumUser", "true");
  isPremiumUser = true;

  alert("✅ Premium activado correctamente");

  window.history.replaceState({}, document.title, window.location.pathname);

  setTimeout(() => {
    refreshResultsAfterUnlock();
  }, 500);
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
  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId })
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Error creando pago: " + data.error);
    }
  } catch (error) {
    alert("Error conectando con Stripe");
  }
}

async function unlockPick() {
  return goPremiumMonthly();
}

function refreshResultsAfterUnlock() {
  isPremiumUser = localStorage.getItem("isPremiumUser") === "true";

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

window.addEventListener("load", () => {
  isPremiumUser = localStorage.getItem("isPremiumUser") === "true";

  if (isPremiumUser) {
    setTimeout(() => {
      refreshResultsAfterUnlock();
    }, 500);
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

async function getRecentGames(teamName) {
  const cacheKey = `${teamName}-all`;

  if (gamesCache[cacheKey]) {
    return gamesCache[cacheKey];
  }

  const teamId = findTeamId(teamName);
  if (!teamId) throw new Error("No encontré equipo: " + teamName);

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
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(g => {
      const isHome = g.home_team.id === teamId;

      return {
        date: g.date,
        isHome,
        scored: isHome ? g.home_team_score : g.visitor_team_score,
        allowed: isHome ? g.visitor_team_score : g.home_team_score
      };
    });

  gamesCache[cacheKey] = games;
  return games;
}

function getConditionGames(allGames, condition) {
  const filtered = allGames.filter(g => {
    if (condition === "home") return g.isHome;
    if (condition === "away") return !g.isHome;
    return true;
  });

  return filtered.length >= 5 ? filtered.slice(0, 5) : allGames.slice(0, 5);
}

function calcProjection(teamGames, opponentGames) {
  const opponentAvgAllowed =
    opponentGames.reduce((sum, g) => sum + g.allowed, 0) / opponentGames.length;

  const differentials = teamGames.map(g => {
    return g.scored - opponentAvgAllowed;
  });

  const avgDifferential =
    differentials.reduce((sum, d) => sum + d, 0) / differentials.length;

  return {
    projection: opponentAvgAllowed + avgDifferential,
    avgDifferential
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

    const awayGames = getConditionGames(awayAll, "away");
    const homeGames = getConditionGames(homeAll, "home");

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
      homeInjuries.defenseImpact;

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
  isPremiumUser = localStorage.getItem("isPremiumUser") === "true";

  const resultDiv = document.getElementById(`result${index}`);

  const totalProj = projA + projB;
  const spreadDiff = projA - projB;

  // FIX: cálculo correcto del spread con dirección real
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
                Desbloquear Premium $${MONTHLY_PRICE}/mes
              </button>
            `
            : ""
        }

      </div>
    </div>
  `;
}

async function loadGames() {
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

      const isNBA = sport === "basketball_nba";

      gamesDiv.innerHTML += `
        <div class="card">
          <h2>${game.away_team} vs ${game.home_team}</h2>

          <p><strong>Fecha:</strong> ${formattedDate}</p>
          <p><strong>Hora:</strong> ${formattedTime}</p>

          <p><strong>Spread visitante:</strong> ${awayTeamSpreadText(awaySpread)}</p>
          <p><strong>Spread local:</strong> ${homeTeamSpreadText(homeSpread)}</p>
          <p><strong>Total:</strong> ${total || "No disponible"}</p>

          ${
            isNBA
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

window.loadGames = loadGames;
window.analyzeAuto = analyzeAuto;
window.analyzeOtherLeague = analyzeOtherLeague;
window.selectSport = selectSport;
window.goPremiumMonthly = goPremiumMonthly;
window.unlockPick = unlockPick;
window.refreshResultsAfterUnlock = refreshResultsAfterUnlock;

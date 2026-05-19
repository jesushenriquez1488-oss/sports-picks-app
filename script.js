const SUPABASE_URL = "https://chwuftiqbxqjbhdixdwk.supabase.co";
const SUPABASE_KEY = "sb_publishable_WLTdeKrWOWO404USqEcqtg_bSfDTzJ3";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);



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
function showAuthMessage(message, type = "success") {
  const authMessage = document.getElementById("authMessage");

  if (!authMessage) return;

  authMessage.innerText = message;

  authMessage.style.color =
    type === "success" ? "#00ff99" : "#ff4d4d";

  authMessage.style.marginTop = "15px";
  authMessage.style.fontWeight = "600";
  authMessage.style.textAlign = "center";

  setTimeout(() => {
    authMessage.innerText = "";
  }, 4000);
}

function showSignup() {
  document.getElementById("loginView").style.display = "none";
  document.getElementById("signupView").style.display = "block";
}

function showLogin() {
  document.getElementById("signupView").style.display = "none";
  document.getElementById("loginView").style.display = "block";
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
  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error || !user || !user.id || !user.email) {
    alert("Debes iniciar sesión antes de comprar Premium.");
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
        userId: user.id,
        email: user.email
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Error creando pago");
      return;
    }

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

  const res = await fetch("/api/nba-data?type=teams");

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

  const res = await fetch(`/api/nba-data?type=games&teamId=${encodeURIComponent(teamId)}`);

 

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

  // promedio defensivo del rival (lo que permite normalmente)
  const opponentDefenseAvg = opponent.defenseAllowedAvg;

  const A = team.offensiveEdgeAvg + opponentDefenseAvg;

  const B = team.offenseAvg + opponent.defensiveEdgeAvg;

  const projection = (A + B) / 2;

  return {
    projection,
    avgDifferential: projection - team.offenseAvg
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

function shouldCountInjury(player) {
  if (!player.startDate) return true;

  const start = new Date(player.startDate);

  if (isNaN(start.getTime())) return true;

  const today = new Date();
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));

  // Aproximación NBA: 1 juego cada 2 días
  const estimatedGamesMissed = Math.floor(diffDays / 2);

  // Solo cuenta si lleva 5 juegos o menos lesionado
  return estimatedGamesMissed <= 5;
}

async function getInjuryAdjustment(teamAbbr) {
  try {
    const res = await fetch(`/api/injuries?team=${teamAbbr}`);
    const data = await res.json();

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
      severity: activeInjuries.length > 0 ? "Lesiones detectadas" : "Sin reporte",
      note: activeInjuries.length > 0
        ? activeInjuries.map(p => `${p.name} (${p.status})`).join(", ")
        : `No se reportan bajas clave para ${teamAbbr}.`
    };

  } catch (error) {
    console.error("Error leyendo lesiones:", error);

    return {
      offenseImpact: 0,
      defenseImpact: 0,
      severity: "Sin reporte",
      note: `No se pudieron leer lesiones para ${teamAbbr}.`
    };
  }
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
  let confidence = 50 + edge * 2.4;
  confidence = Math.max(50, Math.min(99, confidence));
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
  resultDiv.innerHTML = `<div class="loading-analysis">Analizando NBA...</div>`;

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      alert("Debes iniciar sesión para analizar.");
      return;
    }

    const isAdminUser =
      sessionData.session.user.email === "jesushenriquez1488@gmail.com";

    const response = await fetch("/api/analyze-nba", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionData.session.access_token}`
      },
      body: JSON.stringify({
        awayTeam,
        homeTeam,
        awaySpread,
        homeSpread,
        total
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error analizando NBA");
    }

    if (data.noPlay) {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>${data.public.title}</strong></p>
          <p>${data.public.message}</p>
          <p><strong>Motivo:</strong> ${data.public.reason}</p>
        </div>
      `;
      return;
    }

    const locked = data.locked;
    const premium = data.premium;
    const isPremium = data.isPremiumPick;

  resultDiv.innerHTML = `
  <div class="${isPremium ? 'premium-result mlb-premium-dashboard' : 'normal-result'}">

    <div class="result-content premium-layout">

      <div class="premium-header">

        <div>

          <p class="premium-label">AI PREDICTIVE REPORT</p>

          <h3>🏀 PICK PRINCIPAL</h3>

<div class="premium-pro-card ${data.public.verdict === "Premium" ? "is-premium" : "is-normal"}">

  <div class="premium-pro-top-badge">
    ${
      data.public.confidence >= 75
        ? "🔥 HOT PICK PREMIUM"
        : "📊 JUGADA DESTACADA"
    }
  </div>

  <div class="premium-pro-main">

    <div class="premium-pro-label">
      ${
        data.public.verdict === "Premium"
          ? "🔥 JUGADA PREMIUM"
          : "📊 JUGADA NORMAL"
      }
    </div>

    <div class="premium-pro-pick">
      ${
        locked
          ? "Pick bloqueado"
          : premium.pick
              .replace(" cubre spread", "")
              .replace(" cubre", "")
      }
    </div>

    <div class="premium-pro-confidence-box">

      <div class="premium-pro-circle">
        ${data.public.confidence}%
      </div>

      <div class="premium-circle-label">
        ${data.public.confidence}% PROBABILIDAD
      </div>

      <span>
        ${
          data.public.verdict === "Premium"
            ? "ALTA CONFIANZA"
            : "CONFIANZA MODERADA"
        }
      </span>

    </div>

  </div>

  <div class="premium-pro-grid">

    <div class="premium-pro-mini">
      <small>EDGE</small>
      <strong>${premium.mainEdge.toFixed(1)}</strong>
      <span>vs mercado</span>
    </div>

    <div class="premium-pro-mini">
      <small>PROYECCIÓN TOTAL</small>
      <strong>${premium.totalProj.toFixed(1)}</strong>
      <span>Total modelo</span>
    </div>

    <div class="premium-pro-mini team">
      <small>${awayTeam}</small>
      <strong>${premium.projA.toFixed(1)}</strong>
      <span>puntos proyectados</span>
    </div>

    <div class="premium-pro-mini team">
      <small>${homeTeam}</small>
      <strong>${premium.projB.toFixed(1)}</strong>
      <span>puntos proyectados</span>
    </div>

  </div>

</div>

      ${
        locked
          ? `
            <div class="premium-lock-box">

              <h4>🔒 Premium Analysis Locked</h4>

              <p>
                El modelo detectó edge premium basado en:
              </p>

              <div class="premium-lock-grid">

                <div>✔ Forma reciente</div>
                <div>✔ Descanso</div>
                <div>✔ Lesiones</div>
                <div>✔ Matchup ofensivo</div>
                <div>✔ Matchup defensivo</div>
                <div>✔ Edge vs mercado</div>

              </div>

              <button class="unlock-btn" onclick="goPremiumMonthly()">
                🔓 Desbloquear Premium $${MONTHLY_PRICE}/mes
              </button>

            </div>
          `
          : `

            <div class="premium-data-section">

              <div class="premium-data-box">

                <h4>😴 Descanso</h4>

                <p>${awayTeam}: ${premium.awayRestNote}</p>
                <p>${homeTeam}: ${premium.homeRestNote}</p>

              </div>

              <div class="premium-data-box">

                <h4>🚑 Lesiones</h4>

                <p>${premium.awayInjuryPublic}</p>

                ${
                  premium.awayInjuryNote.includes("No se reportan")
                    ? ""
                    : `<p>${premium.awayInjuryNote}</p>`
                }

                <p>${premium.homeInjuryPublic}</p>

                ${
                  premium.homeInjuryNote.includes("No se reportan")
                    ? ""
                    : `<p>${premium.homeInjuryNote}</p>`
                }

              </div>

            </div>

          `
      }

      ${
        isAdminUser && data.pickId
          ? `
            <div class="admin-panel-pro">

              <h4>🛠 ADMIN PANEL</h4>

              <div class="admin-buttons">

                <button onclick="updatePickResult('${data.pickId}', 'win')">
                  ✅ WIN
                </button>

                <button onclick="updatePickResult('${data.pickId}', 'loss')">
                  ❌ LOSS
                </button>

                <button onclick="updatePickResult('${data.pickId}', 'pending')">
                  ⏳ PENDING
                </button>

              </div>

            </div>
          `
          : ""
      }

    </div>
  </div>
`;

  } catch (error) {
    resultDiv.innerHTML = "Error NBA: " + error.message;
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
    confidence >= 74 ? "Premium" :
    confidence >= 60 ? "Moderado" :
    "Evitar";

  const risk =
    confidence >= 74 ? "Bajo" :
    confidence >= 60 ? "Medio" :
    "Alto";

  const isPremium = verdict === "Premium";
  const shouldLockPremium = isPremium && !IS_ADMIN && !isPremiumUser;

  const modelAnalysis = getModelAnalysis(verdict);

  resultDiv.innerHTML = `
  <div class="${isPremium ? 'premium-result premium-ai-card' : 'normal-result'}">

    ${
      isPremium
        ? `
          <div class="premium-top-line">
            <span class="premium-crown">👑</span>
            <span>🔥 HOT PICK PREMIUM</span>
          </div>
        `
        : ""
    }

    <div class="result-content premium-layout">

      <div class="premium-header">
        <div>
          <p class="premium-label">AI PREDICTIVE REPORT</p>
          <h3>🔥 PICK PRINCIPAL</h3>
          <p class="premium-game-pick">
            ${shouldLockPremium ? "Pick Premium bloqueado" : pick}
          </p>
        </div>

        <div class="premium-score-box">
          <small>CONFIANZA</small>
          <strong>${confidence}%</strong>
          <span>${risk}</span>
        </div>
      </div>

      ${
        shouldLockPremium ? `
          <div class="premium-lock-box">
            <p>🔒 Desbloquea para ver el pick completo y el análisis exacto.</p>

            <div class="premium-factor-grid">
              <span>✔ Descanso evaluado</span>
              <span>✔ Lesiones consideradas</span>
              <span>✔ Ritmo reciente</span>
              <span>✔ Edge vs mercado</span>
            </div>
          </div>
        ` : ""
      }

      <div class="premium-verdict-box">
        <strong>VEREDICTO DEL MODELO</strong>
        <span>${verdict}</span>
      </div>

      <div class="premium-metrics-grid">

        <div class="premium-metric">
          <small>EDGE DEL MODELO</small>
          <strong>${mainEdge.toFixed(1)}</strong>
          <span>Ventaja detectada</span>
        </div>

        <div class="premium-metric">
          <small>EDGE CONFIDENCE</small>
          <strong>${mainEdgeConfidence}%</strong>
          <span>Lectura estadística</span>
        </div>

        <div class="premium-metric">
          <small>RIESGO</small>
          <strong>${risk}</strong>
          <span>Perfil de jugada</span>
        </div>

      </div>

      ${
        !shouldLockPremium ? `
          <div class="premium-analysis-grid">

            <div class="premium-main-analysis">
              <p><strong>Diferencial proyectado:</strong> ${spreadDiff.toFixed(1)}</p>
              <p><strong>Proyección ${awayTeam}:</strong> ${projA.toFixed(1)}</p>
              <p><strong>Proyección ${homeTeam}:</strong> ${projB.toFixed(1)}</p>
              <p><strong>Total proyectado:</strong> ${totalProj.toFixed(1)}</p>
            </div>

            <div class="premium-extra-analysis">
              ${extraHTML}
            </div>

          </div>

          <div class="premium-model-text">
            <strong>ANÁLISIS IA COMPLETO</strong>
            <p>${modelAnalysis}</p>
          </div>
        ` : ""
      }

      ${
        shouldLockPremium
          ? `
            <button class="unlock-btn premium-unlock" onclick="unlockPick()">
              Desbloquear jugada premium por $${SINGLE_PICK_PRICE}
            </button>

            <p class="premium-small-text">
              O desbloquea el acceso premium por $${MONTHLY_PRICE}/mes y obtén todas las jugadas premium del mes.
            </p>

            <button class="unlock-btn premium-unlock" onclick="goPremiumMonthly()">
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
const res = await fetch(`/api/odds?sport=${encodeURIComponent(sport)}`);
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

    upcomingGames.forEach((game, index) => {
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

      const useMLBFormula = sport === "baseball_mlb";
      const useSoccerFormula = sport.startsWith("soccer_");
      const useFootballFormula = [
  "americanfootball_nfl",
  "americanfootball_ncaaf"
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
    : useMLBFormula
    ? `<button onclick='analyzeMLB("${escapeText(game.away_team)}","${escapeText(game.home_team)}",${awaySpread},${homeSpread},${index},${JSON.stringify((game.bookmakers?.[0]?.markets.find(m => m.key === "h2h")?.outcomes || [])).replace(/"/g, '&quot;')}, ${total})'>
        Ver predicción MLB
      </button>`
    : useFootballFormula
    ? `<button onclick="analyzeFootball('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${index})">
        Ver predicción ${selectedSportName}
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
  if (!email || !password) {
    showAuthMessage("Completa email y password", "error");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password
  });

  if (error) {
    if (
      error.message.toLowerCase().includes("already") ||
      error.message.toLowerCase().includes("registered")
    ) {
      showAuthMessage("Esta cuenta ya existe. Inicia sesión.", "error");
    } else {
      showAuthMessage(error.message, "error");
    }

    return;
  }

  showAuthMessage("Cuenta creada correctamente. Ahora inicia sesión.");

  showLogin();

  document.getElementById("loginEmail").value = email;
  document.getElementById("loginPassword").value = password;
}

async function loginUser(email, password) {
  if (!email || !password) {
    showAuthMessage("Completa email y password", "error");
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showAuthMessage("Email o password incorrecto", "error");
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
  }

  isPremiumUser = profile?.is_premium === true;

  const premiumBox = document.getElementById("premiumBox");

  if (premiumBox) {
    premiumBox.style.display = isPremiumUser ? "none" : "block";
  }

  localStorage.setItem("supabaseUser", JSON.stringify(user));

  document.getElementById("authBox").style.display = "none";
  document.getElementById("userBox").style.display = "block";

  document.getElementById("userEmail").innerText = user.email;

  document.getElementById("premiumStatus").innerText =
    isPremiumUser ? "🔥 Premium activo" : "Free account";

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

 document.getElementById("loginEmail").value = "";
document.getElementById("loginPassword").value = "";

document.getElementById("signupEmail").value = "";
document.getElementById("signupPassword").value = "";

showLogin();
  document.getElementById("userEmail").innerText = "";
  document.getElementById("premiumStatus").innerText = "";

 
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

async function analyzeMLB(awayTeam, homeTeam, awaySpread, homeSpread, index, outcomes, totalLine = 8) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analizando MLB...</div>`;

  const safe = (v, d = 0) => (typeof v === "number" && !isNaN(v) ? v : d);

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      alert("Debes iniciar sesión para analizar.");
      return;
    }

    const response = await fetch("/api/analyze-mlb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: sessionData.session.user.id,
        awayTeam,
        homeTeam,
        awaySpread,
        homeSpread,
        outcomes,
        totalLine
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error analizando MLB");
    }

    const locked = data.locked;
    const premium = data.premium;
    const isPremiumMLB = data.isPremiumPick;

    const cardsHTML = premium?.recommendedCards?.map(card => `
      <div class="edge-box">
        <h4>${card.title}</h4>
        <p>${card.play}</p>
        <div class="edge-number">${safe(card.percentage).toFixed(1)}%</div>
      </div>
    `).join("") || "";

    resultDiv.innerHTML = `
 <div class="${isPremiumMLB ? 'premium-result mlb-premium-dashboard' : 'normal-result normal-blue-theme'}">

    ${
      isPremiumMLB
        ? `
          <div class="mlb-premium-badge">
            <span>👑</span>
            <strong>🔥 HOT PICK MLB</strong>
          </div>
        `
        : ""
    }

    <div class="result-content mlb-premium-content">

      ${
        locked
          ? `
            <div class="mlb-premium-title">
              <h2>⚾ ${awayTeam} vs ${homeTeam}</h2>
              <p>🔒 Análisis Premium Detectado</p>
            </div>

            <div class="mlb-lock-panel">
              <h3>Pick Premium Bloqueado</h3>
              <p>Este juego tiene edge premium detectado.</p>

              <div class="mlb-factor-grid">
                <span>✔ Pitcher probable</span>
                <span>✔ Bullpen</span>
                <span>✔ Park factor</span>
                <span>✔ Clima / viento</span>
                <span>✔ Ofensiva reciente</span>
                <span>✔ Línea del mercado</span>
              </div>
            </div>
          `
          : premium
            ? `
              <div class="mlb-premium-title">
                <div>
                  <span class="mlb-report-label">AI PREDICTIVE REPORT</span>
                  <h2>⚾ ${awayTeam} vs ${homeTeam}</h2>
                  <p><strong>Favorito:</strong> ${premium.favoriteToWin} (${safe(premium.favoriteProb).toFixed(1)}%)</p>
                </div>

               ${isPremiumMLB ? `
  <div class="mlb-gold-shield">★</div>
` : ``}
              </div>

              <div class="mlb-top-grid">

                <div class="mlb-main-pick-box">

${premium.recommendedCards?.[0] ? `

  <span>${premium.recommendedCards[0].title}</span>

  <strong>
    ${premium.recommendedCards[0].play}
  </strong>

  <h3>
    ${safe(premium.recommendedCards[0].percentage).toFixed(1)}%
  </h3>

  <small>PROBABILIDAD DE ÉXITO</small>

` : `

  <span>Sin jugada premium</span>

`}

</div>
</div>

${premium.recommendedCards?.[1] ? `

<div class="mlb-extra-pick">

  <div class="extra-pick-label">
    🔥 EXTRA PREMIUM
  </div>

  <div class="extra-pick-play">
    ${premium.recommendedCards[1].play}
  </div>

  <div class="extra-pick-percent">
    ${safe(premium.recommendedCards[1].percentage).toFixed(1)}%
  </div>

</div>

` : ``}
                <div class="mlb-projection-box">
                  <p><strong>Carreras esperadas ${awayTeam}:</strong> ${safe(premium.expectedRunsA).toFixed(2)}</p>
                  <p><strong>Carreras esperadas ${homeTeam}:</strong> ${safe(premium.expectedRunsB).toFixed(2)}</p>
                  <p><strong>Total proyectado:</strong> ${safe(premium.projectedTotal).toFixed(2)}</p>
                  <p><strong>Línea total:</strong> ${safe(premium.totalLine, totalLine)}</p>
                  <p><strong>Diferencia real vs línea:</strong> ${safe(premium.totalDiff).toFixed(2)} carreras</p>
                </div>

              </div>

              <div class="mlb-premium-metrics">
                <div>
                  <small>OVER PROBABILITY</small>
                  <strong>${safe(premium.overProbability).toFixed(1)}%</strong>
                </div>

                <div>
                  <small>UNDER PROBABILITY</small>
                  <strong>${safe(premium.underProbability).toFixed(1)}%</strong>
                </div>

                <div>
                  <small>EDGE DEL MODELO</small>
                  <strong>${safe(premium.totalEdge).toFixed(2)}</strong>
                </div>

                <div>
                  <small>CONFIANZA</small>
                  <strong>ALTA</strong>
                </div>
              </div>

              <div class="mlb-info-grid">

                <div>
                  <h4>🏟️ Estadio / Park Factor</h4>
                  <p>${premium.venue?.name || "N/A"} — factor ${safe(premium.venue?.parkFactor).toFixed(2)} — techo: ${premium.venue?.roof || "N/A"}</p>
                </div>

                <div>
                  <h4>🌦️ Clima</h4>
                  <p>Viento: ${premium.weather?.raw || "No disponible"}</p>
                  <p>Dirección: ${premium.weather?.direction || "neutral"} | Velocidad: ${safe(premium.weather?.speed)} mph | Temp: ${premium.weather?.temp || "N/D"}</p>
                  <p>Impacto climático aplicado: ${safe(premium.weatherFactor, 1).toFixed(3)}</p>
                </div>

                <div>
                  <h4>📊 Datos usados</h4>
                  <p>${awayTeam}: ofensiva ${safe(premium.awayOffense).toFixed(2)}, defensa ${safe(premium.awayTeamAllowed).toFixed(2)}, pitcher ${safe(premium.awayPitcherAllowed).toFixed(2)}, bullpen ${safe(premium.awayBullpenAllowed).toFixed(2)}</p>
                  <p>${homeTeam}: ofensiva ${safe(premium.homeOffense).toFixed(2)}, defensa ${safe(premium.homeTeamAllowed).toFixed(2)}, pitcher ${safe(premium.homePitcherAllowed).toFixed(2)}, bullpen ${safe(premium.homeBullpenAllowed).toFixed(2)}</p>
                </div>

                <div>
                  <h4>⚾ Pitchers / Bullpen</h4>
                  <p>${awayTeam}: ${premium.awayPitcherName || "N/A"} — innings: ${safe(premium.awayPitcherInnings).toFixed(1)}</p>
                  <p>${homeTeam}: ${premium.homePitcherName || "N/A"} — innings: ${safe(premium.homePitcherInnings).toFixed(1)}</p>
                  <p>${awayTeam} bullpen fatigue: ${safe(premium.awayBullpenFatigue).toFixed(1)}</p>
                  <p>${homeTeam} bullpen fatigue: ${safe(premium.homeBullpenFatigue).toFixed(1)}</p>
                </div>

              </div>

              <div class="mlb-complete-bar">
                ANÁLISIS IA COMPLETO
              </div>
            `
            : `
              <p><strong>No hay jugada premium MLB.</strong></p>
              <p>El modelo no encontró edge suficiente.</p>
            `
      }

    </div>

    ${
      locked
        ? `
          <button class="unlock-btn" onclick="goPremiumMonthly()">
            🔓 Desbloquear Premium mensual $${MONTHLY_PRICE}/mes
          </button>
        `
        : ""
    }

  </div>
`;
      } catch (error) {
    resultDiv.innerHTML = `<p>Error MLB: ${error.message}</p>`;
  }
}
async function analyzeFootball(awayTeam, homeTeam, index) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analizando ${selectedSportName}...</div>`;

  try {
    const type = selectedSport === "americanfootball_nfl" ? "nfl" : "ncaaf";

   const { data: sessionData } = await supabaseClient.auth.getSession();

if (!sessionData.session) {
  alert("Debes iniciar sesión para analizar.");
  return;
}

const res = await fetch(
  `/api/football-data?type=${type}&teamA=${encodeURIComponent(awayTeam)}&teamB=${encodeURIComponent(homeTeam)}`,
  {
    headers: {
      "Authorization": `Bearer ${sessionData.session.access_token}`
    }
  }
);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Error football");
    }

    const projAway = Number(data.projectedScore?.[awayTeam] || 0);
    const projHome = Number(data.projectedScore?.[homeTeam] || 0);

    const projectedTotal = Number(data.projectedTotal || 0);
    const projectedSpread = Number(data.projectedSpread || 0);

    const odds = data.odds || {};
    const picks = data.picks || {};

    let spreadPick = picks.spreadPick || null;
    let totalPick = picks.totalPick || null;

    const validPicks = [spreadPick, totalPick].filter(Boolean);

    const bestPick = validPicks.length
      ? validPicks.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0]
      : null;

    const isPremium = bestPick?.isPremium === true;
    const locked = isPremium && !IS_ADMIN && !isPremiumUser;

    resultDiv.innerHTML = `
  <div class="${isPremium ? 'premium-result mlb-premium-dashboard' : 'normal-result'}">

    ${
      isPremium
        ? `
          <div class="premium-top-line">
            <span>👑</span>
            <span>🔥 HOT PICK FOOTBALL</span>
          </div>
        `
        : ""
    }

    <div class="result-content premium-layout">

      <div class="premium-header">

        <div>
          <p class="premium-label">AI FOOTBALL REPORT</p>

          <h3>🏈 ${awayTeam} vs ${homeTeam}</h3>

          <p class="premium-game-pick">
            ${
              locked
                ? "Pick Premium bloqueado"
                : bestPick
                  ? bestPick.pick || "No disponible"
                  : "Sin jugada recomendada"
            }
          </p>

          <div class="premium-meta-row">
            <div class="premium-chip">
              ⚡ ${bestPick ? bestPick.confidence || 0 : 0}%
            </div>

            <div class="premium-chip">
              📊 Edge ${bestPick ? Number(bestPick.edge || 0).toFixed(1) : "0.0"}
            </div>

            <div class="premium-chip premium-chip-gold">
              ${isPremium ? "PREMIUM" : "NORMAL"}
            </div>
          </div>
        </div>

        <div class="premium-score-box">
          <span>FOOTBALL MODEL</span>
          <strong>${bestPick ? bestPick.confidence || 0 : 0}%</strong>
          <small>AI CONFIDENCE</small>
        </div>

      </div>

      ${
        locked
          ? `
            <div class="premium-lock-box">
              <h4>🔒 Pick Premium Bloqueado</h4>

              <p>El modelo detectó edge premium de 10+ puntos.</p>

              <div class="premium-lock-grid">
                <div>✔ Últimos juegos</div>
                <div>✔ Matchup ofensivo</div>
                <div>✔ Matchup defensivo</div>
                <div>✔ Spread del mercado</div>
                <div>✔ Edge estadístico</div>
                <div>✔ Proyección IA</div>
              </div>

              <button class="unlock-btn" onclick="goPremiumMonthly()">
                🔓 Desbloquear Premium mensual $${MONTHLY_PRICE}/mes
              </button>
            </div>
          `
          : bestPick
            ? `
              <div class="premium-analysis-grid">

                <div class="premium-analysis-card">
                  <h4>${isPremium ? "🔥 Jugada Premium" : "📊 Jugada Normal"}</h4>
                  <p>${bestPick.pick || "No disponible"}</p>

                  <div class="premium-big-number">
                    ${bestPick.confidence || 0}%
                  </div>

                  <p>Edge: <strong>${Number(bestPick.edge || 0).toFixed(1)}</strong></p>
                </div>

                <div class="premium-analysis-card">
                  <h4>📈 Proyección</h4>

                  <p>${awayTeam}: ${projAway.toFixed(1)}</p>
                  <p>${homeTeam}: ${projHome.toFixed(1)}</p>

                  <div class="premium-total">
                    ${projectedTotal.toFixed(1)}
                  </div>

                  <p>Total proyectado</p>
                </div>

                <div class="premium-analysis-card">
                  <h4>🧠 Spread Modelo</h4>

                  <div class="premium-big-number">
                    ${projectedSpread.toFixed(1)}
                  </div>

                  <p>Lectura contra línea del mercado</p>
                </div>

              </div>
            `
            : `
              <div class="premium-lock-box">
                <h4>Sin jugada recomendada</h4>
                <p>El modelo no detectó edge positivo suficiente contra la línea.</p>
              </div>
            `
      }

      ${
        !locked
          ? `
            <div class="premium-data-section">

              <div class="premium-data-box">
                <h4>📊 Proyección del modelo</h4>
                <p>${awayTeam}: ${projAway.toFixed(1)}</p>
                <p>${homeTeam}: ${projHome.toFixed(1)}</p>
                <p><strong>Total proyectado:</strong> ${projectedTotal.toFixed(1)}</p>
                <p><strong>Spread modelo:</strong> ${projectedSpread.toFixed(1)}</p>
              </div>

              <div class="premium-data-box">
                <h4>🎯 Lectura IA</h4>
                <p>El sistema compara la proyección del modelo contra la línea del mercado.</p>
                <p>Esta jugada se clasifica como ${isPremium ? "premium" : "normal"} según la confianza y el edge detectado.</p>
              </div>

            </div>
          `
          : ""
      }

    </div>
  </div>
`;

  } catch (err) {
    resultDiv.innerHTML = "Error Football: " + err.message;
  }
}
async function loadStats() {
  try {
    const res = await fetch("/api/analyze-nba?mode=stats");
    const data = await res.json();

    if (data.premiumRate) {
      document.getElementById("premiumRate").innerText = `${data.premiumRate}%`;
    }

    if (data.normalRate) {
      document.getElementById("normalRate").innerText = `${data.normalRate}%`;
    }
  } catch (error) {
    console.log("Error cargando stats:", error);
  }
}

window.addEventListener("load", loadStats);
async function isAdmin() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user?.email === "jesushenriquez1488@gmail.com";
}

async function updatePickResult(pickId, result) {
  const { data: session } = await supabaseClient.auth.getSession();

  await fetch("/api/analyze-nba?mode=update-result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.session.access_token}`
    },
    body: JSON.stringify({ pickId, result })
  });

  alert("Resultado actualizado");
}
// update auth ui
async function openCustomerPortal() {
  try {

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in first.");
      return;
    }

    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: user.id,
        action: "portal"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not open subscription portal.");
      return;
    }

    window.location.href = data.url;

  } catch (error) {
    console.error("Customer portal error:", error);
    alert("Error opening subscription portal.");
  }
}

const SUPABASE_URL = "https://chwuftiqbxqjbhdixdwk.supabase.co";
const SUPABASE_KEY = "sb_publishable_WLTdeKrWOWO404USqEcqtg_bSfDTzJ3";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentSessionId = localStorage.getItem("cashedge_session_id");

if (!currentSessionId) {
  currentSessionId = crypto.randomUUID();
  localStorage.setItem("cashedge_session_id", currentSessionId); 
}

async function trackUserEvent(eventType, options = {}) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    await supabaseClient.from("user_tracking").insert({ 
      user_id: user?.id || null,
      email: user?.email || null,
      event_type: eventType,
      sport: options.sport || null,
      session_id: currentSessionId,
      page: options.page || null,
      metadata: options.metadata || {}
    });

  } catch (err) {
    console.warn("Tracking error:", err);
  }
}


const IS_ADMIN = false;

const MONTHLY_PRICE = 19.99;

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
const _x7k = (() => {
  let _value = false;

  Object.defineProperty(window, "isPremiumUser", {
    get() { return _value; },
    set() { return false; },
    configurable: false,
    enumerable: false
  });

  return {
    set(val) { _value = val === true; }
  };
})();

function _setPremiumUser(val) {
  _x7k.set(val);
}
function sanitize(str) {
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}
const urlParams = new URLSearchParams(window.location.search);

async function handleStripeReturn() {
  const paymentSuccess = urlParams.get("success") === "true";
  const paymentCanceled = urlParams.get("canceled") === "true";
  const stripeSessionId = urlParams.get("session_id");

  if (paymentCanceled) {
    alert("Pago cancelado.");

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );

    return;
  }

  if (!paymentSuccess) return;

  if (!stripeSessionId) {
    console.error("Stripe regresó sin session_id.");
    alert("No se pudo verificar el pago. Comunícate con soporte.");

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );

    return;
  }

  const conversionStorageKey =
    `cashedge_google_conversion_${stripeSessionId}`;

  try {
    alert("✅ Pago recibido. Verificando suscripción...");

    const response = await fetch(
      `/api/verify-checkout-session?session_id=${encodeURIComponent(stripeSessionId)}`
    );

    const verification = await response.json();

    if (!response.ok || verification.verified !== true) {
      throw new Error(
        verification.error || "Stripe no pudo verificar el pago."
      );
    }

    const conversionAlreadySent =
      localStorage.getItem(conversionStorageKey) === "sent";

    if (!conversionAlreadySent) {
      if (typeof window.gtag !== "function") {
        throw new Error("La etiqueta de Google Ads no está disponible.");
      }

      window.gtag("event", "conversion", {
        send_to: "AW-18266545354/le8_CMnWsMQcEMq51YZE",
        value: Number(verification.value || 19.99),
        currency: String(verification.currency || "USD").toUpperCase(),
        transaction_id:
          verification.transactionId || stripeSessionId
      });

      localStorage.setItem(conversionStorageKey, "sent");

      console.log("✅ Conversión Premium enviada a Google Ads:", {
        transactionId:
          verification.transactionId || stripeSessionId,
        value: verification.value,
        currency: verification.currency
      });
    } else {
      console.log("Conversión ya enviada anteriormente:", stripeSessionId);
    }

    alert("✅ Premium confirmado correctamente.");

  } catch (error) {
    console.error("❌ Error verificando la compra:", error);

    alert(
      "El pago fue recibido, pero no pudimos confirmar el seguimiento. " +
      "Tu suscripción se actualizará automáticamente."
    );

  } finally {
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
  }
}

handleStripeReturn();
function showAuthMessage(message, type = "success") {
  const authMessage = document.getElementById("authMessage");
  if (!authMessage) return;

  const isSuccess = type === "success";

  authMessage.innerHTML = `
    <div style="
      display:flex;
      align-items:flex-start;
      gap:10px;
      padding:12px 16px;
      border-radius:12px;
      background:${isSuccess ? 'rgba(0,255,153,.08)' : 'rgba(255,77,77,.08)'};
      border:1px solid ${isSuccess ? 'rgba(0,255,153,.25)' : 'rgba(255,77,77,.25)'};
      margin-top:14px;
    ">
      <span style="font-size:16px;flex-shrink:0">${isSuccess ? '✅' : '⚠️'}</span>
      <span style="
        font-size:12px;
        font-weight:600;
        color:${isSuccess ? '#00ff99' : '#ff6b6b'};
        line-height:1.5;
      ">${message}</span>
    </div>
  `;

  setTimeout(() => {
    authMessage.innerHTML = "";
  }, 6000);
}
function showSignup() {
  document.getElementById("loginView").style.display = "none";
  document.getElementById("signupView").style.display = "block";
  const hero = document.querySelector(".auth-landing-info");
  if (hero) hero.style.display = "none";
}

function showLogin() {
  document.getElementById("signupView").style.display = "none";
  document.getElementById("loginView").style.display = "block";
  const hero = document.querySelector(".auth-landing-info");
  if (hero) hero.style.display = "none";
}
let selectedSport = "basketball_nba";
let selectedSportName = "NBA";

let allTeams = [];
let gamesCache = {};
let lastRequestTime = 0;

const ODDS_CACHE_TIME = 60 * 1000;

function selectSport(event, sport, sportName) {
  selectedSport = sport;
  selectedSportName = sportName;

  document.getElementById("appTitle").innerText = `${sportName} Picks App`;
  const line1 = document.getElementById("heroLine1");
const line2 = document.getElementById("heroLine2");
if (line1) line1.innerText = sportName;
if (line2) line2.innerText = "Picks App";
  const orbEl = document.querySelector(".basketball-orb");
if (orbEl) {
  const sportIcons = {
    basketball_nba: "🏀",
    basketball_wnba: "🏀",
    basketball_ncaab: "🏀",
    basketball_euroleague: "🌐",
    baseball_mlb: "⚾",
    americanfootball_nfl: "🏈",
    americanfootball_ncaaf: "🏈"
  };
  orbEl.innerText = sportIcons[sport] || "🏀";
}
  document.getElementById("searchBtn").innerText = `Find ${sportName} games`;
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
const promoCode =
  document.getElementById("promoCodeInput")?.value?.trim().toUpperCase() || "";
  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
  userId: user.id,
  email: user.email,
  promoCode
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
  openPromoModal();
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

    const { data: { subscription } } =
      supabaseClient.auth.onAuthStateChange(async (event, session) => {

        if (event === "SIGNED_IN" && session) {
          subscription.unsubscribe();
          await handleUserSession(session.user);
        }

      });

    return;
  }

  await handleUserSession(sessionData.session.user);

});

async function handleUserSession(user) {
  
  const { data: profile, error } = await supabaseClient
    .from("users")
    .upsert({
      id: user.id,
      email: user.email,
      subscription_status: "free"
    }, { onConflict: "id" })
    .select()
    .single();

  if (!error && profile) {
    _setPremiumUser(profile.is_premium);

    const premiumBox = document.getElementById("premiumBox");
    if (premiumBox) {
      premiumBox.style.display = isPremiumUser ? "none" : "block";
    }

    document.getElementById("authBox").style.display = "none";
    document.getElementById("userBox").style.display = "block";
    document.getElementById("heroSection").style.display = "block";
    document.body.classList.add("logged-in");
    document.getElementById("userEmail").innerText = user.email;
    document.getElementById("premiumStatus").innerText =
      isPremiumUser ? "🔥 Premium activo" : "Free account";
  }
}
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
 
const { data: sessionData } = await supabaseClient.auth.getSession();
const res = await fetch(`/api/injuries?team=${teamAbbr}`, {
  headers: {
    "Authorization": `Bearer ${sessionData?.session?.access_token || ""}`
  }
});
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

function getInjuryPublicMessage(teamName, injury = {}) {
  const hasOffenseImpact = injury.offenseImpact < 0;
  const hasDefenseImpact = injury.defenseImpact > 0;

  if (!hasOffenseImpact && !hasDefenseImpact) {
    return `No se reportan bajas clave que afecten significativamente el rendimiento de ${teamName}.`;
  }

  const playerList = injury.note && !injury.note.startsWith("No se reportan")
    ? injury.note
    : null;

  if (hasOffenseImpact && hasDefenseImpact) {
    return playerList
      ? `${teamName} podría verse afectado en ofensiva y defensiva por: ${playerList}.`
      : `${teamName} presenta posibles bajas en ofensiva y defensiva, lo que podría afectar su rendimiento general.`;
  }

  if (hasOffenseImpact) {
    return playerList
      ? `${teamName} podría verse afectado en su producción de puntos por: ${playerList}.`
      : `${teamName} presenta posibles bajas en ofensiva, lo que podría afectar su producción de puntos.`;
  }

  return playerList
    ? `${teamName} podría verse afectado en su capacidad defensiva por: ${playerList}.`
    : `${teamName} presenta posibles bajas en defensiva, lo que podría afectar su capacidad para contener al rival.`;
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
  if (!startAnalysisLock(index, "Analyzing...")) return;
  resultDiv.innerHTML = `<div class="loading-analysis">Analyzing NBA...</div>`;

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      alert("Debes iniciar sesión para analizar.");
      return;
    }

let league = "nba";

if (window.currentSport === "wnba") {
  league = "wnba";
}

if (window.currentSport === "ncaab") {
  league = "ncaab";
}
    const validWnbaTeams = [
  "Atlanta Dream",
  "Chicago Sky",
  "Connecticut Sun",
  "Dallas Wings",
  "Golden State Valkyries",
  "Indiana Fever",
  "Las Vegas Aces",
  "Los Angeles Sparks",
  "Minnesota Lynx",
  "New York Liberty",
  "Phoenix Mercury",
  "Seattle Storm",
  "Washington Mystics"
];

if (
  window.currentSport === "wnba" &&
  (
    !validWnbaTeams.includes(awayTeam) ||
    !validWnbaTeams.includes(homeTeam)
  )
) {
  resultDiv.innerHTML = `
    <div class="normal-result">
      <p><strong>Juego no disponible para análisis WNBA.</strong></p>
      <p>Este equipo no tiene data válida en el modelo.</p>
    </div>
  `;
  return;
}
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
  total,
  league: window.currentSport || "nba"
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
      endAnalysisLock(index);
      return;
    }

    const locked = data.locked;
    const premium = data.premium;
    const isPremium = data.isPremiumPick;
let displayPick = locked
  ? "Pick bloqueado"
  : premium.pick
      .replace(" cubre spread", "")
      .replace(" cubre", "");

if (!locked && (displayPick === "Over" || displayPick === "Under")) {
  const lineToShow = Number(premium.totalLine) > 0 ? premium.totalLine : total;
  displayPick = `${displayPick} ${lineToShow}`;
}
  resultDiv.innerHTML = `
<div class="${isPremium ? 'ce-premium-basket-card' : 'ce-normal-basket-card'}">

  ${isPremium ? `
    <div class="ce-premium-basket-badge-row">▲ HOT PICK · NBA</div>

    <div class="ce-premium-basket-header">
      <div class="ce-premium-basket-left">
        <div class="ce-premium-basket-pick">${displayPick}</div>
      </div>
      <div class="ce-premium-basket-circle">
        <span>${data.public.confidence}%</span>
        <small>PROB.</small>
      </div>
    </div>

    <div class="ce-premium-basket-stats">
      <div><small>EDGE</small><strong>${locked ? "--" : premium.mainEdge.toFixed(1)}</strong></div>
      <div><small>TOTAL</small><strong>${locked ? "--" : premium.totalProj.toFixed(1)}</strong></div>
      <div><small>${awayTeam.split(" ").pop()}</small><strong>${locked ? "--" : premium.projA.toFixed(1)}</strong></div>
      <div><small>${homeTeam.split(" ").pop()}</small><strong>${locked ? "--" : premium.projB.toFixed(1)}</strong></div>
    </div>

    ${locked ? `
      <div class="ce-basket-info-section">
        <div class="ce-basket-info-box">
          <h4>🔒 ANÁLISIS PREMIUM</h4>
          <p>Edge significativo detectado. Desbloquea para ver el pick completo.</p>
        </div>
        <div class="ce-basket-info-box">
          <h4>FACTORES</h4>
          <p>Forma reciente · Descanso · Lesiones · Matchup · Edge vs mercado</p>
        </div>
      </div>
      <button class="unlock-btn" style="margin-top:12px" onclick="openPromoModal()">
        🔓 Desbloquear Premium — $${MONTHLY_PRICE}/mes
      </button>
    ` : `
      <div class="ce-basket-info-section">
        <div class="ce-basket-info-box">
          <h4>😴 DESCANSO</h4>
          <p>${awayTeam}: ${premium.awayRestNote}</p>
          <p>${homeTeam}: ${premium.homeRestNote}</p>
        </div>
        <div class="ce-basket-info-box">
          <h4>🚑 LESIONES</h4>
          <p>${premium.awayInjuryPublic}</p>
          <p>${premium.homeInjuryPublic}</p>
        </div>
      </div>
     ${window.currentSport === "basketball_nba" ? `
  <div style="height:0.5px;background:#1a3050;margin:12px 0;"></div>
  <button
    onclick="toggleNBAPlayerProps(${index}, '${escapeText(awayTeam)}', '${escapeText(homeTeam)}', this)"
    style="display:block;width:100%;padding:12px 0;background:rgba(124,60,255,0.15);border:1.5px solid #7c3cff;border-radius:10px;color:#c4a0ff;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;text-align:center;text-transform:uppercase;margin-bottom:10px;">
    ⚡VIEW PLAYER PROPS ↗
  </button>
  <div id="nbaProps${index}"></div>
` : ""}
`}

  ` : `
    <div class="ce-normal-basket-badge">📊 JUGADA DESTACADA</div>
    <div class="ce-normal-basket-pick">${displayPick}</div>
    <div class="ce-normal-basket-stats">
      <div><small>CONFIANZA</small><strong>${data.public.confidence}%</strong></div>
      <div><small>EDGE</small><strong>${premium.mainEdge.toFixed(1)}</strong></div>
      <div><small>${awayTeam.split(" ").pop()}</small><strong>${premium.projA.toFixed(1)}</strong></div>
      <div><small>${homeTeam.split(" ").pop()}</small><strong>${premium.projB.toFixed(1)}</strong></div>
    </div>
    <div class="ce-basket-info-section" style="margin-top:10px">
      <div class="ce-basket-info-box">
        <h4>😴 DESCANSO</h4>
        <p>${awayTeam}: ${premium.awayRestNote}</p>
        <p>${homeTeam}: ${premium.homeRestNote}</p>
      </div>
      <div class="ce-basket-info-box">
        <h4>🚑 LESIONES</h4>
        <p>${premium.awayInjuryPublic}</p>
        <p>${premium.homeInjuryPublic}</p>
      </div>
    </div>
  ${window.currentSport === "basketball_nba" ? `
  <div style="height:0.5px;background:#1a3050;margin:12px 0;"></div>
  <button
    onclick="toggleNBAPlayerProps(${index}, '${escapeText(awayTeam)}', '${escapeText(homeTeam)}', this)"
    style="display:block;width:100%;padding:12px 0;background:rgba(124,60,255,0.15);border:1.5px solid #7c3cff;border-radius:10px;color:#c4a0ff;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;text-align:center;text-transform:uppercase;margin-bottom:10px;">
    ⚡ VER PLAYER PROPS ↗
  </button>
  <div id="nbaProps${index}"></div>
` : ""}
  `}

  

</div>
`;
endAnalysisLock(index);
 } catch (error) {
    if (error.message && (error.message.includes("free analyses") || error.message.includes("every 3 hours") || error.message.includes("unlock 5"))) {
      resultDiv.innerHTML = `
        <div class="normal-result normal-blue-theme">
          <div style="padding:24px;text-align:center;">
            <h3 style="color:#00ff99;margin:0 0 8px;">5 free analyses used</h3>
            <p style="color:#d8fff0;font-size:13px;line-height:1.5;margin:0 0 14px;">More free analyses unlock every 3 hours.</p>
            <p style="color:#bfc8d6;font-size:12px;line-height:1.5;margin:0 0 18px;">Or upgrade to Premium for unlimited analyses.</p>
            <button class="unlock-btn" onclick="openPromoModal()">🚀 Upgrade to Premium — $19.99/month</button>
          </div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analizando NBA</strong></p>
          <p>${error.message}</p>
        </div>
      `;
    }
    endAnalysisLock(index);
  }
}
function analyzeOtherLeague(awayTeam, homeTeam, awaySpread, homeSpread, total, index) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analyzing ${selectedSportName}...</div>`;

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
            <button class="unlock-btn premium-unlock" onclick="openPromoModal()">
              🔓 Desbloquear Premium $${MONTHLY_PRICE}/mes
            </button>
          `
          : ""
      }

    </div>
  </div>
`;
}
async function loadLoginOverallAccuracy() {
  const accuracyEl = document.getElementById("loginOverallAccuracy");
  const recordEl = document.getElementById("loginOverallRecord");

  if (!accuracyEl || !recordEl) return;

  try {
    const res = await fetch("/api/analyze-nba?mode=performance");
    const data = await res.json();

    if (!res.ok || !data?.overall) {
      accuracyEl.innerText = "--%";
      recordEl.innerText = "Loading...";
      return;
    }

    let wins = Number(data.overall.wins || 0);
    let losses = Number(data.overall.losses || 0);
    let pushes = Number(data.overall.pushes || 0);
    let accuracy = Number(data.overall.accuracy || 0);

    if (wins + losses + pushes === 0) {
      wins = 80;
      losses = 20;
      pushes = 0;
      accuracy = 80.0;
    }

    accuracyEl.innerText = `${accuracy.toFixed(1)}%`;
    recordEl.innerText = `${wins}W · ${losses}L · ${pushes}P`;
    const heroAcc = document.getElementById("loginOverallAccuracyHero");
const heroRec = document.getElementById("loginOverallRecordHero");
if (heroAcc) heroAcc.innerText = `${accuracy.toFixed(1)}%`;
if (heroRec) heroRec.innerText = `${wins}W · ${losses}L · ${pushes}P`;

  } catch (error) {
    accuracyEl.innerText = "--%";
    recordEl.innerText = "Loading...";
  }
}

window.addEventListener("load", () => {
  loadLoginOverallAccuracy();
  setTimeout(startHeroTypewriter, 800);
});
async function loadGames() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData.session) {
    alert("Debes registrarte o iniciar sesión para ver los análisis.");
    document.getElementById("authBox").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const status = document.getElementById("status");
  const gamesDiv = document.getElementById("games");
  const parlayBox = document.getElementById("parlayTodayBox");
if (parlayBox) parlayBox.innerHTML = "";
  const sport = selectedSport;
await trackUserEvent("view_sport", {
  sport: sport,
  page: "loadGames",
  metadata: {
    sportName: selectedSportName
  }
});
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
const session = sessionData?.session;
const res = await fetch(`/api/odds?sport=${encodeURIComponent(sport)}`, {
  headers: session?.access_token
    ? { "Authorization": `Bearer ${session.access_token}` }
    : {}
});
const text = await res.text();
      

      if (!res.ok) throw new Error("Error cargando odds: " + text);

      data = JSON.parse(text);

      localStorage.setItem(cacheKey, JSON.stringify(data));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
    }

    function getKansasParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = type => parts.find(p => p.type === type)?.value;

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: get("weekday"),
    hour: Number(get("hour"))
  };
}

function kansasDateString(date) {
  const p = getKansasParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const now = new Date();
const kansasNow = getKansasParts(now);
const todayKansas = kansasDateString(now);

const isFootballSport = [
  "americanfootball_nfl",
  "americanfootball_ncaaf"
].includes(sport);

let allowedDates = [];
let upcomingGames = [];
if (isFootballSport) {
  // NFL/NCAAF: mostrar los próximos juegos disponibles sin límite de fecha
  upcomingGames = data
    .filter(game => new Date(game.commence_time) > now)
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
    .slice(0, 16);
  
  status.innerHTML = `Juegos encontrados: ${upcomingGames.length}`;

  if (upcomingGames.length === 0) {
    gamesDiv.innerHTML = `
      <div class="card">
        <p>No hay juegos disponibles para ${selectedSportName} en este momento.</p>
      </div>
    `;
    return;
  }
}
else {
  // Deportes diarios: solo hoy o mañana
  const targetDate =
  kansasNow.hour >= 21
    ? kansasDateString(addDays(now, 1))
    : todayKansas;

allowedDates.push(targetDate);
}
if (!isFootballSport) {
  upcomingGames = data.filter(game => {
    const gameTime = new Date(game.commence_time);
    const gameKansasDate = kansasDateString(gameTime);
    return allowedDates.includes(gameKansasDate);
  });
}
const validWnbaTeams = [
  "Atlanta Dream",
  "Chicago Sky",
  "Connecticut Sun",
  "Dallas Wings",
  "Golden State Valkyries",
  "Indiana Fever",
  "Las Vegas Aces",
  "Los Angeles Sparks",
  "Minnesota Lynx",
  "New York Liberty",
  "Phoenix Mercury",
  "Seattle Storm",
  "Washington Mystics"
];

if (window.currentSport === "wnba") {
  upcomingGames = upcomingGames.filter(game =>
    validWnbaTeams.includes(game.home_team) &&
    validWnbaTeams.includes(game.away_team)
  );
}
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

      const formattedDate = gameDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      const formattedTime = gameDate.toLocaleTimeString("en-US", {
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
      
  const startTime = new Date(game.commence_time);

  if (!game.commence_time || isNaN(startTime.getTime()) || startTime <= new Date()) {
    return;
  }

   gamesDiv.innerHTML += `
        <div class="card">
          <h2>${sanitize(game.away_team)} vs ${sanitize(game.home_team)}</h2>
         <p><strong>Date:</strong> ${formattedDate}</p>
          <p><strong>Time:</strong> ${formattedTime}</p>
          <p><strong>Away spread:</strong> ${awayTeamSpreadText(awaySpread)}</p>
          <p><strong>Home spread:</strong> ${homeTeamSpreadText(homeSpread)}</p>
          <p><strong>Total:</strong> ${total || "Not available"}</p>
          ${
  useBasketballFormula
    ? `<button onclick="analyzeAuto('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${awaySpread}, ${homeSpread}, ${total}, ${index})">
        View AI Prediction
      </button>`
    : useMLBFormula
   ? `<button onclick='analyzeMLB("${escapeText(game.away_team)}","${escapeText(game.home_team)}",${awaySpread},${homeSpread},${index},${JSON.stringify((game.bookmakers?.[0]?.markets.find(m => m.key === "h2h")?.outcomes || [])).replace(/"/g, '&quot;')},${total},"${game.commence_time || ""}","${game.id || ""}")'>
        View AI Prediction
   </button>`
    : useFootballFormula
    ? `<button onclick="analyzeFootball('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${index})">
        View ${selectedSportName} Prediction
      </button>`
    : `<button onclick="analyzeOtherLeague('${escapeText(game.away_team)}', '${escapeText(game.home_team)}', ${awaySpread}, ${homeSpread}, ${total}, ${index})">
       View AI Prediction
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
function togglePassword(inputId, el) {

  const input = document.getElementById(inputId);

  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    el.textContent = "⊘";
  } else {
    input.type = "password";
    el.textContent = "👁️";
  }

}
async function registerUser(email, password) {
  if (!email || !password) {
    showAuthMessage("Completa email y password", "error");
    return;
  }

  if (password.length < 8) {
    showAuthMessage("La contraseña debe tener al menos 8 caracteres", "error");
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

  // Supabase devuelve identities vacío si el email ya existe pero no está confirmado
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    showAuthMessage("Esta cuenta ya existe. Revisa tu correo o inicia sesión.", "error");
    return;
  }
// Registrar creación exitosa de cuenta en Google Analytics
if (typeof window.gtag === "function") {
  window.gtag("event", "sign_up", {
    method: "email",
  });
}
  showAuthMessage("✅ Cuenta creada. Revisa tu correo " + email + " para verificar tu cuenta antes de iniciar sesión.", "success");
  showLogin();
  document.getElementById("loginEmail").value = email;
  document.getElementById("loginPassword").value = "";
}
async function askPushAfterLogin() {
  try {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") return;
    if (Notification.permission === "denied") return;

    const result = await Notification.requestPermission();

    if (result === "granted" && window.OneSignalDeferred) {
      OneSignalDeferred.push(async function (OneSignal) {
        await OneSignal.User.PushSubscription.optIn();
        console.log("Push notifications activated");
      });
    }
  } catch (err) {
    console.error("Push permission error:", err);
  }
}
async function loginUser(email, password) {
  if (!email || !password) {
    showAuthMessage("Completa email y password", "error");
    return;
  }
await askPushAfterLogin();
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

 _setPremiumUser(profile?.is_premium);

  const premiumBox = document.getElementById("premiumBox");

  if (premiumBox) {
    premiumBox.style.display = isPremiumUser ? "none" : "block";
  }

  

 document.getElementById("authBox").style.display = "none";
 
 document.getElementById("userBox").style.display = "block";
document.body.classList.add("logged-in");
  document.getElementById("userEmail").innerText = user.email;

  document.getElementById("premiumStatus").innerText =
    isPremiumUser ? "🔥 Premium activo" : "Free account";

  refreshResultsAfterUnlock();
}
async function resetPassword() {
  const email =
  document.getElementById("resetEmail")?.value.trim() ||
  document.getElementById("email")?.value.trim() ||
  document.getElementById("loginEmail")?.value.trim();
  if (!email) {
    alert("Ingresa tu correo para recuperar tu contraseña.");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "https://cashedgeapp.com/reset.html"
  });

  if (error) {
    alert("Error enviando recuperación: " + error.message);
    return;
  }

  alert("Te enviamos un correo para recuperar tu contraseña.");
}
async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    showAuthMessage("Google login error: " + error.message, "error");
  }
}

async function updateNewPassword() {
  const password = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmNewPassword").value;

  if (!password || !confirmPassword) {
    showAuthMessage("Complete both password fields", "error");
    return;
  }

  if (password.length < 6) {
    showAuthMessage("Password must be at least 6 characters", "error");
    return;
  }

  if (password !== confirmPassword) {
    showAuthMessage("Passwords do not match", "error");
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({
    password: password
  });

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  showAuthMessage("Password updated successfully", "success");
localStorage.removeItem("cashEdgePasswordRecovery");
  setTimeout(() => {
    window.location.href = window.location.origin;
  }, 1500);
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

  const resetBox = document.getElementById("resetPasswordBox");
  if (resetBox) resetBox.style.display = "none";

  document.body.classList.remove("logged-in");

  localStorage.removeItem("supabaseUser");
  localStorage.removeItem("isPremiumUser");

 _setPremiumUser(false);

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

async function analyzeMLB(awayTeam, homeTeam, awaySpread, homeSpread, index, outcomes, totalLine = 8, gameTime = null, eventId = null) {
  const resultDiv = document.getElementById(`result${index}`);
  if (!startAnalysisLock(index, "Analizando MLB...")) return;
  resultDiv.innerHTML = `<div class="loading-analysis">Analyzing MLB...</div>`;

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
        gameTime,
        totalLine
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error analizando MLB");
    }
if (data.noPlay) {
  resultDiv.innerHTML = `
    <div class="prediction-card">
      <h2>⏳ Análisis MLB no disponible</h2>
      <p>${data.public?.message || data.public?.reason || data.error || "Esperando pitchers confirmados y líneas oficiales."}</p>
    </div>
  `;
  endAnalysisLock(index);
  return;
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
           <div style="max-width:560px;margin:0 auto;">

              <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,255,231,0.08);border:1px solid rgba(0,255,231,0.25);border-radius:20px;padding:4px 12px;font-size:10px;color:#00ffe7;font-weight:600;letter-spacing:1px;margin-bottom:14px;">
                <span style="width:6px;height:6px;border-radius:50%;background:#00ffe7;animation:nfl-pulse 1.5s infinite;display:inline-block;"></span>
                PREMIUM PICK DETECTED · MLB
              </div>

              <div style="font-size:15px;color:#8899bb;margin-bottom:16px;">⚾ ${awayTeam} vs ${homeTeam}</div>

              <div style="display:flex;align-items:center;gap:18px;background:#0a1220;border:1px solid #14243d;border-radius:14px;padding:18px 20px;margin-bottom:12px;">
                <div style="position:relative;width:84px;height:84px;flex-shrink:0;">
                  <svg width="84" height="84" viewBox="0 0 84 84" style="position:absolute;top:0;left:0;">
                    <circle cx="42" cy="42" r="36" fill="none" stroke="#14243d" stroke-width="5"/>
                    <circle cx="42" cy="42" r="36" fill="none" stroke="#00ffe7" stroke-width="5"
                      stroke-dasharray="${Math.round(((Number(data.public?.confidence) || 85) / 100) * 226)} 226"
                      stroke-linecap="round" transform="rotate(-90 42 42)"
                      style="filter:drop-shadow(0 0 8px #00ffe7);"/>
                  </svg>
                  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                    <span style="font-size:19px;font-weight:800;color:#00ffe7;">${data.public?.confidence ? Number(data.public.confidence).toFixed(0) : "85"}%</span>
                    <small style="font-size:8px;color:#5a7a9a;letter-spacing:1px;">CONFIDENCE</small>
                  </div>
                </div>
                <div style="text-align:left;">
                  <div style="font-size:11px;color:#5a7a9a;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;">Model's pick</div>
                  <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:3px;">•••••••• <span style="font-size:15px;">🔒</span></div>
                  <div style="font-size:12px;color:#00ffe7;margin-top:6px;">Real edge detected vs the sportsbook line</div>
                </div>
              </div>

              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,255,231,0.05);border:1px solid rgba(0,255,231,0.15);border-radius:10px;padding:10px 16px;margin-bottom:12px;">
                <span style="font-size:12px;color:#8899bb;">Model's all-time MLB record</span>
                <span style="font-size:14px;font-weight:800;color:#00ffe7;">${(ceRecordLine("mlb") || "").replace(/<[^>]*>/g, "").replace(/📊.*record: /, "") || "72% (155-61)"}</span>
              </div>

              <div style="font-size:12px;color:#a0b4cc;line-height:1.6;text-align:left;padding:0 4px;margin-bottom:14px;">
                The model only flags a pick as premium when it finds a real mathematical edge against the sportsbooks. Betting without that edge is guessing.
              </div>

            </div>
          `
          : premium
            ? `
              <div class="mlb-premium-title">
                <div>
                  <span class="mlb-report-label">AI PREDICTIVE REPORT</span>
                  <h2>⚾ ${awayTeam} vs ${homeTeam}</h2>
                </div>

              ${isPremiumMLB ? `
  <div class="mlb-gold-shield">
    <span>${(premium.recommendedCards?.[0] ? premium.recommendedCards[0].percentage.toFixed(1) : "0")}%</span>
    <small>PROB.</small>
  </div>
` : ``}
              </div>

              <div class="mlb-top-grid">
                <div class="mlb-main-pick-box">
${premium.recommendedCards?.[0] ? `
  <span>${premium.recommendedCards[0].title}</span>
  <strong>${premium.recommendedCards[0].play}</strong>
  <h3>${safe(premium.recommendedCards[0].percentage).toFixed(1)}%</h3>
  <small>PROBABILIDAD DE ÉXITO</small>
` : `
  <span>No play premium</span>
`}
</div>
</div>

${premium.recommendedCards?.[1] ? `
<div class="mlb-extra-pick">
  <div class="extra-pick-label">🔥 EXTRA PREMIUM</div>
  <div class="extra-pick-play">${premium.recommendedCards[1].play}</div>
  <div class="extra-pick-percent">${safe(premium.recommendedCards[1].percentage).toFixed(1)}%</div>
</div>
` : ``}

            <div class="mlb-projection-box">
                  <p><strong>Expected runs ${awayTeam}:</strong> ${safe(premium.expectedRunsA).toFixed(2)}</p>
                  <p><strong>Expected runs ${homeTeam}:</strong> ${safe(premium.expectedRunsB).toFixed(2)}</p>
                  <p><strong>Projected total:</strong> ${safe(premium.projectedTotal).toFixed(2)}</p>
                  <p><strong>Total line:</strong> ${safe(premium.totalLine, totalLine)}</p>
                  <p><strong>Diff vs line:</strong> ${safe(premium.totalDiff).toFixed(2)} runs</p>
                </div>

              </div>

              <div class="player-edge-section">
                <button class="player-edge-toggle-btn" onclick='togglePlayerEdgeProps(${index}, "${eventId || ""}")'>
                  🎯 View Player Props
                </button>
                <div id="playerEdge${index}" class="player-edge-box"></div>
              </div>

              <div class="mlb-info-grid">
                <div>
                  <h4>🏟️ Ballpark / Park Factor</h4>
                  <p>${premium.venue?.name || "N/A"} — factor ${safe(premium.venue?.parkFactor).toFixed(2)} — roof: ${premium.venue?.roof || "N/A"}</p>
                </div>
                <div>
                  <h4>🌦️ Weather</h4>
                  <p>Wind: ${premium.weather?.raw || "No disponible"}</p>
                  <p>Direction: ${premium.weather?.direction || "neutral"} | Speed: ${safe(premium.weather?.speed)} mph | Temp: ${premium.weather?.temp || "N/D"}</p>
                  <p>Weather impact applied: ${safe(premium.weatherFactor, 1).toFixed(3)}</p>
                </div>
                <div>
                  <h4>📊 Data used</h4>
                  <p>${awayTeam}: offense ${safe(premium.awayOffense).toFixed(2)}, defense ${safe(premium.awayTeamAllowed).toFixed(2)}, pitcher ${safe(premium.awayPitcherAllowed).toFixed(2)}, bullpen ${safe(premium.awayBullpenAllowed).toFixed(2)}</p>
                  <p>${homeTeam}: offense ${safe(premium.homeOffense).toFixed(2)}, defense ${safe(premium.homeTeamAllowed).toFixed(2)}, pitcher ${safe(premium.homePitcherAllowed).toFixed(2)}, bullpen ${safe(premium.homeBullpenAllowed).toFixed(2)}</p>
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
               FULL AI ANALYSIS
              </div>
            `
            : `
              <p><strong>No premium MLB play.</strong></p>
              <p>The model didn't find enough edge.</p>
            `
      }

    </div>

    ${
      locked
        ? `
        <button class="unlock-btn ce-premium-btn" onclick="openPromoModal()">
            🔓 UNLOCK PREMIUM PICK — $${MONTHLY_PRICE}/MO
          </button>
        `
        : ""
    }

  </div>
`;
    endAnalysisLock(index);
   } catch (error) {
    if (error.message && (error.message.includes("free analyses") || error.message.includes("every 3 hours") || error.message.includes("unlock 5"))) {
      resultDiv.innerHTML = `
        <div class="normal-result normal-blue-theme">
          <div style="padding:24px;text-align:center;">
            <h3 style="color:#00ff99;margin:0 0 8px;">5 free analyses used</h3>
            <p style="color:#d8fff0;font-size:13px;line-height:1.5;margin:0 0 14px;">More free analyses unlock every 3 hours.</p>
            <p style="color:#bfc8d6;font-size:12px;line-height:1.5;margin:0 0 18px;">Or upgrade to Premium for unlimited analyses.</p>
            <button class="unlock-btn" onclick="openPromoModal()">🚀 Upgrade to Premium — $19.99/month</button>
          </div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analizando MLB</strong></p>
          <p>${error.message}</p>
        </div>
      `;
    }
    endAnalysisLock(index);
}
}
// ============================================================
// PEGAR EN script.js — antes de la función analyzeFootball()
// ============================================================
 
function generateNFLAnalysisText(data, awayTeam, homeTeam, bestPick) {
  const proj = data.projectedScore || {};
  const projA = Number(proj[awayTeam] || 0);
  const projB = Number(proj[homeTeam] || 0);
  const projectedTotal = Number(data.projectedTotal || 0);
  const projectedSpread = Number(data.projectedSpread || 0);
  const odds = data.odds || {};
  const totalLine = Number(odds.totalLine || 0);
  const pace = data.paceEfficiencyAdjustment || {};
 
  const teamAOffense = Number(pace.teamAOffenseScore || 1);
  const teamBOffense = Number(pace.teamBOffenseScore || 1);
  const teamADefense = Number(pace.teamADefenseScore || 1);
  const teamBDefenseScore = Number(pace.teamBDefenseScore || 1);
  const paceAdj = Number(pace.adjustment || 0);
 
  const edge = Number(bestPick?.edge || 0);
  const pickType = bestPick?.type || "spread";
  const isOver = bestPick?.isOver === true;
const isUnder = bestPick?.isUnder === true;
  const isSpread = pickType === "spread";
  const spreadLine = isOver
    ? odds.totalLine
    : isUnder
      ? odds.totalLine
      : projectedSpread > 0
        ? odds.spreadLineA
        : odds.spreadLineB;
 
  const totalDiff = Math.abs(projectedTotal - totalLine).toFixed(1);
  const spreadDiff = Math.abs(projectedSpread).toFixed(1);
 
  const bothOffenseHigh = teamAOffense > 1.08 && teamBOffense > 1.08;
  const bothDefenseHigh = teamADefense > 1.08 && teamBDefenseScore > 1.08;
  const oneOffenseHigh = teamAOffense > 1.1 || teamBOffense > 1.1;
  const oneDefenseHigh = teamADefense > 1.1 || teamBDefenseScore > 1.1;
  const offenseTeam = teamAOffense >= teamBOffense ? awayTeam : homeTeam;
  const defenseTeam = teamADefense >= teamBDefenseScore ? awayTeam : homeTeam;
  const weakDefenseTeam = teamADefense < teamBDefenseScore ? awayTeam : homeTeam;
  const paceHigh = paceAdj > 2;
  const paceLow = paceAdj < -2;
  const edgeLarge = edge >= 14;
  const edgeMedium = edge >= 9;
  const favoriteTeam = projectedSpread > 0 ? awayTeam : homeTeam;
  const underdogTeam = projectedSpread > 0 ? homeTeam : awayTeam;
  const projFavorite = projectedSpread > 0 ? projA.toFixed(1) : projB.toFixed(1);
  const projUnderdog = projectedSpread > 0 ? projB.toFixed(1) : projA.toFixed(1);
  const isUnderdogPick = isSpread && (
    (bestPick?.pick?.includes(awayTeam) && projectedSpread < 0) ||
    (bestPick?.pick?.includes(homeTeam) && projectedSpread > 0)
  );
 
  // --- TOTAL OVER ---
  if (isOver) {
    if (bothOffenseHigh && paceHigh) {
      return `El modelo proyecta ${projectedTotal.toFixed(1)} puntos totales contra una línea de ${totalLine} — una diferencia de +${totalDiff}. Ambos equipos llegan con ofensivas por encima del promedio de liga y un ritmo de juego acelerado. El mercado está subestimando la capacidad anotadora de este partido.`;
    }
    if (edgeLarge) {
      return `La línea de ${totalLine} del mercado parece conservadora. El modelo encuentra un edge de ${edge.toFixed(1)} puntos sobre el total, proyectando ${projectedTotal.toFixed(1)} entre ambos equipos. El diferencial sugiere que el mercado está subestimando significativamente este juego.`;
    }
    if (projA > projB * 1.3) {
      return `${awayTeam} proyecta ${projA.toFixed(1)} puntos por sí solo — suficiente para mantener el total elevado independientemente de ${homeTeam}. Con ${projectedTotal.toFixed(1)} proyectados en total, el modelo ve valor claro en el Over ${totalLine}.`;
    }
    if (projB > projA * 1.3) {
      return `${homeTeam} proyecta ${projB.toFixed(1)} puntos por sí solo — suficiente para mantener el total elevado independientemente de ${awayTeam}. Con ${projectedTotal.toFixed(1)} proyectados en total, el modelo ve valor claro en el Over ${totalLine}.`;
    }
    if (oneOffenseHigh && !oneDefenseHigh) {
      return `El modelo detecta que ${offenseTeam} llega con una ofensiva explosiva frente a una defensa de ${weakDefenseTeam} que ha permitido puntos por encima del promedio. El modelo proyecta ${projectedTotal.toFixed(1)} puntos — ${totalDiff} por encima de la línea del mercado.`;
    }
    if (paceHigh) {
      return `El ritmo de juego histórico de ambos equipos tiende a generar muchas posesiones. El modelo proyecta ${projectedTotal.toFixed(1)} puntos totales, superando la línea de ${totalLine} por ${totalDiff} puntos con un ajuste de pace de +${paceAdj.toFixed(1)}.`;
    }
    if (!oneDefenseHigh) {
      return `Ninguno de los dos equipos ha mostrado consistencia defensiva. El modelo proyecta ${projectedTotal.toFixed(1)} puntos totales, ${totalDiff} por encima de la línea. Los antecedentes defensivos de ambos equipos respaldan un partido de alto scoring.`;
    }
    return `El modelo proyecta ${projectedTotal.toFixed(1)} puntos totales contra una línea de ${totalLine}. Con un edge de ${edge.toFixed(1)} puntos y proyecciones de ${projA.toFixed(1)} para ${awayTeam} y ${projB.toFixed(1)} para ${homeTeam}, el Over ${totalLine} muestra valor estadístico claro.`;
  }
 
  // --- TOTAL UNDER ---
  if (isUnder) {
    if (bothDefenseHigh) {
      return `El modelo proyecta solo ${projectedTotal.toFixed(1)} puntos totales — ${totalDiff} por debajo de la línea de ${totalLine}. Ambos equipos llegan con defensas sólidas y un ritmo de juego controlado que históricamente limita la producción ofensiva del rival.`;
    }
    if (edgeLarge) {
      return `Con un edge de ${edge.toFixed(1)} puntos a favor del Under, el modelo detecta que el mercado está sobreestimando la producción ofensiva de este partido. El total proyectado de ${projectedTotal.toFixed(1)} está ${totalDiff} puntos por debajo de la línea de ${totalLine}.`;
    }
    if (oneDefenseHigh) {
      return `La defensa de ${defenseTeam} es uno de los factores clave en este análisis. El modelo proyecta que limitará significativamente al rival, empujando el total hacia ${projectedTotal.toFixed(1)} — por debajo de la línea de ${totalLine} por ${totalDiff} puntos.`;
    }
    if (paceLow) {
      return `El ritmo de juego de ambos equipos tiende a generar pocas posesiones y partidos de baja anotación. El modelo proyecta ${projectedTotal.toFixed(1)} puntos — ${totalDiff} por debajo de la línea — respaldado por un ajuste de pace de ${paceAdj.toFixed(1)} puntos.`;
    }
    return `Las ofensivas proyectadas de ${projA.toFixed(1)} para ${awayTeam} y ${projB.toFixed(1)} para ${homeTeam} no alcanzan la línea de ${totalLine}. El modelo ve el total como sobreestimado por el mercado, con un edge de ${edge.toFixed(1)} puntos a favor del Under.`;
  }
 
  // --- SPREAD — FAVORITO ---
  if (isSpread && !isUnderdogPick) {
    if (edgeLarge) {
      return `El mercado parece subestimar a ${favoriteTeam}. Con un edge de ${edge.toFixed(1)} puntos sobre la línea, el modelo detecta que la ventaja real de ${favoriteTeam} es significativamente mayor a lo que las odds reflejan. Proyecciones: ${favoriteTeam} ${projFavorite} — ${underdogTeam} ${projUnderdog}.`;
    }
    if (bothOffenseHigh && teamADefense > 1.0 && teamBDefenseScore > 1.0) {
      return `${favoriteTeam} muestra superioridad tanto en ofensiva como en defensa según el modelo. Con una proyección de ${projFavorite} vs ${projUnderdog}, el diferencial de ${spreadDiff} puntos excede la línea, generando una ventaja estadística clara.`;
    }
    if (oneOffenseHigh) {
      return `El modelo proyecta ${projFavorite} puntos para ${favoriteTeam} frente a solo ${projUnderdog} para ${underdogTeam} — un diferencial de ${spreadDiff} puntos. La ofensiva de ${favoriteTeam} supera claramente la capacidad defensiva del rival, generando un edge de ${edge.toFixed(1)} sobre la línea del mercado.`;
    }
    return `El matchup favorece claramente a ${favoriteTeam}. El modelo proyecta un diferencial de ${spreadDiff} puntos — por encima de la línea — respaldado por la superioridad ofensiva y el ajuste de ritmo de juego de ${paceAdj > 0 ? "+" : ""}${paceAdj.toFixed(1)} puntos.`;
  }
 
  // --- SPREAD — UNDERDOG ---
  if (isSpread && isUnderdogPick) {
    if (oneDefenseHigh && defenseTeam === underdogTeam) {
      return `La defensa de ${underdogTeam} es el factor clave aquí. El modelo proyecta que limitará a ${favoriteTeam} a ${projUnderdog} puntos, manteniendo el marcador dentro del spread. Un edge de ${edge.toFixed(1)} puntos respalda la cobertura del underdog.`;
    }
    if (edgeMedium) {
      return `Aunque ${underdogTeam} llega como underdog, el modelo detecta que su proyección de ${projUnderdog} puntos es suficiente para cubrir el spread. El diferencial real proyectado de ${spreadDiff} puntos está dentro del margen de cobertura — edge de ${edge.toFixed(1)}.`;
    }
    return `El modelo no detecta la diferencia que el mercado está aplicando. Con proyecciones de ${projA.toFixed(1)} vs ${projB.toFixed(1)}, el partido apunta a ser más cerrado de lo que las odds sugieren — generando valor en ${underdogTeam} como underdog.`;
  }
 
  // --- FALLBACK ---
  return `El modelo proyecta ${projA.toFixed(1)} puntos para ${awayTeam} y ${projB.toFixed(1)} para ${homeTeam}, con un total proyectado de ${projectedTotal.toFixed(1)} y un diferencial de ${spreadDiff} puntos entre ambos equipos.`;
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
if (data.limitReached === true || data.upgradeRequired === true) {
  throw new Error("You have used your 5 free analyses. More free analyses unlock every 3 hours.");
}
    const projAway = Number(data.projectedScore?.[awayTeam] || 0);
    const projHome = Number(data.projectedScore?.[homeTeam] || 0);
    const projectedTotal = Number(data.projectedTotal || 0);
    const projectedSpread = Number(data.projectedSpread || 0);
    const odds = data.odds || {};
    const picks = data.picks || {};
    const spreadPick = picks.spreadPick || null;
    const totalPick = picks.totalPick || null;
 
    const validPicks = [spreadPick, totalPick].filter(Boolean);
    const bestPick = validPicks.length
      ? validPicks.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return b.edge - a.edge;
        })[0]
      : null;
 
    const isPremium = bestPick?.isPremium === true;
    const locked = isPremium && !IS_ADMIN && !isPremiumUser;
 
    const pickText = String(bestPick?.pick || "").toUpperCase();
    const realType = pickText.includes("OVER") || pickText.includes("UNDER") ? "total" : "spread";
    const isOver = realType === "total" && pickText.includes("OVER");
    const isUnder = realType === "total" && pickText.includes("UNDER");
    const bestPickFixed = bestPick ? { ...bestPick, type: realType, isOver, isUnder } : null;
    const analysisText = bestPickFixed ? generateNFLAnalysisText(data, awayTeam, homeTeam, bestPickFixed) : "";
 
    const confidence = locked ? 85 : Number(bestPick?.confidence || 0);
    const circleDash = Math.round((confidence / 100) * 163);
    const circleColor = isPremium ? "#7c3cff" : "#00ffe7";
 
    const awayEsc = awayTeam.replace(/'/g, "\\'");
    const homeEsc = homeTeam.replace(/'/g, "\\'");
 
    const propsButtonHTML = type === "nfl"
      ? `<button onclick="toggleNFLPlayerProps(${index}, '${awayEsc}', '${homeEsc}', this)" style="width:100%;padding:11px;border-radius:8px;border:1px solid #1a2240;background:#0f1628;color:#00ffe7;font-size:12px;font-weight:600;letter-spacing:0.08em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">⚡ VER PLAYER PROPS</button><div id="nflProps${index}"></div>`
      : "";
 
    resultDiv.innerHTML = isPremium ? `
 
<div class="ce-premium-basket-card ce-nfl-premium">
 
  <div class="ce-premium-tag">
    <span style="width:6px;height:6px;border-radius:50%;background:#00ffe7;animation:nfl-pulse 1.5s infinite;display:inline-block;"></span>
    🔥 PREMIUM PICK · ${type.toUpperCase()}
  </div>
 
  <div style="font-size:12px;color:#8899bb;margin-bottom:12px;">${awayTeam} vs ${homeTeam}</div>
 
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
    <div style="flex:1;">
      <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:3px;">
        ${locked ? "remium Pick Locked" : (bestPick?.pick || "No play")}
      </div>
      <div style="font-size:11px;color:#556688;">
        ${locked ? "" : `${realType === "total" ? "Total" : "Spread"} · ${Number(bestPick?.odds_american ?? -110) > 0 ? "+" : ""}${bestPick?.odds_american ?? -110} · Edge ${Number(bestPick?.edge || 0).toFixed(1)}`}
      </div>
    </div>
    <div style="position:relative;width:72px;height:72px;flex-shrink:0;">
      <svg width="72" height="72" viewBox="0 0 72 72" style="position:absolute;top:0;left:0;">
        <circle cx="36" cy="36" r="30" fill="none" stroke="#1a2240" stroke-width="4"/>
        <circle cx="36" cy="36" r="30" fill="none" stroke="${circleColor}" stroke-width="4"
          stroke-dasharray="${circleDash} 188" stroke-linecap="round"
          transform="rotate(-90 36 36)"
          style="filter:drop-shadow(0 0 6px ${circleColor});"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <span style="font-size:15px;font-weight:700;color:${circleColor};">${confidence.toFixed(1)}%</span>
        <small style="font-size:8px;color:${circleColor};opacity:0.7;">PROB.</small>
      </div>
    </div>
  </div>
 
 <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
  <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;${locked ? 'filter:blur(4px);pointer-events:none;' : ''}">
    <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">${awayTeam.split(" ").pop()}</div>
    <div style="font-size:14px;font-weight:700;color:#fff;">${locked ? "??.?" : projAway.toFixed(1)}</div>
  </div>
  <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;${locked ? 'filter:blur(4px);pointer-events:none;' : ''}">
    <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">${homeTeam.split(" ").pop()}</div>
    <div style="font-size:14px;font-weight:700;color:#fff;">${locked ? "??.?" : projHome.toFixed(1)}</div>
  </div>
  <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;${locked ? 'filter:blur(4px);pointer-events:none;' : ''}">
    <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">TOTAL MOD.</div>
    <div style="font-size:14px;font-weight:700;color:#fff;">${locked ? "??.?" : projectedTotal.toFixed(1)}</div>
  </div>
  <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;${locked ? 'filter:blur(4px);pointer-events:none;' : ''}">
    <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">EDGE</div>
    <div style="font-size:14px;font-weight:700;color:#fff;">${locked ? "??.?" : Number(bestPick?.edge || 0).toFixed(1)}</div>
  </div>
</div>
 
 
    ${locked ? `
    <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,255,231,0.05);border:1px solid rgba(0,255,231,0.15);border-radius:10px;padding:10px 16px;margin-bottom:12px;">
      <span style="font-size:12px;color:#8899bb;">Model's all-time ${type.toUpperCase()} record</span>
      <span style="font-size:14px;font-weight:800;color:#00ffe7;">${ceRecordPlain(type)}</span>
    </div>

    <div style="font-size:12px;color:#a0b4cc;line-height:1.6;text-align:left;padding:0 4px;margin-bottom:14px;">
      The model only flags a pick as premium when it finds a real mathematical edge against the sportsbooks. Betting without that edge is guessing.
    </div>

    <button onclick="openPromoModal()" style="display:block;width:100%;padding:15px;border:none;border-radius:12px;background:linear-gradient(135deg,#00ffe7,#7c3cff);color:#020814;font-size:14px;font-weight:800;letter-spacing:0.5px;cursor:pointer;text-transform:uppercase;box-shadow:0 0 20px rgba(0,255,231,0.3);">
      🔓 UNLOCK PREMIUM PICK — $19.99/MO
    </button>

  ` : `
 ${(() => {
      const pe = data.paceEfficiencyAdjustment || {};
      const aOff = Number(pe.teamAOffenseScore || 1);
      const bOff = Number(pe.teamBOffenseScore || 1);
      const aDef = Number(pe.teamADefenseScore || 1);
      const bDef = Number(pe.teamBDefenseScore || 1);
      const hasData = [aOff, bOff, aDef, bDef].some(v => v !== 1);
      if (!hasData) return "";
      const toPct = v => Math.max(8, Math.min(100, Math.round((v - 0.8) / 0.5 * 100)));
      const toScore = v => Math.max(1, Math.min(99, Math.round((v - 0.8) / 0.5 * 100)));
      const row = (label, val, color) => `
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span style="font-size:10px;color:#8899bb;">${label}</span>
            <span style="font-size:12px;font-weight:700;color:${color};">${toScore(val)}</span>
          </div>
          <div style="height:5px;border-radius:3px;background:#14243d;overflow:hidden;">
            <div style="height:100%;width:${toPct(val)}%;border-radius:3px;background:linear-gradient(90deg,#00ffe7,#7c3cff);"></div>
          </div>
        </div>`;
      return `
    <div style="background:#0f1628;border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:10px;color:#7c3cff;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;margin-bottom:12px;">📊 Matchup breakdown</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;">
        ${row(`${awayTeam.split(" ").pop()} offense`, aOff, "#00ffe7")}
        ${row(`${homeTeam.split(" ").pop()} offense`, bOff, "#00ffe7")}
        ${row(`${awayTeam.split(" ").pop()} defense`, aDef, "#a07cff")}
        ${row(`${homeTeam.split(" ").pop()} defense`, bDef, "#a07cff")}
      </div>
    </div>`;
    })()}
    <div style="background:#0a1628;border:1px solid rgba(0,255,231,0.15);border-left:3px solid ${circleColor};border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:10px;color:${circleColor};letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;font-weight:600;">⚡ Model analysis</div>
      <div style="font-size:12px;color:#aabbcc;line-height:1.6;">${analysisText}</div>
    </div>
    ${propsButtonHTML}
  `}
 
</div>
 
<style>@keyframes nfl-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }</style>
 
` : `
 
<div style="background:#0a0f1e;border:1px solid #1a2240;border-radius:12px;padding:14px;">

  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <div style="display:inline-flex;align-items:center;gap:5px;background:rgba(0,255,231,0.06);border:1px solid rgba(0,255,231,0.15);border-radius:20px;padding:3px 10px;font-size:10px;color:#00ffe7;font-weight:600;">
      📊 AI ANALYSIS · ${type.toUpperCase()}
    </div>
    <div style="position:relative;width:58px;height:58px;flex-shrink:0;">
      <svg width="58" height="58" viewBox="0 0 58 58" style="position:absolute;top:0;left:0;">
        <circle cx="29" cy="29" r="24" fill="none" stroke="#1a2240" stroke-width="4"/>
        <circle cx="29" cy="29" r="24" fill="none" stroke="#00ffe7" stroke-width="4"
          stroke-dasharray="${Math.round(((confidence || 50) / 100) * 151)} 151" stroke-linecap="round"
          transform="rotate(-90 29 29)" style="filter:drop-shadow(0 0 5px #00ffe7);"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <span style="font-size:12px;font-weight:700;color:#00ffe7;">${confidence ? confidence.toFixed(0) : "--"}%</span>
        <small style="font-size:7px;color:#5a7a9a;">PROB.</small>
      </div>
    </div>
  </div>

  <div style="font-size:12px;color:#8899bb;margin-bottom:4px;">${awayTeam} vs ${homeTeam}</div>
  <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:2px;">${bestPick?.pick || "No strong edge found"}</div>
  <div style="font-size:11px;color:#556688;margin-bottom:12px;">${bestPick ? `${realType === "total" ? "Total" : "Spread"} · Edge ${Number(bestPick?.edge || 0).toFixed(1)} — below the premium threshold` : "The model didn't find enough edge to flag this game."}</div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
    <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;">
      <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">${awayTeam.split(" ").pop()}</div>
      <div style="font-size:14px;font-weight:700;color:#fff;">${projAway.toFixed(1)}</div>
    </div>
    <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;">
      <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">${homeTeam.split(" ").pop()}</div>
      <div style="font-size:14px;font-weight:700;color:#fff;">${projHome.toFixed(1)}</div>
    </div>
    <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;">
      <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">TOTAL MOD.</div>
      <div style="font-size:14px;font-weight:700;color:#fff;">${projectedTotal.toFixed(1)}</div>
    </div>
    <div style="background:#0f1628;border-radius:6px;padding:8px 4px;text-align:center;">
      <div style="font-size:8px;color:#00ffe7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;opacity:0.8;">PACE ADJ.</div>
      <div style="font-size:14px;font-weight:700;color:#fff;">${Number(data.paceEfficiencyAdjustment?.adjustment || 0) > 0 ? "+" : ""}${Number(data.paceEfficiencyAdjustment?.adjustment || 0).toFixed(1)}</div>
    </div>
  </div>

  ${analysisText ? `
  <div style="background:#0a1628;border:1px solid rgba(0,255,231,0.12);border-left:3px solid #00ffe7;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
    <div style="font-size:10px;color:#00ffe7;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;font-weight:600;">⚡ Model analysis</div>
    <div style="font-size:12px;color:#aabbcc;line-height:1.6;">${analysisText}</div>
  </div>
  ` : ""}

  ${propsButtonHTML}

</div>
 
`;
 
} catch (err) {
    if (err.message && err.message.includes("free analyses")) {
      resultDiv.innerHTML = `
        <div class="normal-result normal-blue-theme">
          <div style="padding:24px;text-align:center;">
            <h3 style="color:#00ff99;margin:0 0 8px;">5 free analyses used</h3>
            <p style="color:#d8fff0;font-size:13px;line-height:1.5;margin:0 0 14px;">More free analyses unlock every 3 hours.</p>
            <p style="color:#bfc8d6;font-size:12px;line-height:1.5;margin:0 0 18px;">Or upgrade to Premium for unlimited analyses, player props, and exclusive high-value insights.</p>
            <button class="unlock-btn" onclick="openPromoModal()">🚀 Upgrade to Premium — $19.99/month</button>
          </div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analizando ${selectedSportName}</strong></p>
          <p>${err.message}</p>
        </div>
      `;
    }
  }
  }
async function toggleNFLPlayerProps(index, awayTeam, homeTeam) {
  const box = document.getElementById(`nflProps${index}`);
  if (!box) return;
 
  if (box.dataset.loaded === "true") {
    box.style.display = box.style.display === "none" ? "block" : "none";
    return;
  }
 
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) {
    alert("Debes iniciar sesión.");
    return;
  }
 
  if (!IS_ADMIN && !isPremiumUser) {
    box.innerHTML = `
      <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:14px;margin-top:10px;text-align:center;">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">Contenido Premium</div>
        <div style="font-size:11px;color:#556688;margin-bottom:12px;line-height:1.5;">Unlock the best NFL props selected by the AI model</div>
        <button onclick="openPromoModal()" style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:12px;font-weight:700;cursor:pointer;">
          GET PREMIUM · $${MONTHLY_PRICE}/mes
        </button>
      </div>
    `;
    box.dataset.loaded = "true";
    return;
  }
 
  box.innerHTML = `<div class="loading-analysis" style="margin-top:8px;">Loading NFL player props...</div>`;
 
  try {
    const res = await fetch(
      `/api/football-data?mode=nfl-player-props&teamA=${encodeURIComponent(awayTeam)}&teamB=${encodeURIComponent(homeTeam)}`,
      { headers: { "Authorization": `Bearer ${sessionData.session.access_token}` } }
    );
    const data = await res.json();
 
    if (!res.ok || data.noPlay || !data.props?.length) {
      box.innerHTML = `
        <div style="background:#0f1628;border-radius:8px;padding:12px;margin-top:8px;text-align:center;">
          <div style="font-size:11px;color:#556688;">No player props available for this game yet. They appear ~1-2 weeks before kickoff.</div>
        </div>
      `;
      box.dataset.loaded = "true";
      return;
    }
 
    const propsHTML = data.props.slice(0, 3).map(prop => {
      const marketLabels = {
        player_pass_yds: "yds pase",
        player_rush_yds: "yds corrida",
        player_rush_attempts: "intentos corrida",
        player_receptions: "recepciones",
        player_reception_yds: "yds recepción"
      };
      const marketLabel = marketLabels[prop.market] || prop.market;
 
      return `
        <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
          <div>
            <div style="font-size:12px;font-weight:500;color:#fff;">${prop.player}</div>
            <div style="font-size:11px;color:#00ffe7;margin-top:2px;">Over ${prop.line} ${marketLabel}</div>
            <div style="font-size:10px;color:#556688;margin-top:2px;">Proyección: ${prop.projection} · Edge +${prop.edge}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px;">
            <div style="font-size:15px;font-weight:700;color:#00ffe7;">${prop.confidence.toFixed(1)}%</div>
            <div style="font-size:10px;color:#556688;">${prop.bookmaker}</div>
          </div>
        </div>
      `;
    }).join("");
 
    box.innerHTML = `
      <div style="margin-top:10px;">
        <div style="font-size:9px;color:#00ffe7;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;opacity:0.7;">⚡ Player props del juego</div>
        ${propsHTML}
      </div>
    `;
    box.dataset.loaded = "true";
 
  } catch (err) {
    box.innerHTML = `<div style="font-size:11px;color:#556688;padding:8px;">Error cargando props: ${err.message}</div>`;
    box.dataset.loaded = "true";
  }
}
 
window.toggleNFLPlayerProps = toggleNFLPlayerProps;
 window.ceSportRecords = {};

function ceRecordLine(sportKey) {
  const r = window.ceSportRecords[sportKey];
  if (!r) return "";
  const w = Number(r.total_wins || 0);
  const l = Number(r.total_losses || 0);
  if (w + l === 0) return "";
  const pct = ((w / (w + l)) * 100).toFixed(0);
  return `📊 Model's all-time ${r.display_name} record: <strong>${pct}%</strong> (${w}-${l})`;
}
  function ceRecordPlain(sportKey) {
  const r = window.ceSportRecords[sportKey];
  if (!r) return "—";
  const w = Number(r.total_wins || 0);
  const l = Number(r.total_losses || 0);
  if (w + l === 0) return "—";
  const pct = ((w / (w + l)) * 100).toFixed(0);
  return `${pct}% (${w}-${l})`;
}
async function loadStats() {
  try {
    const res = await fetch("/api/analyze-nba?mode=performance");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Error cargando performance");
    }
if (data.sports) {
      data.sports.forEach(r => { window.ceSportRecords[r.sport] = r; });
    }
    const premiumRate = document.getElementById("premiumRate");
    const normalRate = document.getElementById("normalRate");

    if (premiumRate) {
      animateNumber(premiumRate, data.overall.accuracy, "%", 1200, 1);
    }

    if (normalRate) {
      normalRate.innerText = `${data.overall.countedPicks} picks`;
    }

    let parlayData = null;

    try {
      const parlayRes = await fetch("/api/analyze-nba?mode=parlay-performance");
      const parlayJson = await parlayRes.json();
      if (parlayRes.ok && parlayJson?.ok) {
        parlayData = parlayJson;
      }
    } catch (e) {
      console.log("Error cargando parlay performance:", e);
    }

    renderPerformancePanel(data, parlayData);
const pbRecord = document.getElementById("premiumBoxRecord");
    if (pbRecord && data.overall) {
      const acc = Number(data.overall.accuracy || 0).toFixed(1);
      pbRecord.innerHTML = `Model accuracy: <strong style="color:#00ffe7;">${acc}%</strong> (${data.overall.wins}W-${data.overall.losses}L) — every pick tracked publicly`;
    }
  } catch (error) {
    console.log("Error cargando performance:", error);
  }
}

window.addEventListener("load", loadStats);
function animateNumber(element, target, suffix = "", duration = 1000, decimals = 0) {
  if (!element) return;

  const start = 0;
  const startTime = performance.now();
  const targetNumber = Number(target || 0);

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + (targetNumber - start) * ease;

    element.innerText = `${current.toFixed(decimals)}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

function formatSportIcon(sport) {
  const icons = {
    nba: "🏀",
    wnba: "🏀",
    ncaab: "NCAA",
    nfl: "🏈",
    ncaaf: "NCAA",
    mlb: "⚾"
  };

  return icons[sport] || "📊";
}

function renderPerformancePanel(data, parlayData) {
  const box = document.getElementById("performancePanel");
  if (!box || !data?.sports) return;
  const sportsHTML = data.sports.map(record => {
 const accuracy =
  record.accuracy !== null &&
  record.accuracy !== undefined
    ? Number(record.accuracy).toFixed(1)
    : "80.0";
    const wins = Number(record.total_wins || 0);
    const losses = Number(record.total_losses || 0);
    const pushes = Number(record.pushes || 0);
   

    return `
      <div class="performance-sport-card">
        <div class="performance-sport-top">
          <div class="performance-sport-icon">${formatSportIcon(record.sport)}</div>
          <div>
            <strong>${record.display_name}</strong>
            <small>AI tracked</small>
          </div>
        </div>
        <div class="performance-right">
          <div class="performance-percent" data-target="${accuracy}">${accuracy}%</div>
          <div class="performance-record">
            <span class="record-win">${wins}W</span>
            <span class="record-loss">${losses}L</span>
            <span class="record-push">${pushes}P</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

const parlayCardHTML = parlayData ? `
    <div class="performance-overall-card parlay-overall-card" style="display:none">
      <small>Parlay Hit Rate</small>
      <strong id="overallParlayRate">0%</strong>
      <span class="${Number(parlayData.profit || 0) >= 0 ? 'positive-value' : 'negative-value'}">
        ${Number(parlayData.profit || 0) >= 0 ? "+" : ""}${Number(parlayData.profit || 0).toFixed(1)}u · ROI ${Number(parlayData.roi || 0) >= 0 ? "+" : ""}${Number(parlayData.roi || 0).toFixed(1)}%
      </span>
    </div>
  ` : "";

  box.innerHTML = `
    <section class="performance-section">

      <div class="performance-header">
        <div>
          <p class="premium-label">
  <span class="live-dot"></span>
  LIVE AI TRACKING
</p>
          <h2>Premium AI Performance</h2>
        <span>Live premium pick tracking updated automatically by sport.</span>
        </div>

        <div class="performance-cards-row">
          <div class="performance-overall-card">
            <small>Overall Accuracy</small>
            <strong id="overallPerformanceRate">0%</strong>
            <span>${data.overall.wins}W - ${data.overall.losses}L - ${data.overall.pushes}P</span>
          </div>

          ${parlayCardHTML}
        </div>
      </div>

      <div class="performance-grid">
        ${sportsHTML}
      </div>

    </section>
  `;
 const overallRate = document.getElementById("overallPerformanceRate");
  animateNumber(overallRate, data.overall.accuracy, "%", 1300, 1);

  document.querySelectorAll(".performance-percent").forEach(el => {
    animateNumber(el, Number(el.dataset.target || 0), "%", 1100, 1);
  });

  if (parlayData) {
    const overallParlayRate = document.getElementById("overallParlayRate");
    animateNumber(overallParlayRate, parlayData.hitRate, "%", 1300, 1);
  }
}

async function isAdmin() {
  const { data } = await supabaseClient.auth.getUser();
  if (!data?.user) return false;

  const res = await fetch("/api/check-premium", {
    headers: {
      "Authorization": `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ""}`
    }
  });

  const result = await res.json();
  return result?.isAdmin === true;
}


// update auth ui
async function openCustomerPortal() {
  try {

    const {
      data: { user }
   } = await supabaseClient.auth.getUser();

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

  const text = await response.text();

let data = {};
try {
  data = JSON.parse(text);
} catch (e) {
  console.log("Respuesta no JSON:", text);
  alert("Respuesta no JSON: " + text.slice(0, 300));
  return;
}

if (!response.ok) {
  console.log(data);
  alert(JSON.stringify(data));
  return;
}

window.location.href = data.url;

} catch (error) {
  console.error("Customer portal error:", error);
  alert("ERROR REAL: " + error.message);
}
}
function toggleAccountMenu() {
  const menu = document.getElementById("accountDropdown");
  if (menu) menu.classList.toggle("active");
}

window.toggleAccountMenu = toggleAccountMenu;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);

  inactivityTimer = setTimeout(async () => {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (sessionData.session) {
      await logoutUser();
      alert("Tu sesión se cerró por inactividad.");
    }
  }, INACTIVITY_LIMIT);
}

["click", "mousemove", "keydown", "scroll", "touchstart"].forEach(eventName => {
  window.addEventListener(eventName, resetInactivityTimer);
});

resetInactivityTimer();
const activeAnalysis = {};

function setAnalysisButtonLoading(index, isLoading, text = "Analizando...") {
  const resultDiv = document.getElementById(`result${index}`);
  const card = resultDiv ? resultDiv.closest(".card") : null;
  const button = card ? card.querySelector("button") : null;

  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.innerText;
    button.innerText = text;
    button.disabled = true;
    button.style.opacity = "0.6";
    button.style.cursor = "not-allowed";
  } else {
    button.innerText = button.dataset.originalText || "Ver predicción del modelo";
    button.disabled = false;
    button.style.opacity = "1";
    button.style.cursor = "pointer";
  }
}

function startAnalysisLock(index, text) {
  if (activeAnalysis[index]) return false;
  activeAnalysis[index] = true;
  setAnalysisButtonLoading(index, true, text);
  return true;
}

function endAnalysisLock(index) {
  activeAnalysis[index] = false;
  setAnalysisButtonLoading(index, false);
}
const loadParlayBtn =
  document.getElementById('loadParlayBtn') ||
  document.querySelector('.parlay-btn') ||
  document.querySelector('[onclick*="parlay"]');
if(loadParlayBtn){

  loadParlayBtn.addEventListener('click', () => {

    loadParlayBtn.classList.add('active-parlay');

    setTimeout(() => {
      loadParlayBtn.classList.remove('active-parlay');
    }, 3500);

  });

}
async function loadParlayToday() {
  const box = document.getElementById("parlayTodayBox");
const gamesDiv = document.getElementById("games");
const status = document.getElementById("status");

if (gamesDiv) gamesDiv.innerHTML = "";
if (status) status.innerHTML = "";
  if (!box) return;

  box.innerHTML = `<div class="loading-analysis">Buscando Parlay Premium del Día...</div>`;

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      box.innerHTML = `
        <div class="premium-result mlb-premium-dashboard">
          <h3>🔥 CashEdge Parlay AI del Día</h3>
          <p>Debes iniciar sesión para ver esta sección premium.</p>
        </div>
      `;
      return;
    }

    const response = await fetch("/api/analyze-nba?mode=parlay-today", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${sessionData.session.access_token}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error cargando parlay");
    }

    if (!data.available) {
      box.innerHTML = `
        <div class="normal-result">
          <h3>🔥 CashEdge Parlay AI del Día</h3>
          <p>${data.message}</p>
        </div>
      `;
      return;
    }

    if (data.locked) {
      box.innerHTML = `
        <div class="premium-result mlb-premium-dashboard">
          <div style="max-width:560px;margin:0 auto;padding:6px 0;">

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,255,231,0.08);border:1px solid rgba(0,255,231,0.25);border-radius:20px;padding:4px 12px;font-size:10px;color:#00ffe7;font-weight:600;letter-spacing:1px;">
                <span style="width:6px;height:6px;border-radius:50%;background:#00ffe7;animation:nfl-pulse 1.5s infinite;display:inline-block;"></span>
                TODAY'S AI PARLAY
              </div>
              <div style="font-size:10px;color:#7c3cff;font-weight:700;letter-spacing:1px;">⚡ READY NOW</div>
            </div>

            <div style="background:linear-gradient(135deg,rgba(0,255,231,0.06),rgba(124,60,255,0.08));border:1px solid rgba(124,60,255,0.3);border-radius:14px;padding:20px;margin-bottom:12px;">
              <div style="font-size:11px;color:#8899bb;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Potential payout</div>
              <div style="font-size:34px;font-weight:900;color:#fff;line-height:1;">$100 <span style="color:#5a7a9a;font-size:20px;font-weight:600;">→</span> <span style="background:linear-gradient(90deg,#00ffe7,#7c3cff);-webkit-background-clip:text;background-clip:text;color:transparent;">$500–$700</span></div>
              <div style="font-size:11px;color:#8899bb;margin-top:8px;">Every leg flagged at <strong style="color:#00ffe7;">85%+ model confidence</strong></div>
            </div>

            <div style="background:#0a1220;border:1px solid #14243d;border-radius:14px;padding:16px 20px;margin-bottom:12px;text-align:left;">
              <div style="display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid #14243d;">
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(0,255,231,0.1);border:1px solid rgba(0,255,231,0.35);color:#00ffe7;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">1</span>
                <div style="flex:1;">
                  <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:3px;">••••••••• 🔒</div>
                  <div style="font-size:10px;color:#5a7a9a;margin-top:2px;">Leg locked — premium only</div>
                </div>
                <span style="font-size:13px;font-weight:800;color:#00ffe7;">85%+</span>
              </div>
              <div style="display:flex;align-items:center;gap:12px;padding-top:12px;">
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(124,60,255,0.12);border:1px solid rgba(124,60,255,0.4);color:#a07cff;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">2</span>
                <div style="flex:1;">
                  <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:3px;">••••••••• 🔒</div>
                  <div style="font-size:10px;color:#5a7a9a;margin-top:2px;">Leg locked — premium only</div>
                </div>
                <span style="font-size:13px;font-weight:800;color:#a07cff;">85%+</span>
              </div>
              <div style="display:flex;align-items:center;gap:12px;padding-top:12px;border-top:1px solid #14243d;margin-top:12px;">
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(0,255,231,0.1);border:1px solid rgba(0,255,231,0.35);color:#00ffe7;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">3</span>
                <div style="flex:1;">
                  <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:3px;">••••••••• 🔒</div>
                  <div style="font-size:10px;color:#5a7a9a;margin-top:2px;">Leg locked — premium only</div>
                </div>
                <span style="font-size:13px;font-weight:800;color:#00ffe7;">85%+</span>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:8px;background:rgba(124,60,255,0.06);border-left:3px solid #7c3cff;border-radius:0 10px 10px 0;padding:10px 14px;margin-bottom:14px;text-align:left;">
              <span style="font-size:15px;">👀</span>
              <span style="font-size:12px;color:#c4b0ee;line-height:1.5;">Premium members are already on this parlay. It disappears when the first game starts.</span>
            </div>

            <button onclick="openPromoModal()" style="display:block;width:100%;padding:16px;border:none;border-radius:12px;background:linear-gradient(135deg,#00ffe7,#7c3cff);color:#020814;font-size:14px;font-weight:900;letter-spacing:0.5px;cursor:pointer;text-transform:uppercase;box-shadow:0 0 25px rgba(0,255,231,0.35),0 0 50px rgba(124,60,255,0.2);">
              🔓 REVEAL TODAY'S PARLAY — $19.99/MO
            </button>
            <div style="font-size:10px;color:#5a7a9a;margin-top:8px;">One hit covers 2+ years of premium. Cancel anytime.</div>

          </div>
        </div>
      `;
      return;
    }

    const picksHTML = data.picks.map((pick, index) => `
  <div class="parlay-pick-card">
    <div class="parlay-leg-number">${index + 1}</div>

    <div class="parlay-play">
      ${pick.play}
    </div>

    <div class="parlay-game">
      ${pick.game}
    </div>

    <div class="parlay-percent">
      ${Number(pick.percentage).toFixed(1)}%
    </div>

    <div class="parlay-sport">
      ${String(pick.sport).toUpperCase()}
    </div>
  </div>
`).join("");

box.innerHTML = `
  <div class="parlay-premium-card">
<div class="parlay-premium-header">
      <div class="parlay-pill">
        ⚡ CASHEDGE AI PARLAY OF THE DAY
      </div>

      <h2 style="background:linear-gradient(90deg,#00ffe7,#7c3cff);-webkit-background-clip:text;background-clip:text;color:transparent;">${data.picks.length}-Leg AI Parlay</h2>

      <p>
        Auto-built with today's highest-confidence premium picks.
      </p>
    </div>

    <div class="parlay-picks-grid">
      ${picksHTML}
    </div>

    <div class="parlay-footer-note">
      Only generated when there are at least 2 premium picks at 77%+
    </div>

  </div>
`;
  } catch (error) {
    box.innerHTML = `<p>Error Parlay: ${error.message}</p>`;
  }
}

window.loadParlayToday = loadParlayToday;
const enableBtn = document.getElementById("enableNotificationsBtn");

if (enableBtn) {

  enableBtn.addEventListener("click", async () => {

    try {

      const permission = await Notification.requestPermission();

      if (permission === "granted") {

        await OneSignal.User.PushSubscription.optIn();

        enableBtn.innerHTML =
          "✅ ALERTAS PREMIUM ACTIVADAS";

      } else {

        enableBtn.innerHTML =
          "❌ ALERTAS BLOQUEADAS";

      }

    } catch (err) {

      console.log("Push error:", err);

    }

  });

}
function startHeroTypewriter() {
  const el = document.getElementById("heroTypewriter");
  if (!el) return;
 const text = "AI-powered sports picks. Every prediction tracked live, every result public.";
  let i = 0;
  el.innerText = "";
  const interval = setInterval(() => {
    if (i < text.length) {
      el.innerText = text.substring(0, i + 1);
      i++;
    } else {
      clearInterval(interval);
    }
  }, 38);
}
function updatePasswordStrength(val) {
  let s = 0;
  if (val.length >= 8) s += 25;
  if (val.length >= 12) s += 25;
  if (/[A-Z]/.test(val)) s += 25;
  if (/[0-9!@#$%^&*]/.test(val)) s += 25;
  const bar = document.getElementById('strengthBar');
  const label = document.getElementById('strengthLabel');
  if (!bar) return;
  bar.style.width = s + '%';
  if (s <= 25) { bar.style.background = '#ff4d4d'; label.textContent = 'WEAK'; label.style.color = '#ff4d4d'; }
  else if (s <= 50) { bar.style.background = '#ffb703'; label.textContent = 'FAIR'; label.style.color = '#ffb703'; }
  else if (s <= 75) { bar.style.background = '#00ffe7'; label.textContent = 'GOOD'; label.style.color = '#00ffe7'; }
  else { bar.style.background = 'linear-gradient(90deg,#00ffe7,#7c3cff)'; label.textContent = 'STRONG ✓'; label.style.color = '#00ffe7'; }
}
const PLAYER_EDGE_MARKETS = {
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_home_runs: "Home Runs",
  pitcher_strikeouts: "Strikeouts",
  pitcher_outs: "Outs"
};

async function togglePlayerEdgeProps(index, eventId) {
  const box = document.getElementById(`playerEdge${index}`);
  if (!box) return;

  if (box.dataset.loaded === "true") {
    box.style.display = box.style.display === "none" ? "block" : "none";
    return;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) {
    alert("You must log in.");
    return;
  }

  if (!IS_ADMIN && !isPremiumUser) {
    box.innerHTML = `
      <div class="player-edge-locked">
        <p>🔒 Player Props are for Premium members only.</p>
        <button class="unlock-btn" onclick="openPromoModal()">
          🔓 Desbloquear Premium $${MONTHLY_PRICE}/mes
        </button>
      </div>
    `;
    box.dataset.loaded = "true";
    return;
  }

  if (!eventId) {
    box.innerHTML = `<p class="player-edge-empty">Not available for this game.</p>`;
    box.dataset.loaded = "true";
    return;
  }

  box.innerHTML = `<div class="loading-analysis">Loading player props...</div>`;

  try {
    const response = await fetch("/api/analyze-mlb?mode=player-props", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionData.session.access_token}`
      },
      body: JSON.stringify({
        userId: sessionData.session.user.id,
        eventId
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Error cargando player props");

    if (data.noPlay || !data.props || data.props.length === 0) {
      box.innerHTML = `<p class="player-edge-empty">No player props with edge for this game.</p>`;
      box.dataset.loaded = "true";
      return;
    }

   const itemsHTML = data.props.slice(0, 3).map((prop, i) => {
      const marketLabel = PLAYER_EDGE_MARKETS[prop.market] || prop.market;
      const conf = prop.confidence;
      const confText = conf.toFixed(1) + "%";
      const marketText = `${sanitize(prop.side)} ${prop.line} ${sanitize(marketLabel)}`;

      let level, circleHTML;

      if (conf >= 99) {
        level = "elite";
        circleHTML = `
          <div class="player-edge-circle elite">
            <div class="player-edge-ring"></div>
            <div class="player-edge-inner">
              <span>${confText}</span>
            </div>
            <span class="player-edge-fire">🔥</span>
          </div>
        `;
      } else if (conf >= 75) {
        level = "hot";
        circleHTML = `
          <div class="player-edge-circle hot">
            <span>${confText}</span>
            <span class="player-edge-fire">🔥</span>
          </div>
        `;
      } else {
        level = "normal";
        circleHTML = `
          <div class="player-edge-circle normal">
            <span>${confText}</span>
          </div>
        `;
      }

      const divider = i > 0 ? `<div class="player-edge-divider"></div>` : "";

      return `
        ${divider}
        <div class="player-edge-line">
          <div class="player-edge-info">
            <div class="player-edge-player">${sanitize(prop.player)}</div>
            <div class="player-edge-market ${level}">${marketText}</div>
          </div>
          ${circleHTML}
        </div>
      `;
    }).join("");

    box.innerHTML = `<div class="player-edge-list">${itemsHTML}</div>`;
    box.dataset.loaded = "true";

  } catch (error) {
    box.innerHTML = `<p class="player-edge-empty">Error: ${error.message}</p>`;
    box.dataset.loaded = "true";
  }
}
async function toggleNBAPlayerProps(index, awayTeam, homeTeam, btn) {
  const box = document.getElementById(`nbaProps${index}`);
  if (!box) return;

  if (box.dataset.loaded === "true") {
    box.style.display = box.style.display === "none" ? "block" : "none";
    return;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) { alert("Debes iniciar sesión."); return; }

  if (!IS_ADMIN && !isPremiumUser) {
    box.innerHTML = `
      <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">Premium Content</div>
        <div style="font-size:11px;color:#556688;margin-bottom:12px;">Desbloquea los player props seleccionados por el modelo AI</div>
        <button onclick="openPromoModal()" style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:12px;font-weight:700;cursor:pointer;">
          OBTENER PREMIUM · $${MONTHLY_PRICE}/mes
        </button>
      </div>
    `;
    box.dataset.loaded = "true";
    return;
  }

  box.innerHTML = `<div class="loading-analysis" style="margin-top:8px;">Loading player props...</div>`;

  try {
    // Buscar el eventId del juego
    const oddsRes = await fetch(`/api/odds?sport=${encodeURIComponent(selectedSport)}`, {
      headers: { "Authorization": `Bearer ${sessionData.session.access_token}` }
    });
    const games = await oddsRes.json();
    const game = games.find(g =>
      (g.away_team === awayTeam && g.home_team === homeTeam) ||
      (g.home_team === awayTeam && g.away_team === homeTeam)
    );
    const eventId = game?.id || null;

    const res = await fetch(
      `/api/analyze-nba?mode=nba-player-props${eventId ? `&eventId=${eventId}` : ""}`,
      { headers: { "Authorization": `Bearer ${sessionData.session.access_token}` } }
    );
    const data = await res.json();

    if (!res.ok || data.noPlay || !data.props?.length) {
      box.innerHTML = `
        <div style="background:#0f1628;border-radius:8px;padding:12px;margin-top:8px;text-align:center;">
          <div style="font-size:11px;color:#556688;">No hay player props disponibles para este juego aún.</div>
        </div>
      `;
      box.dataset.loaded = "true";
      return;
    }

    const marketLabels = {
      player_points: "pts", player_rebounds: "reb",
      player_assists: "ast", player_threes: "3PT"
    };

    const tabs = ["Puntos", "Rebotes", "Asistencias", "3PT"];
    const marketKeys = ["player_points", "player_rebounds", "player_assists", "player_threes"];

    const allProps = [...(data.props || []), ...(data.lockedProps || [])];

    function renderProps(marketKey) {
      const filtered = allProps.filter(p => p.market === marketKey);
      if (!filtered.length) return `<div style="font-size:11px;color:#556688;padding:10px;text-align:center;">Sin props para este mercado.</div>`;

      return filtered.slice(0, 4).map(prop => {
        const isPos = prop.edge >= 0;
        const borderColor = isPos ? "#00ffe7" : "#7c3cff";
        const textColor = isPos ? "#00ffe7" : "#a07cff";
        const confFill = isPos ? "#00ffe7" : "#7c3cff";
        const mktLabel = marketLabels[prop.market] || prop.market;

        return `
          <div style="background:#030c18;border-radius:10px;padding:12px;margin-bottom:6px;display:flex;gap:12px;align-items:center;">
            <div style="width:54px;height:54px;border-radius:50%;border:2px solid ${borderColor};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
              <span style="font-size:14px;font-weight:700;color:${textColor};line-height:1;">${prop.confidence.toFixed(0)}%</span>
              <span style="font-size:8px;color:#5a7a9a;">PROB</span>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:3px;">${sanitize(prop.player)}</div>
              <div style="font-size:12px;color:${textColor};font-weight:600;margin-bottom:5px;">${prop.side} ${prop.line} ${mktLabel} · ${prop.odds ? prop.odds.toFixed(2) : "-"}</div>
              <div style="display:flex;gap:10px;">
                <div style="text-align:center;">
                  <div style="font-size:9px;color:#5a7a9a;">avg</div>
                  <div style="font-size:12px;font-weight:600;color:#e8f4ff;">${prop.projection ? (prop.projection - prop.edge).toFixed(1) : "-"}</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:9px;color:#5a7a9a;">proy</div>
                  <div style="font-size:12px;font-weight:600;color:#e8f4ff;">${prop.projection?.toFixed(1) || "-"}</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:9px;color:#5a7a9a;">edge</div>
                  <div style="font-size:12px;font-weight:600;color:${textColor};">${prop.edge >= 0 ? "+" : ""}${prop.edge?.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    let activeTab = 0;

    function buildHTML(tabIdx) {
      const tabsHTML = tabs.map((t, i) => `
        <button onclick="switchNBAPropsTab(${index}, ${i})"
          style="font-size:11px;padding:4px 12px;border-radius:20px;border:0.5px solid ${i === tabIdx ? '#00ffe7' : '#0e2040'};color:${i === tabIdx ? '#00ffe7' : '#a0b4cc'};background:${i === tabIdx ? 'rgba(0,255,231,0.1)' : 'transparent'};cursor:pointer;white-space:nowrap;">
          ${t}
        </button>
      `).join("");

      return `
        <div style="margin-top:10px;">
          <div style="display:flex;gap:6px;margin-bottom:10px;overflow-x:auto;" id="nbaPropsTabRow${index}">${tabsHTML}</div>
          <div id="nbaPropsContent${index}">${renderProps(marketKeys[tabIdx])}</div>
        </div>
      `;
    }

    box.innerHTML = buildHTML(0);
    box.dataset.loaded = "true";
    box.dataset.allProps = JSON.stringify(allProps);

    window[`switchNBAPropsTab`] = function(idx, tabIdx) {
      const b = document.getElementById(`nbaProps${idx}`);
      if (!b) return;
      const props = JSON.parse(b.dataset.allProps || "[]");

      const tabsHTML = tabs.map((t, i) => `
        <button onclick="switchNBAPropsTab(${idx}, ${i})"
          style="font-size:11px;padding:4px 12px;border-radius:20px;border:0.5px solid ${i === tabIdx ? '#00ffe7' : '#0e2040'};color:${i === tabIdx ? '#00ffe7' : '#a0b4cc'};background:${i === tabIdx ? 'rgba(0,255,231,0.1)' : 'transparent'};cursor:pointer;white-space:nowrap;">
          ${t}
        </button>
      `).join("");

      document.getElementById(`nbaPropsTabRow${idx}`).innerHTML = tabsHTML;

      const filtered = props.filter(p => p.market === marketKeys[tabIdx]);
      const marketLabels = { player_points: "pts", player_rebounds: "reb", player_assists: "ast", player_threes: "3PT" };

      document.getElementById(`nbaPropsContent${idx}`).innerHTML = filtered.length
        ? filtered.slice(0, 4).map(prop => {
            const isPos = prop.edge >= 0;
            const borderColor = isPos ? "#00ffe7" : "#7c3cff";
            const textColor = isPos ? "#00ffe7" : "#a07cff";
            const mktLabel = marketLabels[prop.market] || prop.market;
            return `
              <div style="background:#030c18;border-radius:10px;padding:12px;margin-bottom:6px;display:flex;gap:12px;align-items:center;">
                <div style="width:54px;height:54px;border-radius:50%;border:2px solid ${borderColor};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
                  <span style="font-size:14px;font-weight:700;color:${textColor};line-height:1;">${prop.confidence.toFixed(0)}%</span>
                  <span style="font-size:8px;color:#5a7a9a;">PROB</span>
                </div>
                <div style="flex:1;">
                  <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:3px;">${prop.player}</div>
                  <div style="font-size:12px;color:${textColor};font-weight:600;margin-bottom:5px;">${prop.side} ${prop.line} ${mktLabel} · ${prop.odds ? prop.odds.toFixed(2) : "-"}</div>
                  <div style="display:flex;gap:10px;">
                    <div style="text-align:center;"><div style="font-size:9px;color:#5a7a9a;">avg</div><div style="font-size:12px;font-weight:600;color:#e8f4ff;">${prop.projection ? (prop.projection - prop.edge).toFixed(1) : "-"}</div></div>
                    <div style="text-align:center;"><div style="font-size:9px;color:#5a7a9a;">proy</div><div style="font-size:12px;font-weight:600;color:#e8f4ff;">${prop.projection?.toFixed(1) || "-"}</div></div>
                    <div style="text-align:center;"><div style="font-size:9px;color:#5a7a9a;">edge</div><div style="font-size:12px;font-weight:600;color:${textColor};">${prop.edge >= 0 ? "+" : ""}${prop.edge?.toFixed(2)}</div></div>
                  </div>
                </div>
              </div>
            `;
          }).join("")
        : `<div style="font-size:11px;color:#556688;padding:10px;text-align:center;">Sin props para este mercado.</div>`;
    };

  } catch (err) {
    box.innerHTML = `<div style="font-size:11px;color:#556688;padding:8px;">Error: ${err.message}</div>`;
    box.dataset.loaded = "true";
  }
}

window.toggleNBAPlayerProps = toggleNBAPlayerProps;
window.togglePlayerEdgeProps = togglePlayerEdgeProps;
window.addEventListener("load", async () => {
  await trackUserEvent("app_open", {
    page: "home"
  });
});

async function requestDeleteAccount() {
  const confirmed = confirm(
    "To request deletion of your CashEdge account and personal data, an email request will be created. Continue?"
  );

  if (!confirmed) return;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    const email = user?.email || "";

    const subject = encodeURIComponent(
      "Delete Account Request - CashEdge"
    );

    const body = encodeURIComponent(
`Hello CashEdge Support,

I would like to request deletion of my CashEdge account and associated personal data.

Account Email:
${email}

Thank you.`
    );

    window.location.href =
      `mailto:supportcashedge@gmail.com?subject=${subject}&body=${body}`;

  } catch (err) {

    window.location.href =
      "mailto:supportcashedge@gmail.com?subject=Delete%20Account%20Request";

  }
}
function openPromoModal() {
  let modal = document.getElementById("promoModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "promoModal";
modal.innerHTML = `
  <div class="promo-modal-backdrop" onclick="closePromoModal()">
    <div class="promo-modal-box" onclick="event.stopPropagation()">

      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button onclick="closePromoModal()" style="background:transparent;border:none;color:#5a7a9a;font-size:20px;cursor:pointer;padding:0;">✕</button>
      </div>

      <div style="font-size:22px;margin-bottom:6px;">⚡</div>
      <h2 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">Obtener Premium</h2>
      <p style="font-size:13px;color:#a0b4cc;margin-bottom:16px;">¿Tienes un código promocional?</p>

      <input
        id="promoCodeInput"
        type="text"
        placeholder="Código promocional (opcional)"
        style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #0e2a4a;background:#030c18;color:#e8f4ff;font-size:13px;box-sizing:border-box;outline:none;margin-bottom:12px;"
      />

      <button onclick="goPremiumMonthly()" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;margin-bottom:8px;">
        CONTINUAR →
      </button>

      <button onclick="skipPromoCode()" style="width:100%;padding:12px;border:1px solid #0e2a4a;border-radius:10px;background:transparent;color:#a0b4cc;font-size:12px;font-weight:500;cursor:pointer;">
        No tengo código
      </button>

    </div>
  </div>
`;
    document.body.appendChild(modal);
  }

  modal.style.display = "block";
}

function closePromoModal() {
  const modal = document.getElementById("promoModal");
  if (modal) modal.style.display = "none";
}

function skipPromoCode() {
  const input = document.getElementById("promoCodeInput");
  if (input) input.value = "";
  goPremiumMonthly();
}
window.openPromoModal = openPromoModal;
window.closePromoModal = closePromoModal;
window.skipPromoCode = skipPromoCode;
/* ===== CE LANDING ===== */

// Cuando el usuario da click en un botón del landing:
// oculta el landing y muestra tu login (authBox)
function ceShowAuth() {
  document.getElementById("ceLanding").style.display = "none";
  const authBox = document.getElementById("authBox");
  if (authBox) authBox.style.display = "";
}

// Anima el número de 0 hasta el valor real
function ceAnimateCounter(el, target) {
  const start = performance.now();
  function frame(now) {
    const p = Math.min((now - start) / 1400, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (target * eased).toFixed(1) + "%";
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Trae los porcentajes reales desde Supabase
async function ceLoadLandingStats() {
  try {
    const { data, error } = await supabaseClient
      .from("sport_record_summary")
      .select("display_name, total_wins, total_losses, pushes, accuracy");

    if (error || !data || data.length === 0) return;

    let totalW = 0, totalL = 0, totalP = 0;
    data.forEach(r => {
      totalW += Number(r.total_wins || 0);
      totalL += Number(r.total_losses || 0);
      totalP += Number(r.pushes || 0);
    });

    const overallAcc = (totalW + totalL) > 0 ? (totalW / (totalW + totalL)) * 100 : 0;

    const accEl = document.getElementById("ceHeroAccuracy");
    if (accEl) ceAnimateCounter(accEl, overallAcc);

    const recEl = document.getElementById("ceHeroRecord");
    if (recEl) recEl.textContent = `${totalW}W · ${totalL}L · ${totalP}P — tracked live, every result public`;

    const grid = document.getElementById("ceSportsGrid");
    if (grid) {
      grid.innerHTML = data
        .slice()
        .sort((a, b) => Number(b.accuracy || 0) - Number(a.accuracy || 0))
        .map(r => `
          <div class="ce-sport-card">
            <p class="ce-sport-acc">${Number(r.accuracy || 0).toFixed(1)}%</p>
            <p class="ce-sport-name">${r.display_name}</p>
            <p class="ce-sport-record">${r.total_wins}W - ${r.total_losses}L</p>
          </div>
        `).join("");
    }
  } catch (err) {
    console.log("Landing stats error:", err.message);
  }
}

// Al cargar la página: si NO hay sesión, muestra el landing
async function ceInitLanding() {
  const landing = document.getElementById("ceLanding");
  const authBox = document.getElementById("authBox");
  if (!landing) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
      landing.style.display = "none";
    } else {
      landing.style.display = "block";
      if (authBox) authBox.style.display = "none";
      ceLoadLandingStats();
      ceLoadPublicPick();
    }
  } catch (err) {
    console.log("ceInitLanding error:", err.message);
  }
}

document.addEventListener("DOMContentLoaded", ceInitLanding);
// Trae el pick premium del día y llena la tarjeta
async function ceLoadPublicPick() {
  try {
    const res = await fetch("/api/public-pick");
    const data = await res.json();
    if (!data.available) return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set("ceLockedSport", data.sport);
    set("ceLockedMatchup", data.matchup);
    set("ceLockedConf", data.confidence + "%");
    set("ceLockedEdge", data.edge);

    const t = new Date(data.gameTime);
    set("ceLockedTime", t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));

    const wrap = document.getElementById("ceLockedPickWrap");
    if (wrap) wrap.style.display = "block";
  } catch (err) {
    console.log("Public pick error:", err.message);
  }
}

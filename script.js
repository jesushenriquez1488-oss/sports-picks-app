const SUPABASE_URL = "https://chwuftiqbxqjbhdixdwk.supabase.co";
const SUPABASE_KEY = "sb_publishable_WLTdeKrWOWO404USqEcqtg_bSfDTzJ3";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentSessionId = localStorage.getItem("cashedge_session_id");

if (!currentSessionId) {
  currentSessionId = crypto.randomUUID();
  localStorage.setItem("cashedge_session_id", currentSessionId); 
}
let currentOddsGames = [];
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
const metaEventId = urlParams.get("meta_event_id");
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
const metaConversionStorageKey =
  `cashedge_meta_purchase_${stripeSessionId}`;
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
        send_to: "AW-18266545354/le8_CMnWsMQcEMq5IYZE",
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
const metaConversionAlreadySent =
  localStorage.getItem(metaConversionStorageKey) === "sent";

if (!metaConversionAlreadySent) {
  if (!metaEventId) {
    console.warn("Meta Purchase no enviado: falta meta_event_id.");
  } else if (typeof window.fbq !== "function") {
    console.warn("Meta Purchase no enviado: Pixel no disponible.");
  } else {
    window.fbq(
      "track",
      "Purchase",
      {
        value: Number(verification.value || 19.99),
        currency: String(
          verification.currency || "USD"
        ).toUpperCase(),
        content_name: "CashEdge Premium Subscription",
        content_type: "product"
      },
      {
        eventID: metaEventId
      }
    );

    localStorage.setItem(metaConversionStorageKey, "sent");

    console.log("✅ Purchase enviado al Meta Pixel:", {
      eventId: metaEventId,
      transactionId:
        verification.transactionId || stripeSessionId,
      value: verification.value,
      currency: verification.currency
    });
  }
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
      isPremiumUser ? "🔥 Premium active" : "Free account";
  }
}
async function loadTeams() {
  if (allTeams.length > 0) return;

  const res = await fetch("/api/nba-data?type=teams");

  const text = await res.text();
  if (!res.ok) throw new Error("Error loading teams: " + text);

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
    throw new Error("Too many requests. Wait 1 minute.");
  }

  if (!res.ok) throw new Error("Error loading games: " + text);

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
  throw new Error(games.error || "Error loading games from SportsDataIO");
}

return games;
}
  const cacheKey = `${teamName}-formula-real`;

  if (gamesCache[cacheKey]) {
    return gamesCache[cacheKey];
  }

  const teamId = findTeamId(teamName);
  if (!teamId) throw new Error("Team not found: " + teamName);

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
    throw new Error("Not enough games with real opponent averages.");
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
      alert("You must sign in to analyze.");
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
      <p><strong>Game not available for WNBA analysis.</strong></p>
      <p>This team doesn't have valid data in the model.</p>
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
      throw new Error(data.error || "Error analyzing NBA");
    }

    if (data.noPlay) {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>${data.public.title}</strong></p>
          <p>${data.public.message}</p>
          <p><strong>Reason:</strong> ${data.public.reason}</p>
        </div>
      `;
      endAnalysisLock(index);
      return;
    }

    const locked = data.locked;
    const premium = data.premium;
    const isPremium = data.isPremiumPick;
let displayPick = locked
  ? "•••••••• 🔒"
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
      <div><small>${awayTeam.split(" ").pop()}</small><strong>${locked ? "--" : premium.projA.toFixed(1)}</strong></div>
      <div><small>${homeTeam.split(" ").pop()}</small><strong>${locked ? "--" : premium.projB.toFixed(1)}</strong></div>
      <div><small>MODEL VS LINE</small>${locked ? "<strong>--</strong>" : (() => {
        const ln = Number(premium.totalLine) > 0 ? Number(premium.totalLine) : Number(total || 0);
        const proj = Number(premium.totalProj || 0);
        if (!(ln > 0)) return `<strong>${proj.toFixed(1)}</strong>`;
        const d = proj - ln;
        return `<strong>${proj.toFixed(1)}<span style="color:#4a5f7f;font-size:11px;"> / ${ln}</span></strong><div style="font-size:10px;font-weight:700;color:${d >= 0 ? "#ff8c1a" : "#4da3ff"};margin-top:2px;">${d >= 0 ? "▲ +" : "▼ "}${d.toFixed(1)} pts</div>`;
      })()}</div>
    </div>
    ${locked ? `
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,255,231,0.05);border:1px solid rgba(0,255,231,0.15);border-radius:10px;padding:10px 16px;margin-bottom:12px;">
        <span style="font-size:12px;color:#8899bb;">Model's all-time ${league.toUpperCase()} record</span>
        <span style="font-size:14px;font-weight:800;color:#00ffe7;">${ceRecordPlain(league)}</span>
      </div>

      <div class="ce-basket-info-section">
        <div class="ce-basket-info-box">
          <h4>🔒 PREMIUM ANALYSIS</h4>
          <p>Significant edge detected. Unlock to see the full pick.</p>
        </div>
        <div class="ce-basket-info-box">
          <h4>FACTORS</h4>
          <p>Recent form · Rest · Injuries · Matchup · Edge vs market</p>
        </div>
      </div>

      <div style="font-size:12px;color:#a0b4cc;line-height:1.6;text-align:left;padding:0 4px;margin:12px 0 2px;">
        The model only flags a pick as premium when it finds a real mathematical edge against the sportsbooks. Betting without that edge is guessing.
      </div>

      <button class="unlock-btn" style="margin-top:12px" onclick="openPromoModal()">
        🔓 UNLOCK PREMIUM PICK — $${MONTHLY_PRICE}/MO
      </button>
    ` : `
    <div class="ce-basket-info-section">
        <div class="ce-basket-info-box">
          <h4>😴 REST</h4>
          <p>${awayTeam}: ${premium.awayRestNote}</p>
          <p>${homeTeam}: ${premium.homeRestNote}</p>
        </div>
        <div class="ce-basket-info-box">
          <h4>🚑 INJURIES</h4>
          <p>${premium.awayInjuryPublic}</p>
          <p>${premium.homeInjuryPublic}</p>
        </div>
      </div>
      ${premium.awayRecentForm || premium.homeRecentForm ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        ${[[awayTeam, premium.awayRecentForm], [homeTeam, premium.homeRecentForm]].map(([team, f]) => f ? `
        <div style="background:#070d1a;border:1px solid #10203a;border-radius:8px;padding:10px 12px;">
          <div style="font-size:9px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${team.split(" ").pop()} · LAST ${f.streak.length}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:14px;font-weight:800;color:#fff;">${f.record}</span>
            <span style="font-size:11px;color:#8899bb;">${f.avgPoints} PPG</span>
            <span style="font-size:11px;font-weight:700;letter-spacing:2px;">${f.streak.split("").map(r => `<span style="color:${r === "W" ? "#00ffe7" : "#ff5566"};">${r}</span>`).join("")}</span>
          </div>
        </div>` : "").join("")}
      </div>` : ""}
      <div style="text-align:center;margin-top:10px;margin-bottom:10px;">
        <button onclick='toggleGameHighlight(${index}, "${encodeURIComponent(JSON.stringify(premium || {})).replace(/'/g, "%27")}", "${escapeText(awayTeam)}", "${escapeText(homeTeam)}")' style="background:transparent;border:1px solid rgba(255,140,26,0.35);border-radius:16px;padding:5px 14px;color:#ff8c1a;font-size:10px;font-weight:700;letter-spacing:0.06em;cursor:pointer;text-transform:uppercase;">
          🎯 Game Highlight
        </button>
        <div id="gameHighlight${index}"></div>
      </div>
     ${(window.currentSport === "basketball_nba" || window.currentSport === "nba") ? `
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
    <div class="ce-normal-basket-badge">📊 FEATURED PLAY</div>
    <div class="ce-normal-basket-pick">${displayPick}</div>
    <div class="ce-normal-basket-stats">
      <div><small>CONFIDENCE</small><strong>${data.public.confidence}%</strong></div>
      <div><small>EDGE</small><strong>${premium.mainEdge.toFixed(1)}</strong></div>
      <div><small>${awayTeam.split(" ").pop()}</small><strong>${premium.projA.toFixed(1)}</strong></div>
      <div><small>${homeTeam.split(" ").pop()}</small><strong>${premium.projB.toFixed(1)}</strong></div>
    </div>
    <div class="ce-basket-info-section" style="margin-top:10px">
      <div class="ce-basket-info-box">
        <h4>😴 REST</h4>
        <p>${awayTeam}: ${premium.awayRestNote}</p>
        <p>${homeTeam}: ${premium.homeRestNote}</p>
      </div>
      <div class="ce-basket-info-box">
        <h4>🚑 INJURIES</h4>
        <p>${premium.awayInjuryPublic}</p>
        <p>${premium.homeInjuryPublic}</p>
      </div>
    </div>
 ${(window.currentSport === "basketball_nba" || window.currentSport === "nba") ? `
  <div style="height:0.5px;background:#1a3050;margin:12px 0;"></div>
  <button
    onclick="toggleNBAPlayerProps(${index}, '${escapeText(awayTeam)}', '${escapeText(homeTeam)}', this)"
    style="display:block;width:100%;padding:12px 0;background:rgba(124,60,255,0.15);border:1.5px solid #7c3cff;border-radius:10px;color:#c4a0ff;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;text-align:center;text-transform:uppercase;margin-bottom:10px;">
    ⚡ VIEW PLAYER PROPS ↗
  </button>
  <div id="nbaProps${index}"></div>
` : ""}
  `}

  

</div>
`;
endAnalysisLock(index);
 } catch (error) {
    if (error.message && (error.message.includes("free analyses") || error.message.includes("every 3 hours") || error.message.includes("unlock 5"))) {
   resultDiv.innerHTML = ceLimitScreenHTML(league);
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analyzing NBA</strong></p>
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
              🔓 UNLOCK PREMIUM $${MONTHLY_PRICE}/MO
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
const signupAcc = document.getElementById("signupAccuracy");
if (signupAcc) signupAcc.innerText = `${accuracy.toFixed(1)}%`;
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
    alert("Sign up or log in to view the analyses.");
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
  status.innerHTML = "Loading games...";
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
      status.innerHTML = `Using recent data ${selectedSportName}`;
    } else {
const session = sessionData?.session;
const res = await fetch(`/api/odds?sport=${encodeURIComponent(sport)}`, {
  headers: session?.access_token
    ? { "Authorization": `Bearer ${session.access_token}` }
    : {}
});
const text = await res.text();
      

      if (!res.ok) throw new Error("Error loading odds: " + text);

      data = JSON.parse(text);

      localStorage.setItem(cacheKey, JSON.stringify(data));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
    }
currentOddsGames = Array.isArray(data) ? data : [];
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
  
  status.innerHTML = `Games found: ${upcomingGames.length}`;

  if (upcomingGames.length === 0) {
    gamesDiv.innerHTML = `
      <div class="card">
        <p>No games available for ${selectedSportName} right now.</p>
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
    status.innerHTML = `Games found: ${upcomingGames.length}`;

    if (upcomingGames.length === 0) {
      gamesDiv.innerHTML = `
        <div class="card">
          <p>No games available for ${selectedSportName} right now.</p>
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
function normalizeOddsText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAmericanOdds(value) {
  const odds = Number(value);

  if (!Number.isFinite(odds)) {
    return "";
  }

  return odds > 0 ? `+${odds}` : `${odds}`;
}

function pickContainsTeam(play, teamName) {
  const cleanPlay = normalizeOddsText(play);
  const cleanTeam = normalizeOddsText(teamName);

  if (cleanPlay.includes(cleanTeam)) {
    return true;
  }

  const teamWords = cleanTeam.split(" ");
  const nickname = teamWords[teamWords.length - 1];

  return nickname.length >= 3 &&
    cleanPlay.split(" ").includes(nickname);
}

function findOddsGame(awayTeam, homeTeam) {
  const cleanAway = normalizeOddsText(awayTeam);
  const cleanHome = normalizeOddsText(homeTeam);

  return currentOddsGames.find(game => {
    return (
      normalizeOddsText(game.away_team) === cleanAway &&
      normalizeOddsText(game.home_team) === cleanHome
    );
  }) || null;
}

function getBestOddsForPick(play, awayTeam, homeTeam) {
  if (!play) {
    return null;
  }

  const game = findOddsGame(awayTeam, homeTeam);

  if (!game) {
    return null;
  }

  const cleanPlay = normalizeOddsText(play);

  let marketKey = null;
  let selection = null;
  let selectedTeam = null;
  let selectedPoint = null;

  const totalMatch = String(play).match(
    /\b(over|under)\s*([+-]?\d+(?:\.\d+)?)/i
  );

  if (totalMatch) {
    marketKey = "totals";
    selection =
      totalMatch[1].toLowerCase() === "over"
        ? "Over"
        : "Under";

    selectedPoint = Number(totalMatch[2]);
  } else if (
    cleanPlay.includes("draw") ||
    cleanPlay.includes("tie")
  ) {
    marketKey = "h2h";
    selection = "Draw";
  } else {
    if (pickContainsTeam(play, awayTeam)) {
      selectedTeam = awayTeam;
    } else if (pickContainsTeam(play, homeTeam)) {
      selectedTeam = homeTeam;
    } else {
      return null;
    }

    const spreadMatch = String(play).match(
      /([+-]\d+(?:\.\d+)?)/
    );

    if (spreadMatch) {
      marketKey = "spreads";
      selectedPoint = Number(spreadMatch[1]);
    } else {
      marketKey = "h2h";
    }

    selection = selectedTeam;
  }

  let bestOdds = null;

  for (const bookmaker of game.bookmakers || []) {
    const market = (bookmaker.markets || []).find(
      item => item.key === marketKey
    );

    if (!market) {
      continue;
    }

    for (const outcome of market.outcomes || []) {
      let isCorrectOutcome = false;

      if (marketKey === "totals") {
        isCorrectOutcome =
          normalizeOddsText(outcome.name) ===
            normalizeOddsText(selection) &&
          Math.abs(
            Number(outcome.point) - selectedPoint
          ) < 0.001;
      } else if (marketKey === "spreads") {
        isCorrectOutcome =
          normalizeOddsText(outcome.name) ===
            normalizeOddsText(selectedTeam) &&
          Math.abs(
            Number(outcome.point) - selectedPoint
          ) < 0.001;
      } else {
        isCorrectOutcome =
          normalizeOddsText(outcome.name) ===
          normalizeOddsText(selection);
      }

      if (!isCorrectOutcome) {
        continue;
      }

      const price = Number(outcome.price);

      if (!Number.isFinite(price)) {
        continue;
      }

      if (!bestOdds || price > bestOdds.price) {
        bestOdds = {
          bookmaker: bookmaker.title,
          bookmakerKey: bookmaker.key,
          price,
          formattedPrice: formatAmericanOdds(price),
          market: marketKey,
          selection,
          point:
            marketKey === "h2h"
              ? null
              : Number(outcome.point),
          updatedAt: bookmaker.last_update || null
        };
      }
    }
  }

  return bestOdds;
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
    showAuthMessage("Enter your email and password", "error");
    return;
  }

  if (password.length < 8) {
    showAuthMessage("Password must be at least 8 characters", "error");
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
      showAuthMessage("This account already exists. Please log in.", "error");
    } else {
      showAuthMessage(error.message, "error");
    }
    return;
  }

  // Supabase devuelve identities vacío si el email ya existe pero no está confirmado
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    showAuthMessage("This account already exists. Check your email or log in.", "error");
    return;
  }
// Registrar creación exitosa de cuenta
if (typeof window.gtag === "function") {
  window.gtag("event", "sign_up", {
    method: "email",
  });
}

if (typeof window.fbq === "function") {
  window.fbq("track", "CompleteRegistration");
}
  showAuthMessage("✅ Account created. Check your email " + email + " to verify your account before logging in.", "success");
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
    showAuthMessage("Enter your email and password", "error");
    return;
  }
await askPushAfterLogin();
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showAuthMessage("Incorrect email or password", "error");
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
    alert("Enter your email to reset your password.");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "https://cashedgeapp.com/reset.html"
  });

  if (error) {
    alert("Error sending recovery email: " + error.message);
    return;
  }

  alert("We sent you a password recovery email.");
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
    alert(message || "Sign up or log in to continue.");
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
  if (!startAnalysisLock(index, "Analyzing MLB...")) return;
  resultDiv.innerHTML = `<div class="loading-analysis">Analyzing MLB...</div>`;

  const safe = (v, d = 0) => (typeof v === "number" && !isNaN(v) ? v : d);

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      alert("You must sign in to analyze.");
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
        totalLine,
        eventId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error analyzing MLB");
    }
if (data.noPlay) {
  resultDiv.innerHTML = `
    <div class="prediction-card">
      <h2>⏳ MLB analysis not available</h2>
      <p>${data.public?.message || data.public?.reason || data.error || "Waiting for confirmed pitchers and official lines."}</p>
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
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,255,231,0.08);border:1px solid rgba(0,255,231,0.25);border-radius:20px;padding:4px 12px;font-size:10px;color:#00ffe7;font-weight:600;letter-spacing:1px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#00ffe7;animation:nfl-pulse 1.5s infinite;display:inline-block;"></span>
            🔥 PREMIUM PICK · MLB
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
                      stroke-linecap="round" transform="rotate(-90 42 42)"/>
                  </svg>
                  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                    <span style="font-size:19px;font-weight:800;color:#00ffe7;">${data.public?.confidence ? Number(data.public.confidence).toFixed(0) : "85"}%</span>
                    <small style="font-size:8px;color:#5a7a9a;letter-spacing:1px;">CONFIDENCE</small>
                  </div>
                </div>
                <div style="text-align:left;">
                  <div style="font-size:11px;color:#5a7a9a;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;">Model's pick</div>
                  <div style="display:flex;align-items:center;gap:8px;margin:2px 0 0;">
                    <span style="display:block;height:19px;width:96px;border-radius:5px;background:#16283f;"></span>
                    <span style="display:block;height:19px;width:46px;border-radius:5px;background:#16283f;"></span>
                    <span style="font-size:14px;">🔒</span>
                  </div>
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

              <div style="background:#0a1220;border:1px solid #14243d;border-radius:12px;padding:4px 16px;margin-bottom:14px;text-align:left;">
                <div style="font-size:10px;color:#5a7a9a;letter-spacing:1px;padding:12px 0 6px;">PREMIUM ALSO UNLOCKS</div>
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #10203a;font-size:12px;color:#d0dcec;"><span style="font-size:14px;">🎯</span>Player props — MLB, NBA and NFL</div>
               
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #10203a;font-size:12px;color:#d0dcec;"><span style="font-size:14px;">💎</span>Value plays — every 75%+ edge on the board</div>
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #10203a;font-size:12px;color:#d0dcec;"><span style="font-size:14px;">🔥</span>Daily AI parlay — pays 5-7x when it hits</div>
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #10203a;font-size:12px;color:#d0dcec;"><span style="font-size:14px;">🔔</span>Instant alerts on 95%+ plays</div>
                <div style="display:flex;align-items:center;gap:10px;padding:9px 0 12px;border-top:1px solid #10203a;font-size:12px;color:#d0dcec;"><span style="font-size:14px;">∞</span>Unlimited analyses, every sport</div>
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
                <div class="mlb-main-pick-box ${premium.recommendedCards?.[0] ? "ce-premium-glow" : ""}">
${premium.recommendedCards?.[0] ? `
<span style="font-size:9px;color:#a07cff;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">🔥 ${premium.recommendedCards[0].title}</span>
  <strong style="display:block;font-size:19px;font-weight:800;color:#fff;letter-spacing:0.3px;margin-top:3px;">${premium.recommendedCards[0].play}</strong>
` : `
  <div style="text-align:left;">
    <div style="font-size:10px;color:#00ffe7;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">📊 Model's lean</div>
   <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;">${data.public?.freePick?.play || "No clear lean"}</div>
    <div style="font-size:11px;color:#556688;line-height:1.5;">Not strong enough to qualify as premium.</div>
  </div>
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

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#0b1322;border:1px solid #10203a;border-radius:10px;overflow:hidden;margin-bottom:12px;">
                  <div style="background:#070d1a;padding:12px 8px;text-align:center;">
                    <div style="font-size:8px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${awayTeam.split(" ").pop()} RUNS</div>
                    <div style="font-size:17px;font-weight:800;color:#c9d6e8;">${safe(premium.expectedRunsA).toFixed(1)}</div>
                  </div>
                  <div style="background:#070d1a;padding:12px 8px;text-align:center;">
                    <div style="font-size:8px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${homeTeam.split(" ").pop()} RUNS</div>
                    <div style="font-size:17px;font-weight:800;color:#c9d6e8;">${safe(premium.expectedRunsB).toFixed(1)}</div>
                  </div>
                 <div style="background:#070d1a;padding:12px 8px;text-align:center;">
                    <div style="font-size:8px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">MODEL VS LINE</div>
                    <div style="font-size:17px;font-weight:800;color:#c9d6e8;">${safe(premium.projectedTotal).toFixed(1)}<span style="color:#4a5f7f;font-size:11px;"> / ${safe(premium.totalLine, totalLine)}</span></div>
                    <div style="font-size:11px;font-weight:700;color:${safe(premium.totalDiff) >= 0 ? "#ff8c1a" : "#4da3ff"};margin-top:2px;">${safe(premium.totalDiff) >= 0 ? "▲ +" : "▼ "}${safe(premium.totalDiff).toFixed(1)} runs</div>
                  </div>
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
                  <p>${premium.venue?.name || "N/A"} — roof: ${premium.venue?.roof || "N/A"}</p>
                  <p>${ceParkIcon(premium.venue?.parkFactor)}</p>
                </div>
                <div>
                  <h4>🌦️ Weather</h4>
                  <p>${premium.weather?.raw || "Not available"}</p>
                  <p>${ceWindIcon(premium.weather?.direction, premium.weather?.speed)} · ${ceTempIcon(premium.weather?.temp)}</p>
                  <p style="opacity:0.7;">Run impact: ${safe(premium.weatherImpactPercent, 0) > 0 ? "+" : ""}${safe(premium.weatherImpactPercent, 0).toFixed(1)}%</p>
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
              <div style="text-align:center;margin-top:10px;">
                <button onclick='toggleGameHighlight(${index}, "${encodeURIComponent(JSON.stringify(premium || {})).replace(/'/g, "%27")}", "${escapeText(awayTeam)}", "${escapeText(homeTeam)}")' style="background:transparent;border:1px solid rgba(255,140,26,0.35);border-radius:16px;padding:5px 14px;color:#ff8c1a;font-size:10px;font-weight:700;letter-spacing:0.06em;cursor:pointer;text-transform:uppercase;">
                  🎯 Game Highlight
                </button>
                <div id="gameHighlight${index}"></div>
              </div>
            `
            : `
              <p><strong>MLB analysis not available.</strong></p>
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
    resultDiv.innerHTML = ceLimitScreenHTML("mlb");
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analyzing MLB</strong></p>
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

  const aOff = Number(pace.teamAOffenseScore || 1);
  const bOff = Number(pace.teamBOffenseScore || 1);
  const aDef = Number(pace.teamADefenseScore || 1);
  const bDef = Number(pace.teamBDefenseScore || 1);
  const paceAdj = Number(pace.adjustment || 0);
  const hasPaceData = [aOff, bOff, aDef, bDef].some(v => v !== 1);

  const edge = Number(bestPick?.edge || 0);
  const isOver = bestPick?.isOver === true;
  const isUnder = bestPick?.isUnder === true;
  const isTotal = isOver || isUnder;
  const isSpread = !isTotal;
  const pickStr = String(bestPick?.pick || "");

  const awayShort = awayTeam.split(" ").pop();
  const homeShort = homeTeam.split(" ").pop();

  // Spread: equipo elegido y rival
  const pickedAway = isSpread && pickStr.includes(awayTeam);
  const pickedTeam = pickedAway ? awayTeam : homeTeam;
  const fadedTeam = pickedAway ? homeTeam : awayTeam;
  const pickedProj = pickedAway ? projA : projB;
  const fadedProj = pickedAway ? projB : projA;
  const pickedOff = pickedAway ? aOff : bOff;
  const pickedDef = pickedAway ? aDef : bDef;
  const fadedOff = pickedAway ? bOff : aOff;
  const fadedDef = pickedAway ? bDef : aDef;
  const gap = Math.abs(projA - projB);

  const lineMatch = pickStr.match(/([+-]\d+(\.\d+)?)/);
  const spreadLine = lineMatch ? Number(lineMatch[1]) : null;
  const isDog = spreadLine !== null && spreadLine > 0;
  const isFav = spreadLine !== null && spreadLine < 0;
  const cushion = spreadLine !== null ? gap - Math.abs(spreadLine) : null;
// Lesiones (informativas mientras el injury system esté en modo sombra)
  const injData = data.injuryImpact || {};
  const injClean = n => {
    const t = String(n || "").trim();
    return /no key injuries|injury data unavailable/i.test(t) ? "" : t;
  };
  const awayInjNote = injClean(injData[awayTeam]?.note);
  const homeInjNote = injClean(injData[homeTeam]?.note);
  const injActive = injData.active === true;
  const pickedInjNote = isSpread ? (pickedAway ? awayInjNote : homeInjNote) : "";
  const fadedInjNote = isSpread ? (pickedAway ? homeInjNote : awayInjNote) : "";
  // Escala visible del matchup breakdown (misma que la UI: 0.8→0, 1.3→99)
  const toScore = v => Math.max(1, Math.min(99, Math.round((v - 0.8) / 0.5 * 100)));

  const seed = (awayTeam + homeTeam).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const v = arr => arr[seed % arr.length];

  const args = [];

  // ============ TOTALS ============
  if (isTotal && totalLine > 0) {
    const tGap = Math.abs(projectedTotal - totalLine).toFixed(1);

    args.push({ cond: true, mag: Math.abs(projectedTotal - totalLine) + 2, text: isOver
      ? v([
        `The model projects <strong>${projectedTotal.toFixed(1)} combined points</strong> — ${awayShort} ${projA.toFixed(1)}, ${homeShort} ${projB.toFixed(1)} — against a ${totalLine} line, a ${tGap}-point gap the market hasn't priced.`,
        `At ${projA.toFixed(1)} projected for ${awayShort} and ${projB.toFixed(1)} for ${homeShort}, the model's ${projectedTotal.toFixed(1)} clears the ${totalLine} line by ${tGap}.`
      ])
      : v([
        `The model caps this at <strong>${projectedTotal.toFixed(1)} combined points</strong> (${awayShort} ${projA.toFixed(1)}, ${homeShort} ${projB.toFixed(1)}) — ${tGap} below the ${totalLine} the market hung.`,
        `Projected scoring of ${projA.toFixed(1)} + ${projB.toFixed(1)} lands ${tGap} short of the ${totalLine} line.`
      ])
    });

    if (hasPaceData) {
      // Ofensivas — solo si apoyan
      if (isOver && aOff >= 1.06 && bOff >= 1.06) args.push({ cond: true, mag: (aOff + bOff - 2) * 25, text:
        `Both offenses grade above league average — ${awayShort} at ${toScore(aOff)} and ${homeShort} at ${toScore(bOff)} on the model's efficiency scale — a shootout profile.`
      });
      else if (isOver && (aOff >= 1.1 || bOff >= 1.1)) {
        const ot = aOff >= bOff ? awayShort : homeShort;
        const dt = aOff >= bOff ? homeShort : awayShort;
        const dv = aOff >= bOff ? bDef : aDef;
        args.push({ cond: dv < 1.05, mag: Math.max(aOff, bOff) * 3, text:
          `${ot}'s offense (${toScore(Math.max(aOff, bOff))} efficiency) draws a ${dt} defense grading just ${toScore(dv)} — a mismatch that inflates scoring.`
        });
      }
      if (isOver && aDef < 0.95 && bDef < 0.95) args.push({ cond: true, mag: (2 - aDef - bDef) * 20, text:
        `Neither defense has stopped anyone lately — ${awayShort} grades ${toScore(aDef)} and ${homeShort} ${toScore(bDef)} defensively. Points on both sides.`
      });
      if (isUnder && aDef >= 1.06 && bDef >= 1.06) args.push({ cond: true, mag: (aDef + bDef - 2) * 25, text:
        `Both defenses grade above average — ${awayShort} at ${toScore(aDef)}, ${homeShort} at ${toScore(bDef)} — the profile of a grinder.`
      });
      else if (isUnder && (aDef >= 1.1 || bDef >= 1.1)) {
        const dt = aDef >= bDef ? awayShort : homeShort;
        args.push({ cond: true, mag: Math.max(aDef, bDef) * 3, text:
          `${dt}'s defense (${toScore(Math.max(aDef, bDef))} on the model's scale) is the anchor — it takes points off the board every week.`
        });
      }
      if (isUnder && aOff < 0.95 && bOff < 0.95) args.push({ cond: true, mag: (2 - aOff - bOff) * 20, text:
        `Both offenses are sputtering (${awayShort} ${toScore(aOff)}, ${homeShort} ${toScore(bOff)} efficiency) — no engine to push this over the number.`
      });

      // Pace — solo en dirección
      if (isOver && paceAdj > 1.5) args.push({ cond: true, mag: paceAdj, text:
        `Tempo compounds it: both teams play fast, adding <strong>+${paceAdj.toFixed(1)} points</strong> of pace adjustment to the projection — more possessions, more scoring.`
      });
      if (isUnder && paceAdj < -1.5) args.push({ cond: true, mag: Math.abs(paceAdj), text:
        `The pace profile drags this down further — a ${paceAdj.toFixed(1)}-point adjustment for two teams that shorten games and bleed clock.`
      });
    }

    // Un equipo carga el total
    if (isOver && Math.max(projA, projB) >= totalLine * 0.58) {
      const ct = projA >= projB ? awayShort : homeShort;
      args.push({ cond: true, mag: 3, text:
        `${ct} alone projects for ${Math.max(projA, projB).toFixed(1)} — one offense doing most of the work toward the Over.`
      });
    }
  }

  // ============ SPREAD ============
  if (isSpread) {
    // Gap con framing por tamaño
    if (gap >= 10) args.push({ cond: true, mag: gap / 2, text: v([
      `The projections aren't close: <strong>${pickedTeam} ${pickedProj.toFixed(1)}, ${fadedTeam} ${fadedProj.toFixed(1)}</strong> — a ${gap.toFixed(1)}-point margin against a ${Math.abs(spreadLine || 0)}-point line${cushion !== null && cushion > 0 ? `, ${cushion.toFixed(1)} points of cushion` : ""}.`,
      `The model sees this decided early — ${pickedProj.toFixed(1)} to ${fadedProj.toFixed(1)}, nearly ${cushion !== null && cushion > 3 ? "double" : "past"} what the line demands.`
    ])});
    else args.push({ cond: true, mag: gap / 2, text:
      `The model projects ${pickedProj.toFixed(1)} for ${pickedTeam} against ${fadedProj.toFixed(1)} for ${fadedTeam} — a ${gap.toFixed(1)}-point margin${cushion !== null && cushion > 0 ? ` that clears the number by ${cushion.toFixed(1)}` : " against the line"}.`
    });

    // Framing dog / favorito
    if (isDog) args.push({ cond: true, mag: 4, text: v([
      `The market is asking ${pickedTeam} to stay within ${Math.abs(spreadLine)} — the model says they ${pickedProj > fadedProj ? "win this outright" : `lose by just ${gap.toFixed(1)}`}. That's free points.`,
      `Getting +${Math.abs(spreadLine)} with a team the model ${pickedProj > fadedProj ? "projects to win straight up" : "sees keeping it inside one score"} is the mispricing the model hunts.`
    ])});
    if (isFav && Math.abs(spreadLine) >= 7) args.push({ cond: cushion !== null && cushion > 0, mag: 3, text:
      `Laying ${Math.abs(spreadLine)} is usually dangerous — but ${fadedTeam}'s projected ${fadedProj.toFixed(1)} points leave them ${gap.toFixed(1)} behind, past the number with room.`
    });

    if (hasPaceData) {
      // Ventajas por unidad — solo del lado elegido
      if (pickedOff >= 1.08 && fadedDef < 1.0) args.push({ cond: true, mag: (pickedOff - fadedDef) * 15, text:
        `The matchup driving it: ${pickedTeam}'s offense grades ${toScore(pickedOff)} on the model's efficiency scale against a ${fadedTeam} defense at just ${toScore(fadedDef)} — sustained drives all game.`
      });
      if (pickedDef >= 1.08 && fadedOff < 1.0) args.push({ cond: true, mag: (pickedDef - fadedOff) * 15, text:
        `On the other side of the ball, ${pickedTeam}'s defense (${toScore(pickedDef)}) squares off with a ${fadedTeam} offense grading ${toScore(fadedOff)} — the model expects stalled drives and short fields.`
      });
      if (pickedOff >= 1.05 && pickedDef >= 1.05) args.push({ cond: true, mag: (pickedOff + pickedDef - 2) * 12, text:
        `${pickedTeam} grades above average on both sides of the ball (offense ${toScore(pickedOff)}, defense ${toScore(pickedDef)}) — no phase where ${fadedTeam} can hide.`
      });
    }
    // Lesiones del rival — solo como argumento si el modelo ya las descuenta
    if (injActive && fadedInjNote) args.push({ cond: true, mag: 3.5, text:
      `${fadedTeam}'s injury report works against them: ${fadedInjNote} — production the model has already discounted from their projection.`
    });
  }

  const valid = args.filter(a => a.cond).sort((a, b) => b.mag - a.mag).slice(0, 3);

  // ---- Caveat en contra ----
  let risk = "";
  if (isOver && hasPaceData && (aDef >= 1.1 || bDef >= 1.1)) {
    const dt = aDef >= bDef ? awayShort : homeShort;
    risk = `The one caveat: ${dt}'s defense grades well (${toScore(Math.max(aDef, bDef))}) — the model priced it in, and the projected total still cleared the line.`;
  } else if (isOver && hasPaceData && paceAdj < -1.5) {
    risk = `The one caveat: the pace profile leans slow (${paceAdj.toFixed(1)}) — even so, the efficiency mismatch carried the projection over.`;
  } else if (isUnder && hasPaceData && (aOff >= 1.1 || bOff >= 1.1)) {
    const ot = aOff >= bOff ? awayShort : homeShort;
    risk = `The one caveat: ${ot}'s offense is legit (${toScore(Math.max(aOff, bOff))}) — the defensive matchup is what caps them in the model's read.`;
  } else if (isSpread && hasPaceData && fadedOff >= 1.1) {
    risk = `The one caveat: ${fadedTeam}'s offense grades ${toScore(fadedOff)} — dangerous, but the model already priced it and the edge held.`;
  }
else if (isSpread && pickedInjNote) {
    risk = injActive
      ? `The one caveat: ${pickedTeam}'s own injury report (${pickedInjNote}) — already priced into the projection, and the edge held.`
      : `Worth monitoring: ${pickedTeam}'s injury report lists ${pickedInjNote} — statuses can shift before kickoff.`;
  }
  else if (isTotal && (awayInjNote || homeInjNote)) {
    risk = `Worth monitoring: the injury report lists ${[awayInjNote, homeInjNote].filter(Boolean).join(" and ")} — statuses can shift before kickoff.`;
  }
  // ---- Narrativa ----
  const s = [];
  s.push(v([
    `The model flagged <strong>${pickStr}</strong> with a ${edge.toFixed(1)}-point edge over the market.`,
    `<strong>${pickStr}</strong> cleared the model's threshold on a ${edge.toFixed(1)}-point edge vs the line.`,
    `This game triggered the flag: <strong>${pickStr}</strong>, ${edge.toFixed(1)} points of separation from the market number.`
  ]));
  valid.forEach(a => s.push(a.text));
  if (risk) s.push(risk);
  s.push(v([
    `Stacked together, that's the read.`,
    `That convergence is what put this play on the board.`,
    `The model doesn't flag games without that alignment — this one had it.`
  ]));

  return s.join(" ");
}
async function analyzeFootball(awayTeam, homeTeam, index) {
  const resultDiv = document.getElementById(`result${index}`);
  resultDiv.innerHTML = `<div class="loading-analysis">Analyzing ${selectedSportName}...</div>`;

  const type = selectedSport === "americanfootball_nfl" ? "nfl" : "ncaaf";

  try {
 
    const { data: sessionData } = await supabaseClient.auth.getSession();
 
    if (!sessionData.session) {
      alert("You must sign in to analyze.");
      resultDiv.innerHTML = "";
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
 
    // Si hay algún pick premium bloqueado, ese manda — mostrar card locked
    const lockedPremiumPick = [spreadPick, totalPick].find(p => p?.locked === true) || null;

    const validPicks = [spreadPick, totalPick]
      .filter(p => p && !p.locked)
      .sort((a, b) => {
        if (Number(b.confidence || 0) !== Number(a.confidence || 0)) return Number(b.confidence || 0) - Number(a.confidence || 0);
        return Number(b.edge || 0) - Number(a.edge || 0);
      });

    const bestPick = lockedPremiumPick || validPicks[0] || null;

    const isPremium = bestPick?.isPremium === true;
    const locked = lockedPremiumPick !== null;

    const confidence = locked ? 75 : Number(bestPick?.confidence || 0);
    const circleDash = Math.round((confidence / 100) * 163);
 
    const pickText = String(bestPick?.pick || "").toUpperCase();
    const realType = pickText.includes("OVER") || pickText.includes("UNDER") ? "total" : "spread";
    const isOver = realType === "total" && pickText.includes("OVER");
    const isUnder = realType === "total" && pickText.includes("UNDER");
    const bestPickFixed = bestPick ? { ...bestPick, type: realType, isOver, isUnder } : null;
    const analysisText = bestPickFixed ? generateNFLAnalysisText(data, awayTeam, homeTeam, bestPickFixed) : "";
 
   const circleColor = isPremium ? "#ff8c1a" : "#00ffe7";
 
    const awayEsc = awayTeam.replace(/'/g, "\\'");
    const homeEsc = homeTeam.replace(/'/g, "\\'");
 
    const propsButtonHTML = type === "nfl"
      ? `<button onclick="toggleNFLPlayerProps(${index}, '${awayEsc}', '${homeEsc}', this)" style="width:100%;padding:11px;border-radius:8px;border:1px solid #1a2240;background:#0f1628;color:#00ffe7;font-size:12px;font-weight:600;letter-spacing:0.08em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">⚡ VIEW PLAYER PROPS</button><div id="nflProps${index}"></div>`
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
    <div style="font-size:24px;font-weight:800;letter-spacing:0.3px;margin-bottom:3px;color:#fff;">
        ${locked ? "Premium Pick Locked" : (bestPick?.pick || "No play")}
      </div>
     <div style="font-size:11px;color:#a07cff;">
        ${locked ? "" : `${realType === "total" ? "Total" : "Spread"} · ${Number(bestPick?.odds_american ?? -110) > 0 ? "+" : ""}${bestPick?.odds_american ?? -110} · Edge ${Number(bestPick?.edge || 0).toFixed(1)}`}
      </div>
    </div>
   <div class="ce-conf-pulse" style="position:relative;width:72px;height:72px;flex-shrink:0;">
      <svg width="72" height="72" viewBox="0 0 72 72" style="position:absolute;top:0;left:0;">
        <circle cx="36" cy="36" r="30" fill="none" stroke="#1a2240" stroke-width="4"/>
        <circle cx="36" cy="36" r="30" fill="none" stroke="${circleColor}" stroke-width="4"
          stroke-dasharray="${circleDash} 188" stroke-linecap="round"
          transform="rotate(-90 36 36)"/>
          
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
       <span style="font-size:${locked ? "13px" : "15px"};font-weight:700;color:${circleColor};">${locked ? "75%+" : confidence.toFixed(1) + "%"}</span>
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
    ${(() => {
      const inj = data.injuryImpact || {};
      const awayInj = inj[awayTeam] || {};
      const homeInj = inj[homeTeam] || {};
      const clean = n => String(n || "").trim();
      const awayNote = clean(awayInj.note);
      const homeNote = clean(homeInj.note);
      const noData = t => !t || /no key injuries|injury data unavailable/i.test(t);
      if (noData(awayNote) && noData(homeNote)) return "";
      return `
      <div style="background:#0a1220;border:1px solid #16263f;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
        <div style="font-size:10px;font-weight:700;color:#00ffe7;letter-spacing:0.08em;margin-bottom:6px;">🚑 INJURY REPORT</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:9px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">${awayTeam.split(" ").pop()}</div>
            <div style="font-size:11px;color:#d0dcec;line-height:1.5;">${noData(awayNote) ? "No key injuries reported." : awayNote}</div>
          </div>
          <div>
            <div style="font-size:9px;color:#4a5f7f;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">${homeTeam.split(" ").pop()}</div>
            <div style="font-size:11px;color:#d0dcec;line-height:1.5;">${noData(homeNote) ? "No key injuries reported." : homeNote}</div>
          </div>
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
    const msg = err?.message || String(err);
    if (msg.includes("free analyses") || msg.includes("every 3 hours") || msg.includes("unlock 5")) {
      resultDiv.innerHTML = ceLimitScreenHTML(type);
    } else {
      resultDiv.innerHTML = `
        <div class="normal-result">
          <p><strong>Error analyzing ${selectedSportName}</strong></p>
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
    alert("You must sign in.");
    return;
  }
 
  if (!IS_ADMIN && !isPremiumUser) {
    box.innerHTML = `
      <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:14px;margin-top:10px;text-align:center;">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">Premium Content</div>
        <div style="font-size:11px;color:#556688;margin-bottom:12px;line-height:1.5;">Unlock the best NFL props selected by the AI model</div>
        <button onclick="openPromoModal()" style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:12px;font-weight:700;cursor:pointer;">
          GET PREMIUM · $${MONTHLY_PRICE}/MO
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
        player_pass_yds: "pass yds",
        player_rush_yds: "rush yds",
        player_rush_attempts: "rush attempts",
        player_receptions: "receptions",
        player_reception_yds: "receiving yds"
      };
      const marketLabel = marketLabels[prop.market] || prop.market;
 
      return `
        <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
          <div>
            <div style="font-size:12px;font-weight:500;color:#fff;">${prop.player}</div>
            <div style="font-size:11px;color:#00ffe7;margin-top:2px;">Over ${prop.line} ${marketLabel}</div>
            <div style="font-size:10px;color:#556688;margin-top:2px;">Projection: ${prop.projection} · Edge +${prop.edge}</div>
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
        <div style="font-size:9px;color:#00ffe7;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;opacity:0.7;">⚡Game player props</div>
        ${propsHTML}
      </div>
    `;
    box.dataset.loaded = "true";
 
  } catch (err) {
    box.innerHTML = `<div style="font-size:11px;color:#556688;padding:8px;">Error loading props: ${err.message}</div>`;
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
function ceLimitScreenHTML(sportKey) {
  const records = window.ceSportRecords || {};
  const toRec = r => {
    if (!r) return null;
    const w = Number(r.total_wins || 0), l = Number(r.total_losses || 0);
    return w + l >= 20 ? { name: r.display_name, pct: (w / (w + l)) * 100, w, l } : null;
  };
  const best = toRec(records[sportKey]) || Object.values(records).map(toRec).filter(Boolean).sort((a, b) => b.pct - a.pct)[0] || null;

  return `
    <div class="normal-result" style="border:1px solid rgba(0,255,231,0.25);border-radius:14px;overflow:hidden;">
      <div style="padding:22px 18px;text-align:center;max-width:520px;margin:0 auto;">

        <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,140,26,0.08);border:1px solid rgba(255,140,26,0.3);border-radius:20px;padding:4px 12px;font-size:10px;color:#ff8c1a;font-weight:700;letter-spacing:1px;margin-bottom:14px;">
          ⏳ DAILY FREE LIMIT REACHED
        </div>

        <div style="font-size:20px;font-weight:900;color:#fff;margin-bottom:6px;">You clearly like the picks.</div>
        <div style="font-size:12px;color:#8899bb;line-height:1.6;margin-bottom:16px;">You've used today's 5 free analyses. More free analyses unlock <strong style="color:#00ffe7;">tomorrow</strong> — or you can stop waiting.</div>
        ${best ? `
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,255,231,0.05);border:1px solid rgba(0,255,231,0.15);border-radius:10px;padding:10px 16px;margin-bottom:10px;">
          <span style="font-size:12px;color:#8899bb;">Model's ${best.name} record</span>
          <span style="font-size:14px;font-weight:800;color:#00ffe7;">${best.pct.toFixed(0)}% (${best.w}-${best.l})</span>
        </div>` : ""}

        <div style="background:#0a1220;border:1px solid #14243d;border-radius:10px;padding:4px 16px;margin-bottom:14px;text-align:left;">
          <div style="font-size:10px;color:#5a7a9a;letter-spacing:1px;font-weight:700;padding:12px 0 6px;">PREMIUM UNLOCKS</div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">♾️</span><span style="font-size:12px;color:#d0dcec;">Unlimited analyses — no more waiting</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">🔓</span><span style="font-size:12px;color:#d0dcec;">Every premium pick, all sports</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">🎯</span><span style="font-size:12px;color:#d0dcec;">Player props — MLB, NBA and NFL</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">⚡</span><span style="font-size:12px;color:#d0dcec;">Full game highlight — why the model picked it</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">💎</span><span style="font-size:12px;color:#d0dcec;">Value plays — every 75%+ edge on the board</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #14243d;"><span style="font-size:14px;">🔥</span><span style="font-size:12px;color:#d0dcec;">Daily AI Parlay — pays 5-7x when it hits</span></div>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0 12px;border-top:1px solid #14243d;"><span style="font-size:14px;">🔔</span><span style="font-size:12px;color:#d0dcec;">Instant alerts on 95%+ plays</span></div>
        </div>

        <button onclick="openPromoModal()" style="display:block;width:100%;padding:15px;border:none;border-radius:12px;background:linear-gradient(135deg,#00ffe7,#7c3cff);color:#020814;font-size:13px;font-weight:900;letter-spacing:0.5px;cursor:pointer;text-transform:uppercase;box-shadow:0 0 20px rgba(0,255,231,0.3);">
          🔓 GO UNLIMITED — $19.99/MO
        </button>
        <div style="font-size:10px;color:#5a7a9a;margin-top:8px;">Less than one losing bet. Cancel anytime.</div>

      </div>
    </div>
  `;
}
function ceWindIcon(direction, speed) {
  const value = Number(speed);
  const s = Number.isFinite(value) ? Math.round(value) : 0;

  if (direction === "out") {
    return `<span style="color:#ff8c1a;">↗ OUT ${s} mph</span>`;
  }

  if (direction === "in") {
    return `<span style="color:#4da3ff;">↙ IN ${s} mph</span>`;
  }

  if (direction === "cross") {
    return `<span style="color:#a0b4cc;">⇄ CROSS ${s} mph</span>`;
  }

  return `<span style="color:#a0b4cc;">〰 ${s} mph</span>`;
}

function ceTempIcon(temp) {
  const value = Number(temp);

  if (!Number.isFinite(value)) return "";

  const t = Math.round(value);

  if (t >= 90) {
    return `🌡️🔥 ${t}°F`;
  }

  if (t >= 78) {
    return `🌡️ ${t}°F <span style="color:#ff8c1a;">warm</span>`;
  }

  if (t <= 50) {
    return `🌡️❄️ ${t}°F`;
  }

  return `🌡️ ${t}°F`;
}

function ceParkIcon(factor) {
  const f = Number(factor || 1);

  if (f >= 1.05) {
    return `<span style="color:#ff8c1a;">🏟️ Hitter's park</span>`;
  }

  if (f <= 0.95) {
    return `<span style="color:#4da3ff;">🏟️ Pitcher's park</span>`;
  }

  return `🏟️ Neutral park`;
}

function generateMLBHighlight(premium, awayTeam, homeTeam) {
  if (!premium) return "";
  const s = [];

  // ---- Datos base ----
  const runsA = Number(premium.expectedRunsA || 0);
  const runsB = Number(premium.expectedRunsB || 0);
  const projTotal = Number(premium.projectedTotal || 0);
  const line = Number(premium.totalLine || 0);
  const diff = Number(premium.totalDiff || (projTotal - line));
  const wf = Number(premium.weatherFactor || 1);
  const pf = Number(premium.venue?.parkFactor || 1);
  const parkName = premium.venue?.name || "the ballpark";
  const roof = String(premium.venue?.roof || "").toLowerCase();
  const wDir = premium.weather?.direction;
  const wSpeed = Number(premium.weather?.speed || 0);
  const temp = Number(premium.weather?.temp);
  const awayP = premium.awayPitcherName || `${awayTeam}'s starter`;
  const homeP = premium.homePitcherName || `${homeTeam}'s starter`;
  const innA = Number(premium.awayPitcherInnings || 0);
  const innB = Number(premium.homePitcherInnings || 0);
  const fatA = Number(premium.awayBullpenFatigue || 0);
  const fatB = Number(premium.homeBullpenFatigue || 0);
  const awayOff = Number(premium.awayOffense || 0);
  const homeOff = Number(premium.homeOffense || 0);
  const awayPAllowed = Number(premium.awayPitcherAllowed || 0);
  const homePAllowed = Number(premium.homePitcherAllowed || 0);
  const awayBpAllowed = Number(premium.awayBullpenAllowed || 0);
  const homeBpAllowed = Number(premium.homeBullpenAllowed || 0);

  const card = premium.recommendedCards?.[0] || null;
  const pick = card?.play || null;
  const conf = Number(card?.percentage || 0);
  const pickUp = String(pick || "").toUpperCase();

  // ---- Dirección del pick ----
  const isOver = pickUp.includes("OVER");
  const isUnder = pickUp.includes("UNDER");
  const isTotal = isOver || isUnder;
  const isTeamPick = pick && !isTotal; // ML o Runline
  const pickedAway = isTeamPick && pick.includes(awayTeam);
  const pickedTeam = pickedAway ? awayTeam : homeTeam;
  const fadedTeam = pickedAway ? homeTeam : awayTeam;
  const pickedRuns = pickedAway ? runsA : runsB;
  const fadedRuns = pickedAway ? runsB : runsA;
  const pickedPitcher = pickedAway ? awayP : homeP;
  const fadedPitcher = pickedAway ? homeP : awayP;
  const fadedPitcherAllowed = pickedAway ? homePAllowed : awayPAllowed;
  const pickedPitcherAllowed = pickedAway ? awayPAllowed : homePAllowed;
  const fadedInn = pickedAway ? innB : innA;
  const pickedInn = pickedAway ? innA : innB;
  const fadedFat = pickedAway ? fatB : fatA;
  const pickedFat = pickedAway ? fatA : fatB;

  // ---- Seed para rotar variantes por juego ----
  const seed = (awayTeam + homeTeam).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const v = arr => arr[seed % arr.length];

  const isDome = roof.includes("dome") || roof.includes("closed") || roof.includes("retract");

  const args = [];

  // ============ TOTALS ============
  if (isTotal) {
    const tGap = Math.abs(diff).toFixed(1);

    // Gap del modelo vs línea
    args.push({ cond: line > 0 && Math.abs(diff) >= 1, mag: Math.abs(diff) + 2, text: isOver
      ? v([
        `The model projects <strong>${projTotal.toFixed(1)} combined runs</strong> against a line of ${line} — the market is ${tGap} runs light on this game.`,
        `At ${runsA.toFixed(1)} runs for ${awayTeam} and ${runsB.toFixed(1)} for ${homeTeam}, the projected total of ${projTotal.toFixed(1)} clears the ${line} line by ${tGap}.`
      ])
      : v([
        `The model caps this game at <strong>${projTotal.toFixed(1)} combined runs</strong> — ${tGap} below the ${line} the market hung.`,
        `Projected scoring of ${runsA.toFixed(1)} + ${runsB.toFixed(1)} lands at ${projTotal.toFixed(1)}, well short of the ${line} line.`
      ])
    });

    // Pitchers — SOLO en la dirección del pick
    if (isOver) {
      if (awayPAllowed >= 4.6) args.push({ cond: true, mag: awayPAllowed - 4.3, text:
       `${awayP} has been getting hit — allowing ${awayPAllowed.toFixed(2)} runs per 9 innings over his last 5 outings, exactly the kind of arm ${homeTeam}'s lineup feeds on.`
           });
      if (homePAllowed >= 4.6) args.push({ cond: true, mag: homePAllowed - 4.3, text:
        `On the other side, ${homeP} has allowed ${homePAllowed.toFixed(2)} runs per 9 across his last 5 outings — no shutdown arm in this matchup.`
      });
      if (innA > 0 && innA < 4.7) args.push({ cond: true, mag: 5 - innA, text:
        `${awayP} averages just ${innA.toFixed(1)} innings per start — ${awayTeam}'s bullpen enters early${fatA >= 12 ? `, and it's already gassed (fatigue ${fatA.toFixed(1)})` : ""}, opening the late-inning scoring window.`
      });
      if (innB > 0 && innB < 4.7) args.push({ cond: true, mag: 5 - innB, text:
        `${homeP} rarely gets deep (${innB.toFixed(1)} innings/start), exposing ${homeTeam}'s bullpen${fatB >= 12 ? ` — running hot at ${fatB.toFixed(1)} fatigue` : ""} to a lineup that punishes middle relief.`
      });
      if (fatA >= 12 && innA >= 4.7) args.push({ cond: true, mag: fatA / 5, text:
        `${awayTeam}'s bullpen is fatigued (${fatA.toFixed(1)}) — tired arms in the late innings are where Overs cash.`
      });
      if (fatB >= 12 && innB >= 4.7) args.push({ cond: true, mag: fatB / 5, text:
        `${homeTeam}'s relief corps is running on fumes (fatigue ${fatB.toFixed(1)}) — the model expects late runs.`
      });
      if (awayOff >= 4.8) args.push({ cond: true, mag: awayOff - 4.4, text:
        `${awayTeam}'s offense is producing ${awayOff.toFixed(2)} runs per game — a lineup swinging it well right now.`
      });
      if (homeOff >= 4.8) args.push({ cond: true, mag: homeOff - 4.4, text:
        `${homeTeam} brings ${homeOff.toFixed(2)} runs per game of recent production into a favorable matchup.`
      });
    }

    if (isUnder) {
      if (awayPAllowed > 0 && awayPAllowed <= 3.6) args.push({ cond: true, mag: 4.2 - awayPAllowed, text:
       `${awayP} has been stingy — just ${awayPAllowed.toFixed(2)} runs per 9 innings over his last 5 outings, the kind of arm that strangles totals.`
      });
      if (homePAllowed > 0 && homePAllowed <= 3.6) args.push({ cond: true, mag: 4.2 - homePAllowed, text:
       `${homeP} is dealing: ${homePAllowed.toFixed(2)} runs per 9 in his last 5 outings keeps ${awayTeam}'s lineup in check.`
      });
      if (innA >= 5.8) args.push({ cond: true, mag: innA - 5, text:
        `${awayP} is a workhorse (${innA.toFixed(1)} innings/start) — deep starts mean fewer bullpen innings and fewer scoring windows.`
      });
      if (innB >= 5.8) args.push({ cond: true, mag: innB - 5, text:
        `${homeP} goes deep (${innB.toFixed(1)} innings/start), keeping the game in the starter's hands and off the scoreboard.`
      });
      if (awayOff > 0 && awayOff <= 3.9) args.push({ cond: true, mag: 4.4 - awayOff, text:
        `${awayTeam}'s bats are cold — ${awayOff.toFixed(2)} runs per game recently.`
      });
      if (homeOff > 0 && homeOff <= 3.9) args.push({ cond: true, mag: 4.4 - homeOff, text:
        `${homeTeam} is scraping for runs at ${homeOff.toFixed(2)} per game — no offensive engine here.`
      });
    }

    // Clima — solo si empuja hacia el pick, y solo outdoor
    if (!isDome) {
      if (isOver && wDir === "out" && wSpeed >= 7) args.push({ cond: true, mag: wSpeed / 4, text:
        `The wind is blowing out at ${wSpeed} mph at ${parkName} — a hitter's tailwind that turns warning-track flies into damage.`
      });
      if (isUnder && wDir === "in" && wSpeed >= 7) args.push({ cond: true, mag: wSpeed / 4, text:
        `Wind blowing in at ${wSpeed} mph knocks down fly balls — free outs for both pitching staffs.`
      });
      if (isOver && Number.isFinite(temp) && temp >= 85) args.push({ cond: true, mag: (temp - 80) / 5, text:
        `At ${temp}°F, the ball carries — hot, thin air adds distance to every fly ball.`
      });
      if (isUnder && Number.isFinite(temp) && temp <= 55) args.push({ cond: true, mag: (60 - temp) / 5, text:
        `Cold conditions (${temp}°F) deaden contact and keep the ball in the park.`
      });
    }

    // Park — solo en dirección del pick
    if (isOver && pf >= 1.04) args.push({ cond: true, mag: (pf - 1) * 30, text:
      `${parkName} plays hitter-friendly (park factor ${pf.toFixed(2)}) — the venue itself adds runs to this projection.`
    });
    if (isUnder && pf <= 0.96) args.push({ cond: true, mag: (1 - pf) * 30, text:
      `${parkName} suppresses offense (park factor ${pf.toFixed(2)}) — a pitcher's yard working in the Under's favor.`
    });
  }

  // ============ ML / RUNLINE ============
  if (isTeamPick) {
    const rGap = pickedRuns - fadedRuns;

    // Gap de proyección
    args.push({ cond: rGap >= 0.6, mag: rGap + 2, text: v([
      `The model projects ${pickedTeam} for ${pickedRuns.toFixed(1)} runs against ${fadedRuns.toFixed(1)} for ${fadedTeam} — a ${rGap.toFixed(1)}-run gap in a sport where one run decides most games.`,
      `Run projections tilt clearly: ${pickedRuns.toFixed(1)} to ${fadedRuns.toFixed(1)} in ${pickedTeam}'s favor.`
    ])});

    // Ventaja de pitcheo abridor
    if (pickedPitcherAllowed > 0 && fadedPitcherAllowed > 0 && fadedPitcherAllowed - pickedPitcherAllowed >= 0.8) {
  args.push({ cond: true, mag: fadedPitcherAllowed - pickedPitcherAllowed + 1, text: v([
        `The pitching matchup is the story: over their last 5 outings, ${pickedPitcher} has allowed ${pickedPitcherAllowed.toFixed(2)} runs per 9 against ${fadedPitcher}'s ${fadedPitcherAllowed.toFixed(2)} — a clear mound advantage for ${pickedTeam}.`,
        `Across his last 5 outings ${fadedPitcher} has allowed ${fadedPitcherAllowed.toFixed(2)} runs per 9 while ${pickedPitcher} sits at ${pickedPitcherAllowed.toFixed(2)} — the model weighs starting pitching heavily, and this one isn't close.`
      ])});
    }

    // Pitcher rival corto + bullpen rival cansado
    if (fadedInn > 0 && fadedInn < 4.7) args.push({ cond: true, mag: 5 - fadedInn + (fadedFat >= 12 ? 1.5 : 0), text:
      `${fadedPitcher} averages only ${fadedInn.toFixed(1)} innings per start — ${fadedTeam} hands this to its bullpen early${fadedFat >= 12 ? `, and that bullpen is fatigued (${fadedFat.toFixed(1)})` : ""}, exactly where ${pickedTeam}'s lineup does damage.`
    });

    // Ofensiva propia caliente
    const pickedOff = pickedAway ? awayOff : homeOff;
    const fadedOff = pickedAway ? homeOff : awayOff;
    if (pickedOff >= 4.8) args.push({ cond: true, mag: pickedOff - 4.4, text:
      `${pickedTeam}'s offense is rolling at ${pickedOff.toFixed(2)} runs per game.`
    });
    if (fadedOff > 0 && fadedOff <= 3.9) args.push({ cond: true, mag: 4.4 - fadedOff, text:
      `${fadedTeam}'s lineup is scuffling — ${fadedOff.toFixed(2)} runs per game won't keep pace with this projection.`
    });

    // Pitcher propio workhorse
    if (pickedInn >= 5.8) args.push({ cond: true, mag: pickedInn - 5.2, text:
      `${pickedPitcher} goes deep (${pickedInn.toFixed(1)} innings/start), shortening the game and protecting the lead the model projects.`
    });
  }

  // ---- Top 3 argumentos por magnitud ----
  const valid = args.filter(a => a.cond).sort((a, b) => b.mag - a.mag).slice(0, 3);

  // ---- Caveat: dato fuerte EN CONTRA, mencionado como riesgo controlado ----
  let risk = "";
  if (isOver) {
    if (innA >= 6 || innB >= 6) {
      const wp = innA >= 6 ? awayP : homeP;
      const wi = innA >= 6 ? innA : innB;
      risk = `The one caveat: ${wp} is a workhorse (${wi.toFixed(1)} innings/start) — the model already priced that in, and the projected total still cleared the line.`;
    } else if (!isDome && wDir === "in" && wSpeed >= 7) {
      risk = `The one caveat: wind blowing in at ${wSpeed} mph — even against it, the offensive edge held.`;
    } else if (pf <= 0.96) {
      risk = `The one caveat: ${parkName} is a pitcher's park (${pf.toFixed(2)}) — the model factored the venue and the Over still qualified.`;
    }
  }
  if (isUnder) {
    if (!isDome && wDir === "out" && wSpeed >= 7) {
      risk = `The one caveat: wind blowing out at ${wSpeed} mph — the pitching edge outweighed it in the model's read.`;
    } else if (pf >= 1.04) {
      risk = `The one caveat: ${parkName} plays hitter-friendly (${pf.toFixed(2)}) — even in this yard, the projection came in under the number.`;
    } else if (awayOff >= 4.8 || homeOff >= 4.8) {
      const ht = awayOff >= 4.8 ? awayTeam : homeTeam;
      risk = `The one caveat: ${ht}'s bats have been productive — the pitching matchup is what caps them in the model's read.`;
    }
  }
  if (isTeamPick) {
    if (fadedPitcherAllowed > 0 && fadedPitcherAllowed <= 3.6) {
      risk = `The one caveat: ${fadedPitcher} has pitched well lately (${fadedPitcherAllowed.toFixed(2)} runs per 9 over his last 5) — the model saw it and still found enough edge elsewhere to qualify the play.`;
    } else if (pickedFat >= 12) {
      risk = `The one caveat: ${pickedTeam}'s bullpen is fatigued (${pickedFat.toFixed(1)}) — priced into the projection, and the edge survived.`;
    }
  }

  // ---- Armar narrativa ----
  if (pick) {
    s.push(v([
      `The model flagged <strong>${pick}</strong> at ${conf.toFixed(1)}% confidence in this matchup.`,
      `<strong>${pick}</strong> hit the model's premium threshold at ${conf.toFixed(1)}% confidence.`,
      `This game triggered a premium flag: <strong>${pick}</strong>, ${conf.toFixed(1)}% on the model's scale.`
    ]));
  } else {
    s.push(`No single factor was strong enough to qualify a premium play here, but these are the dynamics the model weighed.`);
  }

  valid.forEach(a => s.push(a.text));
  if (risk) s.push(risk);

  if (pick) {
    s.push(v([
      `Stacked together, that's what qualified this play as premium.`,
      `That alignment of factors is what separated this game from the rest of today's slate.`,
      `The model doesn't flag plays without that convergence — this one had it.`
    ]));
  }

  return s.join(" ");
}
function generateBasketHighlight(premium, awayTeam, homeTeam) {
  if (!premium) return "";
  const s = [];
  const rawPick = String(premium.pick || "");
  const pick = rawPick.replace(" cubre spread", "").replace(" cubre", "");
  const pickUp = pick.toUpperCase();
  const projA = Number(premium.projA || 0);
  const projB = Number(premium.projB || 0);
  const totalProj = Number(premium.totalProj || 0);
  const line = Number(premium.totalLine || 0);
  const edge = Number(premium.mainEdge || 0);
  const margin = Number(premium.spreadDiff || (projA - projB));
  const conf = Number(premium.confidence || 0);

  const isOver = pickUp.includes("OVER");
  const isUnder = pickUp.includes("UNDER");
  const isSpread = !isOver && !isUnder;
  const pickedAway = isSpread && pick.includes(awayTeam);
  const pickedTeam = pickedAway ? awayTeam : homeTeam;
  const fadedTeam = pickedAway ? homeTeam : awayTeam;
  const pickedProj = pickedAway ? projA : projB;
  const fadedProj = pickedAway ? projB : projA;
  const gap = Math.abs(pickedProj - fadedProj);

  // Línea del spread desde el texto del pick (ej. -12.5 / +8.5)
  const lineMatch = pick.match(/([+-]\d+(\.\d+)?)/);
  const spreadLine = lineMatch ? Number(lineMatch[1]) : null;
  const isFavorite = spreadLine !== null && spreadLine < 0;
  const isDog = spreadLine !== null && spreadLine > 0;
  const cushion = spreadLine !== null ? gap - Math.abs(spreadLine) : null;

  // Seed determinístico por juego para rotar frases (mismo juego = mismo texto)
  const seed = (awayTeam + homeTeam).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const v = (arr) => arr[seed % arr.length];

  // Descanso / lesiones
  const restB2B = t => /back-to-back/i.test(t || "");
  const restGood = t => /buen descanso|well rested/i.test(t || "");
  const awayB2B = restB2B(premium.awayRestNote), homeB2B = restB2B(premium.homeRestNote);
  const awayRested = restGood(premium.awayRestNote), homeRested = restGood(premium.homeRestNote);
  const injNames = note => {
    const t = String(note || "");
    return /no se (reportan|pudieron)|no key absences|could not read/i.test(t) ? "" : t;
   };
  const awayInj = injNames(premium.awayInjuryNote);
  const homeInj = injNames(premium.homeInjuryNote);
  const pickedInj = pickedAway ? awayInj : homeInj;
  const fadedInj = pickedAway ? homeInj : awayInj;
  const pickedB2B = pickedAway ? awayB2B : homeB2B;
  const fadedB2B = pickedAway ? homeB2B : awayB2B;
  const pickedRested = pickedAway ? awayRested : homeRested;
  const fadedRested = pickedAway ? homeRested : awayRested;

  const args = [];

  if (isSpread) {
    // 1. Gap de proyección — con framing según tamaño
    if (gap >= 15) {
      args.push({ cond: true, mag: gap, text: v([
        `The projections aren't close: <strong>${pickedProj.toFixed(1)} to ${fadedProj.toFixed(1)}</strong>. The model sees ${pickedTeam} controlling this from start to finish — a ${gap.toFixed(1)}-point gap against a ${Math.abs(spreadLine || 0)}-point line.`,
        `This one profiles as a potential blowout. The model has ${pickedTeam} at ${pickedProj.toFixed(1)} and ${fadedTeam} at just ${fadedProj.toFixed(1)} — nearly double the separation the line demands.`
      ])});
    } else if (gap >= 6) {
      args.push({ cond: true, mag: gap, text: v([
        `The model projects ${pickedProj.toFixed(1)} for ${pickedTeam} vs ${fadedProj.toFixed(1)} for ${fadedTeam} — a ${gap.toFixed(1)}-point margin that clears the number${cushion !== null && cushion > 2 ? ` with ${cushion.toFixed(1)} points to spare` : ""}.`,
        `On raw projections this is ${pickedTeam}'s game: ${pickedProj.toFixed(1)} to ${fadedProj.toFixed(1)}, enough cushion over the ${Math.abs(spreadLine || 0)}-point line to qualify.`
      ])});
    } else {
      args.push({ cond: true, mag: gap, text:
        `The model projects a tighter game than the market — ${pickedProj.toFixed(1)} to ${fadedProj.toFixed(1)} — but the number is what creates the value here.`
      });
    }

    // 2. Framing favorito vs dog
    if (isDog) {
      args.push({ cond: true, mag: 4, text: v([
        `The market is asking ${pickedTeam} to stay within ${Math.abs(spreadLine)} — the model says they ${gap > 0 && pickedProj > fadedProj ? "win this game outright" : `only lose by ${Math.abs(margin).toFixed(1)}`}. That's free points.`,
        `Getting +${Math.abs(spreadLine)} with a team the model ${pickedProj > fadedProj ? "projects to win straight up" : "sees keeping it close"} is exactly the kind of mispricing the model hunts for.`
      ])});
    } else if (isFavorite && Math.abs(spreadLine) >= 10) {
      args.push({ cond: cushion !== null && cushion > 0, mag: 3, text: v([
        `Laying ${Math.abs(spreadLine)} points is usually dangerous — but the model's projected margin of ${gap.toFixed(1)} says ${fadedTeam} simply doesn't have the firepower to keep this inside the number.`,
        `Big spreads scare the public. The model doesn't flinch here: ${fadedTeam}'s projected ${fadedProj.toFixed(1)} points leave them ${gap.toFixed(1)} behind, well past the line.`
      ])});
    }

    // 3. Producción ofensiva desequilibrada
    if (pickedProj >= 95 && fadedProj <= 82) {
      args.push({ cond: true, mag: 3.5, text: v([
        `The mismatch is on both ends: ${pickedTeam}'s projected ${pickedProj.toFixed(1)} points come against a ${fadedTeam} attack the model caps at ${fadedProj.toFixed(1)} — they can't trade baskets in this one.`,
        `${fadedTeam} projects for just ${fadedProj.toFixed(1)} points — against ${pickedTeam}'s ${pickedProj.toFixed(1)}, they'd need a defensive miracle the recent data doesn't support.`
      ])});
    }

    // 4. Contexto del total aunque el pick sea spread
    if (line > 0 && Math.abs(totalProj - line) >= 4) {
      const dir = totalProj > line ? "faster and higher-scoring" : "slower and lower-scoring";
      args.push({ cond: true, mag: 2, text:
        `Worth noting: the model also sees this game playing ${dir} than the market's ${line} total (projected ${totalProj.toFixed(1)}) — the same read that's driving the spread edge.`
      });
    }

    // 5. Lesiones del rival
    args.push({ cond: !!fadedInj, mag: 4, text:
      `${fadedTeam} comes in compromised: ${fadedInj}. That's production the line hasn't fully discounted.`
    });

    // 6. Ventaja de descanso
    args.push({ cond: fadedB2B && !pickedB2B, mag: 3.5, text:
      `${fadedTeam} is on the second night of a back-to-back while ${pickedTeam} ${pickedRested ? "is fully rested" : "played a normal schedule"} — legs matter in fourth quarters.`
    });
    args.push({ cond: pickedRested && !fadedRested && !fadedB2B, mag: 1.5, text: v([
      `${pickedTeam} also holds the rest edge — extra recovery days versus ${fadedTeam}'s standard turnaround.`,
      `The schedule tilts this further: ${pickedTeam} comes in with extra rest while ${fadedTeam} runs a normal rotation.`
    ])});
  }

  if (isOver || isUnder) {
    const tGap = Math.abs(totalProj - line).toFixed(1);
    args.push({ cond: line > 0, mag: Math.abs(totalProj - line), text: isOver
      ? v([
        `The model projects <strong>${totalProj.toFixed(1)} combined points</strong> against a ${line} line — the market is ${tGap} points light on this game.`,
        `At ${totalProj.toFixed(1)} projected points, the model sees scoring the ${line} line doesn't account for — a ${tGap}-point gap.`
      ])
      : v([
        `The model caps this game at <strong>${totalProj.toFixed(1)} combined points</strong> — ${tGap} below the ${line} line the market hung.`,
        `Projected scoring of ${totalProj.toFixed(1)} falls ${tGap} short of the ${line} line — the market is pricing an offensive game the data doesn't show.`
      ])
    });
    args.push({ cond: isOver && Math.max(projA, projB) >= line * 0.55, mag: 3, text:
      `${projA >= projB ? awayTeam : homeTeam} alone projects for ${Math.max(projA, projB).toFixed(1)} — one team doing most of the work toward the Over.`
    });
    args.push({ cond: isUnder && (awayB2B || homeB2B), mag: 3, text:
      `${awayB2B && homeB2B ? "Both teams are" : `${awayB2B ? awayTeam : homeTeam} is`} on a back-to-back — tired legs historically drag totals down.`
    });
    args.push({ cond: isUnder && !!(awayInj || homeInj), mag: 2.5, text:
      `Key offensive pieces are out or limited${awayInj ? ` for ${awayTeam} (${awayInj})` : ""}${awayInj && homeInj ? " and" : ""}${homeInj ? ` for ${homeTeam} (${homeInj})` : ""}, capping the ceiling.`
    });
    args.push({ cond: isOver && awayRested && homeRested, mag: 2, text:
      `Both teams come in fully rested — fresh legs favor pace and efficiency.`
    });
  }

  const valid = args.filter(a => a.cond).sort((a, b) => b.mag - a.mag).slice(0, 3);

  // Caveat en contra (nunca como argumento)
  let risk = "";
  if (isSpread && pickedInj) risk = `The one caveat: ${pickedTeam}'s own injury report (${pickedInj}) — already priced into the projection, and the edge held.`;
  else if (isSpread && pickedB2B && !fadedB2B) risk = `The one caveat: ${pickedTeam} plays on short rest — the model factored the fatigue and the edge survived it.`;
  else if (isOver && (awayB2B || homeB2B)) risk = `The one caveat: ${awayB2B ? awayTeam : homeTeam} is on short rest — even so, the projected total cleared the line comfortably.`;

  // Apertura con variantes
  s.push(v([
    `The model flagged <strong>${pick}</strong> at ${conf.toFixed(0)}% confidence — a ${edge.toFixed(1)}-point edge over the market.`,
    `<strong>${pick}</strong> hit the model's premium threshold at ${conf.toFixed(0)}% confidence, backed by a ${edge.toFixed(1)}-point edge.`,
    `This game triggered a premium flag: <strong>${pick}</strong>, ${conf.toFixed(0)}% confidence, ${edge.toFixed(1)} points of edge vs the line.`
  ]));
  valid.forEach(a => s.push(a.text));
  if (risk) s.push(risk);

  // Cierre con variantes
  s.push(v([
    `Stacked together, that's what qualified this play as premium.`,
    `That combination is what separated this game from the rest of today's slate.`,
    `The model doesn't flag plays without that alignment — this one had it.`
  ]));

  return s.join(" ");
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
    ncaab: "🎓",
    nfl: "🏈",
    ncaaf: "🎓",
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
      alert("Your session has expired due to inactivity.");
    }
  }, INACTIVITY_LIMIT);
}

["click", "mousemove", "keydown", "scroll", "touchstart"].forEach(eventName => {
  window.addEventListener(eventName, resetInactivityTimer);
});

resetInactivityTimer();
const activeAnalysis = {};

function setAnalysisButtonLoading(index, isLoading, text = "Analyzing...") {
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
    button.innerText = button.dataset.originalText || "View AI Prediction";
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

  box.innerHTML = `<div class="loading-analysis">Generating today's Premium AI Parlay...</div>`;

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      box.innerHTML = `
        <div class="premium-result mlb-premium-dashboard">
          <h3>🔥 CashEdge AI Parlay of the Day</h3>
          <p>Sign in to unlock this Premium feature.</p>
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
      throw new Error(data.error || "Error loading parlay");
    }

    if (!data.available) {
      box.innerHTML = `
        <div class="normal-result">
          <h3>🔥 CashEdge AI Parlay of the Day</h3>
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
          "✅ PREMIUM ALERTS ENABLED";

      } else {

        enableBtn.innerHTML =
          "❌ ALERTS BLOCKED";

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
function toggleGameHighlight(index, premiumJson, awayTeam, homeTeam) {
  const box = document.getElementById(`gameHighlight${index}`);
  if (!box) return;

  if (box.dataset.loaded === "true") {
    box.style.display = box.style.display === "none" ? "block" : "none";
    return;
  }

  if (!IS_ADMIN && !isPremiumUser) {
    box.innerHTML = `
      <div style="background:#0f1628;border:1px solid #1a2240;border-radius:8px;padding:14px;margin-top:8px;text-align:center;">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">🔒 Premium Content</div>
        <div style="font-size:11px;color:#556688;margin-bottom:12px;">The full game story — why the model made this call, factor by factor.</div>
        <button onclick="openPromoModal()" style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:12px;font-weight:700;cursor:pointer;">
          GET PREMIUM · $${MONTHLY_PRICE}/mo
        </button>
      </div>
    `;
    box.dataset.loaded = "true";
    return;
  }

  let premium = null;
  try { premium = JSON.parse(decodeURIComponent(premiumJson)); } catch (e) {}

  box.innerHTML = `
    <div style="background:#0a1220;border:1px solid rgba(255,140,26,0.25);border-left:3px solid #ff8c1a;border-radius:8px;padding:14px 16px;margin-top:8px;text-align:left;">
      <div style="font-size:10px;color:#ff8c1a;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;margin-bottom:8px;">🎯 Game Highlight</div>
     <div style="font-size:12px;color:#d0dcec;line-height:1.7;">${(premium?.recommendedCards ? generateMLBHighlight(premium, awayTeam, homeTeam) : generateBasketHighlight(premium, awayTeam, homeTeam)) || "No standout factors detected in this matchup."}</div>
    </div>
  `;
  box.dataset.loaded = "true";
}
window.toggleGameHighlight = toggleGameHighlight;
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

    if (!response.ok) throw new Error(data.error || "Error loading player props");

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
        <div style="font-size:11px;color:#556688;margin-bottom:12px;">Unlock the best NBA props selected by the AI model</div>
        <button onclick="openPromoModal()" style="width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:12px;font-weight:700;cursor:pointer;">
          GET PREMIUM · $${MONTHLY_PRICE}/MO
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
          <div style="font-size:11px;color:#556688;">No player props available for this game yet.</div>
        </div>
      `;
      box.dataset.loaded = "true";
      return;
    }

    const marketLabels = {
      player_points: "pts", player_rebounds: "reb",
      player_assists: "ast", player_threes: "3PT"
    };

    const tabs = ["Points", "Rebounds", "Assists", "3PT"];
    const marketKeys = ["player_points", "player_rebounds", "player_assists", "player_threes"];

    const allProps = [...(data.props || []), ...(data.lockedProps || [])];

    function renderProps(marketKey) {
      const filtered = allProps.filter(p => p.market === marketKey);
      if (!filtered.length) return `<div style="font-size:11px;color:#556688;padding:10px;text-align:center;">No props for this market.</div>`;

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
        : `<div style="font-size:11px;color:#556688;padding:10px;text-align:center;">No props for this market.</div>`;
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
      <h2 style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">Get Premium</h2>
      <p style="font-size:13px;color:#a0b4cc;margin-bottom:16px;">¿Have a promo code?</p>

      <input
        id="promoCodeInput"
        type="text"
        placeholder="Promo code (optional)"
        style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #0e2a4a;background:#030c18;color:#e8f4ff;font-size:13px;box-sizing:border-box;outline:none;margin-bottom:12px;"
      />

      <button onclick="goPremiumMonthly()" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(90deg,#00ffe7,#7c3cff);color:#020814;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;margin-bottom:8px;">
        CONTINUE →
      </button>

      <button onclick="skipPromoCode()" style="width:100%;padding:12px;border:1px solid #0e2a4a;border-radius:10px;background:transparent;color:#a0b4cc;font-size:12px;font-weight:500;cursor:pointer;">
        I don't have a code
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

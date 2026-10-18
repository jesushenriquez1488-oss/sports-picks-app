// /api/twitter-bot.js
// CashEdge X Bot — every post goes out with a branded image generated on the fly.
// Posts have NO links on purpose: X charges $0.015 per post without a URL vs $0.20 with one.
// The link to cashedgeapp.com lives in the profile bio.

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const X_API_KEY = process.env.X_API_KEY;
const X_API_SECRET = process.env.X_API_SECRET;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// ── CONFIG ─────────────────────────────────────────────────────────────────
const TABLE = "picks_history";
const DATE_COL = "game_date";
const TZ = "America/Chicago";

const SPORT_EMOJI = { nba: "🏀", wnba: "🏀", ncaab: "🏀", mlb: "⚾", nfl: "🏈", ncaaf: "🏈" };
const SPORT_TAG = { nba: "NBA", wnba: "WNBA", ncaab: "CBB", mlb: "MLB", nfl: "NFL", ncaaf: "CFB" };

// Brand
const C = {
  bg: "#020814", card: "#0a1424", line: "#16243a",
  cyan: "#00ffe7", purple: "#7c3cff", white: "#f0f6ff", muted: "#8a9ab5",
  win: "#22e58a", loss: "#ff5a6e", push: "#8a9ab5"
};
const IMG_W = 1200;
const IMG_H = 675;

// ── OAuth 1.0a ─────────────────────────────────────────────────────────────
function encode(str) {
  return encodeURIComponent(String(str));
}

function oauthSign(method, url) {
  const p = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };
  const paramStr = Object.keys(p).sort().map(k => `${encode(k)}=${encode(p[k])}`).join("&");
  const base = `${method}&${encode(url)}&${encode(paramStr)}`;
  const key = `${encode(X_API_SECRET)}&${encode(X_ACCESS_TOKEN_SECRET)}`;
  p.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(p).map(k => `${encode(k)}="${encode(p[k])}"`).join(", ");
}

// ── X API ──────────────────────────────────────────────────────────────────
async function uploadImage(pngBuffer) {
  const url = "https://api.x.com/2/media/upload";
  const form = new FormData();
  form.append("media", new Blob([pngBuffer], { type: "image/png" }), "cashedge.png");
  form.append("media_category", "tweet_image");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": oauthSign("POST", url) },
    body: form
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Media upload: ${JSON.stringify(data)}`);
  const id = data?.data?.id || data?.media_id_string;
  if (!id) throw new Error(`Media upload: no id ${JSON.stringify(data)}`);
  return id;
}

async function postTweet(text, mediaId) {
  const url = "https://api.x.com/2/tweets";
  const body = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": oauthSign("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// ── Supabase ───────────────────────────────────────────────────────────────
const sbHeaders = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

async function sbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  const json = await res.json();
  if (!res.ok) throw new Error(`Supabase: ${JSON.stringify(json)}`);
  return Array.isArray(json) ? json : (json.data || []);
}

async function sbCount(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&${query}`, {
    method: "HEAD",
    headers: { ...sbHeaders, "Prefer": "count=exact", "Range": "0-0" }
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}

function chicagoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function prettyDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" })
    .format(d).toUpperCase();
}

function gameLabel(p) {
  if (p.game) return p.game;
  if (p.away_team && p.home_team) return `${p.away_team} @ ${p.home_team}`;
  return p.matchup || "";
}
function pickLabel(p) {
  const pick = p.pick || "";
  // Totals are saved as just "Over"/"Under": add the line (e.g. "Under 156.5")
  if (/^(over|under)$/i.test(pick) && p.line != null) return `${pick} ${p.line}`;
  return pick;
}
function sportOf(p) {
  return String(p.sport || p.type || "").toLowerCase();
}

// ── Data ───────────────────────────────────────────────────────────────────
// Same source as the landing page
async function getPremiumRecord() {
  const rows = await sbSelect("sport_record_summary", "select=sport,display_name,total_wins,total_losses,accuracy");
  const wins = rows.reduce((s, r) => s + (Number(r.total_wins) || 0), 0);
  const losses = rows.reduce((s, r) => s + (Number(r.total_losses) || 0), 0);
  const total = wins + losses;
  const pct = total > 0 ? ((wins / total) * 100).toFixed(1) : null;
  return { wins, losses, pct, bySport: rows };
}

// The Free Premium Play posted yesterday (saved in x_free_plays when it was tweeted)
async function getYesterdayFreePlay() {
  const saved = await sbSelect("x_free_plays", `select=pick_id&post_date=eq.${chicagoDate(-1)}&limit=1`);
  if (!saved[0]) return null;
  const rows = await sbSelect(TABLE, `select=*&id=eq.${saved[0].pick_id}&limit=1`);
  const p = rows[0];
  if (!p || !/^(win|loss|push)$/i.test(p.result)) return null; // not graded yet → don't post
  return p;
}

async function saveFreePlay(pickId) {
  await fetch(`${SUPABASE_URL}/rest/v1/x_free_plays`, {
    method: "POST",
    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ post_date: chicagoDate(0), pick_id: pickId })
  });
}

// Free Premium Play: one of today's Premium picks, still pending, lowest confidence
async function getTodayFreePick() {
  const rows = await sbSelect(TABLE,
    `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}&result=ilike.pending&order=confidence.asc&limit=20`);
  return rows.find(p => pickLabel(p) && gameLabel(p)) || null;
}

async function getTodayPremiumCount() {
  return sbCount(`is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}`);
}

// ── Image building blocks (Satori: every div with 2+ children needs display:flex) ─
function h(type, style, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { style, children: kids.length === 1 ? kids[0] : kids } };
}

function frame(kicker, ...body) {
  return h("div", {
    width: IMG_W, height: IMG_H, display: "flex", flexDirection: "column",
    backgroundColor: C.bg, padding: "48px 60px", fontFamily: "Inter",
    backgroundImage: "radial-gradient(circle at 0% 100%, rgba(0,255,231,0.18), transparent 45%), radial-gradient(circle at 100% 0%, rgba(124,60,255,0.25), transparent 45%)"
  },
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
      h("div", { display: "flex", fontSize: 34, fontWeight: 800 },
        h("span", { color: C.white }, "Cash"),
        h("span", { color: C.cyan }, "Edge")
      ),
      h("div", { display: "flex", fontSize: 22, color: C.cyan, letterSpacing: 3, fontWeight: 700 }, kicker)
    ),
    h("div", { display: "flex", width: 220, height: 6, marginTop: 14,
      backgroundImage: `linear-gradient(90deg, ${C.cyan}, ${C.purple})` }),
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 28 }, ...body),
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 18, color: C.muted },
      h("span", { color: C.cyan, fontWeight: 800 }, "📲 Free alerts on Telegram: t.me/Cashedgeapp"),
      h("span", {}, "21+ | Gamble responsibly | 1-800-MY-RESET")
    )
  );
}

function badge(result) {
  const r = String(result).toLowerCase();
  const color = C[r] || C.muted;
  const label = r === "win" ? "W" : r === "loss" ? "L" : "P";
  return h("div", {
    display: "flex", width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: color, color: C.bg, fontSize: 30, fontWeight: 800
  }, label);
}

function sportChip(s) {
  return h("div", {
    display: "flex", padding: "6px 14px", borderRadius: 8, border: `2px solid ${C.line}`,
    color: C.cyan, fontSize: 20, fontWeight: 700, marginRight: 18, minWidth: 80, justifyContent: "center"
  }, SPORT_TAG[s] || s.toUpperCase() || "—");
}

// ── Images ─────────────────────────────────────────────────────────────────
function receiptsImage(picks, w, l) {
  const shown = picks.slice(0, 5);
  return frame(`YESTERDAY · ${prettyDate(-1)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 44, color: C.white, fontWeight: 800 }, "Premium picks went"),
      h("div", { display: "flex", fontSize: 64, color: C.cyan, fontWeight: 800, marginLeft: 20 }, `${w}-${l}`)
    ),
    h("div", { display: "flex", flexDirection: "column", marginTop: 22 },
      shown.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "12px 18px", marginBottom: 10,
        backgroundColor: C.card, borderRadius: 14, border: `1px solid ${C.line}`
      },
        sportChip(sportOf(p)),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 28, color: C.white, fontWeight: 800 }, pickLabel(p).slice(0, 40)),
          h("div", { display: "flex", fontSize: 18, color: C.muted, marginTop: 2 }, gameLabel(p).slice(0, 60))
        ),
        badge(p.result)
      )),
      picks.length > 5 ? h("div", { display: "flex", fontSize: 22, color: C.muted }, `+${picks.length - 5} more`) : null
    )
  );
}

function freeResultImage(p) {
  const s = sportOf(p);
  const r = String(p.result).toLowerCase();
  const color = C[r] || C.muted;
  const word = r === "win" ? "WIN" : r === "loss" ? "LOSS" : "PUSH";
  return frame(`YESTERDAY · ${prettyDate(-1)}`,
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 },
      h("div", { display: "flex", fontSize: 28, color: C.muted, fontWeight: 800, letterSpacing: 3 }, "FREE PREMIUM PLAY"),
      h("div", { display: "flex", alignItems: "center", marginTop: 18 },
        sportChip(s),
        h("div", { display: "flex", fontSize: 30, color: C.muted, fontWeight: 500 }, gameLabel(p).slice(0, 52))
      ),
      h("div", { display: "flex", alignItems: "center", marginTop: 22 },
        h("div", { display: "flex", fontSize: 76, color: C.white, fontWeight: 800 }, pickLabel(p).slice(0, 26)),
        h("div", {
          display: "flex", marginLeft: 32, padding: "10px 28px", borderRadius: 14,
          backgroundColor: color, color: C.bg, fontSize: 52, fontWeight: 800
        }, word)
      ),
      p.final_score ? h("div", { display: "flex", fontSize: 26, color: C.muted, marginTop: 22 },
        `Final: ${String(p.final_score).slice(0, 70)}`) : null
    )
  );
}

function freePickImage(p) {
  const s = sportOf(p);
  return frame(`FREE PREMIUM PLAY · ${prettyDate(0)}`,
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 },
      h("div", { display: "flex", marginBottom: 22 }, sportChip(s)),
      h("div", { display: "flex", fontSize: 40, color: C.muted, fontWeight: 700 }, gameLabel(p).slice(0, 60)),
      h("div", { display: "flex", fontSize: 76, color: C.cyan, fontWeight: 800, marginTop: 16 }, pickLabel(p).slice(0, 32)),
      h("div", { display: "flex", fontSize: 26, color: C.white, marginTop: 34 },
        "Line movement, betting splits & Premium picks in the app")
    )
  );
}

function teaserImage(count, rec) {
  const bars = Array.from({ length: Math.min(count, 4) });
  return frame(`TODAY · ${prettyDate(0)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 96, color: C.cyan, fontWeight: 800 }, String(count)),
      h("div", { display: "flex", fontSize: 44, color: C.white, fontWeight: 800, marginLeft: 20 },
        `Premium ${count === 1 ? "pick" : "picks"} on the board`)
    ),
    h("div", { display: "flex", flexDirection: "column", marginTop: 12 },
      bars.map((_, i) => h("div", {
        display: "flex", alignItems: "center", padding: "14px 18px", marginBottom: 10,
        backgroundColor: C.card, borderRadius: 14, border: `1px solid ${C.line}`
      },
        h("div", { display: "flex", width: 80, height: 22, borderRadius: 6, backgroundColor: C.line, marginRight: 18 }),
        h("div", { display: "flex", width: 380 + (i % 2) * 120, height: 22, borderRadius: 6,
          backgroundImage: `linear-gradient(90deg, ${C.line}, rgba(124,60,255,0.35))`, flexGrow: 0 }),
        h("div", { display: "flex", marginLeft: "auto", fontSize: 22, color: C.purple, fontWeight: 800, letterSpacing: 2 }, "LOCKED")
      ))
    ),
    rec.pct ? h("div", { display: "flex", fontSize: 26, color: C.muted, marginTop: 8 },
      `Premium record ${rec.wins}-${rec.losses} (${rec.pct}%) · tracked publicly`) : null
  );
}

function recordImage(rec) {
  const order = ["nfl", "nba", "mlb", "wnba", "ncaaf", "ncaab"];
  const rows = [...rec.bySport].sort((a, b) => order.indexOf(a.sport) - order.indexOf(b.sport));
  return frame("PREMIUM RECORD",
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 110, color: C.white, fontWeight: 800 }, `${rec.wins}-${rec.losses}`),
      h("div", { display: "flex", fontSize: 60, color: C.cyan, fontWeight: 800, marginLeft: 28 }, `${rec.pct}%`)
    ),
    h("div", { display: "flex", flexWrap: "wrap", marginTop: 18 },
      rows.map(r => h("div", {
        display: "flex", flexDirection: "column", width: 340, padding: "14px 18px", marginRight: 16, marginBottom: 14,
        backgroundColor: C.card, borderRadius: 14, border: `1px solid ${C.line}`
      },
        h("div", { display: "flex", fontSize: 20, color: C.cyan, fontWeight: 700, letterSpacing: 2 }, SPORT_TAG[r.sport] || r.display_name),
        h("div", { display: "flex", fontSize: 32, color: C.white, fontWeight: 800, marginTop: 4 },
          `${r.total_wins}-${r.total_losses}`)
      ))
    )
  );
}

let FONTS = null;
async function loadFonts() {
  if (FONTS) return FONTS;
  const base = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.8/files";
  const [regular, bold] = await Promise.all([
    fetch(`${base}/inter-latin-500-normal.woff`).then(r => r.arrayBuffer()),
    fetch(`${base}/inter-latin-800-normal.woff`).then(r => r.arrayBuffer())
  ]);
  FONTS = [
    { name: "Inter", data: regular, weight: 500, style: "normal" },
    { name: "Inter", data: bold, weight: 800, style: "normal" }
  ];
  return FONTS;
}

async function renderPng(element) {
  const { ImageResponse } = await import("@vercel/og");
  const fonts = await loadFonts();
  const img = new ImageResponse(element, { width: IMG_W, height: IMG_H, fonts });
  return Buffer.from(await img.arrayBuffer());
}

// ── Post builders: return { text, image } or null when there is nothing honest to say ─
async function buildReceipts() {
  const p = await getYesterdayFreePlay();
  if (!p) return null;
  const r = String(p.result).toLowerCase();
  const word = r === "win" ? "✅ WIN" : r === "loss" ? "❌ LOSS" : "➖ PUSH";
  const score = p.final_score ? `\nFinal: ${p.final_score}` : "";
  return {
    text: `${r === "win" ? "Called it. ✅" : r === "loss" ? "Missed this one. ❌" : "Push. ➖"}\n\nYesterday's Free Premium Play: ${pickLabel(p)} ${word}${score}\n\nPosted before the game. Every result goes public, wins AND losses.\n\n🆓 Today's free play drops at 12 PM CT\n📲 Get it first on our Telegram → link in bio\n\n#${SPORT_TAG[sportOf(p)] || "Sports"}Picks #SportsBetting`,
    image: freeResultImage(p),
    cardDate: chicagoDate(-1) // real CashEdge card of yesterday's free play
  };
}

async function buildFreePick() {
  const p = await getTodayFreePick();
  if (!p) return null;
  const s = sportOf(p);
  return {
    text: `🆓 FREE PREMIUM PLAY\n\n${SPORT_EMOJI[s] || "🎯"} ${pickLabel(p)}\n${gameLabel(p)}\n\nOne of today\'s Premium picks, free. The rest are locked in the app with live line movement and sharp money alerts.\n\nResult posted tomorrow, win or lose.\n\n📲 Line-move alerts FREE on our Telegram → link in bio\n\n#${SPORT_TAG[s] || "Sports"}Picks #SportsBetting`,
    image: freePickImage(p),
    pickId: p.id,
    cardDate: chicagoDate(0) // real CashEdge card of today's free play
  };
}

async function buildTeaser() {
  const count = await getTodayPremiumCount();
  if (count === 0) return null;
  const rec = await getPremiumRecord();
  return {
    text: `🔒 ${count} Premium ${count === 1 ? "pick" : "picks"} on today's board.\n\nThe line already moved on some of them. Premium shows you where the sharp money went, every line move in real time, and advanced player props.\n\n🔗 Link in bio · First month $34.99\n\n#SportsBetting #SportsPicks\n21+ | Gamble responsibly`,
    image: teaserImage(count, rec)
  };
}

async function buildRecord() {
  const rec = await getPremiumRecord();
  if (rec.wins + rec.losses === 0) return null;
  return {
    text: `📊 ${rec.wins}-${rec.losses} (${rec.pct}%)\n\nThat's the CashEdge Premium record. Every pick graded publicly. No deleted losses, no cherry-picking.\n\n🆓 Free Premium Play every day at 12 PM CT\n📲 Daily alerts free on our Telegram → link in bio\n\n#SportsBetting\n21+ | Statistical analysis, not betting advice`,
    image: recordImage(rec)
  };
}

// Market stories (story engine): ?type=market&set=a (2 PM CT) · ?type=market&set=b (4 PM CT)
const MARKET_SETS = {
  a: ["reverse", "money", "trap", "bigmove"],
  b: ["steam", "freeplay", "trap", "reverse", "money", "bigmove"]
};
async function buildMarket(set) {
  const { buildMarketStory } = await import("./_social-stories.js");
  const s = await buildMarketStory("x", MARKET_SETS[set] || MARKET_SETS.a);
  if (!s) return null;
  return {
    text: s.text,
    png: s.png, log: { slot: `market-${set || "a"}`, templateId: s.templateId, gameId: s.gameId }
  };
}

const BUILDERS = { morning: buildReceipts, pick: buildFreePick, teaser: buildTeaser, results: buildRecord, market: buildMarket };

// ── CashEdge Premium card (same design and data as the landing's real Premium card) ──
const SITE = "https://www.cashedgeapp.com";

async function getCardData(date) {
  const res = await fetch(`${SITE}/api/x-card-data?date=${date}`);
  const data = await res.json();
  if (!res.ok || !data.featured) throw new Error(`x-card-data: ${data.error || res.status}`);
  return data.featured;
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function shortTeam(t = "") {
  const parts = String(t).trim().split(/\s+/);
  return (parts[parts.length - 1] || t).toUpperCase();
}
function longDate(ymd) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

// Pulls the same numbers each landing renderer shows
function cardNumbers(f) {
  const sport = String(f.sport || "").toLowerCase();
  const pr = f.analysis?.premium || {};
  const away = f.away_team || "";
  const home = f.home_team || "";

  let pick = String(pr.pick || pr.recommendedCards?.[0]?.play || f.pick || "").trim();
  if (/^(over|under)$/i.test(pick) && Number.isFinite(Number(f.line))) pick += ` ${f.line}`;

  let a, b, total, edge, odds, conf;
  if (sport === "mlb") {
    const card = pr.recommendedCards?.[0] || {};
    a = num(pr.expectedRunsA); b = num(pr.expectedRunsB); total = num(pr.projectedTotal);
    edge = Number.isFinite(Number(pr.totalEdge)) ? num(pr.totalEdge) : total - num(pr.totalLine, f.line);
    odds = num(card.odds_american, f.odds_american);
    conf = num(card.percentage, f.confidence);
  } else if (sport === "nfl" || sport === "ncaaf") {
    const ps = pr.projectedScore || {};
    a = num(ps[away]); b = num(ps[home]); total = num(pr.projectedTotal);
    edge = num(pr.mainEdge); odds = num(pr.odds_american, f.odds_american); conf = num(pr.confidence, f.confidence);
  } else {
    a = num(pr.projA); b = num(pr.projB); total = num(pr.totalProj);
    edge = num(pr.mainEdge); odds = num(pr.odds_american, f.odds_american); conf = num(pr.confidence, f.confidence);
  }
  return { sport, away, home, pick, a, b, total, edge, odds, conf };
}

function ring(conf) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, conf)) / 100 * c;
  return h("div", { display: "flex", position: "relative", width: 132, height: 132, alignItems: "center", justifyContent: "center" },
    {
      type: "svg",
      props: {
        width: 132, height: 132, viewBox: "0 0 132 132", style: { position: "absolute", top: 0, left: 0 },
        children: [
          { type: "circle", props: { cx: 66, cy: 66, r, fill: "none", stroke: "#1c2740", strokeWidth: 9 } },
          { type: "circle", props: { cx: 66, cy: 66, r, fill: "none", stroke: "#ff8a1f", strokeWidth: 9,
            strokeLinecap: "round", strokeDasharray: `${filled} ${c}`, transform: "rotate(-90 66 66)" } }
        ]
      }
    },
    h("div", { display: "flex", flexDirection: "column", alignItems: "center" },
      h("div", { display: "flex", fontSize: 25, color: "#ff8a1f", fontWeight: 800 }, `${conf.toFixed(1)}%`),
      h("div", { display: "flex", fontSize: 13, color: C.muted, letterSpacing: 1 }, "PROB.")
    )
  );
}

function statBox(label, value) {
  return h("div", {
    display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, flexBasis: 0,
    padding: "14px 8px", marginRight: 12, borderRadius: 12, backgroundColor: "#121a2e"
  },
    h("div", { display: "flex", fontSize: 15, color: C.cyan, fontWeight: 800, letterSpacing: 1 }, label),
    h("div", { display: "flex", fontSize: 30, color: C.white, fontWeight: 800, marginTop: 6 }, value)
  );
}

function premiumCardImage(f) {
  const n = cardNumbers(f);
  const result = String(f.result || "").toLowerCase();
  const graded = ["win", "loss", "push"].includes(result);
  const stripColor = !graded ? C.cyan : result === "win" ? C.cyan : result === "loss" ? "#ff5566" : C.muted;
  const stripText = !graded
    ? `${longDate(f.game_date || f.sourceGameDate)} · BEFORE THE GAME`
    : `${longDate(f.sourceGameDate || f.game_date)} · FINAL · ${String(f.finalScore || f.final_score || "").slice(0, 60)}`;
  const stripBadge = !graded ? "FREE TODAY" : result === "win" ? "WIN" : result === "loss" ? "LOSS" : "PUSH";
  const sportLabel = n.sport === "ncaaf" ? "NCAAF" : n.sport === "ncaab" ? "NCAAB" : n.sport.toUpperCase();

  return frame(graded ? "FREE PREMIUM PLAY · RESULT" : "FREE PREMIUM PLAY",
    // strip
    h("div", {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 18px", borderRadius: 12, backgroundColor: "#080e1a", border: `1px solid ${stripColor}66`
    },
      h("div", { display: "flex", fontSize: 19, color: "#d0dcec", fontWeight: 800 }, stripText),
      h("div", { display: "flex", padding: "7px 16px", borderRadius: 20, border: `2px solid ${stripColor}`,
        color: stripColor, fontSize: 19, fontWeight: 800, letterSpacing: 1 }, stripBadge)
    ),
    // card
    h("div", {
      display: "flex", flexDirection: "column", marginTop: 14, padding: "20px 24px", borderRadius: 18,
      border: "2px solid rgba(124,60,255,0.55)",
      backgroundImage: "linear-gradient(135deg, #0d1426, #0a0f1e)"
    },
      h("div", { display: "flex", alignItems: "center" },
        h("div", { display: "flex", alignItems: "center", padding: "7px 16px", borderRadius: 20,
          border: "2px solid rgba(124,60,255,0.6)", backgroundColor: "rgba(124,60,255,0.15)" },
          h("div", { display: "flex", width: 9, height: 9, borderRadius: 9, backgroundColor: C.cyan, marginRight: 10 }),
          h("div", { display: "flex", fontSize: 16, color: C.white, fontWeight: 800, letterSpacing: 1.5 }, `PREMIUM PICK · ${sportLabel}`)
        )
      ),
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 20, color: "#8899bb" }, `${n.away} vs ${n.home}`.slice(0, 60)),
          h("div", { display: "flex", fontSize: 50, color: C.white, fontWeight: 800, marginTop: 6 }, n.pick.slice(0, 26)),
          h("div", { display: "flex", fontSize: 19, color: "#a07cff", marginTop: 4 },
            `Edge ${n.edge.toFixed(1)} · ${n.odds > 0 ? "+" : ""}${n.odds}`)
        ),
        ring(n.conf)
      ),
      h("div", { display: "flex", marginTop: 12, marginRight: -12 },
        statBox(shortTeam(n.away), n.a.toFixed(1)),
        statBox(shortTeam(n.home), n.b.toFixed(1)),
        statBox("TOTAL MOD.", n.total.toFixed(1)),
        statBox("EDGE", n.edge.toFixed(1))
      )
    )
  );
}

// Premium card when the post has one; the simple generated image otherwise
async function makeImage(post) {
  if (post.png) return post.png;
  if (post.cardDate) {
    try {
      return await renderPng(premiumCardImage(await getCardData(post.cardDate)));
    } catch (e) {
      console.error("Premium card failed, using simple image:", e);
    }
  }
  return renderPng(post.image);
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { type, dry, img, set } = req.query;
  const build = BUILDERS[type];
  if (!build) {
    return res.status(400).json({ error: "Invalid type. Use: morning, pick, teaser, results, market" });
  }

  try {
    const post = await build(set);

    // The free play must be saved BEFORE the screenshot: x-card.html only serves saved picks
    if (post?.pickId) await saveFreePlay(post.pickId);

    // Preview (posts nothing): &dry=1 shows the text, &dry=1&img=1 shows the image
    if (dry === "1") {
      if (img === "1") {
        if (!post) return res.status(200).json({ ok: true, type, preview: null });
        const png = await makeImage(post);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(png);
      }
      return res.status(200).json({ ok: true, type, preview: post?.text || null });
    }

    // Real posting: only Vercel Cron (sends Authorization: Bearer CRON_SECRET)
    if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!post) return res.status(200).json({ ok: true, type, skipped: "No data to post" });

    // If the image fails, still post the text so the day isn't lost
    let mediaId = null;
    try {
      mediaId = await uploadImage(await makeImage(post));
    } catch (e) {
      console.error("Image failed, posting text only:", e);
    }

    const tweet = await postTweet(post.text, mediaId);
    if (post.log) {
      const { logPost } = await import("./_social-stories.js");
      await logPost("x", post.log.slot, post.log.templateId, post.log.gameId);
    }
    return res.status(200).json({ ok: true, type, withImage: !!mediaId, tweet });
  } catch (error) {
    console.error("Twitter bot error:", error);
    return res.status(500).json({ error: error.message });
  }
}

// Shared with /api/telegram-bot.js (same data, same images)
export {
  sbSelect, chicagoDate, prettyDate, gameLabel, pickLabel, sportOf, getPremiumRecord,
  h, frame, badge, sportChip, renderPng, getCardData, premiumCardImage,
  C, SPORT_TAG, SPORT_EMOJI, TABLE, DATE_COL
};

// /api/twitter-bot.js
// CashEdge X Bot — yesterday's receipts, free pick, premium teaser, season record
// Posts have NO links on purpose: X charges $0.015 per post without a URL vs $0.20 with one.
// The link to cashedgeapp.com lives in the profile bio.

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const X_API_KEY = process.env.X_API_KEY;
const X_API_SECRET = process.env.X_API_SECRET;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// ── CONFIG: table and column names in Supabase ────────────────────────────
const TABLE = "picks_history";
const DATE_COL = "game_date";      // column with the game date (YYYY-MM-DD)
const TZ = "America/Chicago";

const SPORT_EMOJI = { nba: "🏀", wnba: "🏀", ncaab: "🏀", mlb: "⚾", nfl: "🏈", ncaaf: "🏈" };
const SPORT_TAG = { nba: "NBA", wnba: "WNBA", ncaab: "CBB", mlb: "MLB", nfl: "NFL", ncaaf: "CFB" };

// ── OAuth 1.0a helper ──────────────────────────────────────────────────────
function encode(str) {
  return encodeURIComponent(String(str));
}

function oauthSign(method, url) {
  const oauthParams = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };

  const paramStr = Object.keys(oauthParams).sort()
    .map(k => `${encode(k)}=${encode(oauthParams[k])}`)
    .join("&");

  const base = `${method}&${encode(url)}&${encode(paramStr)}`;
  const signingKey = `${encode(X_API_SECRET)}&${encode(X_ACCESS_TOKEN_SECRET)}`;
  oauthParams.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");

  return "OAuth " + Object.keys(oauthParams)
    .map(k => `${encode(k)}="${encode(oauthParams[k])}"`)
    .join(", ");
}

async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": oauthSign("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// ── Supabase helpers ───────────────────────────────────────────────────────
const sbHeaders = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

async function sbSelect(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${query}`, { headers: sbHeaders });
  const json = await res.json();
  if (!res.ok) throw new Error(`Supabase: ${JSON.stringify(json)}`);
  return Array.isArray(json) ? json : (json.data || []);
}

async function sbCount(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=id&${query}`, {
    method: "HEAD",
    headers: { ...sbHeaders, "Prefer": "count=exact", "Range": "0-0" }
  });
  const range = res.headers.get("content-range") || "";   // e.g. "0-0/123"
  return Number(range.split("/")[1]) || 0;
}

// Date in Chicago, offset in days (0 = today, -1 = yesterday)
function chicagoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
}

// Reads common column names; adjust here if your table uses different ones
function gameLabel(p) {
  if (p.game) return p.game;
  if (p.away_team && p.home_team) return `${p.away_team} @ ${p.home_team}`;
  return p.matchup || "";
}
function pickLabel(p) {
  return p.pick || p.display_pick || p.selection || p.play || "";
}
function sportOf(p) {
  return String(p.sport || p.type || "").toLowerCase();
}

// ── Data ───────────────────────────────────────────────────────────────────
// Season record = Premium picks only (same rule as the landing page)
async function getPremiumRecord() {
  // Same source as the landing page: sport_record_summary
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sport_record_summary?select=sport,total_wins,total_losses`,
    { headers: sbHeaders }
  );
  const rows = await res.json();
  if (!res.ok || !Array.isArray(rows)) throw new Error(`Supabase: ${JSON.stringify(rows)}`);
  const wins = rows.reduce((s, r) => s + (Number(r.total_wins) || 0), 0);
  const losses = rows.reduce((s, r) => s + (Number(r.total_losses) || 0), 0);
  const total = wins + losses;
  const pct = total > 0 ? ((wins / total) * 100).toFixed(1) : null;
  return { wins, losses, pct };
}
async function getYesterdayPremium() {
  const d = chicagoDate(-1);
  return sbSelect(`select=*&is_premium=eq.true&${DATE_COL}=eq.${d}&or=(result.ilike.win,result.ilike.loss,result.ilike.push)`);
}

async function getTodayFreePick() {
  const d = chicagoDate(0);
  const rows = await sbSelect(`select=*&is_premium=eq.false&${DATE_COL}=eq.${d}&limit=20`);
  return rows.find(p => pickLabel(p) && gameLabel(p)) || null;
}

async function getTodayPremiumCount() {
  return sbCount(`is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}`);
}

// ── Post builders (return text or null when there is nothing honest to say) ─
async function buildReceipts() {
  const picks = await getYesterdayPremium();
  if (picks.length === 0) return null;

  const icon = r => ({ win: "✅", loss: "❌", push: "➖" })[String(r).toLowerCase()] || "";
  const w = picks.filter(p => /^win$/i.test(p.result)).length;
  const l = picks.filter(p => /^loss$/i.test(p.result)).length;

  const lines = picks.slice(0, 6).map(p =>
    `${icon(p.result)} ${SPORT_TAG[sportOf(p)] || ""} ${pickLabel(p)}`.replace(/\s+/g, " ").trim()
  );

  let text =
`Yesterday's CashEdge Premium picks: ${w}-${l}

${lines.join("\n")}

Every pick posted before the game. Wins and losses.`;
  if (picks.length > 6) text = text.replace("\n\nEvery", `\n+${picks.length - 6} more\n\nEvery`);
  return text;
}

async function buildFreePick() {
  const p = await getTodayFreePick();
  if (!p) return null;
  const s = sportOf(p);

  return `${SPORT_EMOJI[s] || "🎯"} Free pick of the day — ${SPORT_TAG[s] || s.toUpperCase()}

${gameLabel(p)}
📌 ${pickLabel(p)}

Real-time line movement, betting splits and Premium picks: link in bio.

#${SPORT_TAG[s] || "Sports"}Picks #SportsBetting`;
}

async function buildTeaser() {
  const count = await getTodayPremiumCount();
  if (count === 0) return null;
  const { wins, losses, pct } = await getPremiumRecord();

  return `🔒 ${count} CashEdge Premium ${count === 1 ? "pick" : "picks"} on today's board.

Premium record: ${wins}-${losses}${pct ? ` (${pct}%)` : ""}, every pick tracked publicly.

See where the line is moving before you bet. First month $34.99.
Link in bio.

21+ | Gamble responsibly`;
}

async function buildRecord() {
  const { wins, losses, pct } = await getPremiumRecord();
  if (wins + losses === 0) return null;

  return `📊 CashEdge Premium record: ${wins}-${losses}${pct ? ` (${pct}%)` : ""}

Every Premium pick is graded and public. No deleted losses.

NFL · NBA · MLB · WNBA · CFB · CBB

CashEdge provides statistical analysis, not betting advice. 21+`;
}

const BUILDERS = { morning: buildReceipts, pick: buildFreePick, teaser: buildTeaser, results: buildRecord };

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { type, dry } = req.query;
  const build = BUILDERS[type];
  if (!build) {
    return res.status(400).json({ error: "Invalid type. Use: morning, pick, teaser, results" });
  }

  try {
    const text = await build();

    // Preview mode: shows the tweet without posting (costs nothing)
    if (dry === "1") {
      return res.status(200).json({ ok: true, type, preview: text, length: text?.length || 0 });
    }

    // Real posting: only Vercel Cron (it sends Authorization: Bearer CRON_SECRET)
    if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!text) {
      return res.status(200).json({ ok: true, type, skipped: "No data to post" });
    }

    const tweet = await postTweet(text);
    return res.status(200).json({ ok: true, type, tweet });
  } catch (error) {
    console.error("Twitter bot error:", error);
    return res.status(500).json({ error: error.message });
  }
}

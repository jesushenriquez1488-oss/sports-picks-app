// /api/twitter-bot.js
// CashEdge X Bot — every post goes out with a branded image generated on the fly.
// Oct-30 redesign: only 3 posts a day, all automatic (?type=auto, cron every 30 min):
//   1. "winners"  → yesterday's Premium picks that HIT (skipped if none hit)
//   2. "pick"     → today's free Premium pick, 2 h before the day's first game
//   3. "props"    → 3 free player props, 30 min after the free pick
// No teasers, no polls, no "top secret" posts.
// Posts have NO links on purpose: X charges $0.015 per post without a URL vs $0.20 with one.
// The link to cashedgeapp.com lives in the profile bio.
// Oct-31: 4th post "market" → a real line move / betting split story (story engine), 30 min before the first game.
// Oct-31: ROTATION → 5 versions (A–E) of text, hashtags and image colors, changing every 2 days
//         (Mon Nov 2 = A). Same version on X and Facebook. Preview any version with &v=a … &v=e.
// Oct-31: the same posts also go to the Facebook page "CashEdge AI" (FB_PAGE_ID + FB_PAGE_TOKEN).
// Nov-3: on Facebook every post goes out as a REEL (9 s vertical video, audio of the day's version,
//        files /reel-a.mp3 … /reel-e.mp3 at the root of the site). If the Reel fails, it posts the photo.
//        Turn Reels off without touching code: Vercel env var FB_REELS = off.
// On Facebook: real link instead of "link in bio" and the full 21+ / 1-800-MY-RESET line.
// Each network is logged on its own in social_post_log (channel "x" / "facebook"):
// if one fails, the other still posts, and the failed one retries on the next run.

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const X_API_KEY = process.env.X_API_KEY;
const X_API_SECRET = process.env.X_API_SECRET;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// Facebook page "CashEdge AI": Page token that never expires (saved only in Vercel)
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const FB_API = "https://graph.facebook.com/v26.0";
const FB_ON = !!(FB_PAGE_ID && FB_PAGE_TOKEN);
const REELS_ON = process.env.FB_REELS !== "off";
const REEL_W = 1080;
const REEL_H = 1920;

// ── CONFIG ─────────────────────────────────────────────────────────────────
const TABLE = "picks_history";
const DATE_COL = "game_date";
const TZ = "America/Chicago";

const SPORT_EMOJI = { nba: "🏀", wnba: "🏀", ncaab: "🏀", mlb: "⚾", nfl: "🏈", ncaaf: "🏈" };
const SPORT_TAG = { nba: "NBA", wnba: "WNBA", ncaab: "CBB", mlb: "MLB", nfl: "NFL", ncaaf: "CFB" };

// Brand
const C = {
  bg: "#020814", card: "#071426", line: "#16243a",
  cyan: "#00ffe7", green: "#39ff6a", purple: "#b48cff", gold: "#ffc850",
  white: "#f0f6ff", muted: "#8a9ab5",
  win: "#39ff6a", loss: "#ff5a6e", push: "#8a9ab5"
};
const IMG_W = 1200;
const IMG_H = 675;

// ── ROTATION: 5 versions, each one lasts 2 days (Mon Nov 2, 2026 = A) → full cycle every 10 days ──
const VERSION_NAMES = ["A", "B", "C", "D", "E"];
const ROTATION_START = Date.UTC(2026, 10, 2) / 86400000; // Monday Nov 2, 2026
let FORCED_V = null; // &v=a … &v=e (previews only)
function versionIdx() {
  if (FORCED_V != null) return FORCED_V;
  const [y, m, d] = chicagoDate(0).split("-").map(Number);
  const k = Math.floor((Date.UTC(y, m - 1, d) / 86400000 - ROTATION_START) / 2);
  return ((k % 5) + 5) % 5;
}

// Image colors per version (a = main accent, b = second accent)
const THEMES = [
  { a: "#39ff6a", b: "#00ffe7", bg: "#020814", card: "#071426", glow: "rgba(57,255,106,0.20)", glowAt: "50% 35%" },  // A green/cyan
  { a: "#d4ff3a", b: "#ffffff", bg: "#050705", card: "#11160a", glow: "rgba(212,255,58,0.16)", glowAt: "85% 15%" },  // B lime/white
  { a: "#c77dff", b: "#ff4fd8", bg: "#08031a", card: "#150a30", glow: "rgba(199,125,255,0.24)", glowAt: "15% 25%" }, // C purple/pink
  { a: "#3da9ff", b: "#00ffe7", bg: "#010a1f", card: "#06183a", glow: "rgba(61,169,255,0.24)", glowAt: "50% 100%" }, // D electric blue
  { a: "#ff4d6d", b: "#ff9f1c", bg: "#120308", card: "#24070f", glow: "rgba(255,77,109,0.22)", glowAt: "80% 80%" }   // E red/orange
];
const theme = () => THEMES[versionIdx()];

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

// X limit: 280 (emoji count as 2). Removes the least important blocks until the post fits:
// first hashtags, then middle paragraphs. The hook (first block), the call to action and "21+" stay.
const xLen = t => [...t].reduce((n, c) => n + (c.codePointAt(0) > 0x10FF ? 2 : 1), 0);
function fitX(text, max = 280) {
  if (!text || xLen(text) <= max) return text;
  let parts = text.split("\n\n").filter(p => !/^#/.test(p.trim()));
  if (xLen(parts.join("\n\n")) > max) parts = parts.map(p => /^21\+/.test(p) ? "21+" : p);
  let i = parts.length - 3;
  while (xLen(parts.join("\n\n")) > max && i >= 1) { parts.splice(i, 1); i--; }
  let out = parts.join("\n\n");
  while (xLen(out) > max) out = [...out].slice(0, -2).join("");
  return out;
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

// ── Facebook API ───────────────────────────────────────────────────────────
// Same text as X, adapted: no character limit, the real link instead of "link in bio",
// and the full responsible-gambling line.
function fbText(text) {
  return String(text || "")
    .replace(/link in bio/gi, SITE)
    .replace(/21\+ \| Not betting advice/g, "21+ | Not betting advice | 1-800-MY-RESET")
    .replace(/21\+ \| Gamble responsibly/g, "21+ | Gamble responsibly | 1-800-MY-RESET");
}

// Photo post with the same image as X. If the photo upload fails, posts the text only.
async function postFacebook(text, png) {
  const send = async (edge, withPhoto) => {
    const form = new FormData();
    form.append("access_token", FB_PAGE_TOKEN);
    form.append("message", text);
    if (withPhoto) form.append("source", new Blob([png], { type: "image/png" }), "cashedge.png");
    const res = await fetch(`${FB_API}/${FB_PAGE_ID}/${edge}`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Facebook: ${data?.error?.message || JSON.stringify(data)}`);
    return data;
  };
  if (png) {
    try {
      return await send("photos", true);
    } catch (e) {
      console.error("Facebook photo failed, posting text only:", e);
    }
  }
  return send("feed", false);
}

// ── Facebook REELS ─────────────────────────────────────────────────────────
// 3 steps (Meta Reels Publishing API): start the upload → upload the mp4 → publish with the text.
async function fbForm(url, params) {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Facebook Reel: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

async function postFacebookReel(text, mp4) {
  const start = await fbForm(`${FB_API}/${FB_PAGE_ID}/video_reels`,
    { upload_phase: "start", access_token: FB_PAGE_TOKEN });
  const videoId = start.video_id;
  const up = await fetch(start.upload_url || `https://rupload.facebook.com/video-upload/v26.0/${videoId}`, {
    method: "POST",
    headers: { "Authorization": `OAuth ${FB_PAGE_TOKEN}`, "offset": "0", "file_size": String(mp4.length) },
    body: mp4
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok || upData.success === false || upData.error) {
    throw new Error(`Facebook Reel upload: ${upData?.error?.message || JSON.stringify(upData)}`);
  }
  const fin = await fbForm(`${FB_API}/${FB_PAGE_ID}/video_reels`, {
    upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: text, access_token: FB_PAGE_TOKEN
  });
  return { reel: true, video_id: videoId, ...fin };
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
  // same casing everywhere: "OVER 78.5" → "Over 78.5"
  const pick = String(p.pick || "").replace(/^(over|under)\b/i, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
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

// Free Premium Play: one of today's Premium picks, still pending, lowest confidence.
// ONE free pick per day for every channel: if it was already posted today (on X or Facebook),
// the other channel reuses it. If that game already started, nothing is posted
// (never a second Premium pick for free).
async function getTodayFreePick(kick = new Map()) {
  // never give away a game that is about to start (or already started)
  const soon = Date.now() + 30 * 60000;
  const playable = p => {
    if (!p || !pickLabel(p) || !gameLabel(p) || !/^pending$/i.test(p.result)) return false;
    const t = kick.get(p.game_id);
    return !t || t.getTime() > soon;
  };

  const saved = await sbSelect("x_free_plays", `select=pick_id&post_date=eq.${chicagoDate(0)}&limit=1`);
  if (saved[0]) {
    let rows = await sbSelect(TABLE, `select=*&id=eq.${saved[0].pick_id}&limit=1`);
    if (!rows[0]) {
      // The pick was regenerated after it was posted (new id). Use today's Premium pick of the SAME game,
      // taken from the game logged when the free pick was posted. A Premium pick never flips sides.
      const logged = await sbSelect("social_post_log",
        `select=game_id,posted_at&slot=eq.pick&game_id=not.is.null&posted_at=gte.${new Date(Date.now() - 26 * 3600e3).toISOString()}&order=posted_at.asc&limit=20`);
      const gid = logged.find(l => chiParts(new Date(l.posted_at)).date === chicagoDate(0))?.game_id;
      if (gid) {
        rows = await sbSelect(TABLE,
          `select=*&is_premium=eq.true&game_id=eq.${encodeURIComponent(gid)}&${DATE_COL}=eq.${chicagoDate(0)}&limit=1`);
        if (rows[0]) await saveFreePlay(rows[0].id); // x_free_plays points to the live pick again
      }
    }
    return playable(rows[0]) ? rows[0] : null;
  }

  const rows = await sbSelect(TABLE,
    `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}&result=ilike.pending&order=confidence.asc&limit=20`);
  return rows.find(playable) || null;
}

// All of yesterday's Premium picks (to know if grading finished and which ones won)
async function getYesterdayPremium() {
  return sbSelect(TABLE, `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(-1)}&limit=100`);
}

// ── Schedule helpers (Chicago time) ────────────────────────────────────────
function chiParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const hhmm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

// Kickoff of every game today, from the odds feed (same source the story engine uses)
// Supabase returns at most 1,000 rows per request, so it reads page by page (Nov-3 fix:
// with a single request the early games were cut off and the bot thought the day started later).
async function getTodayKickoffs() {
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const PAGE = 1000;
  const rows = [];
  for (let page = 0; page < 30; page++) {
    const batch = await sbSelect("market_odds_updates",
      `select=cashedge_game_id,commence:raw_payload->>commence_time,home:raw_payload->>home_team,away:raw_payload->>away_team` +
      `&observed_at=gte.${since}&order=observed_at.desc,cashedge_game_id.asc&limit=${PAGE}&offset=${page * PAGE}`);
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const today = chicagoDate(0);
  const map = new Map();
  for (const r of rows) {
    if (!r.commence || !r.cashedge_game_id) continue;
    const t = new Date(r.commence);
    if (isNaN(t) || chiParts(t).date !== today) continue;
    map.set(r.cashedge_game_id, t);
    if (r.away && r.home) map.set(`${r.away} @ ${r.home}`, t); // props rows use this game name
  }
  return map;
}

// Slots already posted today on a channel ("x" / "facebook"), from the social_post_log table
async function postedToday(channel = "x") {
  const rows = await sbSelect("social_post_log",
    `select=slot,posted_at&channel=eq.${channel}&posted_at=gte.${new Date(Date.now() - 26 * 3600e3).toISOString()}&limit=200`);
  const today = chicagoDate(0);
  return new Set(rows.filter(r => chiParts(new Date(r.posted_at)).date === today).map(r => r.slot));
}

// ── 3 FREE PROPS (from player_props_cache) ────────────────────────────────
// One row per game; analysis_json.props = props shown to free users, lockedProps = Premium only.
// Only "props" are used here, so the post never gives away Premium-only props.
const PROPS_TABLE = "player_props_cache";
const MARKET_LABEL = {
  player_points: "PTS", player_rebounds: "REB", player_assists: "AST", player_threes: "3PM",
  player_points_rebounds_assists: "PRA", player_pass_yds: "PASS YDS", player_rush_yds: "RUSH YDS",
  player_reception_yds: "REC YDS", player_receptions: "REC", player_pass_tds: "PASS TD",
  pitcher_strikeouts: "K", pitcher_outs: "OUTS", batter_hits: "HITS", batter_total_bases: "TB"
};
const marketLabel = m => MARKET_LABEL[m] || String(m || "").replace(/^(player|batter|pitcher)_/, "").replace(/_/g, " ").toUpperCase();
// The cache stores decimal odds (2.12) → American (+112)
function americanOdds(dec) {
  const d = Number(dec);
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}
const fmtOdds = a => a == null ? "" : (a > 0 ? `+${a}` : String(a));
const propLabel = p => `${p.side === "UNDER" ? "U" : "O"} ${p.line} ${marketLabel(p.market)}`;

async function getTodayFreeProps(kick = new Map()) {
  const rows = await sbSelect(PROPS_TABLE,
    `select=sport,game,game_date,analysis_json&game_date=eq.${chicagoDate(0)}&order=updated_at.desc&limit=200`);
  const soon = Date.now() + 30 * 60000;
  const seenGames = new Set();
  const all = [];
  for (const r of rows) {
    if (seenGames.has(r.game)) continue; // newest analysis per game only
    seenGames.add(r.game);
    const t = kick.get(r.game);
    // Only games with a confirmed kickoff TODAY (the cache can hold tomorrow's games, e.g. Sunday NFL
    // props on Saturday), and never a game about to start / started
    if (!t || t.getTime() <= soon) continue;
    for (const p of r.analysis_json?.props || []) {
      if (!p?.player || p.line == null || !p.side) continue;
      all.push({ ...p, sport: String(r.sport || "").toLowerCase(), game: r.game, american: americanOdds(p.odds) });
    }
  }
  // highest confidence first, one prop per player
  all.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const players = new Set();
  return all.filter(p => !players.has(p.player) && players.add(p.player)).slice(0, 3);
}

async function getTodayPremiumCount() {
  return sbCount(`is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}`);
}

// ── Image building blocks (Satori: every div with 2+ children needs display:flex) ─
function h(type, style, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { style, children: kids.length === 1 ? kids[0] : kids } };
}

// "Quantum math" backdrop: grid, wave functions and a node network (deterministic per seed)
function quantumBg(seed = 7, ca = C.green, cb = C.cyan) {
  let s = seed + 11;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const kids = [];
  for (let x = 0; x <= IMG_W; x += 60) kids.push({ type: "line", props: { x1: x, y1: 0, x2: x, y2: IMG_H, stroke: ca, strokeOpacity: 0.05 } });
  for (let y = 0; y <= IMG_H; y += 60) kids.push({ type: "line", props: { x1: 0, y1: y, x2: IMG_W, y2: y, stroke: ca, strokeOpacity: 0.05 } });
  for (let k = 0; k < 4; k++) {
    const amp = 25 + rnd() * 60, per = 220 + rnd() * 320, y0 = 90 + rnd() * (IMG_H - 180), ph = rnd() * 6.28;
    let d = "";
    for (let x = 0; x <= IMG_W; x += 15) d += `${x === 0 ? "M" : "L"}${x},${(y0 + amp * Math.sin(x / per * 6.28 + ph)).toFixed(1)} `;
    kids.push({ type: "path", props: { d, fill: "none", stroke: k % 2 ? cb : ca, strokeOpacity: 0.18, strokeWidth: 1.5 } });
  }
  const nodes = Array.from({ length: 18 }, () => [rnd() * IMG_W, rnd() * IMG_H]);
  nodes.forEach(([x, y], i) => {
    const nx = nodes[i + 1];
    if (nx && Math.abs(nx[0] - x) + Math.abs(nx[1] - y) < 450) {
      kids.push({ type: "line", props: { x1: x, y1: y, x2: nx[0], y2: nx[1], stroke: ca, strokeOpacity: 0.14 } });
    }
    kids.push({ type: "circle", props: { cx: x, cy: y, r: 2 + rnd() * 2, fill: ca, fillOpacity: 0.5 } });
  });
  return { type: "svg", props: { width: IMG_W, height: IMG_H, viewBox: `0 0 ${IMG_W} ${IMG_H}`,
    style: { position: "absolute", top: 0, left: 0 }, children: kids } };
}

const FORMULAS = [
  ["P(edge) = Σ p(x | λ)", 40, 128], ["E[v] = p(o − 1) − (1 − p)", 760, 96], ["σ² = Σ (x − μ)² / n", 60, 560],
  ["Δline = Σ w · Δbook", 820, 530], ["z = (μ − line) / σ", 430, 612]
];

// Colors come from the rotation theme (A–E)
function frame(kicker, ...body) {
  const t = theme();
  return h("div", {
    width: IMG_W, height: IMG_H, display: "flex", flexDirection: "column", position: "relative",
    backgroundColor: t.bg, padding: "42px 56px", fontFamily: "Inter, InterGreek",
    backgroundImage: `radial-gradient(circle at ${t.glowAt}, ${t.glow}, rgba(0,0,0,0) 60%)`
  },
    quantumBg(String(kicker).length + versionIdx() * 7, t.a, t.b),
    ...FORMULAS.map(([txt, left, top], i) => h("div", {
      position: "absolute", display: "flex", left, top, fontSize: 18, fontWeight: 500,
      color: i % 2 ? t.b : t.a, opacity: 0.16
    }, txt)),
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
      h("div", { display: "flex", fontSize: 36, fontWeight: 900 },
        h("span", { color: C.white }, "Cash"),
        h("span", { color: t.a }, "Edge")
      ),
      h("div", { display: "flex", fontSize: 20, color: t.a, letterSpacing: 4, fontWeight: 800 }, kicker)
    ),
    h("div", { display: "flex", width: 220, height: 5, marginTop: 12,
      backgroundImage: `linear-gradient(90deg, ${t.a}, ${t.b})` }),
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 22 }, ...body),
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 17, color: C.muted },
      h("span", { color: t.a, fontWeight: 800 }, "📲 Free alerts on Telegram: t.me/Cashedgeapp"),
      h("span", {}, "21+ | Not betting advice | 1-800-MY-RESET")
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
    color: theme().b, fontSize: 20, fontWeight: 700, marginRight: 18, minWidth: 80, justifyContent: "center"
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

// Row look per version: A outlined · B left bar · C tinted · D underline · E thick outline
function rowStyle(color) {
  const t = theme();
  return [
    { backgroundColor: t.card, borderRadius: 14, border: `2px solid ${color}55` },
    { backgroundColor: t.card, borderRadius: 6, borderLeft: `8px solid ${color}` },
    { backgroundColor: `${color}22`, borderRadius: 18 },
    { backgroundColor: "rgba(0,0,0,0)", borderRadius: 0, borderBottom: `2px solid ${color}88` },
    { backgroundColor: t.card, borderRadius: 14, border: `3px solid ${color}` }
  ][versionIdx()];
}

// Headline of each image per version (same idea as the post text)
const WINNERS_HEAD = [
  n => n === 1 ? "PREMIUM WINNER" : "PREMIUM WINNERS",
  n => n === 1 ? "RECEIPT FROM YESTERDAY" : "RECEIPTS FROM YESTERDAY",
  () => "FOR THE BOOKS",
  n => n === 1 ? "PREMIUM PLAY CASHED" : "PREMIUM PLAYS CASHED",
  n => n === 1 ? "HIT ON THE PREMIUM BOARD" : "HITS ON THE PREMIUM BOARD"
];
const PROPS_HEAD = ["3 FREE PLAYER PROPS", "PROPS ON THE BOARD TODAY", "PLAYER PROPS, FREE", "3 PROPS OUR NUMBERS LIKE", "START YOUR PROP SLIP HERE"];

function winnersImage(wins) {
  const t = theme();
  // Max 4 rows (same as the post text): with 5 rows the footer with the 21+ line falls out of the image
  const MAX = 4;
  const shown = wins.slice(0, MAX);
  return frame(`YESTERDAY · ${prettyDate(-1)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 80, color: t.a, fontWeight: 900 }, String(wins.length)),
      h("div", { display: "flex", fontSize: 46, color: C.white, fontWeight: 900, marginLeft: 20 },
        WINNERS_HEAD[versionIdx()](wins.length))
    ),
    h("div", { display: "flex", flexDirection: "column", marginTop: 14 },
      shown.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "10px 18px", marginBottom: 9,
        ...rowStyle(t.a)
      },
        sportChip(sportOf(p)),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 28, color: C.white, fontWeight: 800 }, pickLabel(p).slice(0, 40)),
          h("div", { display: "flex", fontSize: 18, color: C.muted, marginTop: 2 }, gameLabel(p).slice(0, 60))
        ),
        badge("win")
      )),
      wins.length > MAX ? h("div", { display: "flex", fontSize: 22, color: t.a, fontWeight: 800 }, `+${wins.length - MAX} more winners`) : null
    )
  );
}

function propsImage(props) {
  const t = theme();
  return frame(`FREE PLAYER PROPS · ${prettyDate(0)}`,
    h("div", { display: "flex", fontSize: 46, color: C.white, fontWeight: 900 }, PROPS_HEAD[versionIdx()]),
    h("div", { display: "flex", flexDirection: "column", marginTop: 16 },
      props.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "14px 20px", marginBottom: 12,
        ...rowStyle(t.b)
      },
        sportChip(p.sport),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 30, color: C.white, fontWeight: 900 }, String(p.player).slice(0, 30)),
          h("div", { display: "flex", fontSize: 26, color: t.b, fontWeight: 800, marginTop: 2 },
            `${p.side} ${p.line} ${marketLabel(p.market)}`)
        ),
        p.american != null ? h("div", {
          display: "flex", padding: "8px 16px", borderRadius: 12, marginRight: 14,
          border: `2px solid ${p.american > 0 ? t.a : C.line}`, color: p.american > 0 ? t.a : C.white,
          fontSize: 26, fontWeight: 900
        }, fmtOdds(p.american)) : null,
        h("div", { display: "flex", flexDirection: "column", alignItems: "center" },
          h("div", { display: "flex", fontSize: 32, color: t.a, fontWeight: 900 }, `${Number(p.confidence || 0).toFixed(0)}%`),
          h("div", { display: "flex", fontSize: 12, color: C.muted, letterSpacing: 2 }, "CONFIDENCE")
        )
      ))
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
  const [regular, bold, black, greek] = await Promise.all([
    fetch(`${base}/inter-latin-500-normal.woff`).then(r => r.arrayBuffer()),
    fetch(`${base}/inter-latin-800-normal.woff`).then(r => r.arrayBuffer()),
    fetch(`${base}/inter-latin-900-normal.woff`).then(r => r.arrayBuffer()),
    fetch(`${base}/inter-greek-500-normal.woff`).then(r => r.arrayBuffer())
  ]);
  FONTS = [
    { name: "Inter", data: regular, weight: 500, style: "normal" },
    { name: "Inter", data: bold, weight: 800, style: "normal" },
    { name: "Inter", data: black, weight: 900, style: "normal" },
    { name: "InterGreek", data: greek, weight: 500, style: "normal" }
  ];
  return FONTS;
}

async function renderPng(element, width = IMG_W, height = IMG_H) {
  const { ImageResponse } = await import("@vercel/og");
  const fonts = await loadFonts();
  const img = new ImageResponse(element, { width, height, fonts });
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

// ── POST TEXTS: 5 versions each (A–E), approved Oct-31 ─────────────────────
const FREE_PICK_COPY = [
  (sp, em, pick, game) => `🆓 FREE PREMIUM PLAY · ${sp}\n\n${em} ${pick}\n${game}\n\nStraight from today's Premium board. No paywall on this one.\n\n📲 More Premium picks + live line moves → link in bio\n\n#${sp}Picks #SportsBetting`,
  (sp, em, pick, game) => `🎁 Today's free one · ${sp}\n\n${em} ${pick}\n${game}\n\nPulled from today's Premium board. On the house.\n\n📲 The rest of the board → link in bio\n\n#${sp}Picks #FreePicks`,
  (sp, em, pick, game) => `One Premium pick, free. Every day. ${em}\n\n${pick}\n${game}\n\n📲 More Premium picks + live line moves → link in bio\n\n#FreePick #${sp}Bets`,
  (sp, em, pick, game) => `📌 FREE PLAY OF THE DAY · ${sp}\n\n${em} ${pick}\n${game}\n\nThe rest of the board is still locked.\n\n📲 Link in bio\n\n#PickOfTheDay #${sp}`,
  (sp, em, pick, game) => `No paywall today 🔓\n\n${em} ${pick}\n${game}\n\nThis one came straight off the Premium board.\n\n📲 Link in bio\n\n#SportsPicks #${sp}Picks`
];
const WINNERS_COPY = [
  (n, date, lines, sp) => `✅ ${n} Premium ${n === 1 ? "winner" : "winners"} yesterday (${date})\n\n${lines}\n\n🆓 Today's free play drops before the first game.\n📲 Link in bio\n\n#SportsBetting #${sp}Picks`,
  (n, date, lines, sp) => `Yesterday's receipts 🧾 (${date})\n\n${lines}\n\nAll posted before the games. All graded publicly.\n📲 Today's board → link in bio\n\n#SportsPicks #BetSmart`,
  (n, date, lines, sp) => `${n} for the books 📚 (${date})\n\n${lines}\n\nPremium members had ${n === 1 ? "this" : "these"} before the games.\n📲 Get today's → link in bio\n\n#FreePicks #${sp}Bets`,
  (n, date, lines, sp) => `Cash it. ✅ ${n} Premium ${n === 1 ? "play" : "plays"} hit yesterday\n\n${lines}\n\nPicked by the numbers, tracked in public.\n📲 Link in bio\n\n#BettingPicks #${sp}`,
  (n, date, lines, sp) => `🔥 Yesterday on the Premium board (${date})\n\n${lines}\n\nNo hype, just the record.\n📲 See today's picks → link in bio\n\n#SportsBettingTips #PicksOfTheDay`
];
const PROPS_ICON = ["🔥", "🎯", "▪️", "📈", "👉"];
const PROPS_COPY = [
  (sp, lines) => `🆓 3 FREE PLAYER PROPS${sp ? ` · ${sp}` : ""}\n\n${lines}\n\nStraight from today's CashEdge props board.\n📲 Full props board → link in bio\n\n#PlayerProps #${sp || "Sports"}Props`,
  (sp, lines) => `🎯 Props on the board today${sp ? ` · ${sp}` : ""}\n\n${lines}\n\nThree free player props from today's CashEdge board.\n📲 Full props board → link in bio\n\n#PropBets #${sp || "Sports"}`,
  (sp, lines) => `Player props, free. 3 for today 👇\n\n${lines}\n\nProjection vs the line, no guesswork.\n📲 Link in bio\n\n#PlayerProps #FreePicks`,
  (sp, lines) => `📊 3 player props our numbers like today\n\n${lines}\n\n📲 Full board with every prop → link in bio\n\n#${sp || "Sports"}Props #SportsBetting`,
  (sp, lines) => `Building a prop slip today? Start here 👇\n\n${lines}\n\nFree from the CashEdge props board.\n📲 Link in bio\n\n#PropPicks #${sp || "Sports"}Bets`
];
const LEGAL = "\n\n21+ | Not betting advice";

// ── REEL (Facebook): vertical 1080x1920 background + the post image sliding in + audio ──
const REEL_HEAD = {
  pick: ["FREE PREMIUM PLAY", "TODAY'S FREE ONE", "ONE PREMIUM PICK, FREE", "FREE PLAY OF THE DAY", "NO PAYWALL TODAY"],
  market: ["THE MARKET JUST MOVED", "WATCH THIS LINE", "SHARP SIGNAL?", "LINE MOVE ALERT", "WHERE'S THE MONEY?"]
};
const REEL_CARD_Y = 760; // where the post image (1000 x 562) lands in the video

// Background of the Reel: headline on top, empty space for the image, link + 21+ line below.
// Everything important stays between y 260 and 1460 (Facebook covers the top and bottom with its buttons).
function reelFrame(head, sub) {
  const t = theme();
  return h("div", {
    width: REEL_W, height: REEL_H, display: "flex", flexDirection: "column", alignItems: "center", position: "relative",
    backgroundColor: t.bg, fontFamily: "Inter, InterGreek", padding: "250px 60px 0 60px",
    backgroundImage: `radial-gradient(circle at 50% 28%, ${t.glow}, rgba(0,0,0,0) 62%)`
  },
    h("div", { display: "flex", fontSize: 66, fontWeight: 900 },
      h("span", { color: C.white }, "Cash"),
      h("span", { color: t.a }, "Edge")
    ),
    h("div", { display: "flex", width: 260, height: 8, marginTop: 14, backgroundImage: `linear-gradient(90deg, ${t.a}, ${t.b})` }),
    h("div", { display: "flex", fontSize: 30, color: t.a, letterSpacing: 6, fontWeight: 800, marginTop: 44 }, sub || ""),
    h("div", { display: "flex", fontSize: 84, color: C.white, fontWeight: 900, textAlign: "center", justifyContent: "center",
      marginTop: 18, lineHeight: 1.05, maxWidth: 960 }, head || ""),
    h("div", { position: "absolute", top: REEL_CARD_Y - 10, left: 30, width: 1020, height: 582, display: "flex",
      borderRadius: 24, border: `3px solid ${t.a}66` }),
    h("div", { position: "absolute", top: 1380, left: 0, width: REEL_W, display: "flex", flexDirection: "column", alignItems: "center" },
      h("div", { display: "flex", fontSize: 40, color: t.b, fontWeight: 900 }, "Free picks daily → cashedgeapp.com"),
      h("div", { display: "flex", fontSize: 28, color: C.muted, marginTop: 16 }, "21+ | Not betting advice | 1-800-MY-RESET")
    )
  );
}

// 9-second mp4: fade in, the post image slides up into place, slow zoom, audio of the day's version
async function makeReelVideo(post, png) {
  const { default: ffmpegPath } = await import("ffmpeg-static");
  const { spawn } = await import("child_process");
  const fs = (await import("fs")).promises;
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const f = { bg: `/tmp/reel-bg-${id}.png`, card: `/tmp/reel-card-${id}.png`, audio: `/tmp/reel-${id}.mp3`, out: `/tmp/reel-${id}.mp4` };

  const letter = VERSION_NAMES[versionIdx()].toLowerCase();
  const audio = await fetch(`${SITE}/reel-${letter}.mp3`); // files at the root of the site
  if (!audio.ok) throw new Error(`Reel audio reel-${letter}.mp3: HTTP ${audio.status}`);
  await fs.writeFile(f.audio, Buffer.from(await audio.arrayBuffer()));
  await fs.writeFile(f.bg, await renderPng(reelFrame(post.reelHead, post.reelSub), REEL_W, REEL_H));
  await fs.writeFile(f.card, png);

  const D = 9, FPS = 30;
  const filter =
    `[1:v]scale=1000:-2,format=rgba[c];` +
    `[0:v][c]overlay=x=40:y='if(lt(t,0.3),${REEL_H},max(${REEL_CARD_Y},${REEL_H}-(t-0.3)*2600))'[o];` +
    `[o]zoompan=z='1+0.05*on/${D * FPS}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${REEL_W}x${REEL_H}:fps=${FPS},` +
    `fade=t=in:st=0:d=0.3,fade=t=out:st=${D - 0.6}:d=0.6,format=yuv420p[v]`;
  const args = [
    "-y", "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", f.bg,
    "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", f.card,
    "-i", f.audio,
    "-filter_complex", filter, "-map", "[v]", "-map", "2:a",
    "-t", String(D), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
    "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-movflags", "+faststart", f.out
  ];
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, args);
      let err = "";
      p.stderr.on("data", d => { err = (err + d).slice(-1500); });
      p.on("error", reject);
      p.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err}`)));
    });
    return await fs.readFile(f.out);
  } finally {
    await Promise.all(Object.values(f).map(x => fs.unlink(x).catch(() => {})));
  }
}

async function buildFreePick(kick) {
  const p = await getTodayFreePick(kick);
  if (!p) return null;
  const s = sportOf(p);
  return {
    text: FREE_PICK_COPY[versionIdx()](SPORT_TAG[s] || "Sports", SPORT_EMOJI[s] || "🎯", pickLabel(p), gameLabel(p)) + LEGAL,
    reelHead: REEL_HEAD.pick[versionIdx()],
    reelSub: `${SPORT_TAG[s] || "TODAY"} · ${prettyDate(0)}`,
    image: freePickImage(p),
    pickId: p.id,
    gameId: p.game_id,
    cardDate: chicagoDate(0) // real CashEdge card of today's free play
  };
}

// Yesterday's Premium picks that HIT. Losses are not listed. Null when nothing hit.
function buildWinners(rows) {
  const wins = rows.filter(p => /^win$/i.test(p.result) && pickLabel(p));
  if (!wins.length) return null;
  const lines = wins.slice(0, 4).map(p => `✅ ${pickLabel(p)} · ${SPORT_TAG[sportOf(p)] || ""}`.trim());
  const more = wins.length > 4 ? `\n+${wins.length - 4} more` : "";
  // hashtag sport = the sport with the most winners
  const count = {};
  wins.forEach(p => { const t = SPORT_TAG[sportOf(p)]; if (t) count[t] = (count[t] || 0) + 1; });
  const sp = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "Sports";
  return {
    text: WINNERS_COPY[versionIdx()](wins.length, prettyDate(-1), lines.join("\n") + more, sp) + LEGAL,
    reelHead: `${wins.length} ${WINNERS_HEAD[versionIdx()](wins.length)}`,
    reelSub: `YESTERDAY · ${prettyDate(-1)}`,
    image: winnersImage(wins)
  };
}

async function buildProps(kick) {
  const props = await getTodayFreeProps(kick);
  if (props.length < 3) return null;
  const icon = PROPS_ICON[versionIdx()];
  const lines = props.map(p => `${icon} ${p.player} ${propLabel(p)}${p.american != null ? ` (${fmtOdds(p.american)})` : ""}`);
  const tag = SPORT_TAG[props[0].sport] || "";
  return {
    text: PROPS_COPY[versionIdx()](tag, lines.join("\n")) + LEGAL,
    reelHead: PROPS_HEAD[versionIdx()],
    reelSub: `${tag ? tag + " " : ""}PLAYER PROPS · ${prettyDate(0)}`,
    image: propsImage(props)
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

// Market post of the auto cron: real line move / split story from the story engine.
// The engine already rotates ~30 texts and 7 image designs and never repeats a text within 4 days.
// The order of story types also rotates with the version, so each 2-day block leads with a different kind.
// "freeplay" stories are left out on purpose (one of its texts promises tomorrow's result, and losses aren't posted).
const AUTO_MARKET_TYPES = ["reverse", "money", "steam", "bigmove", "trap"];
async function buildMarketAuto() {
  const { buildMarketStory } = await import("./_social-stories.js");
  const k = versionIdx();
  const order = [...AUTO_MARKET_TYPES.slice(k), ...AUTO_MARKET_TYPES.slice(0, k)];
  const s = await buildMarketStory("x", order);
  if (!s) return null;
  return { text: s.text, png: s.png, templateId: s.templateId, gameId: s.gameId,
    reelHead: REEL_HEAD.market[k], reelSub: `MARKET INTEL · ${prettyDate(0)}` };
}

const BUILDERS = {
  morning: buildReceipts, pick: buildFreePick, teaser: buildTeaser, results: buildRecord, market: buildMarket,
  // previews of the auto posts (e.g. ?type=winners&dry=1&img=1&v=c)
  winners: async () => buildWinners(await getYesterdayPremium()),
  props: async () => buildProps(await getTodayKickoffs())
};

// ── AUTO: decides which posts are due right now and on which channels ───────
// Returns the due slots in order (winners → pick → props), each with the channels still missing it.
async function planAuto() {
  const now = chiParts().min;
  const channels = FB_ON ? ["x", "facebook"] : ["x"];
  const doneBy = {};
  for (const c of channels) doneBy[c] = await postedToday(c);
  const missing = slot => channels.filter(c => !doneBy[c].has(slot));
  const due = [];

  // 1) Yesterday's winners: from 9:00 CT, once grading finished (11:00 CT at the latest)
  let rows = [];
  if (missing("winners").length && now >= 9 * 60) {
    rows = await getYesterdayPremium();
    const pending = rows.some(p => /^pending$/i.test(p.result));
    if (!pending || now >= 11 * 60) due.push({ slot: "winners", channels: missing("winners") });
  }

  // 2) Free pick: 2 h before the day's first game (never before 9:30 CT)
  // 3) 3 free props: 30 min after the free pick
  // 4) market move: 30 min before the first game (see below)
  const kick = await getTodayKickoffs();
  const first = [...kick.values()].sort((a, b) => a - b)[0];
  const firstMin = first ? chiParts(first).min : 13 * 60; // no kickoff data → as if first game at 1 PM
  const pickAt = Math.max(firstMin - 120, 9 * 60 + 30);
  if (missing("pick").length && now >= pickAt) due.push({ slot: "pick", channels: missing("pick") });
  if (missing("props").length && now >= pickAt + 30) due.push({ slot: "props", channels: missing("props") });
  // 4) Market move: 30 min before the first game (1 h after the props)
  if (missing("market").length && now >= pickAt + 90) due.push({ slot: "market", channels: missing("market") });

  const done = Object.fromEntries(channels.map(c => [c, [...doneBy[c]]]));
  return { due, rows, kick, now, firstMin, pickAt, done };
}

async function buildAuto(plan, slot) {
  if (slot === "winners") return buildWinners(plan.rows);
  if (slot === "pick") return buildFreePick(plan.kick);
  if (slot === "props") return buildProps(plan.kick);
  if (slot === "market") return buildMarketAuto();
  return null;
}

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
  const r = 62;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, conf)) / 100 * c;
  return h("div", { display: "flex", position: "relative", width: 156, height: 156, alignItems: "center", justifyContent: "center" },
    {
      type: "svg",
      props: {
        width: 156, height: 156, viewBox: "0 0 156 156", style: { position: "absolute", top: 0, left: 0 },
        children: [
          { type: "circle", props: { cx: 78, cy: 78, r, fill: "none", stroke: "rgba(255,200,80,0.18)", strokeWidth: 10 } },
          { type: "circle", props: { cx: 78, cy: 78, r, fill: "none", stroke: C.gold, strokeWidth: 10,
            strokeLinecap: "round", strokeDasharray: `${filled} ${c}`, transform: "rotate(-90 78 78)" } }
        ]
      }
    },
    h("div", { display: "flex", flexDirection: "column", alignItems: "center" },
      h("div", { display: "flex", fontSize: 38, color: C.gold, fontWeight: 900 }, `${conf.toFixed(0)}%`),
      h("div", { display: "flex", fontSize: 12, color: C.muted, letterSpacing: 2 }, "CONFIDENCE")
    )
  );
}

function bigBox(label, value, color = C.white, grow = 1, highlight = false) {
  return h("div", {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    flexGrow: grow, flexBasis: 0, padding: "16px 10px", marginRight: 12, borderRadius: 16,
    backgroundColor: C.card, border: `2px solid ${highlight ? C.purple : C.line}`
  },
    h("div", { display: "flex", fontSize: 16, color: C.muted, fontWeight: 800, letterSpacing: 2 }, label),
    h("div", { display: "flex", fontSize: 44, color, fontWeight: 900, marginTop: 6 }, value)
  );
}

function premiumCardImage(f) {
  const n = cardNumbers(f);
  const result = String(f.result || "").toLowerCase();
  const graded = ["win", "loss", "push"].includes(result);
  const stripColor = !graded ? C.green : result === "win" ? C.green : result === "loss" ? C.loss : C.muted;
  const stripText = !graded
    ? `${longDate(f.game_date || f.sourceGameDate)} · BEFORE THE GAME`
    : `${longDate(f.sourceGameDate || f.game_date)} · FINAL · ${String(f.finalScore || f.final_score || "").slice(0, 60)}`;
  const stripBadge = !graded ? "FREE TODAY" : result === "win" ? "WIN" : result === "loss" ? "LOSS" : "PUSH";
  const sportLabel = n.sport === "ncaaf" ? "NCAAF" : n.sport === "ncaab" ? "NCAAB" : n.sport.toUpperCase();
  const market = Number(f.line);
  const isTotal = /^(over|under)/i.test(n.pick) && Number.isFinite(market);
  const oddsTxt = n.odds ? `${n.odds > 0 ? "+" : ""}${n.odds}` : "—";

  return frame(graded ? "FREE PREMIUM PLAY · RESULT" : "FREE PREMIUM PLAY",
    // date strip
    h("div", {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 18px", borderRadius: 12, backgroundColor: "rgba(2,8,20,0.85)", border: `1px solid ${stripColor}88`
    },
      h("div", { display: "flex", fontSize: 19, color: "#d0dcec", fontWeight: 800 }, stripText),
      h("div", { display: "flex", padding: "6px 16px", borderRadius: 20, border: `2px solid ${stripColor}`,
        color: stripColor, fontSize: 19, fontWeight: 900, letterSpacing: 1 }, stripBadge)
    ),
    // the pick
    h("div", {
      display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16,
      padding: "18px 26px", borderRadius: 20, border: `2px solid ${C.gold}66`,
      backgroundImage: "linear-gradient(90deg, rgba(0,255,231,0.16), rgba(7,20,38,0.85))"
    },
      h("div", { display: "flex", flexDirection: "column" },
        h("div", { display: "flex", fontSize: 20, color: C.gold, fontWeight: 900, letterSpacing: 2 }, `PREMIUM PICK · ${sportLabel}`),
        h("div", { display: "flex", fontSize: 22, color: C.muted, marginTop: 6 }, `${n.away} vs ${n.home}`.slice(0, 56)),
        h("div", { display: "flex", fontSize: 76, color: C.white, fontWeight: 900, marginTop: 4, lineHeight: 1 }, n.pick.slice(0, 22))
      ),
      ring(n.conf)
    ),
    // the numbers
    h("div", { display: "flex", marginTop: 14, marginRight: -12 },
      bigBox("PROJECTED SCORE", `${n.a.toFixed(1)} - ${n.b.toFixed(1)}`, C.white, 1.6),
      isTotal ? bigBox("MARKET", market.toFixed(1), C.gold) : bigBox("ODDS", oddsTxt, C.gold),
      bigBox("MODEL", n.total.toFixed(1), C.cyan),
      bigBox("EDGE", `${n.edge > 0 ? "+" : ""}${n.edge.toFixed(1)}`, C.purple, 1, true)
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
  const { type, dry, img, set, v, reel } = req.query;
  // &v=a … &v=e forces a version (only for previews); otherwise the version of today's date
  FORCED_V = /^[a-e]$/i.test(String(v || "")) ? "abcde".indexOf(String(v).toLowerCase()) : null;

  // ── type=auto (the only one in the cron) ──
  if (type === "auto") {
    try {
      const plan = await planAuto();
      const info = { now: hhmm(plan.now), firstGame: plan.firstMin != null ? hhmm(plan.firstMin) : undefined,
        pickAt: plan.pickAt != null ? hhmm(plan.pickAt) : undefined, version: VERSION_NAMES[versionIdx()],
        facebook: FB_ON, done: plan.done };

      // One post per run: the first due slot that has something to post.
      // A slot with nothing to post (e.g. today's free pick already started) doesn't block the next one.
      let slot = null, post = null, channels = [];
      const empty = [];
      for (const d of plan.due) {
        const p = await buildAuto(plan, d.slot);
        if (p) { slot = d.slot; post = p; channels = d.channels; break; }
        empty.push(d);
      }

      if (dry === "1") {
        // &reel=1 → the Facebook Reel video (mp4) of the post that is due now
        if (reel === "1" && post) {
          const mp4 = await makeReelVideo(post, await makeImage(post));
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).send(mp4);
        }
        if (img === "1" && post) {
          const png = await makeImage(post);
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).send(png);
        }
        return res.status(200).json({ ok: true, slot, channels, ...info,
          preview: fitX(post?.text) || null, previewFacebook: post ? fbText(post.text) : null });
      }

      if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { logPost } = await import("./_social-stories.js");

      // Winners with zero hits: mark the day as done so it doesn't keep checking
      for (const d of empty) {
        if (d.slot === "winners") for (const c of d.channels) await logPost(c, "winners", "no-winners", null);
      }
      if (!post) return res.status(200).json({ ok: true, idle: true, ...info });

      if (post.pickId) await saveFreePlay(post.pickId);
      let png = null;
      try {
        png = await makeImage(post);
      } catch (e) {
        console.error("Image failed, posting text only:", e);
      }

      // Each channel on its own: if one fails, the other still posts (and is logged)
      const posted = {}, errors = {};
      if (channels.includes("x")) {
        try {
          let mediaId = null;
          if (png) {
            try { mediaId = await uploadImage(png); } catch (e) { console.error("X image failed, text only:", e); }
          }
          posted.x = await postTweet(fitX(post.text), mediaId);
          await logPost("x", slot, post.templateId || slot, post.gameId || null);
        } catch (e) {
          console.error("X post failed:", e);
          errors.x = e.message;
        }
      }
      if (channels.includes("facebook")) {
        try {
          // Reel first; if anything fails (video, upload, publish) → the normal photo post
          let fbRes = null;
          if (png && REELS_ON && post.reelHead) {
            try {
              fbRes = await postFacebookReel(fbText(post.text), await makeReelVideo(post, png));
            } catch (e) {
              console.error("Facebook Reel failed, posting photo:", e);
            }
          }
          posted.facebook = fbRes || await postFacebook(fbText(post.text), png);
          await logPost("facebook", slot, post.templateId || slot, post.gameId || null);
        } catch (e) {
          console.error("Facebook post failed:", e);
          errors.facebook = e.message;
        }
      }

      const ok = Object.keys(posted).length > 0;
      return res.status(ok ? 200 : 500).json({ ok, slot, channels, withImage: !!png, ...info, posted, errors });
    } catch (error) {
      console.error("Twitter bot (auto) error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ── Manual types (previews / one-off posts; no longer in the cron) ──
  const build = BUILDERS[type];
  if (!build) {
    return res.status(400).json({ error: "Invalid type. Use: auto, winners, pick, props, market, morning, teaser, results" });
  }

  try {
    const post = await build(set);

    // The free play must be saved BEFORE the screenshot: x-card.html only serves saved picks
    if (post?.pickId) await saveFreePlay(post.pickId);

    // Preview (posts nothing): &dry=1 shows the text, &dry=1&img=1 shows the image
    if (dry === "1") {
      if (reel === "1") {
        if (!post) return res.status(200).json({ ok: true, type, preview: null });
        const mp4 = await makeReelVideo(post, await makeImage(post));
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(mp4);
      }
      if (img === "1") {
        if (!post) return res.status(200).json({ ok: true, type, preview: null });
        const png = await makeImage(post);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(png);
      }
      return res.status(200).json({ ok: true, type, preview: fitX(post?.text) || null, length: xLen(fitX(post?.text) || "") });
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

    const tweet = await postTweet(fitX(post.text), mediaId);
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
  h, frame, badge, sportChip, renderPng, getCardData, premiumCardImage, quantumBg,
  C, SPORT_TAG, SPORT_EMOJI, TABLE, DATE_COL
};

// /api/twitter-bot.js
// CashEdge X Bot — every post goes out with a branded image generated on the fly.
// Posts have NO links on purpose: X charges $0.015 per post without a URL vs $0.20 with one.
// The link to cashedgeapp.com lives in the profile bio.

import crypto from "crypto";
import { ImageResponse } from "@vercel/og";

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
  return p.pick || p.display_pick || p.selection || p.play || "";
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

async function getYesterdayPremium() {
  return sbSelect(TABLE,
    `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(-1)}&or=(result.ilike.win,result.ilike.loss,result.ilike.push)`);
}

async function getTodayFreePick() {
  const rows = await sbSelect(TABLE, `select=*&is_premium=eq.false&${DATE_COL}=eq.${chicagoDate(0)}&limit=20`);
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
    backgroundColor: C.bg, padding: "48px 60px", fontFamily: "sans-serif",
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
      h("span", {}, "cashedgeapp.com"),
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
        h("div", { display: "flex", flexGrow: 1, fontSize: 28, color: C.white, fontWeight: 700 }, pickLabel(p).slice(0, 48)),
        badge(p.result)
      )),
      picks.length > 5 ? h("div", { display: "flex", fontSize: 22, color: C.muted }, `+${picks.length - 5} more`) : null
    )
  );
}

function freePickImage(p) {
  const s = sportOf(p);
  return frame(`FREE PICK · ${prettyDate(0)}`,
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

async function renderPng(element) {
  const img = new ImageResponse(element, { width: IMG_W, height: IMG_H });
  return Buffer.from(await img.arrayBuffer());
}

// ── Post builders: return { text, image } or null when there is nothing honest to say ─
async function buildReceipts() {
  const picks = await getYesterdayPremium();
  if (picks.length === 0) return null;
  const w = picks.filter(p => /^win$/i.test(p.result)).length;
  const l = picks.filter(p => /^loss$/i.test(p.result)).length;
  return {
    text: `Yesterday's CashEdge Premium picks: ${w}-${l}\n\nEvery pick posted before the game. Wins and losses, no deleted tweets.`,
    image: receiptsImage(picks, w, l)
  };
}

async function buildFreePick() {
  const p = await getTodayFreePick();
  if (!p) return null;
  const s = sportOf(p);
  return {
    text: `${SPORT_EMOJI[s] || "🎯"} Free pick of the day: ${pickLabel(p)}\n\n${gameLabel(p)}\n\nPremium picks + real-time line movement: link in bio.\n\n#${SPORT_TAG[s] || "Sports"}Picks`,
    image: freePickImage(p)
  };
}

async function buildTeaser() {
  const count = await getTodayPremiumCount();
  if (count === 0) return null;
  const rec = await getPremiumRecord();
  return {
    text: `🔒 ${count} Premium ${count === 1 ? "pick" : "picks"} on today's board.\n\nSee where the line is moving before you bet. First month $34.99, link in bio.\n\n21+ | Gamble responsibly`,
    image: teaserImage(count, rec)
  };
}

async function buildRecord() {
  const rec = await getPremiumRecord();
  if (rec.wins + rec.losses === 0) return null;
  return {
    text: `📊 CashEdge Premium record: ${rec.wins}-${rec.losses} (${rec.pct}%)\n\nEvery Premium pick graded and public.\n\nCashEdge provides statistical analysis, not betting advice. 21+`,
    image: recordImage(rec)
  };
}

const BUILDERS = { morning: buildReceipts, pick: buildFreePick, teaser: buildTeaser, results: buildRecord };

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { type, dry, img } = req.query;
  const build = BUILDERS[type];
  if (!build) {
    return res.status(400).json({ error: "Invalid type. Use: morning, pick, teaser, results" });
  }

  try {
    const post = await build();

    // Preview (posts nothing): &dry=1 shows the text, &dry=1&img=1 shows the image
    if (dry === "1") {
      if (img === "1") {
        if (!post) return res.status(200).json({ ok: true, type, preview: null });
        const png = await renderPng(post.image);
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
      mediaId = await uploadImage(await renderPng(post.image));
    } catch (e) {
      console.error("Image failed, posting text only:", e);
    }

    const tweet = await postTweet(post.text, mediaId);
    return res.status(200).json({ ok: true, type, withImage: !!mediaId, tweet });
  } catch (error) {
    console.error("Twitter bot error:", error);
    return res.status(500).json({ error: error.message });
  }
}

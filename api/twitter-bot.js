// /api/twitter-bot.js
// CashEdge X Bot — every post goes out with a branded image generated on the fly.
// Oct-30 redesign: only 3 posts a day, all automatic (?type=auto, cron every 30 min):
//   1. "winners"  → yesterday's Premium picks that HIT (skipped if none hit)
//   2. "pick"     → today's free Premium pick, 2 h before the day's first game
//   3. "props"    → 3 free player props, 30 min after the free pick
// No teasers, no polls, no "top secret" posts.
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
  bg: "#020814", card: "#071426", line: "#16243a",
  cyan: "#00ffe7", green: "#39ff6a", purple: "#b48cff", gold: "#ffc850",
  white: "#f0f6ff", muted: "#8a9ab5",
  win: "#39ff6a", loss: "#ff5a6e", push: "#8a9ab5"
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

// Free Premium Play: one of today's Premium picks, still pending, lowest confidence
async function getTodayFreePick(kick = new Map()) {
  const rows = await sbSelect(TABLE,
    `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}&result=ilike.pending&order=confidence.asc&limit=20`);
  // never give away a game that is about to start (or already started)
  const soon = Date.now() + 30 * 60000;
  return rows.find(p => {
    if (!pickLabel(p) || !gameLabel(p)) return false;
    const t = kick.get(p.game_id);
    return !t || t.getTime() > soon;
  }) || null;
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
async function getTodayKickoffs() {
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const rows = await sbSelect("market_odds_updates",
    `select=cashedge_game_id,commence:raw_payload->>commence_time,home:raw_payload->>home_team,away:raw_payload->>away_team` +
    `&observed_at=gte.${since}&limit=10000`);
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

// Slots already posted today on X (uses the existing social_post_log table)
async function postedToday() {
  const rows = await sbSelect("social_post_log",
    `select=slot,posted_at&channel=eq.x&posted_at=gte.${new Date(Date.now() - 26 * 3600e3).toISOString()}&limit=200`);
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
    if (t && t.getTime() <= soon) continue; // game about to start / started
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
function quantumBg(seed = 7) {
  let s = seed + 11;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const kids = [];
  for (let x = 0; x <= IMG_W; x += 60) kids.push({ type: "line", props: { x1: x, y1: 0, x2: x, y2: IMG_H, stroke: C.green, strokeOpacity: 0.05 } });
  for (let y = 0; y <= IMG_H; y += 60) kids.push({ type: "line", props: { x1: 0, y1: y, x2: IMG_W, y2: y, stroke: C.green, strokeOpacity: 0.05 } });
  for (let k = 0; k < 4; k++) {
    const amp = 25 + rnd() * 60, per = 220 + rnd() * 320, y0 = 90 + rnd() * (IMG_H - 180), ph = rnd() * 6.28;
    let d = "";
    for (let x = 0; x <= IMG_W; x += 15) d += `${x === 0 ? "M" : "L"}${x},${(y0 + amp * Math.sin(x / per * 6.28 + ph)).toFixed(1)} `;
    kids.push({ type: "path", props: { d, fill: "none", stroke: k % 2 ? C.cyan : C.green, strokeOpacity: 0.18, strokeWidth: 1.5 } });
  }
  const nodes = Array.from({ length: 18 }, () => [rnd() * IMG_W, rnd() * IMG_H]);
  nodes.forEach(([x, y], i) => {
    const nx = nodes[i + 1];
    if (nx && Math.abs(nx[0] - x) + Math.abs(nx[1] - y) < 450) {
      kids.push({ type: "line", props: { x1: x, y1: y, x2: nx[0], y2: nx[1], stroke: C.green, strokeOpacity: 0.14 } });
    }
    kids.push({ type: "circle", props: { cx: x, cy: y, r: 2 + rnd() * 2, fill: C.green, fillOpacity: 0.5 } });
  });
  return { type: "svg", props: { width: IMG_W, height: IMG_H, viewBox: `0 0 ${IMG_W} ${IMG_H}`,
    style: { position: "absolute", top: 0, left: 0 }, children: kids } };
}

const FORMULAS = [
  ["P(edge) = Σ p(x | λ)", 40, 128], ["E[v] = p(o − 1) − (1 − p)", 760, 96], ["σ² = Σ (x − μ)² / n", 60, 560],
  ["Δline = Σ w · Δbook", 820, 530], ["z = (μ − line) / σ", 430, 612]
];

function frame(kicker, ...body) {
  return h("div", {
    width: IMG_W, height: IMG_H, display: "flex", flexDirection: "column", position: "relative",
    backgroundColor: C.bg, padding: "42px 56px", fontFamily: "Inter, InterGreek",
    backgroundImage: "radial-gradient(circle at 50% 35%, rgba(57,255,106,0.20), rgba(2,8,20,0) 60%)"
  },
    quantumBg(String(kicker).length),
    ...FORMULAS.map(([t, left, top], i) => h("div", {
      position: "absolute", display: "flex", left, top, fontSize: 18, fontWeight: 500,
      color: i % 2 ? C.cyan : C.green, opacity: 0.16
    }, t)),
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
      h("div", { display: "flex", fontSize: 36, fontWeight: 900 },
        h("span", { color: C.white }, "Cash"),
        h("span", { color: C.green }, "Edge")
      ),
      h("div", { display: "flex", fontSize: 20, color: C.green, letterSpacing: 4, fontWeight: 800 }, kicker)
    ),
    h("div", { display: "flex", width: 220, height: 5, marginTop: 12,
      backgroundImage: `linear-gradient(90deg, ${C.green}, ${C.cyan})` }),
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 22 }, ...body),
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 17, color: C.muted },
      h("span", { color: C.green, fontWeight: 800 }, "📲 Free alerts on Telegram: t.me/Cashedgeapp"),
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

function winnersImage(wins) {
  const shown = wins.slice(0, 5);
  return frame(`YESTERDAY · ${prettyDate(-1)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 80, color: C.green, fontWeight: 900 }, String(wins.length)),
      h("div", { display: "flex", fontSize: 46, color: C.white, fontWeight: 900, marginLeft: 20 },
        `PREMIUM ${wins.length === 1 ? "WINNER" : "WINNERS"}`)
    ),
    h("div", { display: "flex", flexDirection: "column", marginTop: 14 },
      shown.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "10px 18px", marginBottom: 9,
        backgroundColor: C.card, borderRadius: 14, border: `2px solid ${C.green}55`
      },
        sportChip(sportOf(p)),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 28, color: C.white, fontWeight: 800 }, pickLabel(p).slice(0, 40)),
          h("div", { display: "flex", fontSize: 18, color: C.muted, marginTop: 2 }, gameLabel(p).slice(0, 60))
        ),
        badge("win")
      )),
      wins.length > 5 ? h("div", { display: "flex", fontSize: 22, color: C.green, fontWeight: 800 }, `+${wins.length - 5} more winners`) : null
    )
  );
}

function propsImage(props) {
  return frame(`FREE PLAYER PROPS · ${prettyDate(0)}`,
    h("div", { display: "flex", fontSize: 46, color: C.white, fontWeight: 900 }, "3 FREE PLAYER PROPS"),
    h("div", { display: "flex", flexDirection: "column", marginTop: 16 },
      props.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "14px 20px", marginBottom: 12,
        backgroundColor: C.card, borderRadius: 16, border: `2px solid ${C.cyan}55`
      },
        sportChip(p.sport),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 30, color: C.white, fontWeight: 900 }, String(p.player).slice(0, 30)),
          h("div", { display: "flex", fontSize: 26, color: C.cyan, fontWeight: 800, marginTop: 2 },
            `${p.side} ${p.line} ${marketLabel(p.market)}`)
        ),
        p.american != null ? h("div", {
          display: "flex", padding: "8px 16px", borderRadius: 12, marginRight: 14,
          border: `2px solid ${p.american > 0 ? C.green : C.line}`, color: p.american > 0 ? C.green : C.white,
          fontSize: 26, fontWeight: 900
        }, fmtOdds(p.american)) : null,
        h("div", { display: "flex", flexDirection: "column", alignItems: "center" },
          h("div", { display: "flex", fontSize: 32, color: C.gold, fontWeight: 900 }, `${Number(p.confidence || 0).toFixed(0)}%`),
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

async function buildFreePick(kick) {
  const p = await getTodayFreePick(kick);
  if (!p) return null;
  const s = sportOf(p);
  return {
    text: `🆓 FREE PREMIUM PLAY · ${SPORT_TAG[s] || "TODAY"}\n\n${SPORT_EMOJI[s] || "🎯"} ${pickLabel(p)}\n${gameLabel(p)}\n\nStraight from today's Premium board. No paywall on this one.\n\n📲 More Premium picks + live line moves → link in bio\n\n#${SPORT_TAG[s] || "Sports"}Picks #SportsBetting\n\n21+ | Not betting advice`,
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
  return {
    text: `✅ ${wins.length} Premium ${wins.length === 1 ? "winner" : "winners"} yesterday (${prettyDate(-1)})\n\n${lines.join("\n")}${more}\n\n🆓 Today's free play drops before the first game.\n📲 Link in bio\n\n21+ | Not betting advice`,
    image: winnersImage(wins)
  };
}

async function buildProps(kick) {
  const props = await getTodayFreeProps(kick);
  if (props.length < 3) return null;
  const lines = props.map(p => `🔥 ${p.player} ${propLabel(p)}${p.american != null ? ` (${fmtOdds(p.american)})` : ""}`);
  const tag = SPORT_TAG[props[0].sport] || "";
  return {
    text: `🆓 3 FREE PLAYER PROPS${tag ? ` · ${tag}` : ""}\n\n${lines.join("\n")}\n\nStraight from today's CashEdge props board.\n📲 Full props board → link in bio\n\n21+ | Not betting advice`,
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

const BUILDERS = { morning: buildReceipts, pick: buildFreePick, teaser: buildTeaser, results: buildRecord, market: buildMarket };

// ── AUTO: decides which post is due right now (one post per run) ───────────
async function planAuto() {
  const now = chiParts().min;
  const done = await postedToday();

  // 1) Yesterday's winners: from 9:00 CT, once grading finished (11:00 CT at the latest)
  if (!done.has("winners") && now >= 9 * 60) {
    const rows = await getYesterdayPremium();
    const pending = rows.some(p => /^pending$/i.test(p.result));
    if (!pending || now >= 11 * 60) return { slot: "winners", rows, now };
  }

  // 2) Free pick: 2 h before the day's first game (never before 9:30 CT)
  // 3) 3 free props: 30 min after the free pick
  const kick = await getTodayKickoffs();
  const first = [...kick.values()].sort((a, b) => a - b)[0];
  const firstMin = first ? chiParts(first).min : 13 * 60; // no kickoff data → as if first game at 1 PM
  const pickAt = Math.max(firstMin - 120, 9 * 60 + 30);
  if (!done.has("pick") && now >= pickAt) return { slot: "pick", kick, now, firstMin, pickAt };
  if (!done.has("props") && now >= pickAt + 30) return { slot: "props", kick, now, firstMin, pickAt };

  return { slot: null, now, firstMin, pickAt, done: [...done] };
}

async function buildAuto(plan) {
  if (plan.slot === "winners") return buildWinners(plan.rows);
  if (plan.slot === "pick") return buildFreePick(plan.kick);
  if (plan.slot === "props") return buildProps(plan.kick);
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
  const { type, dry, img, set } = req.query;

  // ── type=auto (the only one in the cron) ──
  if (type === "auto") {
    try {
      const plan = await planAuto();
      const info = { now: hhmm(plan.now), firstGame: plan.firstMin != null ? hhmm(plan.firstMin) : undefined,
        pickAt: plan.pickAt != null ? hhmm(plan.pickAt) : undefined };
      const post = plan.slot ? await buildAuto(plan) : null;

      if (dry === "1") {
        if (img === "1" && post) {
          const png = await makeImage(post);
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).send(png);
        }
        return res.status(200).json({ ok: true, slot: plan.slot, ...info, preview: fitX(post?.text) || null });
      }

      if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { logPost } = await import("./_social-stories.js");
      if (!plan.slot) return res.status(200).json({ ok: true, idle: true, ...info });

      if (!post) {
        // Winners with zero hits: mark the day as done so it doesn't keep checking
        if (plan.slot === "winners") await logPost("x", "winners", "no-winners", null);
        return res.status(200).json({ ok: true, slot: plan.slot, skipped: "No data to post", ...info });
      }

      if (post.pickId) await saveFreePlay(post.pickId);
      let mediaId = null;
      try {
        mediaId = await uploadImage(await makeImage(post));
      } catch (e) {
        console.error("Image failed, posting text only:", e);
      }
      const tweet = await postTweet(fitX(post.text), mediaId);
      await logPost("x", plan.slot, plan.slot, post.gameId || null);
      return res.status(200).json({ ok: true, slot: plan.slot, withImage: !!mediaId, ...info, tweet });
    } catch (error) {
      console.error("Twitter bot (auto) error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ── Manual types (previews / one-off posts; no longer in the cron) ──
  const build = BUILDERS[type];
  if (!build) {
    return res.status(400).json({ error: "Invalid type. Use: auto, morning, pick, teaser, results, market" });
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

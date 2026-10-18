// /api/_social-stories.js   (the "_" means Vercel does NOT expose it as an endpoint)
// CashEdge story engine: reads the real market (splits + line moves), detects "stories",
// and picks one of ~40 templates (text + image design) without repeating itself.
//
// RULES (never break):
// - Only market data (split snapshots + odds updates). Never market_events of Premium picks,
//   because those reveal the CashEdge side. Exception: today's Free Premium Play (already public).
// - Show WHAT happened, never WHAT TO DO. The money side / CashEdge read is always hidden.
// - Nothing is invented: if the data doesn't support a story, the post is skipped.

import { sbSelect, chicagoDate, h, renderPng, C, SPORT_TAG } from "./twitter-bot.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = "America/Chicago";

const COL = {
  bg: "#020814", card: "#0a1222", line: "#1a2840", white: "#f0f6ff", muted: "#8c9bb4",
  cyan: "#00ffe7", purple: "#7c3cff", red: "#ff465f", orange: "#ff8a1f", green: "#22e58a"
};
const W = 1200, HGT = 675;

// ═══════════════════════════════════════════════════════════════════════════
// 1. DATA
// ═══════════════════════════════════════════════════════════════════════════

const TEAMS = new Map();
function parseGameId(id = "") {
  const g = parseGameIdRaw(id);
  const t = TEAMS.get(id);
  return g && t ? { ...g, home: t.home, away: t.away } : g;
}
function parseGameIdRaw(id = "") {
  // "nfl-2026-10-19-San Francisco 49ers-Washington Commanders" → home first, away second
  const m = String(id).match(/^([a-z]+)-(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!m) return null;
  const teams = m[3];
  const cut = teams.lastIndexOf("-");
  if (cut < 0) return null;
  return { sport: m[1], date: m[2], home: teams.slice(0, cut), away: teams.slice(cut + 1) };
}

const short = t => { const p = String(t).trim().split(/\s+/); return p[p.length - 1] || t; };
const fmtLine = (n, total) => total ? String(n) : (n > 0 ? `+${n}` : String(n));
const minsAgo = iso => (Date.now() - Date.parse(iso)) / 60000;

function sideLabel(key, g) {
  const k = String(key || "").toLowerCase();
  if (k === "over") return "Over";
  if (k === "under") return "Under";
  if (k === "home") return short(g.home);
  if (k === "away") return short(g.away);
  return short(key);
}
function otherKey(key, g) {
  const k = String(key || "").toLowerCase();
  if (k === "over") return "under";
  if (k === "under") return "over";
  if (k === "home") return "away";
  if (k === "away") return "home";
  if (short(key) === short(g.home)) return "away";
  return "home";
}
// How many points the line moved TOWARD this side (positive = market agrees with that side)
function towardSide(key, oldLine, newLine, marketType) {
  const d = newLine - oldLine;
  const k = String(key || "").toLowerCase();
  if (marketType === "total") return k === "under" ? -d : d;
  return -d; // spread: more negative = side got more expensive = money on that side
}

async function loadSplits() {
  const today = chicagoDate(0);
  const tomorrow = chicagoDate(1);
  const rows = await sbSelect("market_split_snapshots",
    `select=cashedge_game_id,market_type,selection_key,line,money_pct,tickets_pct,observed_at` +
    `&or=(cashedge_game_id.like.*-${today}-*,cashedge_game_id.like.*-${tomorrow}-*)` +
    `&market_type=in.(spread,total)&observed_at=gte.${new Date(Date.now() - 30 * 3600e3).toISOString()}` +
    `&order=observed_at.asc&limit=8000`);
  // group by game|market|selection → first + latest snapshot + last line change time
  const groups = new Map();
  for (const r of rows) {
    if (r.line == null || r.tickets_pct == null) continue;
    const k = `${r.cashedge_game_id}|${r.market_type}|${String(r.selection_key).toLowerCase()}`;
    let gr = groups.get(k);
    if (!gr) { gr = { first: r, last: r, lineChangedAt: r.observed_at }; groups.set(k, gr); }
    if (Number(r.line) !== Number(gr.last.line)) gr.lineChangedAt = r.observed_at;
    gr.last = r;
  }
  return [...groups.values()];
}

async function loadMoves(minutes) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  return sbSelect("market_odds_updates",
    `select=cashedge_game_id,sportsbook_name,market_type,selection_key,previous_line,new_line,observed_at,raw_payload` +
    `&observed_at=gte.${since}&market_type=in.(spread,total)&order=observed_at.asc&limit=8000`);
}

async function loadKickoffs() {
  const rows = await loadMoves(24 * 60);
  const map = new Map();
  for (const r of rows) {
    const t = r.raw_payload?.commence_time;
    if (t) map.set(r.cashedge_game_id, t);
    // exact team names from the odds feed (safe for names with "-", e.g. Gardner-Webb)
    if (r.raw_payload?.home_team && r.raw_payload?.away_team)
      TEAMS.set(r.cashedge_game_id, { home: r.raw_payload.home_team, away: r.raw_payload.away_team });
  }
  return { map, rows };
}

const notStarted = (kick, id) => { const t = kick.get(id); return !t || Date.parse(t) > Date.now() + 10 * 60000; };
const startsIn = (kick, id) => {
  const t = kick.get(id); if (!t) return null;
  const m = (Date.parse(t) - Date.now()) / 60000; if (m <= 0) return null;
  return m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. STORY DETECTORS — each returns candidates { type, gameId, score, ...data }
// ═══════════════════════════════════════════════════════════════════════════

function base(gr) {
  const r = gr.last, g = parseGameId(r.cashedge_game_id);
  if (!g) return null;
  return {
    gameId: r.cashedge_game_id, g, sportTag: SPORT_TAG[g.sport] || g.sport.toUpperCase(),
    matchup: `${g.away} @ ${g.home}`, market: r.market_type, key: String(r.selection_key).toLowerCase(),
    tickets: Number(r.tickets_pct), money: r.money_pct == null ? null : Number(r.money_pct),
    oldLine: Number(gr.first.line), newLine: Number(r.line), total: r.market_type === "total"
  };
}

// Normalize so "side" = the side the PUBLIC (tickets) is on
function publicView(b) {
  if (b.tickets >= 50) return { ...b, side: b.key, pubTickets: b.tickets, pubMoney: b.money };
  const ok = otherKey(b.key, b.g);
  return {
    ...b, side: ok, pubTickets: 100 - b.tickets, pubMoney: b.money == null ? null : 100 - b.money,
    // flip line to the other side's perspective
    oldLine: b.total ? b.oldLine : -b.oldLine, newLine: b.total ? b.newLine : -b.newLine
  };
}

function detectReverse(groups, kick) {
  const out = [];
  for (const gr of groups) {
    const b = base(gr); if (!b || !notStarted(kick, b.gameId)) continue;
    const p = publicView(b);
    const toward = towardSide(p.side, p.oldLine, p.newLine, p.market);
    if (p.pubTickets >= 62 && toward <= -1) {
      out.push({ type: "reverse", score: p.pubTickets + Math.abs(toward) * 10, ...p,
        sideLabel: sideLabel(p.side, p.g), otherLabel: sideLabel(otherKey(p.side, p.g), p.g),
        moved: Math.abs(p.newLine - p.oldLine) });
    }
  }
  return out;
}

function detectMoneySplit(groups, kick) {
  const out = [];
  for (const gr of groups) {
    const b = base(gr); if (!b || b.money == null || !notStarted(kick, b.gameId)) continue;
    const p = publicView(b);
    const gap = p.pubTickets - p.pubMoney; // public has tickets but NOT the money
    if (p.pubTickets >= 58 && gap >= 15) {
      out.push({ type: "money", score: gap * 2 + p.pubTickets, ...p,
        sideLabel: sideLabel(p.side, p.g), otherLabel: sideLabel(otherKey(p.side, p.g), p.g), gap });
    }
  }
  return out;
}

function detectTrap(groups, kick) {
  const out = [];
  for (const gr of groups) {
    const b = base(gr); if (!b || !notStarted(kick, b.gameId)) continue;
    const p = publicView(b);
    const frozenH = minsAgo(gr.lineChangedAt) / 60;
    if (p.pubTickets >= 72 && frozenH >= 4 && p.oldLine === p.newLine) {
      out.push({ type: "trap", score: p.pubTickets + frozenH, ...p,
        sideLabel: sideLabel(p.side, p.g), frozenH: Math.floor(frozenH), frozenM: Math.round((frozenH % 1) * 60) });
    }
  }
  return out;
}

function detectBigMove(groups, kick) {
  const out = [];
  for (const gr of groups) {
    const b = base(gr); if (!b || !notStarted(kick, b.gameId)) continue;
    const moved = Math.abs(b.newLine - b.oldLine);
    if (moved >= 1.5) {
      out.push({ type: "bigmove", score: moved * 20, ...b,
        sideLabel: sideLabel(b.key, b.g), moved, startsIn: startsIn(kick, b.gameId) });
    }
  }
  return out;
}

// Fast move: several sportsbooks moved the same line in the last 60 minutes
function detectSteam(moveRows, kick) {
  const groups = new Map();
  for (const r of moveRows) {
    if (minsAgo(r.observed_at) > 60 || r.previous_line == null || r.new_line == null) continue;
    const g = parseGameId(r.cashedge_game_id); if (!g || !notStarted(kick, r.cashedge_game_id)) continue;
    const key = String(r.selection_key).toLowerCase();
    // normalize: totals → over line; spreads → home line
    const isAway = key === "away" || short(key) === short(g.away);
    const norm = v => r.market_type === "total" ? Number(v) : (isAway ? -Number(v) : Number(v));
    const k = `${r.cashedge_game_id}|${r.market_type}`;
    let gr = groups.get(k);
    if (!gr) { gr = { g, gameId: r.cashedge_game_id, market: r.market_type, books: new Map(), t0: r.observed_at, t1: r.observed_at }; groups.set(k, gr); }
    const book = gr.books.get(r.sportsbook_name) || { from: norm(r.previous_line) };
    book.to = norm(r.new_line);
    gr.books.set(r.sportsbook_name, book);
    gr.t1 = r.observed_at;
  }
  const out = [];
  for (const gr of groups.values()) {
    const deltas = [...gr.books.values()].map(b => b.to - b.from).filter(d => d !== 0).sort((a, b) => a - b);
    if (deltas.length < 2) continue;
    const med = deltas[Math.floor(deltas.length / 2)];
    if (Math.abs(med) < 1) continue;
    const froms = [...gr.books.values()].map(b => b.from).sort((a, b) => a - b);
    const from = froms[Math.floor(froms.length / 2)];
    const total = gr.market === "total";
    const mins = Math.max(1, Math.round((Date.parse(gr.t1) - Date.parse(gr.t0)) / 60000));
    out.push({
      type: "steam", score: Math.abs(med) * 30 + deltas.length * 5, gameId: gr.gameId, g: gr.g,
      sportTag: SPORT_TAG[gr.g.sport] || gr.g.sport.toUpperCase(), matchup: `${gr.g.away} @ ${gr.g.home}`,
      total, sideLabel: total ? "Total" : short(gr.g.home), oldLine: from, newLine: from + med,
      moved: Math.abs(med), books: deltas.length, mins, startsIn: startsIn(kick, gr.gameId)
    });
  }
  return out;
}

// Today's Free Premium Play vs the market (pick is already public, so this reveals nothing)
async function detectFreePlayMarket() {
  const plays = await sbSelect("x_free_plays", `select=pick_id&post_date=eq.${chicagoDate(0)}&limit=1`);
  if (!plays[0]) return [];
  const picks = await sbSelect("picks_history", `select=*&id=eq.${plays[0].pick_id}&limit=1`);
  const p = picks[0]; if (!p || !/^pending$/i.test(p.result)) return [];
  // only events of the SAME market as the free play (never leak another Premium pick of that game)
  const mt = /^(over|under)$/i.test(p.pick) ? "total" : "spread";
  const ev = await sbSelect("market_events",
    `select=event_type,direction,event_data,headline,last_detected_at&cashedge_game_id=eq.${encodeURIComponent(p.game_id)}&market_type=eq.${mt}` +
    `&is_active=eq.true&order=last_detected_at.desc&limit=10`);
  const e = ev.find(x => x.direction === "aligned" || x.direction === "against");
  if (!e) return [];
  const g = parseGameId(p.game_id) || { home: p.home_team, away: p.away_team, sport: p.sport };
  const pick = /^(over|under)$/i.test(p.pick) && p.line != null ? `${p.pick} ${p.line}` : p.pick;
  return [{
    type: "freeplay", score: 100, gameId: p.game_id, g, sportTag: SPORT_TAG[String(p.sport).toLowerCase()] || "",
    matchup: `${p.away_team} @ ${p.home_team}`, pick, against: e.direction === "against",
    lineMove: e.event_data?.lineMovement ?? null, books: (e.event_data?.retailAligned || 0) + (e.event_data?.referenceAligned || 0),
    booksAgainst: (e.event_data?.retailAgainst || 0) + (e.event_data?.referenceAgainst || 0)
  }];
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. IMAGE DESIGNS (Satori)
// ═══════════════════════════════════════════════════════════════════════════

function shell(tag, tagColor, glowA, glowB, ...body) {
  return h("div", {
    width: W, height: HGT, display: "flex", flexDirection: "column", padding: "34px 50px 30px",
    backgroundColor: COL.bg, fontFamily: "Inter",
    backgroundImage: `radial-gradient(circle at 5% 95%, ${glowA}44, transparent 45%), radial-gradient(circle at 95% 5%, ${glowB}55, transparent 45%)`
  },
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
      h("div", { display: "flex", fontSize: 30, fontWeight: 800 },
        h("span", { color: COL.white }, "Cash"), h("span", { color: COL.cyan }, "Edge")),
      h("div", { display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 22,
        border: `2px solid ${tagColor}`, backgroundColor: `${tagColor}22` },
        h("div", { display: "flex", width: 12, height: 12, borderRadius: 12, backgroundColor: tagColor, marginRight: 10 }),
        h("div", { display: "flex", fontSize: 18, fontWeight: 800, color: tagColor, letterSpacing: 1.5 }, tag))
    ),
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 18 }, ...body),
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 17 },
      h("span", { color: COL.cyan, fontWeight: 800 }, "📲 Free alerts on Telegram: t.me/Cashedgeapp"),
      h("span", { color: COL.muted }, "21+ | Gamble responsibly | 1-800-MY-RESET"))
  );
}

const title = (a, b, colB, size = 62) => h("div", { display: "flex", flexDirection: "column" },
  h("div", { display: "flex", fontSize: size, fontWeight: 800, color: COL.white, lineHeight: 1.05 }, a),
  b ? h("div", { display: "flex", fontSize: size, fontWeight: 800, color: colB, lineHeight: 1.05 }, b) : null);

const sub = t => h("div", { display: "flex", fontSize: 24, color: COL.muted, marginTop: 10 }, t);

const card = (style, ...kids) => h("div", { display: "flex", flexDirection: "column", padding: "18px 26px",
  borderRadius: 20, backgroundColor: COL.card, border: `2px solid ${COL.line}`, ...style }, ...kids);

const label = (t, color = COL.muted) => h("div", { display: "flex", fontSize: 19, fontWeight: 800, color, letterSpacing: 1.5 }, t);

const redacted = (width, height = 54, txt = "🔒 PREMIUM ONLY") => h("div", {
  display: "flex", width, height, borderRadius: 10, alignItems: "center", justifyContent: "center",
  backgroundColor: "#000000", border: "1px solid #2a2a36",
  backgroundImage: "repeating-linear-gradient(135deg, #000 0px, #000 10px, #16161f 10px, #16161f 20px)"
}, h("div", { display: "flex", fontSize: 17, fontWeight: 800, color: COL.purple, letterSpacing: 2 }, txt));

const bar = (pct, color, width, txt) => h("div", { display: "flex", width, height: 58, borderRadius: 14,
  backgroundColor: COL.card, border: `2px solid ${COL.line}` },
  h("div", { display: "flex", width: Math.max(60, width * pct / 100), height: 54, borderRadius: 12, backgroundColor: color,
    alignItems: "center", paddingLeft: 18 },
    h("div", { display: "flex", fontSize: 24, fontWeight: 800, color: COL.bg }, txt || "")));

// D1 — Anomaly: public vs line
function dAnomaly(s, v) {
  const head = v.head || ["SOMETHING DOESN'T", "ADD UP."];
  return shell(v.tag || "MARKET ANOMALY", COL.red, COL.red, COL.purple,
    title(head[0], head[1], COL.red),
    sub(`${s.matchup}  ·  ${s.sportTag}`),
    h("div", { display: "flex", marginTop: 22 },
      card({ width: 500, marginRight: 30 },
        label("PUBLIC BETS"),
        h("div", { display: "flex", fontSize: 100, fontWeight: 800, color: COL.white, lineHeight: 1.1 }, `${s.pubTickets}%`),
        h("div", { display: "flex", fontSize: 26, fontWeight: 800, color: COL.cyan }, `on ${s.sideLabel.toUpperCase()}`)),
      card({ flexGrow: 1, border: `2px solid ${COL.red}` },
        label("BUT THE LINE MOVED", COL.red),
        h("div", { display: "flex", alignItems: "center", marginTop: 14 },
          h("div", { display: "flex", fontSize: 54, fontWeight: 800, color: COL.muted, textDecoration: "line-through" }, fmtLine(s.oldLine, s.total)),
          h("div", { display: "flex", fontSize: 54, fontWeight: 800, color: COL.red, margin: "0 22px" }, "→"),
          h("div", { display: "flex", fontSize: 54, fontWeight: 800, color: COL.white }, fmtLine(s.newLine, s.total))),
        h("div", { display: "flex", fontSize: 26, fontWeight: 800, color: COL.red, marginTop: 12 }, `AGAINST THE PUBLIC`),
        h("div", { display: "flex", fontSize: 21, color: COL.muted, marginTop: 8 }, v.question || "Who knows something the public doesn't?")))
  );
}

// D2 — Follow the money: tickets visible, money redacted
function dMoney(s, v) {
  return shell(v.tag || "BETTING SPLITS", COL.green, COL.green, COL.cyan,
    title(...(v.head || ["FOLLOW THE", "MONEY."]), COL.green, 66),
    sub(`${s.matchup}  ·  ${s.sportTag}`),
    h("div", { display: "flex", flexDirection: "column", marginTop: 20 },
      label("TICKETS"),
      h("div", { display: "flex", alignItems: "center", marginTop: 8 },
        bar(s.pubTickets, COL.cyan, 900, s.sideLabel.toUpperCase()),
        h("div", { display: "flex", fontSize: 48, fontWeight: 800, color: COL.white, marginLeft: 24 }, `${s.pubTickets}%`)),
      h("div", { display: "flex", marginTop: 20 }, label("MONEY")),
      h("div", { display: "flex", alignItems: "center", marginTop: 8 },
        redacted(900, 58),
        h("div", { display: "flex", fontSize: 48, fontWeight: 800, color: COL.green, marginLeft: 24 }, "??%"))),
    h("div", { display: "flex", fontSize: 24, color: COL.white, marginTop: 22 }, v.line || "The money tells a very different story on this one.")
  );
}

// D3 — Trap: gauge + frozen line
function arcPath(cx, cy, r, pct) {
  const a = Math.PI * (1 - pct / 100);
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
}
function dTrap(s, v) {
  return shell(v.tag || "TRAP WATCH", COL.orange, COL.orange, COL.red,
    h("div", { display: "flex", justifyContent: "space-between", flexGrow: 1 },
      h("div", { display: "flex", flexDirection: "column", width: 640 },
        h("div", { display: "flex", fontSize: 112, fontWeight: 800, color: COL.orange, lineHeight: 1 }, v.head?.[0] || "TRAP"),
        h("div", { display: "flex", fontSize: 112, fontWeight: 800, color: COL.white, lineHeight: 1.05 }, v.head?.[1] || "ALERT?"),
        sub(`${s.matchup}  ·  ${s.sportTag}`),
        h("div", { display: "flex", fontSize: 27, fontWeight: 800, color: COL.white, marginTop: 18 }, `${s.pubTickets}% of the public is on ${s.sideLabel}.`),
        h("div", { display: "flex", fontSize: 27, fontWeight: 800, color: COL.white, marginTop: 6 }, `The line hasn't moved in ${s.frozenH} hours.`),
        h("div", { display: "flex", fontSize: 22, color: COL.muted, marginTop: 14 }, v.line || "Books don't sit still for no reason.")),
      h("div", { display: "flex", flexDirection: "column", alignItems: "center", width: 400, marginTop: 20 },
        h("div", { display: "flex", width: 380, height: 210, position: "relative", justifyContent: "center" },
          { type: "svg", props: { width: 380, height: 210, viewBox: "0 0 380 210", style: { position: "absolute", top: 0, left: 0 },
            children: [
              { type: "path", props: { d: arcPath(190, 195, 165, 100), stroke: COL.line, strokeWidth: 30, fill: "none", strokeLinecap: "round" } },
              { type: "path", props: { d: arcPath(190, 195, 165, s.pubTickets), stroke: COL.orange, strokeWidth: 30, fill: "none", strokeLinecap: "round" } }
            ] } },
          h("div", { display: "flex", flexDirection: "column", alignItems: "center", marginTop: 92 },
            h("div", { display: "flex", fontSize: 70, fontWeight: 800, color: COL.white }, `${s.pubTickets}%`),
            h("div", { display: "flex", fontSize: 17, fontWeight: 800, color: COL.muted }, `PUBLIC ON ${short(s.sideLabel).toUpperCase()}`))),
        card({ marginTop: 18, width: 340, border: `2px solid ${COL.orange}` },
          h("div", { display: "flex", fontSize: 30, fontWeight: 800, color: COL.white }, `LINE  ${fmtLine(s.newLine, s.total)}`),
          h("div", { display: "flex", fontSize: 21, fontWeight: 800, color: COL.orange }, `FROZEN · ${s.frozenH}h ${s.frozenM}m`))))
  );
}

// D4 — Move: open → now (+ minutes)
function dMove(s, v) {
  const fast = s.type === "steam";
  return shell(v.tag || (fast ? "LIVE · JUST NOW" : "BIGGEST MOVE TODAY"), fast ? COL.red : COL.cyan, COL.cyan, COL.purple,
    title(...(v.head || (fast ? ["SHARP MONEY", "JUST HIT."] : ["THE MARKET", "IS PICKING A SIDE."])), COL.cyan, 60),
    sub(`${s.matchup}  ·  ${s.sportTag}${s.startsIn ? `  ·  Starts in ${s.startsIn}` : ""}`),
    card({ marginTop: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", border: `2px solid ${COL.cyan}`, padding: "26px 40px" },
      h("div", { display: "flex", flexDirection: "column" }, label(fast ? "BEFORE" : "OPEN"),
        h("div", { display: "flex", fontSize: 100, fontWeight: 800, color: COL.muted }, fmtLine(s.oldLine, s.total))),
      h("div", { display: "flex", fontSize: 80, fontWeight: 800, color: COL.cyan }, "→"),
      h("div", { display: "flex", flexDirection: "column" }, label("NOW", COL.cyan),
        h("div", { display: "flex", fontSize: 100, fontWeight: 800, color: COL.white }, fmtLine(s.newLine, s.total))),
      h("div", { display: "flex", flexDirection: "column" }, label(fast ? "IN" : "MOVED"),
        h("div", { display: "flex", alignItems: "baseline" },
          h("div", { display: "flex", fontSize: 100, fontWeight: 800, color: COL.red }, fast ? String(s.mins) : String(s.moved)),
          h("div", { display: "flex", fontSize: 30, fontWeight: 800, color: COL.red, marginLeft: 8 }, fast ? "MIN" : "PTS")))),
    h("div", { display: "flex", fontSize: 23, color: COL.white, marginTop: 20 },
      v.line || (fast ? "Premium members got this alert instantly. You're seeing it late." : `${s.total ? "Total" : s.sideLabel} line on the move. Where is the money coming from?`))
  );
}

// D5 — Classified case file
function dClassified(s, v) {
  const rows = [
    ["Matchup", s.matchup],
    [s.oldLine !== s.newLine ? "Opening line" : "Line", fmtLine(s.oldLine, s.total)],
    s.oldLine !== s.newLine ? ["Current line", fmtLine(s.newLine, s.total)] : null,
    s.pubTickets ? ["Public tickets", `${s.pubTickets}% ${s.sideLabel}`] : null,
    ["Sharp money side", null], ["CashEdge read", null], ["Confidence", null]
  ].filter(Boolean).slice(0, 6);
  return shell(v.tag || "PREMIUM FILE", COL.purple, COL.purple, COL.cyan,
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, padding: "22px 34px", borderRadius: 18,
      backgroundColor: "#0e101a", border: `2px solid ${COL.purple}`, position: "relative" },
      h("div", { display: "flex", fontSize: 20, fontWeight: 800, color: COL.muted, letterSpacing: 1 },
        `CASE FILE #${chicagoDate(0).replace(/-/g, "").slice(4)}  ·  ${s.sportTag}`),
      h("div", { display: "flex", fontSize: 38, fontWeight: 800, color: COL.white, marginTop: 6, marginBottom: 8 }, v.head?.[0] || "MARKET READ:"),
      ...rows.map(([k, val]) => h("div", { display: "flex", alignItems: "center", height: 52 },
        h("div", { display: "flex", width: 330, fontSize: 25, color: COL.muted }, k),
        val ? h("div", { display: "flex", fontSize: 26, fontWeight: 800, color: COL.white }, String(val).slice(0, 38))
          : redacted(560, 38, "🔒 CLASSIFIED"))),
      h("div", { display: "flex", position: "absolute", top: 26, right: 40, transform: "rotate(-10deg)",
        border: `6px solid ${COL.red}`, borderRadius: 12, padding: "6px 22px" },
        h("div", { display: "flex", fontSize: 54, fontWeight: 800, color: COL.red }, "CLASSIFIED")))
  );
}

// D6 — Poll: what would you do?
function dPoll(s, v) {
  const opts = v.options(s);
  const colors = [COL.cyan, COL.purple, COL.orange];
  return shell(v.tag || "YOUR CALL", COL.cyan, COL.cyan, COL.purple,
    title(...(v.head || ["WHAT WOULD", "YOU DO?"]), COL.cyan, 58),
    h("div", { display: "flex", fontSize: 24, color: COL.white, marginTop: 10 }, v.setup(s)),
    h("div", { display: "flex", marginTop: 20 },
      h("div", { display: "flex", flexDirection: "column", width: 700 },
        ...opts.map((o, i) => h("div", { display: "flex", alignItems: "center", height: 70, marginBottom: 14, borderRadius: 16,
          backgroundColor: COL.card, border: `2px solid ${colors[i]}`, padding: "0 12px" },
          h("div", { display: "flex", width: 48, height: 48, borderRadius: 12, backgroundColor: colors[i], alignItems: "center", justifyContent: "center",
            fontSize: 30, fontWeight: 800, color: COL.bg }, "ABC"[i]),
          h("div", { display: "flex", fontSize: 30, fontWeight: 800, color: COL.white, marginLeft: 20 }, o)))),
      card({ marginLeft: 30, flexGrow: 1, border: `2px solid ${COL.purple}`, backgroundColor: "#0e101a" },
        label("OUR READ", COL.purple),
        h("div", { display: "flex", marginTop: 14 }, redacted(300, 60, "🔒 LOCKED")),
        h("div", { display: "flex", fontSize: 22, color: COL.muted, marginTop: 18 }, "Inside the app"),
        h("div", { display: "flex", fontSize: 30, fontWeight: 800, color: COL.white }, "before kickoff")))
  );
}

// D7 — Free play vs market (meter of books with / against)
function dFreePlay(s, v) {
  const col = s.against ? COL.red : COL.green;
  const tot = Math.max(1, s.books + s.booksAgainst);
  return shell(v.tag || "FREE PLAY · MARKET WATCH", col, col, COL.purple,
    title(...(v.head || (s.against ? ["THE MARKET IS", "PUSHING BACK."] : ["THE MARKET IS", "FOLLOWING US."])), col, 60),
    sub(`Today's Free Premium Play  ·  ${s.sportTag}`),
    card({ marginTop: 22, border: `2px solid ${col}` },
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" },
        h("div", { display: "flex", flexDirection: "column" },
          h("div", { display: "flex", fontSize: 52, fontWeight: 800, color: COL.white }, s.pick),
          h("div", { display: "flex", fontSize: 22, color: COL.muted }, s.matchup)),
        h("div", { display: "flex", padding: "10px 22px", borderRadius: 14, backgroundColor: col, fontSize: 26, fontWeight: 800, color: COL.bg },
          s.against ? "MARKET AGAINST" : "MARKET WITH US")),
      h("div", { display: "flex", marginTop: 18 },
        h("div", { display: "flex", width: Math.round(1000 * s.books / tot), height: 16, backgroundColor: COL.green, borderRadius: 8 }),
        h("div", { display: "flex", flexGrow: 1, height: 16, backgroundColor: COL.red, borderRadius: 8, marginLeft: 4 })),
      h("div", { display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800, marginTop: 8 },
        h("span", { color: COL.green }, `${s.books} books with`), h("span", { color: COL.red }, `${s.booksAgainst} against`))),
    h("div", { display: "flex", fontSize: 23, color: COL.white, marginTop: 18 }, v.line || "What happens next? Premium members get every move live.")
  );
}

const DESIGNS = { anomaly: dAnomaly, money: dMoney, trap: dTrap, move: dMove, classified: dClassified, poll: dPoll, freeplay: dFreePlay };

// ═══════════════════════════════════════════════════════════════════════════
// 4. TEMPLATES (text + design). {story} fields are filled with real data.
// ═══════════════════════════════════════════════════════════════════════════

const L = (s, n) => fmtLine(n, s.total);
const T = []; // { id, type, design, v:{...visual overrides}, text: s => string }
const add = (id, type, design, text, v = {}) => T.push({ id, type, design, text, v });

// ── Reverse line move (public vs line) ── 7
add("rev1", "reverse", "anomaly", s => `🚨 Something doesn't add up in ${s.matchup}.\n\n${s.pubTickets}% of bets are on ${s.sideLabel}.\nThe line just moved the OTHER way (${L(s, s.oldLine)} → ${L(s, s.newLine)}).\n\nBooks don't move lines for fun.\nWho knows something the public doesn't? 🤔`);
add("rev2", "reverse", "anomaly", s => `👀 The public is hammering ${s.sideLabel} (${s.pubTickets}%).\n\nSo why is the line running away from them?\n\n${s.matchup}: ${L(s, s.oldLine)} → ${L(s, s.newLine)}\n\nSomebody with bigger tickets disagrees. CashEdge sees who. 🔒`, { head: ["THE PUBLIC VS", "THE LINE."], tag: "REVERSE LINE MOVE" });
add("rev3", "reverse", "classified", s => `📁 CASE FILE: ${s.matchup}\n\n✅ ${s.pubTickets}% of tickets on ${s.sideLabel}\n✅ Line moved ${s.moved} pts against them\n❓ Where's the real money? CLASSIFIED\n\nPremium members already have the full file. 🔒`);
add("rev4", "reverse", "poll", s => `${s.pubTickets}% of the public is on ${s.sideLabel}.\nThe line went ${L(s, s.oldLine)} → ${L(s, s.newLine)}. Against them.\n\nWhat do you do? 👇\n🅰️ Ride with the public\n🅱️ Follow the line\n🅲️ Stay away\n\nOur read is inside the app 🔒`, {
  setup: s => `${s.pubTickets}% on ${s.sideLabel}. Line: ${L(s, s.oldLine)} → ${L(s, s.newLine)}. Against them.`,
  options: s => [`Ride with ${short(s.sideLabel)}`, "Follow the line", "Stay away"] });
add("rev5", "reverse", "anomaly", s => `⚠️ Reverse line move spotted.\n\n${s.matchup}\nPublic: ${s.pubTickets}% on ${s.sideLabel}\nLine: ${L(s, s.oldLine)} → ${L(s, s.newLine)}\n\nWhen the line goes against the crowd, pay attention. Full read in CashEdge. 🔒`, { head: ["REVERSE", "LINE MOVE."], tag: "SHARP SIGNAL?", question: "When the line fights the crowd… pay attention." });
add("rev6", "reverse", "classified", s => `Everybody likes ${s.sideLabel} in ${s.matchup}.\nThe sportsbooks… not so much. 📉\n\nThe line moved ${s.moved} pts the other way.\n\nWe know where the big money went. Do you? 👀`, { head: ["WHO'S RIGHT?"] });
add("rev7", "reverse", "anomaly", s => `🎭 Two different stories in ${s.matchup}:\n\n🎟️ The public: ${s.pubTickets}% on ${s.sideLabel}\n📉 The line: moving the other way\n\nOnly one of them is usually right. Find out which inside CashEdge.`, { head: ["TWO STORIES.", "ONE WINNER."] });

// ── Money vs tickets ── 6
add("mon1", "money", "money", s => `💰 FOLLOW THE MONEY\n\n${s.matchup}\n🎟️ Tickets: ${s.pubTickets}% on ${s.sideLabel}\n💵 Money: ██%\n\nWhen the money and the tickets disagree this much… something's up.\n\nFull split in the app 🔓`);
add("mon2", "money", "money", s => `The crowd picked ${s.sideLabel} (${s.pubTickets}% of bets).\n\nThe money? It's not on their side. 👀\n\n${s.matchup}\n\nSee where the big bets are going: CashEdge`, { head: ["THE CROWD", "VS THE MONEY."], line: "The crowd has the tickets. Someone else has the money." });
add("mon3", "money", "classified", s => `📁 ${s.matchup}\n\n${s.pubTickets}% of tickets on ${s.sideLabel}.\nThe money split? Classified.\n\nIt's a ${s.gap}-point gap. That doesn't happen by accident.\n\n🔒 Premium sees it all.`);
add("mon4", "money", "poll", s => `${s.pubTickets}% of tickets on ${s.sideLabel}… but the money says something else.\n\nWhere do you think the big bets are? 👇\n🅰️ ${s.sideLabel}\n🅱️ ${s.otherLabel}\n🅲️ Split down the middle\n\nAnswer is in CashEdge 🔒`, {
  head: ["GUESS THE", "SHARP SIDE."], setup: s => `${s.matchup}: ${s.pubTickets}% of tickets on ${s.sideLabel}. The money disagrees.`,
  options: s => [short(s.sideLabel), short(s.otherLabel), "Split down the middle"] });
add("mon5", "money", "money", s => `🧠 Tickets tell you what people THINK.\n💵 Money tells you what they KNOW.\n\n${s.matchup}: the two don't match today.\n\nTickets: ${s.pubTickets}% ${s.sideLabel}\nMoney: 🔒\n\nUnlock it before kickoff.`, { head: ["TICKETS LIE.", "MONEY DOESN'T."] });
add("mon6", "money", "money", s => `${s.matchup} has one of the biggest money/ticket gaps on today's board. 📊\n\nThe public is loud on ${s.sideLabel}.\nThe money is quiet… and somewhere else.\n\nFull read in CashEdge 🔓`, { head: ["BIGGEST GAP", "ON THE BOARD."] });

// ── Trap ── 5
add("trap1", "trap", "trap", s => `🪤 TRAP ALERT?\n\n${s.pubTickets}% of the public is on ${s.sideLabel} in ${s.matchup}.\nThe line hasn't moved in ${s.frozenH} hours.\n\nWhen the whole world bets one side and the book doesn't flinch… that's not an accident.`);
add("trap2", "trap", "trap", s => `Why isn't this line moving? 🤨\n\n${s.matchup}\n${s.pubTickets}% on ${s.sideLabel}. Line frozen at ${L(s, s.newLine)} for ${s.frozenH}h.\n\nBooks usually adjust when this many people pile on. Not this time.`, { head: ["WHY ISN'T IT", "MOVING?"], tag: "FROZEN LINE" });
add("trap3", "trap", "classified", s => `📁 TRAP FILE: ${s.matchup}\n\nPublic: ${s.pubTickets}% ${s.sideLabel}\nLine: frozen ${s.frozenH}h\nOur read: 🔒 CLASSIFIED\n\nIs the book inviting the public in? 👀`, { head: ["TRAP FILE:"] });
add("trap4", "trap", "poll", s => `${s.pubTickets}% on ${s.sideLabel}. Line hasn't moved in ${s.frozenH} hours.\n\nIs it a trap? 👇\n🅰️ Yes, fade it\n🅱️ No, the public is right\n🅲️ Not touching it`, {
  head: ["IS IT A", "TRAP?"], setup: s => `${s.matchup}: ${s.pubTickets}% on ${s.sideLabel}, line frozen ${s.frozenH}h.`,
  options: () => ["Yes, fade it", "No, public is right", "Not touching it"] });
add("trap5", "trap", "trap", s => `The easiest-looking bet of the day might be the most dangerous one. 🪤\n\n${s.matchup}\n${s.pubTickets}% of bettors agree on ${s.sideLabel}. The book isn't worried.\n\nCashEdge tracks it live. 👀`, { head: ["TOO EASY", "TO BE TRUE?"] });

// ── Steam (fast move) ── 5
add("stm1", "steam", "move", s => `⚡ JUST NOW: sharp action hit ${s.matchup}.\n\n${s.total ? "Total" : s.sideLabel} ${L(s, s.oldLine)} → ${L(s, s.newLine)} in ${s.mins} minutes across ${s.books} books.\n\nPremium members got this alert instantly. You're seeing it late. 🔒`);
add("stm2", "steam", "move", s => `🚨 ${s.books} sportsbooks moved ${s.matchup} at the same time.\n\n${L(s, s.oldLine)} → ${L(s, s.newLine)} in ${s.mins} min.\n\nThat's not the public. That's someone who knows something.`, { head: ["THE BOOKS", "JUST REACTED."], tag: "STEAM MOVE" });
add("stm3", "steam", "classified", s => `📁 LIVE FILE: ${s.matchup}\n\nLine: ${L(s, s.oldLine)} → ${L(s, s.newLine)}\nBooks moved: ${s.books}\nWho moved it: 🔒 CLASSIFIED\n\nGet these alerts the second they happen 👇`, { head: ["LIVE FILE:"] });
add("stm4", "steam", "move", s => `⏰ Something just happened in ${s.matchup}${s.startsIn ? ` (starts in ${s.startsIn})` : ""}.\n\nThe line jumped ${s.moved} pts in ${s.mins} minutes.\n\nIf you're betting this game, you want to know why. 👀`, { head: ["LAST-MINUTE", "MOVE."] });
add("stm5", "steam", "move", s => `💥 ${s.moved} points. ${s.mins} minutes. ${s.books} books.\n\n${s.matchup} just got hit.\n\nCashEdge members got the alert in real time. Next one goes to Premium first. 🔒`, { head: ["BOOM.", "LINE JUST JUMPED."] });

// ── Big move today ── 5
add("big1", "bigmove", "move", s => `📈 BIGGEST MOVE ON TODAY'S BOARD\n\n${s.matchup}\n${s.total ? "Total" : s.sideLabel}: ${L(s, s.oldLine)} → ${L(s, s.newLine)} (${s.moved} pts)\n\nThe market is picking a side. Do you know which one? 👀`);
add("big2", "bigmove", "classified", s => `📁 ${s.matchup}\n\nOpened: ${L(s, s.oldLine)}\nNow: ${L(s, s.newLine)}\nWho pushed it: 🔒\n\n${s.moved} points is a LOT. Find out where the money came from.`, { head: ["MARKET READ:"] });
add("big3", "bigmove", "move", s => `${s.moved} points since this morning. 😳\n\n${s.matchup}: ${L(s, s.oldLine)} → ${L(s, s.newLine)}\n\nIf you bet this at the open, you're happy. If you're betting it now… check CashEdge first.`, { head: ["SINCE THIS", "MORNING."] });
add("big4", "bigmove", "poll", s => `${s.matchup} moved ${L(s, s.oldLine)} → ${L(s, s.newLine)} today.\n\nWhat's behind it? 👇\n🅰️ Sharp money\n🅱️ Injury news\n🅲️ Public hype\n\nWe know. 🔒`, {
  head: ["WHAT'S BEHIND", "THIS MOVE?"], setup: s => `${s.matchup}: ${L(s, s.oldLine)} → ${L(s, s.newLine)} today.`,
  options: () => ["Sharp money", "Injury news", "Public hype"] });
add("big5", "bigmove", "move", s => `🔥 The line everyone's talking about today:\n\n${s.matchup}\n${L(s, s.oldLine)} → ${L(s, s.newLine)}\n\nThe market moved. Did you move with it?\n\n📲 Live moves on our Telegram`, { head: ["THE LINE", "EVERYONE'S WATCHING."] });

// ── Free play vs market ── 5
add("fp1", "freeplay", "freeplay", s => s.against
  ? `⚠️ UPDATE on today's Free Premium Play (${s.pick}):\n\nThe market is pushing back. ${s.booksAgainst} books moved against it.\n\nDo we stay strong or is the market right? 👀 We'll find out tonight.`
  : `📈 UPDATE on today's Free Premium Play (${s.pick}):\n\nThe market is moving WITH us. ${s.books} books followed.\n\nThis is what CashEdge members see all day, on every Premium pick. 🔒`);
add("fp2", "freeplay", "freeplay", s => s.against
  ? `🥊 It's us vs the market on ${s.pick}.\n\nThe line moved against today's free play.\n\nWho's right? Results drop tomorrow at 9 AM. 👇`
  : `✅ The market agrees.\n\nToday's free play (${s.pick}) is getting support from ${s.books} books.\n\nMembers are watching every move live. You? 👀`,
  { head: ["FREE PLAY", "MARKET UPDATE."] });
add("fp3", "freeplay", "freeplay", s => `📊 Live check on our free pick: ${s.pick}\n\n${s.books} books with us · ${s.booksAgainst} against\n\nThis is the Market Intelligence Premium members get on EVERY pick, not just this one. 🔒`, { tag: "MARKET INTELLIGENCE" });
add("fp4", "freeplay", "freeplay", s => s.against
  ? `🚨 The market just turned on today's free play (${s.pick}).\n\nPremium members got this alert the second it happened. Here's what they also get: every line move, every split, every alert.`
  : `🔥 Today's free play (${s.pick}) is getting the market's respect.\n\nImagine getting this for every Premium pick. That's CashEdge.`, { tag: "LIVE ALERT" });
add("fp5", "freeplay", "freeplay", s => `👀 ${s.matchup}\n\nOur free play: ${s.pick}\nMarket status: ${s.against ? "AGAINST 📉" : "WITH US 📈"}\n\nDrop a 🔥 if you're riding with us tonight.`, { head: ["ARE YOU", "RIDING WITH US?"] });

export const TEMPLATE_COUNT = T.length;

// ═══════════════════════════════════════════════════════════════════════════
// 5. ENGINE: pick the best story + a template not used recently
// ═══════════════════════════════════════════════════════════════════════════

async function recentLog(channel) {
  try {
    return await sbSelect("social_post_log",
      `select=template_id,game_id,posted_at&channel=eq.${channel}&posted_at=gte.${new Date(Date.now() - 4 * 86400e3).toISOString()}&limit=500`);
  } catch { return []; }
}

export async function logPost(channel, slot, templateId, gameId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/social_post_log`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, slot, template_id: templateId, game_id: gameId })
    });
  } catch (e) { console.error("social_post_log", e); }
}

// types: preferred story types in order, e.g. ["reverse","money","steam"]
export async function buildMarketStory(channel, types, { exclude = [] } = {}) {
  const { map: kick, rows: moveRows } = await loadKickoffs();
  const groups = await loadSplits();

  const detectors = {
    reverse: () => detectReverse(groups, kick),
    money: () => detectMoneySplit(groups, kick),
    trap: () => detectTrap(groups, kick),
    bigmove: () => detectBigMove(groups, kick),
    steam: () => detectSteam(moveRows, kick),
    freeplay: () => detectFreePlayMarket()
  };

  const log = await recentLog(channel);
  const today = chicagoDate(0);
  const usedGamesToday = new Set(log.filter(l => new Date(l.posted_at).toLocaleDateString("en-CA", { timeZone: TZ }) === today).map(l => l.game_id));
  const usedTemplates = log.map(l => l.template_id);

  for (const type of types) {
    const stories = (await detectors[type]())
      .filter(s => !usedGamesToday.has(s.gameId) && !exclude.includes(s.gameId))
      .sort((a, b) => b.score - a.score);
    if (!stories.length) continue;
    const story = stories[0];

    // templates of this type, least-recently used first, random among the unused
    const pool = T.filter(t => t.type === type);
    const fresh = pool.filter(t => !usedTemplates.includes(t.id));
    const choices = fresh.length ? fresh : pool;
    const tpl = choices[Math.floor(Math.random() * choices.length)];

    const element = DESIGNS[tpl.design](story, tpl.v);
    return {
      templateId: tpl.id, type, gameId: story.gameId,
      text: tpl.text(story) + "\n\n21+ | Gamble responsibly",
      png: await renderPng(element),
      poll: tpl.design === "poll" ? { question: "What do you do?", options: tpl.v.options(story) } : null
    };
  }
  return null; // nothing honest to say → skip
}

// For local previews / tests
export { T as TEMPLATES, DESIGNS };

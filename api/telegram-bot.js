// /api/telegram-bot.js
// CashEdge Telegram channel — winners-first content, fully automatic.
// ONE Vercel cron runs every hour; this file decides what to post by the Chicago hour.
// Rules: everything posted is true. Losses are never posted alone. No "lock"/"guaranteed".

import {
  sbSelect, chicagoDate, prettyDate, gameLabel, pickLabel, sportOf, getPremiumRecord,
  h, frame, sportChip, renderPng, getCardData, premiumCardImage,
  C, SPORT_TAG, SPORT_EMOJI, TABLE, DATE_COL
} from "./twitter-bot.js";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHANNEL = process.env.TELEGRAM_CHANNEL;
const TZ = "America/Chicago";

const APP_LINK = "https://cashedgeapp.com/?utm_source=telegram&utm_medium=social&utm_campaign=channel";
const SPORT_NAME = { nba: "NBA", wnba: "WNBA", ncaab: "College Basketball", mlb: "MLB", nfl: "NFL", ncaaf: "College Football" };

// ── Telegram API ───────────────────────────────────────────────────────────
async function sendPhoto(png, caption) {
  const form = new FormData();
  form.append("chat_id", TG_CHANNEL);
  form.append("photo", new Blob([png], { type: "image/png" }), "cashedge.png");
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("reply_markup", JSON.stringify({
    inline_keyboard: [[{ text: "🔓 Unlock today's Premium board", url: APP_LINK }]]
  }));
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${JSON.stringify(data)}`);
  return data.result?.message_id;
}

// Native Telegram poll (anonymous, works in channels)
async function sendPoll(question, options) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPoll`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHANNEL, question, options: options.map(o => ({ text: o })), is_anonymous: true })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram poll: ${JSON.stringify(data)}`);
}

const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Market story (story engine) → Telegram caption: first line in bold
async function marketSlot(slot, types) {
  const { buildMarketStory } = await import("./_social-stories.js");
  const s = await buildMarketStory("telegram", types);
  if (!s) return null;
  const [first, ...rest] = s.text.split("\n");
  return {
    png: s.png, poll: s.poll, log: { slot, templateId: s.templateId, gameId: s.gameId },
    caption: `<b>${esc(first)}</b>\n${esc(rest.join("\n"))}`
  };
}

function chicagoHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
}

// ── Data ───────────────────────────────────────────────────────────────────
async function yesterdayGraded() {
  return sbSelect(TABLE,
    `select=*&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(-1)}&or=(result.ilike.win,result.ilike.loss)`);
}

async function todayPremium() {
  return sbSelect(TABLE,
    `select=sport,confidence,result&is_premium=eq.true&${DATE_COL}=eq.${chicagoDate(0)}&order=confidence.desc&limit=50`);
}

// Best sport by real accuracy (only sports with enough graded picks)
async function hottestSport() {
  const { bySport } = await getPremiumRecord();
  const rows = bySport
    .map(r => ({ ...r, total: Number(r.total_wins) + Number(r.total_losses) }))
    .filter(r => r.total >= 50)
    .sort((a, b) => Number(b.accuracy) - Number(a.accuracy));
  return rows[0] || null;
}

// ── Images ─────────────────────────────────────────────────────────────────
function winnersImage(wins, w, l, showRecord) {
  const shown = wins.slice(0, 5);
  return frame(`YESTERDAY · ${prettyDate(-1)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 96, color: C.win, fontWeight: 800 }, showRecord ? `${w}-${l}` : String(w)),
      h("div", { display: "flex", fontSize: 44, color: C.white, fontWeight: 800, marginLeft: 22 },
        showRecord ? "Premium day" : `Premium ${w === 1 ? "winner" : "winners"}`)
    ),
    h("div", { display: "flex", flexDirection: "column", marginTop: 14 },
      shown.map(p => h("div", {
        display: "flex", alignItems: "center", padding: "10px 18px", marginBottom: 9,
        backgroundColor: C.card, borderRadius: 14, border: `1px solid ${C.line}`
      },
        sportChip(sportOf(p)),
        h("div", { display: "flex", flexDirection: "column", flexGrow: 1 },
          h("div", { display: "flex", fontSize: 27, color: C.white, fontWeight: 800 }, pickLabel(p).slice(0, 40)),
          h("div", { display: "flex", fontSize: 17, color: C.muted }, gameLabel(p).slice(0, 60))
        ),
        h("div", { display: "flex", padding: "8px 16px", borderRadius: 10, backgroundColor: C.win,
          color: C.bg, fontSize: 24, fontWeight: 800 }, "CASHED")
      )),
      wins.length > 5 ? h("div", { display: "flex", fontSize: 22, color: C.muted }, `+${wins.length - 5} more winners`) : null
    )
  );
}

function hotSportImage(s) {
  const key = String(s.sport).toLowerCase();
  return frame("HOT RIGHT NOW",
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 },
      h("div", { display: "flex", fontSize: 40, color: C.white, fontWeight: 800 }, `${SPORT_EMOJI[key] || "🔥"} ${SPORT_NAME[key] || s.display_name} Premium picks are hitting`),
      h("div", { display: "flex", fontSize: 170, color: C.cyan, fontWeight: 800, lineHeight: 1 }, `${Number(s.accuracy).toFixed(1)}%`),
      h("div", { display: "flex", fontSize: 30, color: C.muted, marginTop: 10 },
        `${s.total_wins}-${s.total_losses} this season · every pick graded publicly`)
    )
  );
}

function confidenceImage(top, count) {
  const key = sportOf(top);
  return frame(`TONIGHT · ${prettyDate(0)}`,
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 },
      h("div", { display: "flex", fontSize: 34, color: C.purple, fontWeight: 800, letterSpacing: 3 }, "🔒 HIGH CONFIDENCE PLAY"),
      h("div", { display: "flex", alignItems: "baseline", marginTop: 8 },
        h("div", { display: "flex", fontSize: 150, color: "#ff8a1f", fontWeight: 800, lineHeight: 1 }, `${Number(top.confidence).toFixed(1)}%`),
        h("div", { display: "flex", fontSize: 44, color: C.white, fontWeight: 800, marginLeft: 24 }, SPORT_TAG[key] || key.toUpperCase())
      ),
      h("div", { display: "flex", fontSize: 30, color: C.muted, marginTop: 16 },
        `Our strongest play tonight + ${Math.max(count - 1, 0)} more Premium picks · Locked in the app`)
    )
  );
}

function urgencyImage(count, bySport) {
  return frame(`TONIGHT · ${prettyDate(0)}`,
    h("div", { display: "flex", alignItems: "baseline" },
      h("div", { display: "flex", fontSize: 130, color: "#ff8a1f", fontWeight: 800, lineHeight: 1 }, String(count)),
      h("div", { display: "flex", fontSize: 46, color: C.white, fontWeight: 800, marginLeft: 22 }, "Premium picks still open")
    ),
    h("div", { display: "flex", flexWrap: "wrap", marginTop: 26 },
      Object.entries(bySport).map(([k, n]) => h("div", {
        display: "flex", flexDirection: "column", padding: "14px 22px", marginRight: 14, marginBottom: 14,
        backgroundColor: C.card, borderRadius: 14, border: `1px solid ${C.line}`
      },
        h("div", { display: "flex", fontSize: 20, color: C.cyan, fontWeight: 800, letterSpacing: 2 }, k),
        h("div", { display: "flex", fontSize: 40, color: C.white, fontWeight: 800 }, `🔒 ${n}`)
      ))
    ),
    h("div", { display: "flex", fontSize: 28, color: C.muted, marginTop: 6 }, "Lines keep moving until kickoff")
  );
}

// ── Posts by hour (Chicago). Return { png, caption } or null to skip ───────
// 12 posts/day: 8 market · 9 winners · 10 cashed · 11 hot sport · 12 free play · 13 market
// 14 money · 15 free play vs market · 16 urgency · 17 market · 18 high confidence · 20 market
const SLOTS = {
  8:  () => marketSlot(8,  ["bigmove", "trap", "reverse", "money"]),
  13: () => marketSlot(13, ["reverse", "trap", "money", "bigmove"]),
  14: () => marketSlot(14, ["money", "reverse", "trap", "bigmove"]),
  15: () => marketSlot(15, ["freeplay", "steam", "reverse", "money"]),
  17: () => marketSlot(17, ["steam", "reverse", "trap", "money", "bigmove"]),
  20: () => marketSlot(20, ["steam", "bigmove", "reverse", "trap", "money"]),

  // 9 AM — yesterday's winners (only if it was a good day)
  9: async () => {
    const graded = await yesterdayGraded();
    const wins = graded.filter(p => /^win$/i.test(p.result));
    const l = graded.length - wins.length;
    if (wins.length < 3) return null;                       // weak day → skip
    const pct = wins.length / graded.length;
    const great = pct >= 0.7;                                // great day → show full record
    const head = great ? `🔥 HUGE DAY: ${wins.length}-${l} on Premium picks yesterday` : `✅ ${wins.length} Premium winners yesterday`;
    const list = wins.slice(0, 8).map(p => `✅ ${SPORT_TAG[sportOf(p)] || ""} ${pickLabel(p)}`).join("\n");
    return {
      png: await renderPng(winnersImage(wins, wins.length, l, great)),
      caption: `<b>${head}</b>\n\n${list}\n\nAll posted to members BEFORE the games.\n\n🔓 Today's board is live 👇\n\n21+ | Gamble responsibly`
    };
  },

  // 10 AM — yesterday's Free Premium Play, only if it cashed
  10: async () => {
    const f = await getCardData(chicagoDate(-1)).catch(() => null);
    if (!f || f.result !== "win") return null;
    return {
      png: await renderPng(premiumCardImage(f)),
      caption: `<b>💰 CASHED: yesterday's Free Premium Play</b>\n\n${f.pick}${f.line != null && /^(over|under)$/i.test(f.pick) ? " " + f.line : ""} ✅\n\nWe gave it away for free. Members got this + the full board.\n\nToday's free play drops at 12 PM CT 🔔`
    };
  },

  // 11 AM — hottest sport by real accuracy
  11: async () => {
    const s = await hottestSport();
    if (!s) return null;
    const key = String(s.sport).toLowerCase();
    return {
      png: await renderPng(hotSportImage(s)),
      caption: `<b>🔥 ${SPORT_NAME[key] || s.display_name} Premium picks: ${Number(s.accuracy).toFixed(1)}% this season</b>\n\n${s.total_wins}-${s.total_losses}, every pick graded publicly.\n\nPremium also shows you every line move in real time and where the sharp money is going.\n\n21+ | Gamble responsibly`
    };
  },

  // 12 PM — today's Free Premium Play (same pick the X bot posts)
  12: async () => {
    const f = await getCardData(chicagoDate(0)).catch(() => null);
    if (!f) return null;
    const key = String(f.sport).toLowerCase();
    const pick = `${f.pick}${f.line != null && /^(over|under)$/i.test(f.pick) ? " " + f.line : ""}`;
    return {
      png: await renderPng(premiumCardImage(f)),
      caption: `<b>🆓 FREE PREMIUM PLAY</b>\n\n${SPORT_EMOJI[key] || "🎯"} <b>${pick}</b>\n${f.away_team} @ ${f.home_team}\n\nOne Premium pick, on us. The rest of today's board is locked in the app 👇\n\n21+ | Gamble responsibly`
    };
  },

  // 4 PM — urgency: how many Premium picks are still open tonight
  16: async () => {
    const open = (await todayPremium()).filter(p => /^pending$/i.test(p.result));
    if (open.length < 2) return null;
    const bySport = {};
    open.forEach(p => { const k = SPORT_TAG[sportOf(p)] || "OTHER"; bySport[k] = (bySport[k] || 0) + 1; });
    const lines = Object.entries(bySport).map(([k, n]) => `• ${k}: ${n} ${n === 1 ? "pick" : "picks"}`).join("\n");
    return {
      png: await renderPng(urgencyImage(open.length, bySport)),
      caption: `<b>⏰ ${open.length} Premium picks still open tonight</b>\n\n${lines}\n\nLines keep moving until kickoff. Get in before the number is gone 👇\n\n21+ | Gamble responsibly`
    };
  },

  // 6 PM — highest-confidence play tonight (locked)
  18: async () => {
    const picks = (await todayPremium()).filter(p => /^pending$/i.test(p.result));
    if (!picks.length) return null;
    const top = picks[0];
    return {
      png: await renderPng(confidenceImage(top, picks.length)),
      caption: `<b>🔒 HIGH CONFIDENCE play tonight: ${Number(top.confidence).toFixed(1)}%</b>\n\n${SPORT_TAG[sportOf(top)] || ""} · our strongest play of the day, plus ${picks.length - 1} more Premium picks.\n\nUnlock it before the line moves 👇\n\n21+ | Gamble responsibly`
    };
  }
};

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { slot, dry, img } = req.query;
  const hour = slot ? Number(slot) : chicagoHour();
  const build = SLOTS[hour];

  try {
    if (!build) return res.status(200).json({ ok: true, hour, skipped: "Nothing scheduled this hour" });
    const post = await build();

    // Preview: ?slot=9&dry=1 (caption) · ?slot=9&dry=1&img=1 (image)
    if (dry === "1") {
      if (!post) return res.status(200).json({ ok: true, hour, preview: null, note: "Would skip (no good data)" });
      if (img === "1") {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(post.png);
      }
      return res.status(200).json({ ok: true, hour, template: post.log?.templateId, caption: post.caption, poll: post.poll });
    }

    if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!post) return res.status(200).json({ ok: true, hour, skipped: "No good data" });

    const id = await sendPhoto(post.png, post.caption);
    if (post.poll) await sendPoll(post.poll.question, post.poll.options).catch(e => console.error(e));
    if (post.log) {
      const { logPost } = await import("./_social-stories.js");
      await logPost("telegram", post.log.slot, post.log.templateId, post.log.gameId);
    }
    return res.status(200).json({ ok: true, hour, messageId: id, template: post.log?.templateId });
  } catch (error) {
    console.error("Telegram bot error:", error);
    return res.status(500).json({ error: error.message });
  }
}

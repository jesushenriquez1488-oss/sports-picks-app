
/* CashEdge Fantasy Sports — UI preview only.
   No API calls, no Supabase, no Railway, no storage. */

(() => {
  "use strict";

  const POS = {
    nba: ["PG", "SG", "SF", "PF", "C"],
    nfl: ["QB", "RB", "WR", "TE", "DST"]
  };

  const SLOT = {
    "nba-draftkings": [
      "PG", "SG", "SF", "PF",
      "C", "G", "F", "UTIL"
    ],
    "nba-fanduel": [
      "PG1", "PG2", "SG1", "SG2",
      "SF1", "SF2", "PF1", "PF2", "C"
    ],
    "nfl-draftkings": [
      "QB", "RB1", "RB2", "WR1", "WR2",
      "WR3", "TE", "FLEX", "DST"
    ],
    "nfl-fanduel": [
      "QB", "RB1", "RB2", "WR1", "WR2",
      "WR3", "TE", "FLEX", "DEF"
    ]
  };

  // Fictional data for design testing only.
  function makeSamples(sport, platform) {
    const base = platform === "fanduel" ? 1100 : 0;

    return POS[sport].flatMap((pos, i) =>
      Array.from({ length: 6 }, (_, j) => ({
        id: `${sport}:${pos}:${j}`,
        name: `${pos} Sample ${j + 1}`,
        pos,
        team: "DEMO",
        salary: 9300 - j * 1000 + i * 120 + base,
        pts: +(43 - j * 5.1 + i * 1.1).toFixed(1),
        photoUrl: null
      }))
    );
  }

  function slotsOf(sport, platform) {
    return SLOT[`${sport}-${platform}`] || [];
  }

  function fits(player, slot, sport) {
    if (sport === "nba") {
      const type = slot.replace(/[12]$/g, "");

      return (
        type === player.pos ||
        type === "UTIL" ||
        (
          type === "G" &&
          ["PG", "SG"].includes(player.pos)
        ) ||
        (
          type === "F" &&
          ["SF", "PF"].includes(player.pos)
        )
      );
    }

    const type = slot.replace(/[123]$/g, "");

    return (
      type === (player.pos === "DST" ? "DEF" : player.pos) ||
      type === player.pos ||
      (
        type === "FLEX" &&
        ["RB", "WR", "TE"].includes(player.pos)
      )
    );
  }

  // Local slot validation. Not an optimizer.
  function assign(players, slots, sport) {
    const order = [...players].sort(
      (a, b) =>
        slots.filter(s => fits(a, s, sport)).length -
        slots.filter(s => fits(b, s, sport)).length
    );

    const used = new Set();
    const map = new Map();

    function walk(index) {
      if (index >= order.length) return true;

      const player = order[index];

      for (const slot of slots) {
        if (!used.has(slot) && fits(player, slot, sport)) {
          used.add(slot);
          map.set(slot, player);

          if (walk(index + 1)) return true;

          used.delete(slot);
          map.delete(slot);
        }
      }

      return false;
    }

    return walk(0) ? map : null;
  }

  function init(target, options = {}) {
    const root =
      typeof target === "string"
        ? document.querySelector(target)
        : target;

    if (!root) {
      throw new Error("Fantasy preview container not found");
    }

    const state = {
      sport: "nba",
      platform: "draftkings",
      tab: "recommendations",
      picked: [],
      locked: new Set(),
      modal: null,
      query: "",
      toast: ""
    };

    const cap = () =>
      state.platform === "draftkings" ? 50000 : 60000;

    const pool = () =>
      makeSamples(state.sport, state.platform);

    const slots = () =>
      slotsOf(state.sport, state.platform);

    const money = n =>
      "$" + n.toLocaleString("en-US");

    const total = () =>
      state.picked.reduce((sum, p) => sum + p.salary, 0);

    const score = () =>
      state.picked.reduce((sum, p) => sum + p.pts, 0);

    const assigned = () =>
      assign(state.picked, slots(), state.sport) ||
      new Map();

    const face = p => `
      <span class="face" aria-hidden="true">
        ${p.pos}
      </span>
    `;

    const row = p => `
      <div class="athlete">
        ${face(p)}

        <div class="athlete-text">
          <strong title="${p.name}">${p.name}</strong>
          <small>${p.team} · ${p.pos}</small>
        </div>

        <div class="athlete-stats">
          <strong>${p.pts.toFixed(1)}</strong>
          <small>${money(p.salary)}</small>
        </div>

        <button
          class="plus"
          data-action="add"
          data-id="${p.id}"
          aria-label="Add ${p.name}"
          ${state.picked.some(x => x.id === p.id)
            ? "disabled"
            : ""}
        >+</button>
      </div>
    `;

    function page() {
      const list = pool();
      const selected = assigned();
      const remainder = cap() - total();

      let content = "";

      if (state.tab === "recommendations") {
        content = `
          <div class="section-head">
            <h2>Top players by position</h2>
            <span class="tiny muted">3 per category · demo</span>
          </div>

          <div class="position-grid">
            ${POS[state.sport].map(pos => `
              <div class="box">
                <div class="pos-title">
                  ${pos}
                  <small>FPTS / SALARY</small>
                </div>

                ${list
                  .filter(p => p.pos === pos)
                  .slice(0, 3)
                  .map(row)
                  .join("")}

                <button
                  class="view"
                  data-action="all"
                  data-pos="${pos}"
                >
                  VIEW ALL ›
                </button>
              </div>
            `).join("")}
          </div>
        `;
      } else if (state.tab === "builder") {
        content = `
          <div class="section-head">
            <h2>My lineup builder</h2>
            <button class="tool" data-action="clear">
              Clear
            </button>
          </div>

          <div class="summary">
            <div class="metric">
              <b>${state.picked.length}/${slots().length}</b>
              <small>PLAYERS</small>
            </div>

            <div class="metric">
              <b>${money(remainder)}</b>
              <small>REMAINING</small>
            </div>

            <div class="metric">
              <b>${score().toFixed(1)}</b>
              <small>DEMO FPTS</small>
            </div>
          </div>

          <div class="lineup">
            ${slots().map(slot => {
              const p = selected.get(slot);

              return `
                <div class="slot">
                  <span class="slot-tag">${slot}</span>

                  <div class="slot-text">
                    ${p
                      ? `
                        <strong>${p.name}</strong>
                        <small>
                          ${money(p.salary)} ·
                          ${p.pts.toFixed(1)} demo points
                        </small>
                      `
                      : `<small>Available slot</small>`}
                  </div>

                  ${p
                    ? `
                      <button
                        class="tool ${state.locked.has(p.id)
                          ? "locked"
                          : ""}"
                        data-action="lock"
                        data-id="${p.id}"
                        title="Lock"
                      >
                        ${state.locked.has(p.id) ? "🔒" : "♧"}
                      </button>

                      <button
                        class="tool"
                        data-action="remove"
                        data-id="${p.id}"
                        title="Remove"
                      >×</button>
                    `
                    : `
                      <button
                        class="tool"
                        data-action="goto-rec"
                      >＋</button>
                    `}
                </div>
              `;
            }).join("")}
          </div>

          <p class="guide">
            Lock is part of the interface preview.
            It will become an optimizer constraint when
            the Railway service is connected.
          </p>
        `;
      } else {
        content = `
          <div class="section-head">
            <h2>Generated lineups</h2>
            <span class="tiny muted">Portfolio preview</span>
          </div>

          <div class="pending">
            <strong>Optimization not connected yet</strong>

            <p>
              CashEdge Optimal and 10 Alternatives will
              appear here after the Fantasy engine is
              connected. No fictional optimized results
              are displayed.
            </p>

            <button
              class="btn second"
              data-action="pending"
            >
              Generate 10 alternatives
            </button>
          </div>
        `;
      }

      root.innerHTML = `
        <div class="cfs">
          <div class="wrap">

            <header class="top">
              <button
                class="back"
                data-action="back"
                aria-label="Back to CashEdge"
              >‹</button>

              <div style="flex:1">
                <div class="eyebrow">
                  CASHEDGE · FANTASY LAB
                </div>
                <h1>Fantasy Sports</h1>
              </div>

              <span class="sample">DESIGN PREVIEW</span>
            </header>

            <div class="intro">
              <strong>
                Build smarter. Own your lineup.
              </strong>
              <div class="muted tiny">
                No sportsbook or Fantasy engine connected.
                All displayed player values are fictional.
              </div>
            </div>

            <div class="league">
              <div class="box">
                <p class="label">Sport</p>

                <div class="choice">
                  <button
                    data-action="sport"
                    data-value="nba"
                    class="${state.sport === "nba"
                      ? "active"
                      : ""}"
                  >NBA</button>

                  <button
                    data-action="sport"
                    data-value="nfl"
                    class="${state.sport === "nfl"
                      ? "active"
                      : ""}"
                  >NFL</button>
                </div>
              </div>

              <div class="box">
                <p class="label">Platform</p>

                <div class="choice">
                  <button
                    data-action="platform"
                    data-value="draftkings"
                    class="${state.platform === "draftkings"
                      ? "active"
                      : ""}"
                  >DK</button>

                  <button
                    data-action="platform"
                    data-value="fanduel"
                    class="${state.platform === "fanduel"
                      ? "active"
                      : ""}"
                  >FD</button>
                </div>
              </div>
            </div>

            <div class="box contest">
              <div>
                <p class="label">Contest preview</p>
                <strong>
                  ${state.sport.toUpperCase()} ·
                  ${state.platform === "draftkings"
                    ? "DraftKings"
                    : "FanDuel"}
                </strong>
                <div class="muted">
                  Classic salary cap ·
                  ${slots().length} positions
                </div>
              </div>

              <div class="cap">
                <span>${money(cap())}</span>
              </div>
            </div>

            <div class="actions">
              <button
                class="btn main"
                data-action="pending"
              >
                ✦ CashEdge Optimal
              </button>

              <button
                class="btn second"
                data-action="goto-builder"
              >
                ＋ Build My Lineup
              </button>
            </div>

            <nav class="tabs" aria-label="Fantasy sections">
              <button
                data-action="tab"
                data-value="recommendations"
                class="${state.tab === "recommendations"
                  ? "on"
                  : ""}"
              >Recommendations</button>

              <button
                data-action="tab"
                data-value="builder"
                class="${state.tab === "builder"
                  ? "on"
                  : ""}"
              >
                My Builder · ${state.picked.length}
              </button>

              <button
                data-action="tab"
                data-value="lineups"
                class="${state.tab === "lineups"
                  ? "on"
                  : ""}"
              >My Lineups</button>
            </nav>

            ${content}

            <div class="dock">
              <div style="flex:1;min-width:0">
                <div class="tiny muted">
                  ${state.picked.length}/${slots().length}
                  players · ${money(remainder)} left
                </div>

                <div class="bar">
                  <span style="width:${Math.min(
                    100,
                    total() / cap() * 100
                  ).toFixed(2)}%"></span>
                </div>

                <strong>
                  ${score().toFixed(1)} demo FPTS
                </strong>
              </div>

              <button data-action="goto-builder">
                View lineup ›
              </button>
            </div>

          </div>

          ${state.modal ? modalHTML() : ""}

          ${state.toast
            ? `
              <div class="toast" role="status">
                ${state.toast}
              </div>
            `
            : ""}
        </div>
      `;
    }

    function filterModalRows() {
      return pool()
        .filter(p =>
          p.pos === state.modal &&
          p.name.toLowerCase().includes(
            state.query.toLowerCase()
          )
        )
        .map(row)
        .join("") ||
        "<p class='muted'>No matching players.</p>";
    }

    function modalHTML() {
      const pos = state.modal;

      return `
        <div class="shade" data-action="close-shade">
          <section
            class="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="All ${pos} players"
          >
            <div class="sheet-top">
              <div>
                <div class="eyebrow">
                  ${pos} · ALL PLAYERS
                </div>
                <strong>Player selection</strong>
              </div>

              <button
                class="tool"
                data-action="close"
              >Close ×</button>
            </div>

            <input
              id="cfs-search"
              placeholder="Search players..."
              autocomplete="off"
              value="${state.query.replace(/"/g, "")}"
            >

            <div id="cfs-results" class="all-rows">
              ${filterModalRows()}
            </div>
          </section>
        </div>
      `;
    }

    function flash(message) {
      state.toast = message;
      page();

      setTimeout(() => {
        state.toast = "";

        const element = root.querySelector(".toast");

        if (element) element.remove();
      }, 2400);
    }

    function addPlayer(playerId) {
      const p = pool().find(x => x.id === playerId);

      if (!p) return;

      if (state.picked.some(x => x.id === playerId)) {
        return flash("Player already selected.");
      }

      if (total() + p.salary > cap()) {
        return flash(
          "This selection exceeds the salary cap."
        );
      }

      const candidateLineup = [
        ...state.picked,
        p
      ];

      if (!assign(
        candidateLineup,
        slots(),
        state.sport
      )) {
        return flash(
          "No compatible open roster slot."
        );
      }

      state.picked.push(p);
      page();
    }

    root.addEventListener("click", event => {
      const button =
        event.target.closest("[data-action]");

      if (!button || !root.contains(button)) return;

      const action = button.dataset.action;
      const value = button.dataset.value;

      if (
        action === "close-shade" &&
        event.target !== button
      ) {
        return;
      }

      if (action === "back") {
        if (typeof options.onClose === "function") {
          options.onClose();
        } else {
          flash(
            "The Back button will return to CashEdge after integration."
          );
        }
        return;
      }

      if (
        action === "sport" ||
        action === "platform"
      ) {
        if (state[action] !== value) {
          state[action] = value;
          state.picked = [];
          state.locked.clear();
          state.modal = null;
          state.query = "";
        }

        page();
        return;
      }

      if (action === "tab") {
        state.tab = value;
      } else if (action === "goto-builder") {
        state.tab = "builder";
      } else if (action === "goto-rec") {
        state.tab = "recommendations";
      } else if (action === "all") {
        state.modal = button.dataset.pos;
        state.query = "";
      } else if (
        action === "close" ||
        action === "close-shade"
      ) {
        state.modal = null;
        state.query = "";
      } else if (action === "add") {
        addPlayer(button.dataset.id);
        return;
      } else if (action === "remove") {
        state.picked = state.picked.filter(
          p => p.id !== button.dataset.id
        );
        state.locked.delete(button.dataset.id);
      } else if (action === "lock") {
        const id = button.dataset.id;

        if (state.locked.has(id)) {
          state.locked.delete(id);
        } else {
          state.locked.add(id);
        }
      } else if (action === "clear") {
        state.picked = [];
        state.locked.clear();
      } else if (action === "pending") {
        return flash(
          "CashEdge optimization will activate when Railway is connected."
        );
      }

      page();
    });

    root.addEventListener("input", event => {
      if (event.target.id !== "cfs-search") {
        return;
      }

      state.query = event.target.value;

      const results =
        root.querySelector("#cfs-results");

      if (results) {
        results.innerHTML = filterModalRows();
      }
    });

    page();

    return {
      destroy() {
        root.replaceChildren();
      }
    };
  }

  window.CashEdgeFantasyUI = {
    mount: init
  };
})();

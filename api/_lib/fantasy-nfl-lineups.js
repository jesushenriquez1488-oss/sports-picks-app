// ============================================================
// CASHEDGE FANTASY NFL — OPTIMIZADOR DE ALINEACIONES
// ============================================================
//
// Mismo optimizador EXACTO de NBA (no adivina: busca la
// combinacion con mas puntos que cumple todas las reglas),
// con las reglas de NFL:
//
//   DraftKings Classic : QB, RB, RB, WR, WR, WR, TE, FLEX, DST
//                        $50,000 | jugadores de al menos 2 partidos
//   FanDuel Full Roster: QB, RB, RB, WR, WR, WR, TE, FLEX, DEF
//                        $60,000 | maximo 4 del mismo equipo |
//                        al menos 3 equipos distintos
//   FLEX = RB, WR o TE.
//
// Varias alineaciones: la #1 es la optima; la #2 la mejor que
// cambia al menos N jugadores respecto a la #1; etc.
//
// Archivo con "_" al inicio: Vercel NO lo publica como endpoint.
// ============================================================

"use strict";

const FLEX = ["RB", "WR", "TE"];

const RULES = {
  draftkings: {
    salaryCap: 50000,
    slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
    eligible: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX, DST: ["DST"] },
    minGames: 2
  },
  fanduel: {
    salaryCap: 60000,
    slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
    eligible: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX, DST: ["DST"] },
    minGames: 1,
    minTeams: 3,
    maxPerTeam: 4
  }
};

// ¿Se pueden acomodar estos jugadores en las posiciones?
// Devuelve la asignacion o null.
function assignSlots(players, rule) {
  const slots = rule.slots;
  const slotOf = new Array(slots.length).fill(-1);
  const canPlay = (p, s) => rule.eligible[slots[s]].some(pos => p.positions.includes(pos));

  const tryPlace = (pi, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !canPlay(players[pi], s)) continue;
      seen[s] = true;
      if (slotOf[s] === -1 || tryPlace(slotOf[s], seen)) {
        slotOf[s] = pi;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < players.length; i++) {
    if (!tryPlace(i, new Array(slots.length).fill(false))) return null;
  }
  return slotOf;
}

// Cupos de cada posicion en la alineacion (DK y FD iguales):
// minimo por posicion + 1 FLEX que puede ser RB, WR o TE.
// Orden de busqueda: primero las posiciones de 1 o 2 cupos (QB, DST,
// TE) y luego RB y WR. Asi el limite superior poda muchisimo antes
// (medido: 10 alineaciones en ~1 segundo con 140 jugadores).
const GROUPS = ["QB", "DST", "TE", "RB", "WR"];
const MIN_NEED = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 };
const FLEX_GROUPS = ["RB", "WR", "TE"];
const TOPK = 4;

function solveOne(pool, rule, previous, minDifferent, nodeLimit) {
  const size = rule.slots.length;
  const maxShared = size - minDifferent;
  const n = pool.length;
  const gIndex = pool.map(p => GROUPS.indexOf(p.positions[0]));

  const minSalary = [];
  for (let i = 0; i <= n; i++) {
    const rest = pool.slice(i).map(p => p.salary).sort((a, b) => a - b);
    const row = [0];
    for (let k = 1; k <= size; k++) row.push(k <= rest.length ? row[k - 1] + rest[k - 1] : Infinity);
    minSalary.push(row);
  }

  // LIMITE SUPERIOR por posicion (relajacion de Lagrange del salario):
  // para un "precio por dolar" L, lo maximo que se puede sumar es
  //   L*presupuesto + mejores (puntos - L*salario) de CADA posicion que
  //   falta llenar + el mejor FLEX posible.
  // Nunca subestima, asi que podar con el es seguro (resultado exacto).
  const ratios = pool.map(p => p.points / p.salary).sort((a, b) => a - b);
  const q = f => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))] || 0;
  const lambdas = [0, q(0.2), q(0.4), q(0.5), q(0.6), q(0.75), q(0.9)];

  // top[l][g][i] = mejores TOPK valores del grupo g desde la posicion i.
  const top = lambdas.map(L => {
    const byGroup = GROUPS.map(() => new Array(n + 1));
    const cur = GROUPS.map(() => []);
    for (let g = 0; g < GROUPS.length; g++) byGroup[g][n] = [];
    for (let i = n - 1; i >= 0; i--) {
      const g = gIndex[i];
      const v = pool[i].points - L * pool[i].salary;
      const list = cur[g].slice();
      let k = list.findIndex(x => v > x);
      if (k === -1) k = list.length;
      list.splice(k, 0, v);
      if (list.length > TOPK) list.pop();
      cur[g] = list;
      for (let h = 0; h < GROUPS.length; h++) byGroup[h][i] = cur[h];
    }
    return byGroup;
  });

  const counts = [0, 0, 0, 0, 0];
  const upperBound = (i, budget) => {
    const need = GROUPS.map((g, k) => Math.max(0, MIN_NEED[g] - counts[k]));
    const extra = FLEX_GROUPS.reduce((s, x) => { const k = GROUPS.indexOf(x); return s + Math.max(0, counts[k] - MIN_NEED[x]); }, 0);
    const flexLeft = Math.max(0, 1 - extra);
    let best = Infinity;
    for (let t = 0; t < lambdas.length; t++) {
      let v = lambdas[t] * budget;
      for (let g = 0; g < GROUPS.length; g++) {
        const list = top[t][g][i];
        if (list.length < need[g]) return -Infinity;     // ya no se puede llenar
        for (let k = 0; k < need[g]; k++) v += list[k];
      }
      if (flexLeft) {
        let f = -Infinity;
        for (const g of FLEX_GROUPS.map(x => GROUPS.indexOf(x))) {
          const list = top[t][g][i];
          if (list.length > need[g]) f = Math.max(f, list[need[g]]);
        }
        if (f === -Infinity) return -Infinity;
        v += f;
      }
      if (v < best) best = v;
    }
    return best;
  };

  const maxOf = { QB: 1, RB: 3, WR: 4, TE: 2, DST: 1 };
  const previousSets = previous.map(l => new Set(l.map(p => p.id)));
  let best = null;
  let bestPoints = -Infinity;
  let nodes = 0;
  let complete = true;
  const chosen = [];

  const search = (i, salary, points) => {
    if (++nodes > nodeLimit) {
      complete = false;
      return;
    }
    const need = size - chosen.length;
    if (need === 0) {
      if (new Set(chosen.map(p => p.gameId)).size < rule.minGames) return;
      if (rule.minTeams && new Set(chosen.map(p => p.team)).size < rule.minTeams) return;
      if (points > bestPoints) {
        const slots = assignSlots(chosen, rule);
        if (slots) {
          bestPoints = points;
          best = { players: [...chosen], slots };
        }
      }
      return;
    }
    if (n - i < need) return;
    if (salary + minSalary[i][need] > rule.salaryCap) return;
    const budget = rule.salaryCap - salary;
    if (points + upperBound(i, budget) <= bestPoints + 1e-9) return;

    for (let j = i; j < n; j++) {
      if (n - j < need) break;
      if (points + upperBound(j, budget) <= bestPoints + 1e-9) break;
      const p = pool[j];
      const g = gIndex[j];
      if (salary + p.salary > rule.salaryCap) continue;
      if (counts[g] >= maxOf[GROUPS[g]]) continue;
      // FLEX: solo uno de los tres grupos puede pasar su minimo.
      if (FLEX_GROUPS.includes(GROUPS[g]) && counts[g] >= MIN_NEED[GROUPS[g]]) {
        const extra = FLEX_GROUPS.reduce((s, x) => { const k = GROUPS.indexOf(x); return s + Math.max(0, counts[k] - MIN_NEED[x]); }, 0);
        if (extra >= 1) continue;
      }

      chosen.push(p);
      counts[g]++;
      const ok = (!rule.maxPerTeam || chosen.filter(c => c.team === p.team).length <= rule.maxPerTeam) &&
        previousSets.every(set => chosen.filter(c => set.has(c.id)).length <= maxShared);
      if (ok) search(j + 1, salary + p.salary, points + p.points);
      counts[g]--;
      chosen.pop();
      if (!complete) return;
    }
  };

  search(0, 0, 0);
  return { best, nodes, complete };
}

// players: [{ id, name, salary, points, positions:[QB|RB|WR|TE|DST], gameId, team }]
// maxExposure: parte maxima de las alineaciones en que puede salir un
// mismo jugador (0.4 = 40%: con 10 alineaciones, maximo 4). Asi una
// lesion o una paliza no hunde todas las alineaciones.
function buildLineups(platform, players, { count = 10, minDifferent = 2, nodeLimit = 5e6, maxExposure = 1 } = {}) {
  const rule = RULES[platform];
  if (!rule) return { status: "PLATAFORMA_NO_SOPORTADA", lineups: [] };

  const pool = players
    .filter(p => p.salary > 0 && p.points > 0 && p.positions?.length)
    .map(p => ({ ...p, positions: p.positions.map(x => String(x).toUpperCase()) }))
    .sort((a, b) => GROUPS.indexOf(a.positions[0]) - GROUPS.indexOf(b.positions[0]) || b.points - a.points || a.salary - b.salary);

  const lineups = [];
  let allOptimal = true;

  const maxUses = Math.max(1, Math.floor(maxExposure * count + 1e-9));
  const uses = new Map();

  for (let k = 0; k < count; k++) {
    const available = pool.filter(p => (uses.get(p.id) || 0) < maxUses);
    const r = solveOne(available, rule, lineups.map(l => l.players), minDifferent, nodeLimit);
    if (!r.complete) allOptimal = false;
    if (!r.best) break;

    const ordered = r.best.slots.map((pi, s) => ({ slot: rule.slots[s], ...r.best.players[pi] }));
    for (const pl of r.best.players) uses.set(pl.id, (uses.get(pl.id) || 0) + 1);
    lineups.push({
      number: k + 1,
      players: ordered,
      salary: ordered.reduce((sum, p) => sum + p.salary, 0),
      points: Math.round(ordered.reduce((sum, p) => sum + p.points, 0) * 100) / 100,
      optimal: r.complete,
      nodes: r.nodes
    });
  }

  return {
    status: lineups.length ? "OK" : "SIN_SOLUCION",
    optimal: allOptimal,
    salaryCap: rule.salaryCap,
    lineups
  };
}

module.exports = { buildLineups, assignSlots, RULES };

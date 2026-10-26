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
// buildStackLineups (opcion): cada alineacion se arma alrededor de
// un STACK = QB + sus receptores (WR/TE). Medido 2022-2026: QB y su
// WR1 se mueven juntos (correlacion 0.40). Cada stack recibe
// alineaciones segun su probabilidad de ser el mejor del slate; uno
// con probabilidad casi cero no recibe ninguna. Ademas: nunca una
// defensa contra jugadores de la propia alineacion.
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

// forced: jugadores que YA van en la alineacion (el stack).
// noDstVsOwn: rechaza una DST cuyo rival tenga jugadores en la alineacion.
function solveOne(pool, rule, previous, minDifferent, nodeLimit, forced = [], noDstVsOwn = false) {
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
  for (const f of forced) counts[GROUPS.indexOf(f.positions[0])]++;
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
  const chosen = [...forced];

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
      const dst = noDstVsOwn ? chosen.find(c => c.positions[0] === "DST") : null;
      const dstOk = !dst || !chosen.some(c => c !== dst && c.opp === dst.team);
      const ok = dstOk && (!rule.maxPerTeam || chosen.filter(c => c.team === p.team).length <= rule.maxPerTeam) &&
        previousSets.every(set => chosen.filter(c => set.has(c.id)).length <= maxShared);
      if (ok) search(j + 1, salary + p.salary, points + p.points);
      counts[g]--;
      chosen.pop();
      if (!complete) return;
    }
  };

  search(0, forced.reduce((s, f) => s + f.salary, 0), forced.reduce((s, f) => s + f.points, 0));
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

// ============================================================
// ALINEACIONES CON STACK (QB + receptores)
// ============================================================
// 1) Bloque de cada equipo: su QB + sus 3 mejores receptores (WR/TE).
//    Valor del bloque = QB + los 2 mejores receptores.
// 2) Probabilidad de que cada bloque sea el MEJOR del slate:
//    simulacion con el error medido de un bloque (16.8 pts DK,
//    QB + 2 receptores, 1,922 bloques 2022-2026).
// 3) Cada bloque recibe alineaciones en proporcion a esa probabilidad
//    (resto mayor). Si le toca menos de media alineacion: cero.
// 4) Dentro del bloque se alterna: QB + 2 receptores (rotando el par),
//    luego QB + 1 receptor (el resto libre), y asi.
// 5) El resto lo llena el optimizador exacto. Nunca una DST contra
//    jugadores de la propia alineacion. Tope de exposicion para
//    todos menos los del stack (al QB lo limita su cuota).
// players: igual que buildLineups + opp (rival).

const STACK_SD = 16.8;

// Generador fijo: misma entrada -> mismas alineaciones.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStackLineups(platform, players, { count = 10, minDifferent = 2, nodeLimit = 5e6, maxExposure = 1, sims = 20000, sd = STACK_SD, seed = 12345 } = {}) {
  const rule = RULES[platform];
  if (!rule) return { status: "PLATAFORMA_NO_SOPORTADA", lineups: [] };

  const pool = players
    .filter(p => p.salary > 0 && p.points > 0 && p.positions?.length)
    .map(p => ({ ...p, positions: p.positions.map(x => String(x).toUpperCase()) }))
    .sort((a, b) => GROUPS.indexOf(a.positions[0]) - GROUPS.indexOf(b.positions[0]) || b.points - a.points || a.salary - b.salary);

  // ---- 1) Bloques ----
  const stacks = [];
  for (const team of new Set(pool.filter(p => p.positions[0] === "QB").map(p => p.team))) {
    const qb = pool.filter(p => p.team === team && p.positions[0] === "QB").sort((a, b) => b.points - a.points)[0];
    const rec = pool.filter(p => p.team === team && (p.positions[0] === "WR" || p.positions[0] === "TE"))
      .sort((a, b) => b.points - a.points).slice(0, 3);
    if (rec.length < 2) continue;
    stacks.push({ team, qb, rec, value: qb.points + rec[0].points + rec[1].points, prob: 0, quota: 0 });
  }
  if (!stacks.length) return { ...buildLineups(platform, players, { count, minDifferent, nodeLimit, maxExposure }), stacks: [] };

  // ---- 2) Probabilidad de ser el mejor bloque ----
  const rand = seededRandom(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const wins = stacks.map(() => 0);
  for (let s = 0; s < sims; s++) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < stacks.length; i++) {
      const v = stacks[i].value + sd * gauss();
      if (v > bv) { bv = v; bi = i; }
    }
    wins[bi]++;
  }
  stacks.forEach((st, i) => { st.prob = wins[i] / sims; });

  // ---- 3) Cuota de alineaciones ----
  // Un bloque al que le toca menos de media alineacion queda fuera;
  // su parte se reparte entre los que si entran (resto mayor).
  const eligible = stacks.map(st => st.prob * count >= 0.5);
  if (!eligible.some(Boolean)) eligible[stacks.reduce((bi, st, i) => (st.prob > stacks[bi].prob ? i : bi), 0)] = true;
  const probIn = stacks.reduce((s, st, i) => s + (eligible[i] ? st.prob : 0), 0);
  const raw = stacks.map((st, i) => (eligible[i] ? (st.prob / probIn) * count : 0));
  const quota = raw.map(Math.floor);
  const left = count - quota.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i])
    .filter(([, i]) => eligible[i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, left)
    .forEach(([, i]) => { quota[i]++; });
  stacks.forEach((st, i) => { st.quota = quota[i]; });
  stacks.sort((a, b) => b.prob - a.prob);

  // ---- 4) y 5) Alineaciones ----
  const maxUses = Math.max(1, Math.floor(maxExposure * count + 1e-9));
  const uses = new Map();
  const built = [];
  let allOptimal = true;
  const pairsOf = r => (r.length >= 3 ? [[r[0], r[1]], [r[0], r[2]], [r[1], r[2]]] : [[r[0], r[1]]]);

  const free = p => (uses.get(p.id) || 0) < maxUses;
  // Arma UNA alineacion del bloque st (turno k). Devuelve true si salio.
  const buildOne = (st, k) => {
    const pairs = pairsOf(st.rec);
    // Receptores: el turno que toca; si alguno ya llego al tope de
    // exposicion, la siguiente opcion del mismo bloque que este libre.
    const options = k % 2 === 0
      ? pairs.map((_, j) => pairs[(k / 2 + j) % pairs.length])
      : st.rec.slice(0, 2).map((_, j) => [st.rec[((k - 1) / 2 + j) % 2]]);
    const rec = options.find(o => o.every(free));
    if (!rec) return false;
    const forced = [st.qb, ...rec];
    const fid = new Set(forced.map(p => p.id));
    const available = pool.filter(p => !fid.has(p.id) && p.positions[0] !== "QB" && free(p));
    const r = solveOne(available, rule, built.map(l => l.raw), minDifferent, nodeLimit, forced, true);
    if (!r.complete) allOptimal = false;
    if (!r.best) return false;

    // El QB no cuenta: a el lo limita la cuota de su bloque.
    for (const pl of r.best.players) if (pl.id !== st.qb.id) uses.set(pl.id, (uses.get(pl.id) || 0) + 1);
    const ordered = r.best.slots.map((pi, s) => ({ slot: rule.slots[s], ...r.best.players[pi] }));
    built.push({
      raw: r.best.players,
      players: ordered,
      salary: ordered.reduce((sum, p) => sum + p.salary, 0),
      points: Math.round(ordered.reduce((sum, p) => sum + p.points, 0) * 100) / 100,
      optimal: r.complete,
      nodes: r.nodes,
      stack: { team: st.team, qb: st.qb.name, receivers: forced.slice(1).map(p => p.name) }
    });
    st.built = (st.built || 0) + 1;
    return true;
  };

  // Primero la cuota de cada bloque.
  for (const st of stacks) {
    st.built = 0;
    for (let k = 0; k < st.quota; k++) buildOne(st, st.built);
  }
  // Si un bloque no pudo completar su cuota (sus receptores llegaron
  // al tope), esas alineaciones pasan a los bloques que si entraron,
  // del mas probable al menos probable.
  const inPlay = stacks.filter(st => st.quota > 0);
  let progress = true;
  while (built.length < count && progress) {
    progress = false;
    for (const st of inPlay) {
      if (built.length >= count) break;
      if (buildOne(st, st.built)) progress = true;
    }
  }

  // La #1 = la de mas puntos proyectados.
  built.sort((a, b) => b.points - a.points);
  const lineups = built.map((l, i) => ({ number: i + 1, players: l.players, salary: l.salary, points: l.points, optimal: l.optimal, nodes: l.nodes, stack: l.stack }));

  return {
    status: lineups.length ? "OK" : "SIN_SOLUCION",
    optimal: allOptimal,
    salaryCap: rule.salaryCap,
    lineups,
    stacks: stacks.map(st => ({
      team: st.team, qb: st.qb.name, receivers: st.rec.map(p => p.name),
      value: Math.round(st.value * 100) / 100, prob: Math.round(st.prob * 1000) / 1000, lineups: st.built
    }))
  };
}

module.exports = { buildLineups, buildStackLineups, assignSlots, RULES };

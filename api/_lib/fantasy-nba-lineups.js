// ============================================================
// CASHEDGE FANTASY NBA — OPTIMIZADOR DE ALINEACIONES
// ============================================================
//
// Optimizador EXACTO (no adivina): busca la combinacion con mas
// puntos proyectados que cumple todas las reglas de la casa.
// Se verifico contra OR-Tools (el motor de multi_solver.py) y
// da el mismo optimo.
//
// Varias alineaciones: la #1 es la optima. La #2 es la mejor
// que cambia al menos N jugadores respecto a la #1, la #3 la
// mejor que cambia al menos N respecto a la #1 y la #2, etc.
//
// Archivo con "_" al inicio: Vercel NO lo publica como endpoint.
// ============================================================

const RULES = {
  draftkings: {
    salaryCap: 50000,
    slots: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
    eligible: {
      PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"],
      G: ["PG", "SG"], F: ["SF", "PF"], UTIL: ["PG", "SG", "SF", "PF", "C"]
    },
    minGames: 2
  },
  // FanDuel NBA "Full Roster": 9 jugadores, $60,000,
  // maximo 4 del mismo equipo, al menos 3 equipos distintos.
  fanduel: {
    salaryCap: 60000,
    slots: ["PG", "PG", "SG", "SG", "SF", "SF", "PF", "PF", "C"],
    eligible: {
      PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"]
    },
    minGames: 1,
    minTeams: 3,
    maxPerTeam: 4
  }
};

// ¿Se pueden acomodar estos jugadores en las posiciones?
// (emparejamiento jugador-posicion). Devuelve la asignacion o null.
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

function solveOne(pool, rule, previous, minDifferent, nodeLimit) {
  const size = rule.slots.length;
  const maxShared = size - minDifferent;
  const n = pool.length;

  // Ordenados de mas a menos puntos: la mejor solucion aparece
  // pronto y el limite superior poda casi todo lo demas.
  const prefix = [0];
  for (const p of pool) prefix.push(prefix[prefix.length - 1] + p.points);

  // Salario minimo para completar k jugadores desde la posicion i.
  const minSalary = [];
  for (let i = 0; i <= n; i++) {
    const rest = pool.slice(i).map(p => p.salary).sort((a, b) => a - b);
    const row = [0];
    for (let k = 1; k <= size; k++) row.push(k <= rest.length ? row[k - 1] + rest[k - 1] : Infinity);
    minSalary.push(row);
  }

  // Limite superior que SI mira el salario (relajacion de Lagrange):
  // para cualquier "precio por dolar" L, la mejor alineacion posible
  // nunca supera  L*presupuesto + suma de los k mejores (puntos - L*salario).
  // Se precalcula para cada punto de la lista y cada k.
  const ratios = pool.map(p => p.points / p.salary).sort((a, b) => a - b);
  const q = f => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))] || 0;
  const lambdas = [0, q(0.2), q(0.4), q(0.5), q(0.6), q(0.75), q(0.9)];
  const suffixTop = lambdas.map(L => {
    const table = [];
    for (let i = 0; i <= n; i++) {
      const vals = pool.slice(i).map(p => p.points - L * p.salary).sort((a, b) => b - a);
      const row = [0];
      for (let k = 1; k <= size; k++) row.push(k <= vals.length ? row[k - 1] + vals[k - 1] : -Infinity);
      table.push(row);
    }
    return table;
  });
  const upperBound = (i, k, budget) => {
    let b = Infinity;
    for (let t = 0; t < lambdas.length; t++) {
      const v = lambdas[t] * budget + suffixTop[t][i][k];
      if (v < b) b = v;
    }
    return b;
  };

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
      const games = new Set(chosen.map(p => p.gameId));
      if (games.size < rule.minGames) return;
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
    // Limite superior: los "need" mejores que quedan (sin mirar salario).
    // Si ni asi se supera la mejor encontrada, no se sigue.
    if (points + (prefix[i + need] - prefix[i]) <= bestPoints + 1e-9) return;
    if (salary + minSalary[i][need] > rule.salaryCap) return;
    const budget = rule.salaryCap - salary;
    if (points + upperBound(i, need, budget) <= bestPoints + 1e-9) return;

    for (let j = i; j < n; j++) {
      if (n - j < need) break;
      // El limite solo baja al avanzar en la lista: se puede cortar.
      if (points + upperBound(j, need, budget) <= bestPoints + 1e-9) break;
      const p = pool[j];
      if (salary + p.salary > rule.salaryCap) continue;

      chosen.push(p);
      // Poda temprana: las posiciones deben seguir siendo posibles
      // y no repetir demasiado una alineacion anterior.
      const ok = (!rule.maxPerTeam || chosen.filter(c => c.team === p.team).length <= rule.maxPerTeam) &&
        assignSlots(chosen, rule) &&
        previousSets.every(set => chosen.filter(c => set.has(c.id)).length <= maxShared);
      if (ok) search(j + 1, salary + p.salary, points + p.points);
      chosen.pop();
      if (!complete) return;
    }
  };

  search(0, 0, 0);
  return { best, nodes, complete };
}

// players: [{ id, name, salary, points, positions:[...], gameId, team }]
// maxExposure: parte maxima de las alineaciones en que puede salir un
// mismo jugador (0.4 = 40%: con 10 alineaciones, maximo 4). Asi una
// lesion o una paliza no hunde todas las alineaciones.
function buildLineups(platform, players, { count = 10, minDifferent = 2, nodeLimit = 5e6, maxExposure = 1 } = {}) {
  const rule = RULES[platform];
  if (!rule) return { status: "PLATAFORMA_NO_SOPORTADA", lineups: [] };

  const pool = players
    .filter(p => p.salary > 0 && p.points > 0 && p.positions?.length)
    .map(p => ({ ...p, positions: p.positions.map(x => String(x).toUpperCase()) }))
    .sort((a, b) => b.points - a.points || a.salary - b.salary);

  const lineups = [];
  let allOptimal = true;

  const maxUses = Math.max(1, Math.floor(maxExposure * count + 1e-9));
  const uses = new Map();

  for (let k = 0; k < count; k++) {
    const available = pool.filter(p => (uses.get(p.id) || 0) < maxUses);
    const r = solveOne(available, rule, lineups.map(l => l.players), minDifferent, nodeLimit);
    if (!r.complete) allOptimal = false;
    if (!r.best) break;

    const players = r.best.slots.map((pi, s) => ({ slot: rule.slots[s], ...r.best.players[pi] }));
    for (const pl of r.best.players) uses.set(pl.id, (uses.get(pl.id) || 0) + 1);
    lineups.push({
      number: k + 1,
      players,
      salary: players.reduce((sum, p) => sum + p.salary, 0),
      points: Math.round(players.reduce((sum, p) => sum + p.points, 0) * 100) / 100,
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

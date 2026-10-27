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
// REGLAS NUEVAS (27-oct, aprobadas):
//  1. Titular y su suplente de la MISMA posicion nunca van juntos
//     (se reparten los mismos minutos). Opcion: noStarterBackup.
//  2. Pilas en los partidos mas rapidos DEL SLATE DE HOY (se
//     comparan solo entre ellos, nunca contra la liga):
//     - el MAS RAPIDO del slate (MUY_RAPIDO): su nucleo (2 estrellas
//       de un equipo + la estrella rival) va en la MITAD de las
//       alineaciones; esos 3 jugadores pueden llegar al 50%.
//     - los demas de la mitad rapida (RAPIDO): las otras alineaciones
//       llevan una pareja de ellos (2 titulares del mismo equipo, o
//       estrella vs estrella si el partido se espera parejo).
//     - El resto de cada alineacion lo completa el optimizador con
//       los que mas proyectan (no al azar).
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

// Puntos extra (solo internos) para obligar a que entren los
// jugadores de la pila. Se quitan antes de devolver la alineacion.
const FORCE_BONUS = 1000;

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

// Regla 1: ¿a es titular y b es su suplente de esa misma posicion?
// startPos = posicion del titular en el depth chart (PG, SG...).
// backupOf = posiciones donde el suplente aparece en el depth chart.
function isStarterAndBackup(a, b) {
  return a.team === b.team &&
    a.starter === true && b.starter === false &&
    !!a.startPos && Array.isArray(b.backupOf) && b.backupOf.includes(a.startPos);
}
function starterBackupConflict(chosen, p) {
  for (const c of chosen) {
    if (c === p) continue;
    if (isStarterAndBackup(c, p) || isStarterAndBackup(p, c)) return true;
  }
  return false;
}

function solveOne(pool, rule, previous, minDifferent, nodeLimit, check = null) {
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

  // Para cada jugador: en que alineaciones anteriores aparece.
  // Se lleva la cuenta al vuelo (rapido con 150+ alineaciones);
  // misma regla que antes: ninguna anterior puede repetir mas de
  // maxShared jugadores.
  const inPrevious = new Map();
  previous.forEach((l, idx) => {
    for (const p of l) {
      if (!inPrevious.has(p.id)) inPrevious.set(p.id, []);
      inPrevious.get(p.id).push(idx);
    }
  });
  const shared = new Int16Array(previous.length);
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
      const prevList = inPrevious.get(p.id) || [];
      let repeats = false;
      for (const idx of prevList) if (++shared[idx] > maxShared) repeats = true;
      // Poda temprana: las posiciones deben seguir siendo posibles,
      // no repetir demasiado una alineacion anterior y cumplir las
      // reglas extra (titular/suplente).
      const ok = !repeats &&
        (!rule.maxPerTeam || chosen.filter(c => c.team === p.team).length <= rule.maxPerTeam) &&
        (!check || check(chosen, p)) &&
        assignSlots(chosen, rule);
      if (ok) search(j + 1, salary + p.salary, points + p.points);
      for (const idx of prevList) shared[idx]--;
      chosen.pop();
      if (!complete) return;
    }
  };

  search(0, 0, 0);
  return { best, nodes, complete };
}

// ------------------------------------------------------------
// PLAN DE PILAS (partidos rapidos)
// games: [{ gameId, cls: "MUY_RAPIDO"|"RAPIDO"|"NORMAL"|"LENTO",
//           teams: [teamA, teamB], close: bool, pace }]
// Devuelve { core: { ids, names, gameId, lineups } | null,
//            pairs: [{ ids, names, gameId, tipo }], resumen }
// ------------------------------------------------------------
function planStacks(players, games, count, { coreShare = 0.5, platform = "draftkings" } = {}) {
  const rule = RULES[platform] || RULES.draftkings;
  const pool = players
    .filter(p => p.salary > 0 && p.points > 0 && p.positions?.length)
    .map(p => ({ ...p, positions: p.positions.map(x => String(x).toUpperCase()) }));
  const topStarters = (team, k) => pool
    .filter(p => p.team === team && p.starter === true)
    .sort((a, b) => b.points - a.points)
    .slice(0, k);
  // ¿Caben juntos en las posiciones de esta casa? (ej. FanDuel tiene
  // UN solo C: dos pivots no pueden ir juntos).
  const fits = list => !!assignSlots(list, rule);
  const asStack = (list, gameId, tipo) => ({
    ids: list.map(p => p.id),
    names: list.map(p => p.name),
    gameId,
    tipo,
    value: list.reduce((s, p) => s + p.points, 0)
  });

  const fast = games
    .filter(g => g.cls === "MUY_RAPIDO" || g.cls === "RAPIDO")
    .sort((a, b) => b.pace - a.pace);
  if (!fast.length) return { core: null, pairs: [], resumen: "Sin partidos rapidos: se arma normal" };

  // Parejas de un partido: 2 titulares del mismo equipo (entre sus 3
  // mejores) y, en partido parejo o el mas rapido, estrella vs estrella.
  const pairsOf = g => {
    const [a, b] = g.teams;
    const out = [];
    for (const t of [a, b]) {
      const top = topStarters(t, 3);
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) out.push(asStack([top[i], top[j]], g.gameId, "2 del mismo equipo"));
      }
    }
    // Estrella vs estrella (medido: explotan juntas 1.29x en parejos
    // y 1.34x en total alto).
    if (g.close || g.cls === "MUY_RAPIDO") {
      const ta = topStarters(a, 2);
      const tb = topStarters(b, 2);
      for (const x of ta) for (const y of tb) out.push(asStack([x, y], g.gameId, "estrella vs estrella"));
    }
    return out.filter(st => fits(pool.filter(p => st.ids.includes(p.id))));
  };

  // NUCLEO del partido mas rapido: 2 estrellas de un equipo + la
  // estrella rival. Se prueban todas las combinaciones de sus 3
  // mejores titulares y se queda la de mas puntos que QUEPA en las
  // posiciones de la casa.
  let core = null;
  const veryFast = fast.find(g => g.cls === "MUY_RAPIDO");
  if (veryFast) {
    const options = [];
    for (const [mineTeam, rivalTeam] of [veryFast.teams, [...veryFast.teams].reverse()]) {
      const mine = topStarters(mineTeam, 3);
      const rival = topStarters(rivalTeam, 3);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          for (const r of rival) {
            const trio = [mine[i], mine[j], r];
            if (fits(trio)) options.push(trio);
          }
        }
      }
    }
    options.sort((x, y) => y.reduce((s, p) => s + p.points, 0) - x.reduce((s, p) => s + p.points, 0));
    if (options.length) {
      core = {
        ...asStack(options[0], veryFast.gameId, "nucleo"),
        lineups: Math.floor(count * coreShare + 1e-9)
      };
    }
  }

  // Parejas: primero las de los OTROS partidos rapidos; despues, como
  // respaldo (cuando el tope de exposicion agota las primeras), las
  // del partido mas rapido que no repiten el nucleo completo.
  const others = fast
    .filter(g => !core || g.gameId !== core.gameId)
    .flatMap(pairsOf)
    .sort((a, b) => b.value - a.value);
  const backup = core
    ? pairsOf(fast.find(g => g.gameId === core.gameId))
      .filter(p => !p.ids.every(id => core.ids.includes(id)))
      .sort((a, b) => b.value - a.value)
    : [];
  const pairs = [...others.slice(0, 8), ...backup.slice(0, 4)];

  return {
    core,
    pairs,
    resumen: [
      core ? `Nucleo del partido mas rapido (${core.lineups} de ${count}): ${core.names.join(" + ")}` : null,
      pairs.length ? `Parejas (en orden): ${pairs.map(p => p.names.join(" + ")).join(" | ")}` : null
    ].filter(Boolean).join(". ")
  };
}

// players: [{ id, name, salary, points, positions:[...], gameId, team,
//             starter, startPos, backupOf }]
// maxExposure: parte maxima de las alineaciones en que puede salir un
// mismo jugador (0.4 = 40%: con 10 alineaciones, maximo 4). Asi una
// lesion o una paliza no hunde todas las alineaciones.
// noStarterBackup: regla titular / suplente de su posicion.
// stackPlan: resultado de planStacks (pilas de partidos rapidos).
// coreExposure: tope de los jugadores del nucleo (0.5 = 50%).
function buildLineups(platform, players, {
  count = 10, minDifferent = 2, nodeLimit = 5e6, maxExposure = 1, timeLimitMs = Infinity,
  noStarterBackup = false, stackPlan = null, coreExposure = 0.5
} = {}) {
  const rule = RULES[platform];
  if (!rule) return { status: "PLATAFORMA_NO_SOPORTADA", lineups: [] };

  const pool = players
    .filter(p => p.salary > 0 && p.points > 0 && p.positions?.length)
    .map(p => ({ ...p, positions: p.positions.map(x => String(x).toUpperCase()) }))
    .sort((a, b) => b.points - a.points || a.salary - b.salary);

  const lineups = [];
  let allOptimal = true;

  const maxUses = Math.max(1, Math.floor(maxExposure * count + 1e-9));
  const coreIds = new Set(stackPlan?.core?.ids || []);
  const coreUses = Math.max(maxUses, Math.floor(coreExposure * count + 1e-9));
  const capOf = id => (coreIds.has(id) ? coreUses : maxUses);
  const uses = new Map();
  const check = noStarterBackup ? (chosen, p) => !starterBackupConflict(chosen, p) : null;

  const startedAt = Date.now();
  let timedOut = false;
  let pairTurn = 0;

  // Que jugadores obligar en la alineacion k (en orden de intento).
  const candidatesFor = k => {
    if (!stackPlan) return [null];
    const list = [];
    if (stackPlan.core && k < stackPlan.core.lineups) list.push(stackPlan.core);
    const pairs = stackPlan.pairs || [];
    for (let t = 0; t < pairs.length; t++) list.push(pairs[(pairTurn + t) % pairs.length]);
    list.push(null); // ultimo recurso: sin obligar a nadie
    return list;
  };

  for (let k = 0; k < count; k++) {
    // Tope de tiempo (solo lo usan las alineaciones de prueba).
    if (Date.now() - startedAt > timeLimitMs) {
      timedOut = true;
      break;
    }
    const available = pool.filter(p => (uses.get(p.id) || 0) < capOf(p.id));
    const availableIds = new Set(available.map(p => p.id));

    let r = null;
    let used = null;
    let attempts = 0;
    for (const cand of candidatesFor(k)) {
      if (cand && !cand.ids.every(id => availableIds.has(id))) continue;
      // Maximo 4 intentos con pila (para no pasarse de tiempo).
      if (cand && attempts >= 4) continue;
      if (cand) attempts++;
      const forced = new Set(cand ? cand.ids : []);
      const list = forced.size
        ? available
          .map(p => (forced.has(p.id) ? { ...p, points: p.points + FORCE_BONUS, realPoints: p.points } : p))
          .sort((a, b) => b.points - a.points || a.salary - b.salary)
        : available;
      const res = solveOne(list, rule, lineups.map(l => l.players), minDifferent, nodeLimit, check);
      if (!res.best) continue;
      // Con pila: todos los obligados deben haber entrado.
      if (forced.size && !cand.ids.every(id => res.best.players.some(p => p.id === id))) continue;
      r = res;
      used = cand;
      break;
    }
    if (!r) break;
    if (!r.complete) allOptimal = false;
    if (used && used !== stackPlan?.core) pairTurn++;

    const clean = p => {
      if (p.realPoints === undefined) return p;
      const { realPoints, ...rest } = p;
      return { ...rest, points: realPoints };
    };
    const players = r.best.slots.map((pi, s) => ({ slot: rule.slots[s], ...clean(r.best.players[pi]) }));
    for (const pl of players) uses.set(pl.id, (uses.get(pl.id) || 0) + 1);
    lineups.push({
      number: k + 1,
      players,
      salary: players.reduce((sum, p) => sum + p.salary, 0),
      points: Math.round(players.reduce((sum, p) => sum + p.points, 0) * 100) / 100,
      optimal: r.complete,
      nodes: r.nodes,
      pila: used ? used.names.join(" + ") : null
    });
  }

  // Ordenar de mas a menos proyectado y renumerar.
  lineups.sort((a, b) => b.points - a.points);
  lineups.forEach((l, i) => (l.number = i + 1));

  return {
    status: lineups.length ? "OK" : "SIN_SOLUCION",
    optimal: allOptimal,
    timedOut,
    salaryCap: rule.salaryCap,
    lineups
  };
}

module.exports = { buildLineups, planStacks, assignSlots, starterBackupConflict, RULES };

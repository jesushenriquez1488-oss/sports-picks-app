// ============================================================
// CASHEDGE FANTASY NBA — OPTIMIZADOR CAPTAIN (DraftKings Showdown)
// ============================================================
//
// Reglas de DraftKings Showdown Captain Mode:
//   1 CPT + 5 UTIL, tope $50,000.
//   El CPT da 1.5x puntos y cuesta su salario de CPT (DraftKings
//   ya lo trae, normalmente 1.5x el de UTIL).
//   Un jugador no puede ir de CPT y de UTIL en la misma alineacion.
//   Tiene que haber jugadores de los 2 equipos.
//
// Optimizador EXACTO, igual que el de Classic: la #1 es la mejor
// posible; la #2 la mejor distinta de la #1; etc. "Distinta" =
// cambia al menos minDifferent jugadores O cambia el CPT.
//
// Archivo con "_" al inicio: Vercel NO lo publica como endpoint.
// ============================================================

const CAP = 50000;
const SIZE = 6; // 1 CPT + 5 UTIL

// players: [{ id, name, team, salary (UTIL), cptSalary, points, utilId, cptId }]
const { pairTracker } = require("./fantasy-pairs");

function buildCaptainLineups(players, {
  count = 20,
  minDifferent = 1,
  maxExposure = 1,
  nodeLimit = 3e6,
  salaryCap = CAP,
  maxPairShare = 1,  // 5-nov: misma pareja en maximo esta parte de las alineaciones
  check = null,      // 5-nov: regla extra al final (NFL: QB con un receptor de su equipo)
  prior = []         // 5-nov: alineaciones que ya existen [{ cpt, ids:[...] }]: las nuevas deben ser distintas
} = {}) {
  const pool = players
    .filter(p => Number(p.points) > 0 && Number(p.salary) > 0 && Number(p.cptSalary) > 0)
    .map(p => ({ ...p, points: Number(p.points), salary: Number(p.salary), cptSalary: Number(p.cptSalary) }))
    .sort((a, b) => b.points - a.points);
  const teams = new Set(pool.map(p => p.team));
  if (pool.length < SIZE || teams.size < 2) {
    return { lineups: [], status: "POCOS_JUGADORES", optimal: false };
  }

  const uses = new Map();
  const maxUses = Math.max(1, Math.floor(maxExposure * count + 1e-9));
  const previous = (prior || []).map(p => ({ cpt: String(p.cpt), ids: new Set((p.ids || []).map(String)) }));
  const lineups = [];
  const pairs = pairTracker(maxPairShare, count);
  let allOptimal = true;

  for (let n = 0; n < count; n++) {
    const blocked = id => (uses.get(id) || 0) >= maxUses;
    const r = solveOne(pool, previous, minDifferent, nodeLimit, blocked, salaryCap, pairs, check);
    if (!r) break;
    if (!r.optimal) allOptimal = false;
    const cpt = r.cpt, utils = r.utils;
    for (const p of [cpt, ...utils]) uses.set(p.id, (uses.get(p.id) || 0) + 1);
    pairs.add([cpt, ...utils]);
    previous.push({ cpt: cpt.id, ids: new Set([cpt.id, ...utils.map(u => u.id)]) });
    lineups.push({
      number: n + 1,
      points: round(cpt.points * 1.5 + utils.reduce((s, u) => s + u.points, 0), 2),
      salary: cpt.cptSalary + utils.reduce((s, u) => s + u.salary, 0),
      optimal: r.optimal,
      players: [
        { slot: "CPT", id: cpt.id, dkId: cpt.cptId, name: cpt.name, team: cpt.team, salary: cpt.cptSalary, points: round(cpt.points * 1.5, 2) },
        ...utils.map(u => ({ slot: "UTIL", id: u.id, dkId: u.utilId, name: u.name, team: u.team, salary: u.salary, points: round(u.points, 2) }))
      ]
    });
  }
  return {
    lineups,
    status: lineups.length ? (lineups.length < count ? "MENOS_DE_LAS_PEDIDAS" : "OK") : "SIN_ALINEACIONES",
    optimal: allOptimal
  };
}

// Mejor alineacion: prueba cada CPT y llena 5 UTIL con busqueda
// exacta (cota: los mejores puntos que todavia caben).
function solveOne(pool, previous, minDifferent, nodeLimit, blocked, cap, pairs = null, check = null) {
  let best = null, bestPts = -1, nodes = 0, cut = false;
  const utilPool = pool; // ya ordenado de mas a menos puntos

  for (const cpt of pool) {
    if (blocked(cpt.id)) continue;
    const base = cpt.points * 1.5;
    // cota rapida: CPT + los 5 mejores UTIL posibles
    let bound = base, k = 0;
    for (const u of utilPool) { if (u.id !== cpt.id && !blocked(u.id)) { bound += u.points; if (++k === 5) break; } }
    if (bound <= bestPts) continue;
    if (cpt.cptSalary > cap) continue;

    const chosen = [];
    const dfs = (start, salary, pts) => {
      if (cut) return;
      if (++nodes > nodeLimit) { cut = true; return; }
      if (chosen.length === 5) {
        const ids = new Set([cpt.id, ...chosen.map(c => c.id)]);
        const teams = new Set([cpt.team, ...chosen.map(c => c.team)]);
        if (teams.size < 2) return;
        if (check && !check(cpt, chosen)) return;
        for (const prev of previous) {
          let same = 0;
          for (const id of ids) if (prev.ids.has(id)) same++;
          const changed = SIZE - same;
          if (changed < minDifferent && prev.cpt === cpt.id) return;
        }
        if (pts > bestPts) { bestPts = pts; best = { cpt, utils: chosen.slice() }; }
        return;
      }
      const need = 5 - chosen.length;
      for (let i = start; i < utilPool.length; i++) {
        const u = utilPool[i];
        if (u.id === cpt.id || blocked(u.id)) continue;
        if (salary + u.salary > cap) continue;
        if (pairs && !pairs.ok([cpt, ...chosen], u)) continue;
        // cota: estos puntos + los siguientes "need" mejores
        let b = pts, c = 0;
        for (let j = i; j < utilPool.length && c < need; j++) {
          const v = utilPool[j];
          if (v.id === cpt.id || blocked(v.id)) continue;
          b += v.points; c++;
        }
        if (c < need || b <= bestPts) return;   // ordenados: no hay nada mejor despues
        chosen.push(u);
        dfs(i + 1, salary + u.salary, pts + u.points);
        chosen.pop();
        if (cut) return;
      }
    };
    dfs(0, cpt.cptSalary, base);
    if (cut) break;
  }
  return best ? { ...best, optimal: !cut } : null;
}

function round(v, d = 2) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

module.exports = { buildCaptainLineups };

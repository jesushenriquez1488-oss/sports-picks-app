// ============================================================
// CASHEDGE FANTASY — TOPE DE PAREJAS (5-nov)
// Dos jugadores juntos en maximo maxPairShare de las alineaciones
// (0.3 = 30%). Asi uno o dos jugadores que fallen no tumban la mitad.
// exempt: ids que no cuentan (ej. el QB de su stack en NFL).
// ============================================================

function pairTracker(maxPairShare = 1, count = 1, exempt = () => false) {
  const on = maxPairShare < 1;
  const cap = Math.max(1, Math.floor(maxPairShare * count + 1e-9));
  const uses = new Map();
  const key = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  return {
    // ¿p puede entrar con los ya elegidos?
    ok(chosen, p) {
      if (!on || exempt(p.id)) return true;
      const pid = String(p.id);
      for (const c of chosen) {
        if (c === p || exempt(c.id)) continue;
        if ((uses.get(key(String(c.id), pid)) || 0) >= cap) return false;
      }
      return true;
    },
    // sumar una alineacion terminada
    add(players) {
      if (!on) return;
      const ids = players.map(p => String(p.id));
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (exempt(ids[a]) || exempt(ids[b])) continue;
        const k = key(ids[a], ids[b]);
        uses.set(k, (uses.get(k) || 0) + 1);
      }
    }
  };
}

module.exports = { pairTracker };

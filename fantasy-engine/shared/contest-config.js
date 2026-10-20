
"use strict";

// Fantasy Edge — reglas de concursos.
// Independiente de Player Props y Market Intelligence.

const SPORTS = ["nba", "nfl"];
const PLATFORMS = ["draftkings", "fanduel"];

function slot(id, eligiblePositions) {
  return { id, eligiblePositions };
}

const CLASSIC_RULES = {
  nba: {
    draftkings: {
      salaryCap: 50000,
      slots: [
        slot("PG", ["PG"]),
        slot("SG", ["SG"]),
        slot("SF", ["SF"]),
        slot("PF", ["PF"]),
        slot("C", ["C"]),
        slot("G", ["PG", "SG"]),
        slot("F", ["SF", "PF"]),
        slot("UTIL", ["PG", "SG", "SF", "PF", "C"])
      ]
    },

    fanduel: {
      salaryCap: 60000,
      slots: [
        slot("PG1", ["PG"]),
        slot("PG2", ["PG"]),
        slot("SG1", ["SG"]),
        slot("SG2", ["SG"]),
        slot("SF1", ["SF"]),
        slot("SF2", ["SF"]),
        slot("PF1", ["PF"]),
        slot("PF2", ["PF"]),
        slot("C", ["C"])
      ]
    }
  },

  nfl: {
    draftkings: {
      salaryCap: 50000,
      slots: [
        slot("QB", ["QB"]),
        slot("RB1", ["RB"]),
        slot("RB2", ["RB"]),
        slot("WR1", ["WR"]),
        slot("WR2", ["WR"]),
        slot("WR3", ["WR"]),
        slot("TE", ["TE"]),
        slot("FLEX", ["RB", "WR", "TE"]),
        slot("DST", ["DST", "DEF", "D"])
      ]
    },

    fanduel: {
      salaryCap: 60000,
      slots: [
        slot("QB", ["QB"]),
        slot("RB1", ["RB"]),
        slot("RB2", ["RB"]),
        slot("WR1", ["WR"]),
        slot("WR2", ["WR"]),
        slot("WR3", ["WR"]),
        slot("TE", ["TE"]),
        slot("FLEX", ["RB", "WR", "TE"]),
        slot("DEF", ["DST", "DEF", "D"])
      ]
    }
  }
};

function getContestConfig({
  sport,
  platform,
  format = "classic"
} = {}) {

  sport = String(sport || "").toLowerCase();
  platform = String(platform || "").toLowerCase();
  format = String(format || "").toLowerCase();

  if (
    !SPORTS.includes(sport) ||
    !PLATFORMS.includes(platform)
  ) {
    throw new Error(
      "Deporte o plataforma no admitidos"
    );
  }

  // Los formatos especiales se habilitaran
  // cuando verifiquemos sus reglas reales.
  if (format !== "classic") {
    throw new Error(
      "Formato pendiente de validar: " + format
    );
  }

  const rules = CLASSIC_RULES[sport][platform];

  return {
    sport,
    platform,
    format,
    salaryCap: rules.salaryCap,
    rosterSize: rules.slots.length,
    slots: rules.slots.map(s => ({
      id: s.id,
      eligiblePositions: [...s.eligiblePositions]
    }))
  };
}

function validateClassicLineup({
  sport,
  platform,
  slate,
  lineup
} = {}) {

  const config = getContestConfig({
    sport,
    platform
  });

  const errors = [];

  const gameIds = Array.isArray(slate?.gameIds)
    ? new Set(slate.gameIds.map(String))
    : null;

  // El slate debe venir de datos reales
  // de la plataforma seleccionada.
  if (
    !slate?.id ||
    !gameIds?.size ||
    slate.sport !== config.sport ||
    slate.platform !== config.platform ||
    slate.format !== "classic"
  ) {
    errors.push(
      "Falta un slate real de la plataforma"
    );
  }

  if (
    !Array.isArray(lineup) ||
    lineup.length !== config.rosterSize
  ) {
    errors.push(
      "Cantidad de jugadores incorrecta"
    );
  }

  const usedSlots = new Set();
  const usedPlayers = new Set();

  let salary = 0;

  for (
    const entry of Array.isArray(lineup)
      ? lineup
      : []
  ) {

    if (!entry || typeof entry !== "object") {
      errors.push("Entrada invalida");
      continue;
    }

    const slotId = String(entry.slot || "");
    const playerId = String(
      entry.playerId ?? ""
    );

    const cost = Number(entry.salary);

    const positions =
      Array.isArray(entry.positions)
        ? entry.positions.map(
            p => String(p).toUpperCase()
          )
        : [];

    const rule = config.slots.find(
      s => s.id === slotId
    );

    if (!rule || usedSlots.has(slotId)) {
      errors.push(
        "Slot invalido o repetido: " + slotId
      );
    }

    usedSlots.add(slotId);

    if (
      !playerId ||
      usedPlayers.has(playerId)
    ) {
      errors.push(
        "Jugador invalido o repetido: " +
        playerId
      );
    }

    usedPlayers.add(playerId);

    if (
      !Number.isInteger(cost) ||
      cost <= 0
    ) {
      errors.push(
        "Salario invalido: " + playerId
      );
    } else {
      salary += cost;
    }

    if (
      rule &&
      !positions.some(
        p => rule.eligiblePositions.includes(p)
      )
    ) {
      errors.push(
        "Posicion no elegible: " + slotId
      );
    }

    if (
      gameIds &&
      !gameIds.has(String(entry.gameId ?? ""))
    ) {
      errors.push(
        "Jugador fuera del slate: " + playerId
      );
    }
  }

  for (const rule of config.slots) {
    if (!usedSlots.has(rule.id)) {
      errors.push(
        "Falta slot: " + rule.id
      );
    }
  }

  if (salary > config.salaryCap) {
    errors.push("Presupuesto excedido");
  }

  return {
    structurallyValid: errors.length === 0,

    // Falta validar reglas particulares del
    // concurso: equipos, horario y bloqueos.
    contestVerified: false,

    salary,
    salaryCap: config.salaryCap,
    remaining: config.salaryCap - salary,
    errors
  };
}

module.exports = {
  SPORTS,
  PLATFORMS,
  getContestConfig,
  validateClassicLineup
};

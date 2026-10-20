
"use strict";

// CASHEDGE FANTASY EDGE — LINEUP OPTIMIZER V1
// NBA + NFL | DraftKings + FanDuel
// Solo calculos. No consulta APIs ni escribe datos.
// Busca una alineacion usando beam search.
// El resultado es experimental, no optimo garantizado.

const {
  getContestConfig,
  validateClassicLineup
} = require("./contest-config");

const BEAM_WIDTH = 3000;

const id = value =>
  value === null || value === undefined
    ? ""
    : String(value).trim();

function positionsOf(player) {
  const raw = Array.isArray(player.positions)
    ? player.positions
    : [player.position];

  return [...new Set(
    raw
      .flatMap(value =>
        String(value || "")
          .toUpperCase()
          .split(/[\/,]/)
      )
      .map(value => value.trim())
      .filter(Boolean)
      .map(value =>
        ["DEF", "D"].includes(value)
          ? "DST"
          : value
      )
  )];
}

function optimizeFantasyLineup({
  sport,
  platform,
  slate,
  players,
  locked = [],
  excluded = []
} = {}) {

  const config = getContestConfig({
    sport,
    platform
  });

  if (
    !slate?.id ||
    slate.sport !== config.sport ||
    slate.platform !== config.platform ||
    slate.format !== "classic" ||
    !Array.isArray(slate.gameIds) ||
    !slate.gameIds.length
  ) {
    throw new Error(
      "Se requiere slate Classic valido"
    );
  }

  if (
    !Array.isArray(players) ||
    !players.length
  ) {
    throw new Error(
      "Se requieren jugadores con salarios y proyecciones"
    );
  }

  const allowedGames = new Set(
    slate.gameIds.map(id)
  );

  const lockedIds = new Set(
    locked.map(id)
  );

  const excludedIds = new Set(
    excluded.map(id)
  );

  if (
    [...lockedIds].some(value =>
      excludedIds.has(value)
    )
  ) {
    throw new Error(
      "Un jugador no puede estar bloqueado y excluido"
    );
  }

  if (
    lockedIds.has("") ||
    excludedIds.has("")
  ) {
    throw new Error(
      "Identificador de jugador vacio"
    );
  }

  if (
    lockedIds.size > config.rosterSize
  ) {
    throw new Error(
      "Demasiados jugadores bloqueados"
    );
  }

  const poolById = new Map();

  for (const raw of players) {
    const playerId = id(
      raw?.playerId ?? raw?.id
    );

    if (
      !playerId ||
      excludedIds.has(playerId)
    ) {
      continue;
    }

    // No interpretar una lesion no verificada
    // como una baja confirmada.
    if (
      raw.status === "out_injury" ||
      raw.injuryStatus === "out" ||
      raw.disabled === true
    ) {
      continue;
    }

    const salary = Number(raw.salary);
    const projectedPoints = Number(
      raw.projectedPoints
    );

    const gameId = id(raw.gameId);
    const positions = positionsOf(raw);

    if (
      !Number.isInteger(salary) ||
      salary <= 0 ||
      salary > config.salaryCap ||
      raw.projectedPoints === null ||
      raw.projectedPoints === undefined ||
      !Number.isFinite(projectedPoints) ||
      projectedPoints < 0 ||
      !allowedGames.has(gameId) ||
      !positions.length
    ) {
      continue;
    }

    const player = {
      playerId,
      name: raw.name || null,
      teamId: id(raw.teamId) || null,
      gameId,
      salary,
      projectedPoints,
      positions
    };

    // Un mismo jugador puede aparecer en
    // varios roster slots del feed DFS.
    // Aceptar duplicados identicos; rechazar
    // identidad, salario o puntos contradictorios.

    if (poolById.has(playerId)) {
      const old = poolById.get(playerId);

      if (
        old.gameId !== player.gameId ||
        old.salary !== player.salary ||
        old.projectedPoints !==
          player.projectedPoints ||
        old.teamId !== player.teamId ||
        old.positions.join(",") !==
          player.positions.join(",")
      ) {
        throw new Error(
          "Datos contradictorios: " + playerId
        );
      }

      continue;
    }

    poolById.set(playerId, player);
  }

  const pool = [...poolById.values()];

  for (const playerId of lockedIds) {
    if (!poolById.has(playerId)) {
      throw new Error(
        "Jugador bloqueado sin datos validos: " +
        playerId
      );
    }
  }

  const eligible = (player, slot) =>
    player.positions.some(position =>
      slot.eligiblePositions.includes(position)
    );

  // Primero asignar los jugadores bloqueados.
  // Probamos sus distintas posiciones elegibles
  // para evitar conflictos PG/G/UTIL, etc.

  const lockedPlayers =
    [...lockedIds].map(playerId =>
      poolById.get(playerId)
    );

  lockedPlayers.sort(
    (a, b) =>
      config.slots.filter(s =>
        eligible(a, s)
      ).length -
      config.slots.filter(s =>
        eligible(b, s)
      ).length
  );

  const seeds = [];

  function assignLocks(
    index,
    assigned,
    usedSlots,
    salary,
    score
  ) {
    if (salary > config.salaryCap) {
      return;
    }

    if (index === lockedPlayers.length) {
      seeds.push({
        assigned: [...assigned],
        usedSlots: new Set(usedSlots),
        usedPlayers: new Set(lockedIds),
        salary,
        score
      });

      return;
    }

    const player = lockedPlayers[index];

    for (const slot of config.slots) {
      if (
        usedSlots.has(slot.id) ||
        !eligible(player, slot)
      ) {
        continue;
      }

      assigned.push({
        slot: slot.id,
        player
      });

      usedSlots.add(slot.id);

      assignLocks(
        index + 1,
        assigned,
        usedSlots,
        salary + player.salary,
        score + player.projectedPoints
      );

      usedSlots.delete(slot.id);
      assigned.pop();
    }
  }

  assignLocks(
    0,
    [],
    new Set(),
    0,
    0
  );

  if (!seeds.length) {
    return {
      found: false,
      reason: "locked_players_incompatible",
      lineups: []
    };
  }

  let best = null;

  for (const seed of seeds) {

    // Completar primero los slots con menos
    // jugadores elegibles disponibles.

    const remainingSlots =
      config.slots
        .filter(slot =>
          !seed.usedSlots.has(slot.id)
        )
        .sort((a, b) => {
          const count = slot =>
            pool.filter(player =>
              !lockedIds.has(player.playerId) &&
              eligible(player, slot)
            ).length;

          return count(a) - count(b);
        });

    let beam = [{
      assigned: seed.assigned,
      usedPlayers: seed.usedPlayers,
      salary: seed.salary,
      score: seed.score
    }];

    for (const slot of remainingSlots) {
      const candidates = pool.filter(
        player =>
          !lockedIds.has(player.playerId) &&
          eligible(player, slot)
      );

      const next = [];

      for (const state of beam) {
        for (const player of candidates) {

          if (
            state.usedPlayers.has(
              player.playerId
            ) ||
            state.salary + player.salary >
              config.salaryCap
          ) {
            continue;
          }

          next.push({
            assigned: [
              ...state.assigned,
              {
                slot: slot.id,
                player
              }
            ],

            usedPlayers: new Set([
              ...state.usedPlayers,
              player.playerId
            ]),

            salary:
              state.salary + player.salary,

            score:
              state.score +
              player.projectedPoints
          });
        }
      }

      next.sort((a, b) =>
        b.score - a.score ||
        a.salary - b.salary
      );

      beam = next.slice(
        0,
        BEAM_WIDTH
      );

      if (!beam.length) {
        break;
      }
    }

    for (const state of beam) {
      if (
        state.assigned.length !==
        config.rosterSize
      ) {
        continue;
      }

      const lineup = state.assigned.map(
        item => ({
          slot: item.slot,
          playerId: item.player.playerId,
          gameId: item.player.gameId,
          salary: item.player.salary,
          positions: item.player.positions,
          projectedPoints:
            item.player.projectedPoints,
          name: item.player.name,
          teamId: item.player.teamId
        })
      );

      const validation =
        validateClassicLineup({
          sport,
          platform,
          slate,
          lineup
        });

      if (
        !validation.structurallyValid
      ) {
        continue;
      }

      if (
        !best ||
        state.score > best.score ||
        (
          state.score === best.score &&
          state.salary < best.salary
        )
      ) {
        best = {
          lineup,
          score: state.score,
          salary: state.salary,
          validation
        };
      }
    }
  }

  if (!best) {
    return {
      found: false,
      reason: "no_valid_lineup_found",
      // Beam search puede descartar una
      // solucion valida durante la busqueda.
      provenInfeasible: false,
      lineups: []
    };
  }

  // Ordenar los jugadores por el orden
  // oficial de slots de contest-config.

  best.lineup.sort(
    (a, b) =>
      config.slots.findIndex(
        s => s.id === a.slot
      ) -
      config.slots.findIndex(
        s => s.id === b.slot
      )
  );

  return {
    found: true,
    mode: "shadow",
    sport: config.sport,
    platform: config.platform,
    format: config.format,

    projectedPoints:
      Math.round(best.score * 100) / 100,

    salary: best.salary,
    salaryCap: config.salaryCap,
    remainingSalary:
      config.salaryCap - best.salary,

    // La busqueda es aproximada.
    // No garantiza el maximo global.

    optimalityGuaranteed: false,

    // Las reglas particulares del concurso
    // aun no estan confirmadas.

    contestVerified: false,
    readyForPublication: false,

    lineup: best.lineup
  };
}

module.exports = {
  optimizeFantasyLineup
};

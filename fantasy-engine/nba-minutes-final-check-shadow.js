
"use strict";

// CASHEDGE FANTASY NBA
// FINAL ROLE + MINUTES CHECK
// SHADOW ONLY
// No modifica formulas de produccion.
// No exige 8 juegos.
// No utiliza ventana de 240 dias.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(
  "fantasy-shadow-input"
);

function load(filename) {
  return JSON.parse(
    fs.readFileSync(
      path.join(ROOT, filename),
      "utf8"
    )
  );
}

const id = value =>
  String(value ?? "").trim();

const round = number =>
  Math.round(number * 100) / 100;

function average(games) {
  if (!games.length) return null;

  const total = games.reduce(
    (sum, game) => sum + game.minutes,
    0
  );

  return total / games.length;
}

function validMinutes(value) {
  return (
    Number.isFinite(value) &&
    value > 0 &&
    value <= 60
  );
}

function byPlayerId(players) {
  return new Map(
    players.map(player => [
      id(player.espnPlayerId),
      player
    ])
  );
}

function main() {
  const rotation = load(
    "nba-rotation-context.json"
  );

  const history = load(
    "nba-fantasy-history.json"
  );

  const previous = load(
    "nba-role-minutes-shadow.json"
  );

  if (
    rotation.mode !== "shadow" ||
    history.mode !== "shadow" ||
    previous.mode !== "shadow"
  ) {
    throw new Error(
      "SHADOW inputs required"
    );
  }

  if (
    !Array.isArray(rotation.players) ||
    !Array.isArray(history.players) ||
    !Array.isArray(previous.players)
  ) {
    throw new Error(
      "Missing player arrays"
    );
  }

  if (
    history.asOfDate !== previous.cutoffDay
  ) {
    throw new Error(
      "History cutoff mismatch"
    );
  }

  const cutoff = Date.parse(
    history.asOfDate + "T00:00:00Z"
  );

  if (!Number.isFinite(cutoff)) {
    throw new Error("Invalid cutoff");
  }

  const histories = byPlayerId(
    history.players
  );

  const oldMinutes = byPlayerId(
    previous.players
  );

  const players = rotation.players.map(
    rotationPlayer => {
      const key = id(
        rotationPlayer.espnPlayerId
      );

      const h = histories.get(key);
      const old = oldMinutes.get(key);

      const ranks = (
        rotationPlayer.positions || []
      )
        .map(p => Number(p.depthRank))
        .filter(rank =>
          Number.isInteger(rank) &&
          rank >= 1
        );

      const rank = ranks.length
        ? Math.min(...ranks)
        : null;

      const candidateId = id(
        rotationPlayer.nbaPlayerId ||
        rotationPlayer.candidateNbaPlayerId
      );

      const matched = Boolean(
        h &&
        h.shadowEligible === true &&
        id(h.nbaPlayerId) &&
        id(h.nbaPlayerId) === candidateId
      );

      const currentTeamId = id(
        rotationPlayer.nbaTeamId
      );

      const teamMatched = Boolean(
        currentTeamId &&
        currentTeamId === id(
          h?.expectedCurrentTeamId
        )
      );

      // Solo juegos anteriores al corte.
      // Temporada NBA 2025-26 y 2026-27.
      // Sin ventana de 240 dias.

      const allGames = matched &&
        Array.isArray(h.historicalGames)
        ? h.historicalGames
          .filter(game => {
            const date = Date.parse(
              game.gameDate || ""
            );

            const minutes = Number(
              game.minutes
            );

            return (
              Number.isFinite(date) &&
              date < cutoff &&
              [2025, 2026].includes(
                Number(game.season)
              ) &&
              validMinutes(minutes)
            );
          })
          .map(game => ({
            ...game,
            minutes: Number(game.minutes)
          }))
          .sort(
            (a, b) =>
              Date.parse(b.gameDate) -
              Date.parse(a.gameDate)
          )
        : [];

      const current = allGames.filter(
        game =>
          Number(game.season) === 2026
      );

      const lastSeason = allGames.filter(
        game =>
          Number(game.season) === 2025
      );

      const currentSameTeam = current.filter(
        game =>
          id(game.teamId) === currentTeamId
      );

      const previousSameTeam =
        lastSeason.filter(
          game =>
            id(game.teamId) === currentTeamId
        );

      // Si tenemos muestra del mismo equipo,
      // usarla antes que la de otros equipos.
      // Si cambio de equipo, conservamos
      // su historial individual anterior.

      const selectedPrevious =
        previousSameTeam.length
          ? previousSameTeam
          : lastSeason;

      const selectedCurrent =
        currentSameTeam.length
          ? currentSameTeam
          : current;

      const previousMean = average(
        selectedPrevious
      );

      const currentMean = average(
        selectedCurrent
      );

      // Promedio histórico de referencia.
      // Cada partido cuenta una vez.
      // No se exige cantidad mínima.
      //
      // Este valor NO incorpora todavía
      // lesiones, rival ni cambios
      // estadísticos de uso.

      const combined = [
        ...selectedPrevious,
        ...selectedCurrent
      ];

      const historicalBaseline = average(
        combined
      );

      // Solo primeros y segundos puestos
      // obtienen referencia para Fantasy.
      // Reservas profundas quedan fuera.

      const projected = (
        rank === 1 || rank === 2
      )
        ? historicalBaseline
        : null;

      const flags = [];

      if (!matched) {
        flags.push(
          "NO_MATCHED_STATISTICAL_HISTORY"
        );
      }

      if (!teamMatched) {
        flags.push(
          "TEAM_MAPPING_UNRESOLVED"
        );
      }

      if (!combined.length) {
        flags.push(
          "NO_2025_OR_2026_HISTORY"
        );
      }

      if (rank === null) {
        flags.push(
          "NO_DEPTH_ROLE"
        );
      }

      if (rank >= 3) {
        flags.push(
          "NOT_PRIMARY_FANTASY_POOL"
        );
      }

      if (
        rank === 1 &&
        projected !== null &&
        projected < 20
      ) {
        flags.push(
          "ROLE_HISTORY_DISAGREEMENT_REVIEW"
        );
      }

      const role = rank === 1
        ? "FIRST_LISTED"
        : rank === 2
          ? "SECOND_LISTED"
          : rank === 3
            ? "THIRD_LISTED"
            : "DEEP_BENCH";

      return {
        player: rotationPlayer.espnName,
        team: rotationPlayer.team,

        espnPlayerId: key,

        nbaPlayerId: matched
          ? id(h.nbaPlayerId)
          : null,

        role,
        depthRank: rank,

        previousSeasonGames:
          selectedPrevious.length,

        previousSeasonSameTeam:
          previousSameTeam.length,

        currentSeasonGames:
          selectedCurrent.length,

        currentSeasonSameTeam:
          currentSameTeam.length,

        previousMinutes:
          previousMean === null
            ? null
            : round(previousMean),

        currentMinutes:
          currentMean === null
            ? null
            : round(currentMean),

        projectedMinutes:
          projected === null
            ? null
            : round(projected),

        historicalMinutesDiagnostic:
          historicalBaseline === null
            ? null
            : round(historicalBaseline),

        oldProjectedMinutes:
          old?.estimatedMinutes ?? null,

        previousSource:
          previousSameTeam.length
            ? "SAME_TEAM_2025"
            : selectedPrevious.length
              ? "PREVIOUS_TEAM_2025"
              : "NONE",

        flags,

        gameDayAvailabilityVerified: false,
        readyForLineups: false
      };
    }
  );

  const focusNames = [
    "Nikola Jokic",
    "Anthony Davis",
    "Stephen Curry",
    "Trae Young",
    "Jericho Sims",
    "Obi Toppin",
    "Dennis Schroder",
    "Giannis Antetokounmpo"
  ];

  const focus = players.filter(
    player =>
      focusNames.includes(player.player)
  );

  const summary = {
    depthChartPlayers: players.length,

    firstListed: players.filter(
      p => p.depthRank === 1
    ).length,

    firstListedWithMinutes: players.filter(
      p =>
        p.depthRank === 1 &&
        p.projectedMinutes !== null
    ).length,

    firstListedWithMissingData: players.filter(
      p =>
        p.depthRank === 1 &&
        p.projectedMinutes === null
    ).length,

    rank2WithMinutes: players.filter(
      p =>
        p.depthRank === 2 &&
        p.projectedMinutes !== null
    ).length,

    rank3AndDeeperNotRecommended:
      players.filter(
        p => p.depthRank >= 3
      ).length
  };

  const report = {
    module: "fantasy_nba",
    mode: "shadow",

    version: "minutes-final-check-v1",

    targetDate: previous.targetDate,
    historicalCutoffExclusive:
      history.asOfDate,

    generatedAt:
      new Date().toISOString(),

    summary,
    focus,

    warnings: [
      "ESPN first listed does not mean confirmed starter",
      "Historical minutes do not include verified injuries",
      "No opponent adjustment in this check",
      "Historical baseline is not a calibrated game prediction",
      "Missing player IDs must be resolved separately",
      "No salary slate or lineup optimization in this check"
    ],

    readyForLineups: false,

    players
  };

  const output = path.join(
    ROOT,
    "nba-minutes-final-check-shadow.json"
  );

  fs.writeFileSync(
    output,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(
    "===== FANTASY NBA LAST ROLE/MINUTES CHECK ====="
  );

  console.log(
    "SUMMARY",
    JSON.stringify(summary, null, 2)
  );

  console.table(
    focus.map(player => ({
      player: player.player,
      rank: player.depthRank,
      priorGames:
        player.previousSeasonGames,
      currentGames:
        player.currentSeasonGames,
      prior: player.previousMinutes,
      now: player.currentMinutes,
      old: player.oldProjectedMinutes,
      new: player.projectedMinutes,
      flags: player.flags.join(",")
    }))
  );

  console.log(
    "OUTPUT:",
    output
  );

  console.log(
    "NO DATABASE WRITES | NO PRODUCTION CHANGES | NO LINEUPS"
  );
}

main();

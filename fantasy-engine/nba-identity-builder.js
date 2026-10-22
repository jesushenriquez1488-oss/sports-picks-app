
"use strict";

// CASHEDGE FANTASY EDGE
// NBA IDENTITY BUILDER V1
//
// ESPN Depth Chart ↔ Supabase NBA IDs
// Procesa los 30 equipos en una sola ejecucion.
//
// SHADOW ONLY.
// Lee ESPN y Supabase.
// No escribe en Supabase.
// No modifica Player Props ni Premium Picks.
// No asigna automaticamente identidades dudosas.

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const {
  getDepthChart
} = require("./espn-depthchart-probe");

const {
  normalizeDepthChart
} = require("./espn-depthchart-normalizer");

const ESPN_TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/" +
  "sports/basketball/nba/teams?limit=100";

const OUTPUT =
  "fantasy-shadow-input/nba-identity-report.json";

const CURRENT_SEASON = 2026;
const PREVIOUS_SEASON = 2025;
const PAGE_SIZE = 1000;

const id = value =>
  String(value ?? "").trim();

const normalizeName = value =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function loadTeams() {
  const response = await fetch(ESPN_TEAMS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      "ESPN teams HTTP " + response.status
    );
  }

  const json = await response.json();

  const entries =
    json?.sports?.[0]?.leagues?.[0]?.teams;

  if (!Array.isArray(entries)) {
    throw new Error("Invalid ESPN teams response");
  }

  const unique = new Map();

  for (const entry of entries) {
    const team = entry?.team;

    if (!team?.id || !team?.abbreviation) {
      continue;
    }

    unique.set(id(team.id), {
      espnTeamId: id(team.id),
      abbreviation: String(team.abbreviation),
      name: String(team.displayName || "")
    });
  }

  const teams = [...unique.values()];

  if (teams.length !== 30) {
    throw new Error(
      "Expected 30 NBA teams, got " + teams.length
    );
  }

  return teams;
}

async function loadEspnPlayers(teams) {
  const result = [];

  for (let i = 0; i < teams.length; i += 3) {
    const batch = teams.slice(i, i + 3);

    const responses = await Promise.all(
      batch.map(team =>
        getDepthChart(team.espnTeamId)
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const team = batch[j];
      const response = responses[j];

      if (
        id(response.team?.id) !== team.espnTeamId
      ) {
        throw new Error(
          "ESPN team mismatch: " +
          team.abbreviation
        );
      }

      const records = normalizeDepthChart(response);

      if (!records.length) {
        throw new Error(
          "Empty Depth Chart: " +
          team.abbreviation
        );
      }

      const players = new Map();

      for (const row of records) {
        const playerId = id(row.espnPlayerId);

        if (!players.has(playerId)) {
          players.set(playerId, {
            espnPlayerId: playerId,
            espnName: row.playerName,
            espnTeamId: team.espnTeamId,
            team: team.abbreviation,
            positions: [],
            checkedAt: response.checkedAt
          });
        }

        players.get(playerId).positions.push({
          position: row.position,
          rank: row.depthRank,
          firstListed: row.depthRank === 1
        });
      }

      result.push(...players.values());
    }
  }

  return result;
}

async function loadSeason(db, season) {
  const rows = [];

  for (let offset = 0; offset < 100000; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("nba_player_game_stats")
      .select(
        "player_id,player_name,team_id,season,game_date"
      )
      .eq("season", season)
      .order("game_date", { ascending: false })
      .order("player_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(
        `Supabase season ${season}: ${error.message}`
      );
    }

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }

  throw new Error(
    "NBA history exceeded pagination limit"
  );
}

function buildHistoryIndex(rows) {
  const byName = new Map();

  for (const row of rows) {
    const nameKey = normalizeName(row.player_name);
    const playerId = id(row.player_id);
    const teamId = id(row.team_id);

    if (!nameKey || !playerId || !teamId) {
      continue;
    }

    if (!byName.has(nameKey)) {
      byName.set(nameKey, new Map());
    }

    const group = byName.get(nameKey);

    if (!group.has(playerId)) {
      group.set(playerId, {
        nbaPlayerId: playerId,
        nbaName: row.player_name,
        currentTeams: new Set(),
        previousTeams: new Set(),
        latestCurrentTeam: null,
        latestPreviousTeam: null,
        currentGames: new Set(),
        previousGames: new Set()
      });
    }

    const player = group.get(playerId);

    // loadSeason devuelve fechas descendentes.
    // La primera fila valida de cada temporada
    // identifica el ultimo equipo registrado.

    if (Number(row.season) === CURRENT_SEASON) {
      player.currentTeams.add(teamId);

      if (player.latestCurrentTeam === null) {
        player.latestCurrentTeam = teamId;
      }

      player.currentGames.add(
        String(row.game_date) + "|" + teamId
      );
    } else {
      player.previousTeams.add(teamId);

      if (player.latestPreviousTeam === null) {
        player.latestPreviousTeam = teamId;
      }

      player.previousGames.add(
        String(row.game_date) + "|" + teamId
      );
    }
  }

  return byName;
}

function findCandidates(espnPlayers, historyIndex) {
  const output = [];

  for (const player of espnPlayers) {
    const matches = [
      ...(historyIndex.get(
        normalizeName(player.espnName)
      )?.values() || [])
    ];

    output.push({
      ...player,
      matches: matches.map(match => ({
        nbaPlayerId: match.nbaPlayerId,
        nbaName: match.nbaName,
        latestCurrentTeam: match.latestCurrentTeam,
        latestPreviousTeam: match.latestPreviousTeam,
        currentTeams: [...match.currentTeams],
        previousTeams: [...match.previousTeams],
        currentRows: match.currentGames.size,
        previousRows: match.previousGames.size
      }))
    });
  }

  return output;
}

function inferTeamMappings(players) {
  const groups = new Map();

  for (const player of players) {
    if (!groups.has(player.espnTeamId)) {
      groups.set(player.espnTeamId, []);
    }

    groups.get(player.espnTeamId).push(player);
  }

  const result = new Map();

  for (const [espnTeamId, teamPlayers] of groups) {
    const votes = new Map();

    // Una coincidencia de nombre unica puede
    // aportar un voto. Nunca contar un mismo
    // jugador varias veces por sus partidos.

    const countVotes = field => {
      const counts = new Map();

      for (const player of teamPlayers) {
        if (player.matches.length !== 1) {
          continue;
        }

        const candidate = player.matches[0];
        const teamId = candidate[field];

        if (!teamId) continue;

        counts.set(
          teamId,
          (counts.get(teamId) || 0) + 1
        );
      }

      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1]);
    };

    const current = countVotes(
      "latestCurrentTeam"
    );

    const previous = countVotes(
      "latestPreviousTeam"
    );

    // La temporada actual tiene prioridad.
    // Exigimos ventaja clara y varios jugadores.
    // La temporada anterior solo crea candidatos.

    const bestCurrent = current[0];
    const secondCurrent = current[1];

    const currentStrong =
      bestCurrent &&
      bestCurrent[1] >= 2 &&
      bestCurrent[1] >=
        (secondCurrent?.[1] || 0) + 2;

    const bestPrevious = previous[0];

    const mapping = {
      espnTeamId,
      team: teamPlayers[0].team,
      nbaTeamId: currentStrong
        ? bestCurrent[0]
        : null,
      status: currentStrong
        ? "CURRENT_SEASON_SUPPORTED"
        : "TEAM_REVIEW_REQUIRED",
      currentVotes: current,
      previousVotes: previous,
      historicalCandidate:
        bestPrevious?.[0] || null
    };

    result.set(espnTeamId, mapping);
  }

  // Impedir que dos equipos ESPN compartan
  // una correspondencia de equipo aprobada.

  const used = new Map();

  for (const mapping of result.values()) {
    if (!mapping.nbaTeamId) continue;

    const teamId = mapping.nbaTeamId;

    if (used.has(teamId)) {
      mapping.status = "DUPLICATE_TEAM_MAPPING";
      mapping.nbaTeamId = null;

      const prior = used.get(teamId);
      prior.status = "DUPLICATE_TEAM_MAPPING";
      prior.nbaTeamId = null;
    } else {
      used.set(teamId, mapping);
    }
  }

  return result;
}

function classifyPlayers(
  players,
  teamMappings,
  crosswalkRows
) {
  const verified = new Map();
  const reverse = new Map();

  for (const row of crosswalkRows) {
    if (row.verified !== true) continue;

    const espnId = id(row.espn_player_id);
    const nbaId = id(row.nba_player_id);

    if (verified.has(espnId) ||
        reverse.has(nbaId)) {
      throw new Error(
        "Conflicting verified crosswalk records"
      );
    }

    verified.set(espnId, nbaId);
    reverse.set(nbaId, espnId);
  }

  const espnAppearances = new Map();

  for (const player of players) {
    const key = player.espnPlayerId;

    espnAppearances.set(
      key,
      (espnAppearances.get(key) || 0) + 1
    );
  }

  const counts = {
    alreadyVerified: 0,
    strongCandidate: 0,
    teamReview: 0,
    nameMissing: 0,
    ambiguous: 0,
    conflict: 0
  };

  const entries = players.map(player => {
    const mapping = teamMappings.get(
      player.espnTeamId
    );

    const knownId = verified.get(
      player.espnPlayerId
    );

    let status = "";
    let nbaPlayerId = null;

    if (
      espnAppearances.get(player.espnPlayerId) > 1
    ) {
      status = "CONFLICT";
    } else if (knownId) {
      if (
        player.matches.length > 0 &&
        !player.matches.some(
          m => m.nbaPlayerId === knownId
        )
      ) {
        status = "CONFLICT";
      } else {
        status = "ALREADY_VERIFIED";
        nbaPlayerId = knownId;
      }
    } else if (player.matches.length === 0) {
      status = "NAME_MISSING";
    } else if (player.matches.length > 1) {
      status = "AMBIGUOUS";
    } else {
      const candidate = player.matches[0];

      if (
        reverse.has(candidate.nbaPlayerId)
      ) {
        status = "CONFLICT";
      } else if (
        mapping?.nbaTeamId &&
        candidate.latestCurrentTeam ===
          mapping.nbaTeamId
      ) {
        status = "STRONG_CANDIDATE";
        nbaPlayerId = candidate.nbaPlayerId;
      } else {
        status = "TEAM_REVIEW";
        nbaPlayerId = candidate.nbaPlayerId;
      }
    }

    const countName = {
      ALREADY_VERIFIED: "alreadyVerified",
      STRONG_CANDIDATE: "strongCandidate",
      TEAM_REVIEW: "teamReview",
      NAME_MISSING: "nameMissing",
      AMBIGUOUS: "ambiguous",
      CONFLICT: "conflict"
    }[status];

    counts[countName]++;

    return {
      espnPlayerId: player.espnPlayerId,
      espnName: player.espnName,
      espnTeamId: player.espnTeamId,
      team: player.team,
      nbaPlayerId,
      status,
      teamMappingStatus: mapping?.status || null,
      nbaTeamCandidate:
        mapping?.nbaTeamId ||
        mapping?.historicalCandidate ||
        null,
      positions: player.positions,
      possibleMatches: player.matches
    };
  });

  return { counts, entries };
}

async function main() {
  const url = process.env.FANTASY_SUPABASE_URL;
  const key =
    process.env.FANTASY_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Fantasy Supabase credentials"
    );
  }

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  console.log(
    "===== CASHEDGE NBA IDENTITY BUILDER ====="
  );

  console.log("MODE: SHADOW / READ ONLY");

  const teams = await loadTeams();

  const espnPlayers =
    await loadEspnPlayers(teams);

  const [current, previous, saved] =
    await Promise.all([
      loadSeason(db, CURRENT_SEASON),
      loadSeason(db, PREVIOUS_SEASON),
      db.from("fantasy_nba_player_crosswalk")
        .select(
          "espn_player_id,nba_player_id,verified"
        )
    ]);

  if (saved.error) {
    throw new Error(saved.error.message);
  }

  const history = buildHistoryIndex([
    ...current,
    ...previous
  ]);

  const candidates = findCandidates(
    espnPlayers,
    history
  );

  const mappings = inferTeamMappings(
    candidates
  );

  const identities = classifyPlayers(
    candidates,
    mappings,
    saved.data || []
  );

  if (mappings.size !== 30) {
    throw new Error(
      "Team mapping coverage incomplete"
    );
  }

  const report = {
    mode: "shadow",
    sport: "nba",
    source: "espn_supabase",
    generatedAt: new Date().toISOString(),
    seasons: [
      CURRENT_SEASON,
      PREVIOUS_SEASON
    ],
    teamsFound: teams.length,
    entriesFound: espnPlayers.length,
    counts: identities.counts,
    teams: [...mappings.values()],
    players: identities.entries,
    readyForOptimization: false,
    readyForPublication: false
  };

  const destination = path.resolve(OUTPUT);

  fs.mkdirSync(path.dirname(destination), {
    recursive: true
  });

  fs.writeFileSync(
    destination,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(
    "Teams:", report.teamsFound
  );

  console.log(
    "Player entries:", report.entriesFound
  );

  console.log(
    "Classification:",
    JSON.stringify(report.counts, null, 2)
  );

  console.log(
    "Team mappings:",
    JSON.stringify(
      report.teams.map(team => ({
        team: team.team,
        nbaTeamId: team.nbaTeamId,
        status: team.status
      })),
      null,
      2
    )
  );

  console.log(
    "JSON REPORT:", OUTPUT
  );

  console.log(
    "NO DATABASE WRITES | NO FORMULA CHANGES"
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      "NBA_IDENTITY_BUILDER_ERROR:",
      error.stack || error.message
    );

    process.exitCode = 1;
  });
}

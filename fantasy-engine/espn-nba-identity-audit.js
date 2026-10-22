
"use strict";

// CASHEDGE FANTASY EDGE
// ESPN ↔ SUPABASE NBA IDENTITY AUDIT V1
//
// 30 equipos.
// Solo lectura ESPN + Supabase.
// No inserta ni actualiza registros.
// No modifica formulas ni crons.
// SHADOW ONLY.

const { createClient } = require(
  "@supabase/supabase-js"
);

const {
  getDepthChart
} = require("./espn-depthchart-probe");

const {
  normalizeDepthChart
} = require("./espn-depthchart-normalizer");

const TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/" +
  "sports/basketball/nba/teams?limit=100";

const normalize = value =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const asId = value =>
  String(value ?? "").trim();

async function getTeams() {
  const response = await fetch(TEAMS_URL, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `ESPN teams HTTP ${response.status}`
    );
  }

  const json = await response.json();

  const teams =
    json?.sports?.[0]?.leagues?.[0]?.teams;

  if (!Array.isArray(teams)) {
    throw new Error("Invalid ESPN teams");
  }

  const unique = new Map();

  for (const entry of teams) {
    const team = entry?.team;

    if (team?.id && team?.abbreviation) {
      unique.set(asId(team.id), {
        id: asId(team.id),
        abbreviation: team.abbreviation
      });
    }
  }

  return [...unique.values()];
}

async function getEspnPlayers(teams) {
  const output = [];

  for (let i = 0; i < teams.length; i += 3) {
    const batch = teams.slice(i, i + 3);

    const responses = await Promise.all(
      batch.map(team => getDepthChart(team.id))
    );

    responses.forEach((result, index) => {
      const team = batch[index];

      if (
        asId(result.team?.id) !== team.id
      ) {
        throw new Error(
          `ESPN team mismatch: ${team.abbreviation}`
        );
      }

      const records = normalizeDepthChart(result);

      const unique = new Map();

      for (const player of records) {
        if (!unique.has(player.espnPlayerId)) {
          unique.set(player.espnPlayerId, {
            espnId: asId(player.espnPlayerId),
            name: player.playerName,
            espnTeamId: team.id,
            team: team.abbreviation,
            checkedAt: result.checkedAt
          });
        }
      }

      output.push(...unique.values());
    });
  }

  return output;
}

async function getHistory(db, season) {
  const rows = [];
  const pageSize = 1000;
  const maxPages = 100;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;

    const { data, error } = await db
      .from("nba_player_game_stats")
      .select(
        "player_id,player_name,team_id," +
        "season,game_date"
      )
      .eq("season", season)
      .order("game_date", {
        ascending: false
      })
      .order("player_id", {
        ascending: true
      })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `NBA history ${season}: ${error.message}`
      );
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) {
      return rows;
    }
  }

  throw new Error(
    `NBA history ${season}: pagination limit`
  );
}

function buildIdentityIndex(rows) {
  const byName = new Map();

  for (const row of rows) {
    const key = normalize(row.player_name);

    if (!key) continue;

    if (!byName.has(key)) {
      byName.set(key, new Map());
    }

    const playerId = asId(row.player_id);
    const existing = byName.get(key);

    if (!existing.has(playerId)) {
      existing.set(playerId, {
        playerId,
        name: row.player_name,
        teamIds: new Set(),
        seasons: new Set()
      });
    }

    existing.get(playerId)
      .teamIds.add(asId(row.team_id));

    existing.get(playerId)
      .seasons.add(Number(row.season));
  }

  return byName;
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
    "===== NBA ESPN IDENTITY AUDIT ====="
  );
  console.log("SHADOW / READ ONLY");

  const teams = await getTeams();

  if (teams.length !== 30) {
    throw new Error(
      `Expected 30 teams, got ${teams.length}`
    );
  }

  const espnPlayers = await getEspnPlayers(teams);

  const [current, previous, crosswalkResult] =
    await Promise.all([
      getHistory(db, 2026),
      getHistory(db, 2025),
      db.from("fantasy_nba_player_crosswalk")
        .select(
          "espn_player_id,nba_player_id,verified"
        )
    ]);

  if (crosswalkResult.error) {
    throw new Error(
      crosswalkResult.error.message
    );
  }

  const indexed = buildIdentityIndex([
    ...current,
    ...previous
  ]);

  const verified = new Map(
    (crosswalkResult.data || [])
      .filter(row => row.verified === true)
      .map(row => [
        asId(row.espn_player_id),
        asId(row.nba_player_id)
      ])
  );

  const counts = {
    verified: 0,
    candidate: 0,
    missing: 0,
    ambiguous: 0,
    conflict: 0
  };

  const candidates = [];
  const review = [];

  for (const player of espnPlayers) {
    const matches = [
      ...(indexed.get(normalize(player.name))
        ?.values() || [])
    ];

    const known = verified.get(player.espnId);

    if (known) {
      if (
        matches.length &&
        !matches.some(p => p.playerId === known)
      ) {
        counts.conflict++;

        review.push({
          ...player,
          status: "CROSSWALK_NAME_CONFLICT",
          registeredId: known
        });
      } else {
        counts.verified++;
      }

      continue;
    }

    if (!matches.length) {
      counts.missing++;

      review.push({
        ...player,
        status: "NO_EXACT_NAME_MATCH"
      });

      continue;
    }

    if (matches.length > 1) {
      counts.ambiguous++;

      review.push({
        ...player,
        status: "AMBIGUOUS",
        candidateIds: matches.map(
          p => p.playerId
        )
      });

      continue;
    }

    // Solo candidato: una coincidencia de nombre
    // NO demuestra identidad o equipo actual.
    const match = matches[0];

    counts.candidate++;

    candidates.push({
      espnId: player.espnId,
      espnName: player.name,
      espnTeam: player.team,
      nbaId: match.playerId,
      nbaName: match.name,
      historicalTeamIds: [...match.teamIds],
      seasons: [...match.seasons],
      status: "CANDIDATE_REQUIRES_VERIFICATION"
    });
  }

  console.log("ESPN teams:", teams.length);
  console.log("ESPN unique team-player entries:",
    espnPlayers.length);
  console.log("Current season rows:", current.length);
  console.log("Previous season rows:", previous.length);

  console.log(
    "IDENTITY COUNTS:",
    JSON.stringify(counts, null, 2)
  );

  console.log(
    "CANDIDATES:",
    JSON.stringify(candidates, null, 2)
  );

  console.log(
    "REVIEW REQUIRED:",
    JSON.stringify(review, null, 2)
  );

  console.log(
    "NO DATABASE WRITES | NO FORMULA CHANGES"
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      "IDENTITY_AUDIT_ERROR:",
      error.message
    );

    process.exitCode = 1;
  });
}


"use strict";

// CASHEDGE FANTASY NBA
// STAGE PROVISIONAL PLAYER IDENTITIES
//
// SOLO escribe en:
// public.fantasy_nba_player_crosswalk
//
// Nunca actualiza registros existentes.
// Nunca marca candidatos como verificados.
// Nunca modifica tablas de produccion.
// SHADOW ONLY.

const fs = require("node:fs");
const { createClient } = require("@supabase/supabase-js");

const REPORT_PATH =
  "fantasy-shadow-input/nba-identity-report.json";

const TABLE = "fantasy_nba_player_crosswalk";
const BATCH_SIZE = 40;

const asId = value =>
  String(value ?? "").trim();

async function loadExisting(db) {
  const rows = [];

  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await db
      .from(TABLE)
      .select(
        "espn_player_id,nba_player_id,verified"
      )
      .range(offset, offset + 999);

    if (error) throw error;

    rows.push(...(data || []));

    if (!data || data.length < 1000) {
      return rows;
    }
  }

  throw new Error("Crosswalk pagination limit");
}

function prepareCandidates(report, existing) {
  if (
    report.mode !== "shadow" ||
    report.sport !== "nba" ||
    report.teamsFound !== 30 ||
    !Array.isArray(report.players) ||
    !Array.isArray(report.teams)
  ) {
    throw new Error("Invalid identity report");
  }

  const teams = new Map(
    report.teams.map(team => [
      asId(team.espnTeamId),
      team
    ])
  );

  const existingEspn = new Map();
  const existingNba = new Map();

  for (const row of existing) {
    const espnId = asId(row.espn_player_id);
    const nbaId = asId(row.nba_player_id);

    if (existingEspn.has(espnId)) {
      throw new Error(
        "Existing duplicate ESPN identity"
      );
    }

    existingEspn.set(espnId, nbaId);

    if (
      existingNba.has(nbaId) &&
      existingNba.get(nbaId) !== espnId
    ) {
      throw new Error(
        "Existing NBA identity conflict: " + nbaId
      );
    }

    existingNba.set(nbaId, espnId);
  }

  const candidates = report.players.filter(
    p => p.status === "STRONG_CANDIDATE"
  );

  const batchEspn = new Set();
  const batchNba = new Set();
  const pending = [];

  let alreadySaved = 0;

  for (const player of candidates) {
    const espnId = asId(player.espnPlayerId);
    const nbaId = asId(player.nbaPlayerId);

    const team = teams.get(
      asId(player.espnTeamId)
    );

    const matches = player.possibleMatches || [];

    if (
      !espnId ||
      !nbaId ||
      !team ||
      team.status !== "CURRENT_SEASON_SUPPORTED" ||
      !team.nbaTeamId ||
      matches.length !== 1 ||
      asId(matches[0].nbaPlayerId) !== nbaId ||
      asId(matches[0].latestCurrentTeam) !==
        asId(team.nbaTeamId)
    ) {
      throw new Error(
        "Candidate failed validation: " + espnId
      );
    }

    if (
      batchEspn.has(espnId) ||
      batchNba.has(nbaId)
    ) {
      throw new Error(
        "Duplicate candidate identity: " + espnId
      );
    }

    batchEspn.add(espnId);
    batchNba.add(nbaId);

    const savedNba = existingEspn.get(espnId);
    const savedEspn = existingNba.get(nbaId);

    if (
      (savedNba && savedNba !== nbaId) ||
      (savedEspn && savedEspn !== espnId)
    ) {
      throw new Error(
        "Existing mapping conflict: " + espnId
      );
    }

    if (savedNba === nbaId) {
      alreadySaved++;
      continue;
    }

    pending.push({
      espn_player_id: espnId,
      nba_player_id: Number(nbaId),
      espn_player_name: player.espnName,
      nba_player_name: matches[0].nbaName,
      verified: false,
      verification_source:
        "fantasy_shadow_current_team_candidate"
    });
  }

  return {
    candidatesFound: candidates.length,
    alreadySaved,
    pending
  };
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

  const report = JSON.parse(
    fs.readFileSync(REPORT_PATH, "utf8")
  );

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const existing = await loadExisting(db);

  const prepared = prepareCandidates(
    report,
    existing
  );

  console.log(
    "===== FANTASY NBA IDENTITY STAGING ====="
  );

  console.log(
    "Strong candidates:",
    prepared.candidatesFound
  );

  console.log(
    "Already saved:",
    prepared.alreadySaved
  );

  console.log(
    "New provisional records:",
    prepared.pending.length
  );

  let inserted = 0;

  for (
    let i = 0;
    i < prepared.pending.length;
    i += BATCH_SIZE
  ) {
    const batch = prepared.pending.slice(
      i,
      i + BATCH_SIZE
    );

    // INSERT, no UPSERT.
    // Los registros anteriores no se reemplazan.
    const { data, error } = await db
      .from(TABLE)
      .insert(batch)
      .select("espn_player_id");

    if (error) {
      throw new Error(
        "Fantasy insert failed: " + error.message
      );
    }

    inserted += (data || []).length;
  }

  const finalRows = await loadExisting(db);

  const verified = finalRows.filter(
    row => row.verified === true
  ).length;

  const provisional = finalRows.filter(
    row => row.verified === false
  ).length;

  console.log(
    "INSERTED THIS RUN:", inserted
  );

  console.log(
    "TOTAL VERIFIED:", verified
  );

  console.log(
    "TOTAL PROVISIONAL:", provisional
  );

  console.log(
    "TOTAL CROSSWALK:", finalRows.length
  );

  console.log(
    "EXISTING PRODUCTION TABLES UNCHANGED"
  );

  console.log(
    "FANTASY ONLY | NO FORMULA CHANGES"
  );
}

main().catch(error => {
  console.error(
    "FANTASY_STAGING_ERROR:",
    error.stack || error.message
  );

  process.exitCode = 1;
});

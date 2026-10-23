// ============================================================
// CASHEDGE FANTASY NFL — DATOS DIARIOS
// ============================================================
//
// Guarda en Supabase todo lo que la formula NFL necesita del
// dia del partido. La formula NUNCA llama a estas fuentes:
// solo lee lo que este archivo deja guardado.
//
//   players  NFLverse: enlace GSIS <-> ESPN y estado de roster
//            (activo, IR, practica, cortado)   -> football_players
//   depth    Depth chart ESPN de los 32 equipos -> football_depth_chart
//   slates   Slates y salarios DK / FD de los proximos 7 dias
//            (BALLDONTLIE)                      -> fantasy_nfl_slates
//                                                  fantasy_nfl_slate_players
//   weather  Pronostico de viento a la hora de cada partido al
//            aire libre (Open-Meteo, gratis)    -> football_game_weather
//
// Las lesiones NO se bajan aqui: ya las guarda tu nfl-injury-cron
// en nfl_injury_state.
//
// USO
//   /api/fantasy-nfl-daily?secret=...              -> todo
//   /api/fantasy-nfl-daily?secret=...&step=depth   -> un paso
//   steps: all, refresh, players, depth, slates, weather
//
// SHADOW: no toca picks, props, nfl_* ni ningun otro cron.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BDL = "https://api.balldontlie.io";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

const TIMEOUT_MS = 20000;
const ESPN_CONCURRENCY = 5;
const SLATE_DAYS = 7;          // slates de hoy y los 6 dias siguientes
const WEATHER_DAYS = 8;        // Open-Meteo pronostica hasta 16; con 8 sobra
const GAME_HOURS = 4;          // promedio del viento durante el partido

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);


// ============================================================
// UTILIDADES
// ============================================================

const str = value => String(value ?? "").trim();

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "NA") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// NFL: la temporada 2026 va de septiembre 2026 a febrero 2027.
function currentNFLSeason() {
  const now = new Date();
  return now.getMonth() + 1 >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function chicagoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function easternParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23"
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Todos los archivos usan el codigo NFLverse (LA = Rams, WAS = Washington).
const TEAM_ALIASES = {
  LAR: "LA", STL: "LA",
  WSH: "WAS",
  JAC: "JAX",
  OAK: "LV", LVR: "LV",
  SD: "LAC",
  GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB"
};

function teamCode(raw) {
  const value = str(raw).toUpperCase();
  return TEAM_ALIASES[value] || value;
}

// Quita acentos, apostrofes, puntos y sufijos (Jr, III...).
// "D.J. Moore" -> "dj moore", "Ja'Marr Chase" -> "jamarr chase".
function normalizeName(value) {
  return str(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(t => t && !["jr", "sr", "ii", "iii", "iv", "v"].includes(t))
    .join(" ");
}

function initialLast(name) {
  const parts = normalizeName(name).split(" ");
  return parts.length > 1 ? `${parts[0][0]}:${parts.slice(1).join(" ")}` : null;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}


// ============================================================
// HTTP (con reintentos para 429 / 5xx)
// ============================================================

async function fetchText(url, headers = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CashEdge-Fantasy/1.0", ...headers },
        signal: controller.signal
      });
      const text = await response.text();
      if (response.ok) return text;

      lastError = new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 200)}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;

    } catch (error) {
      lastError = error.name === "AbortError" ? new Error(`Timeout ${url}`) : error;
      if (/HTTP (4\d\d)/.test(lastError.message) && !/HTTP 429/.test(lastError.message)) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }

  throw lastError;
}

async function fetchJSON(url, headers = {}) {
  return JSON.parse(await fetchText(url, { Accept: "application/json", ...headers }));
}

function bdlKey() {
  return process.env.BALLDONTLIE_NFL_API_KEY || process.env.BALLDONTLIE_API_KEY || "";
}

function bdlFetch(path, params = []) {
  const url = new URL(BDL + path);
  for (const [key, value] of params) url.searchParams.append(key, String(value));
  return fetchJSON(url.toString(), { Authorization: bdlKey() });
}

// Todas las paginas (cursor).
async function bdlPages(path, params = []) {
  const rows = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 60; page++) {
    const response = await bdlFetch(path, [
      ...params,
      ["per_page", 100],
      ...(cursor ? [["cursor", cursor]] : [])
    ]);

    if (!Array.isArray(response?.data)) {
      throw new Error(`BALLDONTLIE ${path}: respuesta sin data`);
    }

    rows.push(...response.data);

    const next = response?.meta?.next_cursor;
    if (next === null || next === undefined || next === "") return rows;

    if (seen.has(String(next))) throw new Error(`BALLDONTLIE ${path}: cursor repetido`);
    seen.add(String(next));
    cursor = next;
  }

  throw new Error(`BALLDONTLIE ${path}: demasiadas paginas`);
}


// ============================================================
// SUPABASE
// ============================================================

async function selectAll(table, columns, build = q => q) {
  const rows = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(
      supabaseAdmin.from(table).select(columns)
    ).range(from, from + PAGE - 1);

    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function upsertAll(table, rows, onConflict, size = 500) {
  let saved = 0;
  for (const part of chunks(rows, size)) {
    const { error } = await supabaseAdmin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    saved += part.length;
  }
  return saved;
}


// ============================================================
// CSV (misma lectura que fantasy-nfl-weekly.js)
// ============================================================

function parseCSV(text, required, optional = []) {
  if (typeof text !== "string" || !text.trim()) throw new Error("CSV vacio");

  const results = [];
  let headers = null;
  let indexes = [];
  let fields = [];
  let field = "";
  let quoted = false;

  const finishRow = () => {
    fields.push(field);
    field = "";
    if (!headers) {
      headers = fields.map(v => v.replace(/^﻿/, "").trim());
      const missing = required.filter(name => !headers.includes(name));
      if (missing.length) throw new Error("CSV columnas faltantes: " + missing.join(", "));
      const wanted = new Set([...required, ...optional]);
      indexes = headers.map((name, i) => (wanted.has(name) ? [name, i] : null)).filter(Boolean);
    } else if (fields.some(v => v !== "")) {
      const obj = {};
      for (const [name, i] of indexes) obj[name] = fields[i] ?? "";
      results.push(obj);
    }
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (fields.length || field.length) finishRow();
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV con comillas incompletas");
  if (fields.length || field.length) finishRow();
  return { headers, rows: results };
}


// ============================================================
// PASO 1: JUGADORES (NFLverse)
// ============================================================
// Enlaza el ID de ESPN (depth chart y lesiones) con el GSIS de
// NFLverse (snaps y produccion). Ademas trae el estado de roster:
// un jugador en IR (RES) o en practica (DEV) no puede jugar.

async function stepPlayers() {
  const season = currentNFLSeason();
  const { rows } = parseCSV(
    await fetchText(PLAYERS_URL),
    ["gsis_id", "display_name", "position", "latest_team", "status", "espn_id", "last_season"],
    ["first_name", "last_name", "jersey_number", "rookie_season"]
  );

  const runAt = new Date().toISOString();
  const out = new Map();
  let duplicated = 0;

  for (const r of rows) {
    const gsis = str(r.gsis_id);
    const position = str(r.position).toUpperCase();
    const last = numberOrNull(r.last_season);
    if (!gsis || gsis === "NA" || !POSITIONS.has(position) || last === null || last < season - 1) continue;

    if (out.has(gsis)) {
      duplicated++;
      continue;
    }

    const espn = str(r.espn_id);
    out.set(gsis, {
      gsis_player_id: gsis,
      player_name: str(r.display_name),
      first_name: str(r.first_name) || null,
      last_name: str(r.last_name) || null,
      position,
      team: str(r.latest_team) && str(r.latest_team) !== "NA" ? teamCode(r.latest_team) : null,
      roster_status: str(r.status) && str(r.status) !== "NA" ? str(r.status).toUpperCase() : null,
      espn_athlete_id: espn && espn !== "NA" ? espn.replace(/\.0$/, "") : null,
      jersey_number: str(r.jersey_number) && str(r.jersey_number) !== "NA" ? str(r.jersey_number) : null,
      rookie_season: numberOrNull(r.rookie_season),
      last_season: last,
      synced_at: runAt
    });
  }

  const list = [...out.values()];
  if (list.length < 500) throw new Error(`NFLverse players devolvio solo ${list.length} jugadores`);

  await upsertAll("football_players", list, "gsis_player_id");

  const status = {};
  for (const p of list) if (p.last_season === season) status[p.roster_status || "?"] = (status[p.roster_status || "?"] || 0) + 1;

  return {
    jugadores: list.length,
    conIdESPN: list.filter(p => p.espn_athlete_id).length,
    duplicados: duplicated,
    estadoRosterTemporadaActual: status
  };
}


// ============================================================
// PASO 2: DEPTH CHART ESPN
// ============================================================

async function espnTeams() {
  const data = await fetchJSON(`${ESPN}/teams?limit=100`);
  const list = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = list
    .map(entry => entry?.team)
    .filter(t => t?.id && t?.abbreviation)
    .map(t => ({ id: str(t.id), code: teamCode(t.abbreviation) }));

  if (teams.length < 32) throw new Error(`ESPN devolvio ${teams.length} equipos`);
  return teams;
}

function athleteId(a) {
  const id = str(a?.id || a?.athlete?.id);
  if (id) return id;
  const ref = str(a?.$ref || a?.athlete?.$ref);
  return ref.match(/athletes\/(\d+)/)?.[1] || "";
}

// La formacion ofensiva es la que tiene QB.
// En cada posicion puede haber una o varias casillas (ej. tres
// casillas de WR). El orden de la posicion se arma asi:
// primero los titulares de cada casilla, luego los segundos, etc.
function parseDepth(depth) {
  const charts = depth?.depthchart ?? depth?.depthcharts ?? [];
  const chartList = Array.isArray(charts) ? charts : [charts];

  const offense = chartList.find(chart =>
    Object.entries(chart?.positions || {}).some(([key, entry]) =>
      str(entry?.position?.abbreviation || key).toUpperCase() === "QB"
    )
  );
  if (!offense) throw new Error("sin formacion ofensiva");

  const groups = new Map();
  for (const [key, entry] of Object.entries(offense.positions || {})) {
    const position = str(entry?.position?.abbreviation || key).toUpperCase().replace(/\d+$/, "");
    if (!POSITIONS.has(position)) continue;
    const athletes = Array.isArray(entry?.athletes) ? entry.athletes : [];
    pushTo(groups, position, { slot: key, athletes });
  }

  const rows = [];
  for (const [position, slots] of groups) {
    const seen = new Set();
    let rank = 0;
    const depthLevels = Math.max(0, ...slots.map(s => s.athletes.length));

    for (let level = 0; level < depthLevels; level++) {
      for (const s of slots) {
        const a = s.athletes[level];
        const id = athleteId(a);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rank++;
        rows.push({
          espn_athlete_id: id,
          position,
          position_rank: rank,
          slot: s.slot,
          slot_rank: level + 1,
          player_name: str(a?.displayName || a?.athlete?.displayName || a?.fullName) || null,
          espn_injury: str(a?.injuries?.[0]?.status) || null
        });
      }
    }
  }

  if (!rows.some(r => r.position === "QB")) throw new Error("depth chart sin QB");

  return {
    rows,
    formato: {
      formacion: str(offense.name) || null,
      casillas: [...groups].map(([p, s]) => `${p}: ${s.map(x => `${x.slot}(${x.athletes.length})`).join(" ")}`)
    }
  };
}

async function stepDepth() {
  const runAt = new Date().toISOString();
  const day = chicagoDay();

  const [teams, players] = await Promise.all([
    espnTeams(),
    selectAll("football_players", "gsis_player_id,player_name,position,team,espn_athlete_id")
  ]);

  if (!players.length) throw new Error("football_players vacia: corre primero step=players");

  const byEspn = new Map(players.filter(p => p.espn_athlete_id).map(p => [str(p.espn_athlete_id), p]));
  const byTeamName = new Map();
  for (const p of players) pushTo(byTeamName, `${p.team}|${normalizeName(p.player_name)}`, p);

  const failedTeams = [];
  const okTeams = [];
  const rows = [];
  const unlinked = [];
  let sample = null;

  await pool(teams, ESPN_CONCURRENCY, async team => {
    let parsed;
    try {
      parsed = parseDepth(await fetchJSON(`${ESPN}/teams/${team.id}/depthcharts`));
    } catch (error) {
      failedTeams.push(`${team.code}: ${error.message}`);
      return;
    }

    okTeams.push(team.code);
    if (!sample) sample = { equipo: team.code, ...parsed.formato };

    for (const r of parsed.rows) {
      let p = byEspn.get(r.espn_athlete_id) || null;
      let method = p ? "espn_id" : null;

      // Respaldo: mismo equipo + mismo nombre (solo si es unico).
      if (!p && r.player_name) {
        const found = byTeamName.get(`${team.code}|${normalizeName(r.player_name)}`) || [];
        if (found.length === 1) {
          p = found[0];
          method = "equipo_nombre";
        }
      }

      if (!p) unlinked.push(`${r.player_name || r.espn_athlete_id} (${team.code} ${r.position}${r.position_rank})`);

      rows.push({
        snapshot_date: day,
        team: team.code,
        ...r,
        gsis_player_id: p?.gsis_player_id || null,
        checked_at: runAt
      });
    }
  });

  if (!okTeams.length) throw new Error(`ESPN no respondio para ningun equipo: ${failedTeams.join(" | ")}`);

  await upsertAll("football_depth_chart", rows, "snapshot_date,team,espn_athlete_id,position");

  // Quitar de hoy a quien ESPN ya no lista (solo equipos que respondieron).
  const { error } = await supabaseAdmin
    .from("football_depth_chart")
    .delete()
    .eq("snapshot_date", day)
    .in("team", okTeams)
    .lt("checked_at", runAt);
  if (error) throw new Error(`Supabase football_depth_chart: ${error.message}`);

  const starters = rows.filter(r => r.position_rank === 1);
  return {
    snapshotDate: day,
    equipos: okTeams.length,
    equiposFallidos: failedTeams,
    filas: rows.length,
    titularesSinEnlace: starters.filter(r => !r.gsis_player_id).map(r => `${r.player_name} (${r.team} ${r.position})`),
    sinEnlaceTotal: unlinked.length,
    sinEnlace: unlinked.slice(0, 30),
    formatoESPN: sample
  };
}


// ============================================================
// PASO 3: SLATES Y SALARIOS (BALLDONTLIE)
// ============================================================

// Slate principal del dia: el de mas partidos cuyo ultimo partido
// empieza antes de las 6 pm del este (asi el domingo es el "Main"
// de 1 pm + 4 pm y no el que incluye el Sunday/Monday Night).
// Si ninguno cumple (ej. lunes), el de mas partidos.
function markMain(slates) {
  const byKey = new Map();
  for (const s of slates) pushTo(byKey, `${s.platform}|${s.slate_date}`, s);

  for (const list of byKey.values()) {
    const sameDay = list.filter(s => {
      if (!s.last_event_starts_at || !s.starts_at) return false;
      const first = easternParts(new Date(s.starts_at));
      const last = easternParts(new Date(s.last_event_starts_at));
      return first.day === last.day && last.hour < 18;
    });
    const pick = (sameDay.length ? sameDay : list)
      .slice()
      .sort((a, b) =>
        (b.event_count || 0) - (a.event_count || 0) ||
        String(a.starts_at).localeCompare(String(b.starts_at))
      )[0];
    if (pick) pick.is_main = true;
  }
}

function buildPlayerIndex(players) {
  const idx = {
    teamPosName: new Map(),
    teamName: new Map(),
    posName: new Map(),
    teamInitialLast: new Map()
  };
  for (const p of players) {
    const name = normalizeName(p.player_name);
    pushTo(idx.teamPosName, `${p.team}|${p.position}|${name}`, p);
    pushTo(idx.teamName, `${p.team}|${name}`, p);
    pushTo(idx.posName, `${p.position}|${name}`, p);
    const il = initialLast(p.player_name);
    if (il) pushTo(idx.teamInitialLast, `${p.team}|${il}`, p);
  }
  return idx;
}

// BALLDONTLIE no usa el ID GSIS: se enlaza por equipo + posicion +
// nombre, y solo si hay UN candidato.
function linkPlayer(idx, team, position, name) {
  const n = normalizeName(name);
  const tries = [
    ["equipo_posicion_nombre", idx.teamPosName.get(`${team}|${position}|${n}`)],
    ["equipo_nombre", idx.teamName.get(`${team}|${n}`)],
    // Cambiado de equipo hace poco: nombre + posicion unicos en la liga.
    ["posicion_nombre_liga", idx.posName.get(`${position}|${n}`)],
    ["equipo_inicial_apellido", idx.teamInitialLast.get(`${team}|${initialLast(name)}`)]
  ];
  for (const [method, found] of tries) {
    if (found && found.length === 1) return { gsis: found[0].gsis_player_id, method };
  }
  return null;
}

function draftablePosition(d) {
  const entity = str(d.entity_type).toLowerCase();
  if (entity === "team") return "DST";
  for (const raw of str(d.position).toUpperCase().split(/[\/,]/)) {
    const p = raw.trim();
    if (POSITIONS.has(p)) return p === "FB" ? "RB" : p;
    if (["DST", "D", "DEF", "D/ST"].includes(p)) return "DST";
  }
  return null;
}

async function loadSlatePlayers(slate, idx, runAt) {
  const detail = (await bdlFetch(`/nfl/v1/dfs/slates/${slate.slate_id}`)).data || {};
  const draftables = await bdlPages("/nfl/v1/dfs/draftables", [["slate_ids[]", slate.slate_id]]);

  const rosterSlots = {};
  for (const s of detail.roster_slots || []) {
    if (s.active === false) continue;
    const name = str(s.name).toUpperCase();
    rosterSlots[name] = (rosterSlots[name] || 0) + (Number(s.required_count) || 1);
  }
  slate.roster_slots = rosterSlots;
  slate.events = (detail.events || []).map(e => ({
    id: e.id,
    name: e.name ?? null,
    starts_at: e.starts_at ?? null,
    game_id: e.game_id ?? null,
    active: e.active ?? null
  }));
  slate.style = str(detail.style || slate.style) || null;
  slate.salary_cap = numberOrNull(detail.salary_cap) ?? slate.salary_cap;

  const out = new Map();
  const conflicts = new Set();
  const skipped = { inactivo: 0, sinSalario: 0, posicion: 0 };

  for (const d of draftables) {
    if (d.active === false || d.is_disabled === true) {
      skipped.inactivo++;
      continue;
    }
    const salary = numberOrNull(d.salary);
    if (salary === null || salary <= 0) {
      skipped.sinSalario++;
      continue;
    }
    const position = draftablePosition(d);
    if (!position) {
      skipped.posicion++;
      continue;
    }

    const isTeam = position === "DST";
    const playerId = numberOrNull(d.player_id);
    const teamId = numberOrNull(d.team_id);
    if (isTeam ? teamId === null : playerId === null) {
      skipped.posicion++;
      continue;
    }

    const key = isTeam ? `DST:${teamId}` : `P:${playerId}`;
    const eventId = numberOrNull(d.slate_event_id);

    // El mismo jugador sale una vez por cada casilla (ej. RB y FLEX).
    if (out.has(key)) {
      const prev = out.get(key);
      if (prev.salary !== salary || prev.event_id !== eventId) conflicts.add(key);
      continue;
    }

    out.set(key, {
      slate_id: slate.slate_id,
      entity_key: key,
      platform: slate.platform,
      slate_date: slate.slate_date,
      entity_type: isTeam ? "team" : "player",
      bdl_player_id: isTeam ? null : playerId,
      bdl_team_id: teamId,
      player_name: str(d.display_name),
      position,
      team: teamCode(d.team_abbreviation) || null,
      event_id: eventId,
      bdl_game_id: numberOrNull(d.game_id),
      salary,
      status: str(d.status) || null,
      gsis_player_id: null,
      link_method: null,
      checked_at: runAt
    });
  }

  for (const key of conflicts) out.delete(key);

  // Enlace a NFLverse. Un GSIS no puede quedar en dos jugadores.
  const claims = new Map();
  for (const row of out.values()) {
    if (row.entity_type !== "player") continue;
    const link = linkPlayer(idx, row.team, row.position, row.player_name);
    if (link) {
      row.gsis_player_id = link.gsis;
      row.link_method = link.method;
      pushTo(claims, link.gsis, row);
    }
  }
  for (const list of claims.values()) {
    if (list.length > 1) for (const row of list) {
      row.gsis_player_id = null;
      row.link_method = "ambiguo";
    }
  }

  const rows = [...out.values()];
  if (rows.length) await upsertAll("fantasy_nfl_slate_players", rows, "slate_id,entity_key");

  // Quien la casa retiro del slate.
  const { error } = await supabaseAdmin
    .from("fantasy_nfl_slate_players")
    .delete()
    .eq("slate_id", slate.slate_id)
    .lt("checked_at", runAt);
  if (error) throw new Error(`Supabase fantasy_nfl_slate_players: ${error.message}`);

  const players = rows.filter(r => r.entity_type === "player");
  const unlinked = players.filter(r => !r.gsis_player_id);
  // Los que importan: los que cuestan mas de $3,500.
  const unlinkedRelevant = unlinked.filter(r => r.salary > 3500);

  return {
    jugadores: players.length,
    dst: rows.length - players.length,
    enlazados: players.length - unlinked.length,
    sinEnlace: unlinked.length,
    sinEnlaceMasDe3500: unlinkedRelevant.map(r => `${r.player_name} (${r.team} ${r.position} $${r.salary})`).slice(0, 25),
    conflictos: conflicts.size,
    descartados: skipped
  };
}

async function stepSlates() {
  if (!bdlKey()) throw new Error("BALLDONTLIE_NFL_API_KEY / BALLDONTLIE_API_KEY no configurada");

  const runAt = new Date().toISOString();
  const today = chicagoDay();
  const until = addDays(today, SLATE_DAYS - 1);

  const players = await selectAll("football_players", "gsis_player_id,player_name,position,team");
  if (!players.length) throw new Error("football_players vacia: corre primero step=players");
  const idx = buildPlayerIndex(players);

  const slates = [];
  const otherStyles = {};

  for (const platform of ["draftkings", "fanduel"]) {
    const list = await bdlPages("/nfl/v1/dfs/slates", [
      ["providers[]", platform],
      ["formats[]", "salary_cap"],
      ["scopes[]", "multi_event"],
      ["start_date", today],
      ["end_date", until]
    ]);

    for (const s of list) {
      if (s.provider !== platform || s.format !== "salary_cap" || s.active === false) continue;
      if (s.scope && s.scope !== "multi_event") continue;
      if (!(numberOrNull(s.salary_cap) > 0) || !s.starts_at) continue;

      // DraftKings "Classic", FanDuel "Full Roster" (las de 9 jugadores).
      if (!/^(classic|full roster)$/i.test(str(s.style))) {
        const k = `${platform}: ${str(s.style) || "?"}`;
        otherStyles[k] = (otherStyles[k] || 0) + 1;
        continue;
      }

      const slateDate = chicagoDay(new Date(s.starts_at));
      if (slateDate < today || slateDate > until) continue;

      slates.push({
        slate_id: Number(s.id),
        platform,
        slate_date: slateDate,
        style: str(s.style) || null,
        salary_cap: numberOrNull(s.salary_cap),
        starts_at: s.starts_at,
        last_event_starts_at: s.last_event_starts_at || null,
        event_count: numberOrNull(s.event_count),
        is_main: false,
        roster_slots: null,
        events: null,
        checked_at: runAt
      });
    }
  }

  markMain(slates);

  const report = [];
  for (const slate of slates.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))) {
    try {
      const r = await loadSlatePlayers(slate, idx, runAt);
      report.push({ slate: slate.slate_id, plataforma: slate.platform, fecha: slate.slate_date, principal: slate.is_main, partidos: slate.event_count, ...r });
    } catch (error) {
      report.push({ slate: slate.slate_id, plataforma: slate.platform, fecha: slate.slate_date, error: error.message });
    }
  }

  if (slates.length) await upsertAll("fantasy_nfl_slates", slates, "slate_id");

  return {
    desde: today,
    hasta: until,
    slates: report,
    otrosFormatosIgnorados: otherStyles
  };
}


// ============================================================
// PASO 4: CLIMA (Open-Meteo, gratis, sin clave)
// ============================================================
// Solo partidos sin techo fijo. El viento se promedia durante las
// 4 horas del partido. Que tanto baja los pases y patadas NO se
// inventa: la formula lo mide con el historial (football_schedule.wind).

// Coordenadas de cada estadio (stadium_id de NFLverse).
const STADIUMS = {
  ATL97: [33.7554, -84.4008], BAL00: [39.2780, -76.6227], BOS00: [42.0909, -71.2643],
  BUF00: [42.7738, -78.7870], CAR00: [35.2258, -80.8528], CHI98: [41.8623, -87.6167],
  CIN00: [39.0955, -84.5161], CLE00: [41.5061, -81.6995], DAL00: [32.7473, -97.0945],
  DEN00: [39.7439, -105.0201], DET00: [42.3400, -83.0456], GNB00: [44.5013, -88.0622],
  HOU00: [29.6847, -95.4107], IND00: [39.7601, -86.1639], JAX00: [30.3239, -81.6373],
  KAN00: [39.0489, -94.4839], LAX01: [33.9535, -118.3392], MIA00: [25.9580, -80.2389],
  MIN01: [44.9737, -93.2581], NAS00: [36.1665, -86.7713], NOR00: [29.9511, -90.0812],
  NYC01: [40.8135, -74.0745], PHI00: [39.9008, -75.1675], PHO00: [33.5276, -112.2626],
  PIT00: [40.4468, -80.0158], SEA00: [47.5952, -122.3316], SFO01: [37.4030, -121.9700],
  TAM00: [27.9759, -82.5033], VEG00: [36.0909, -115.1833], WAS00: [38.9078, -76.8645],
  // Partidos internacionales
  LON00: [51.5560, -0.2796], LON02: [51.6043, -0.0664], MAD01: [40.4531, -3.6883],
  MEL00: [-37.8200, 144.9834], MEX00: [19.3029, -99.1505], MUN01: [48.2188, 11.6247],
  PAR00: [48.9245, 2.3602], RIO00: [-22.9122, -43.2302], FRA00: [50.0686, 8.6455],
  SAO00: [-23.5453, -46.4742], BER00: [52.5147, 13.2395], DUB00: [53.3607, -6.2511]
};

const avg = list => {
  const v = list.filter(x => Number.isFinite(x));
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
};

async function stepWeather() {
  const runAt = new Date().toISOString();
  const today = chicagoDay();
  const until = addDays(today, WEATHER_DAYS - 1);

  const games = await selectAll(
    "football_schedule",
    "game_id,game_date,game_time_et,roof,stadium_id,home_score",
    q => q.gte("game_date", today).lte("game_date", until)
  );

  const pending = games.filter(g => g.home_score === null);
  const skipped = { techo: 0, sinEstadio: [], sinHora: 0, fueraDelPronostico: 0 };
  const byStadium = new Map();

  for (const g of pending) {
    if (str(g.roof).toLowerCase() === "dome") {
      skipped.techo++;
      continue;
    }
    if (!STADIUMS[g.stadium_id]) {
      skipped.sinEstadio.push(`${g.game_id} (${g.stadium_id || "?"})`);
      continue;
    }
    if (!/^\d{1,2}:\d{2}/.test(str(g.game_time_et))) {
      skipped.sinHora++;
      continue;
    }
    pushTo(byStadium, g.stadium_id, g);
  }

  const rows = [];
  const failed = [];

  await pool([...byStadium.keys()], 4, async stadium => {
    const [lat, lon] = STADIUMS[stadium];
    const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}` +
      "&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm" +
      `&timezone=America%2FNew_York&forecast_days=${Math.min(16, WEATHER_DAYS + 1)}`;

    let data;
    try {
      data = await fetchJSON(url);
    } catch (error) {
      failed.push(`${stadium}: ${error.message}`);
      return;
    }

    const h = data?.hourly || {};
    const index = new Map((h.time || []).map((t, i) => [t, i]));

    for (const g of byStadium.get(stadium)) {
      const hour = Number(str(g.game_time_et).split(":")[0]);
      const start = index.get(`${g.game_date}T${String(hour).padStart(2, "0")}:00`);
      if (start === undefined) {
        skipped.fueraDelPronostico++;
        continue;
      }
      const span = k => (h[k] || []).slice(start, start + GAME_HOURS).map(Number);

      rows.push({
        game_id: g.game_id,
        game_date: g.game_date,
        kickoff_et: str(g.game_time_et),
        stadium_id: stadium,
        roof: g.roof || null,
        wind_mph: avg(span("wind_speed_10m")),
        gust_mph: avg(span("wind_gusts_10m")),
        temp_f: avg(span("temperature_2m")),
        precip_mm: Math.round(span("precipitation").filter(Number.isFinite).reduce((s, x) => s + x, 0) * 10) / 10,
        precip_prob: (() => {
          const p = span("precipitation_probability").filter(Number.isFinite);
          return p.length ? Math.max(...p) : null;
        })(),
        source: "open-meteo",
        checked_at: runAt
      });
    }
  });

  if (rows.length) await upsertAll("football_game_weather", rows, "game_id");

  const windy = rows.filter(r => r.wind_mph >= 15).map(r => `${r.game_id} ${r.wind_mph} mph`);
  return {
    desde: today,
    hasta: until,
    partidos: rows.length,
    conVientoFuerte: windy,
    omitidos: skipped,
    estadiosFallidos: failed
  };
}


// ============================================================
// HANDLER
// ============================================================

function isInternalRequest(req) {
  const secret = process.env.CRON_SECRET || process.env.GENERATE_DAILY_SECRET || "";
  if (!secret) return false;
  const auth = String(req.headers.authorization || "");
  return (
    (auth.startsWith("Bearer ") && auth.slice(7) === secret) ||
    String(req.headers["x-internal-secret"] || "") === secret ||
    String(req.query.secret || "") === secret
  );
}

const PLANS = {
  all: ["players", "depth", "slates", "weather"],
  refresh: ["depth", "slates", "weather"],
  players: ["players"],
  depth: ["depth"],
  slates: ["slates"],
  weather: ["weather"]
};

const STEPS = {
  players: stepPlayers,
  depth: stepDepth,
  slates: stepSlates,
  weather: stepWeather
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isInternalRequest(req)) return res.status(401).json({ error: "Unauthorized" });

  const step = String(req.query.step || "all");
  const plan = PLANS[step];
  if (!plan) return res.status(400).json({ error: "step invalido", valid: Object.keys(PLANS) });

  const t0 = Date.now();
  const results = {};
  const errors = [];

  // Cada paso por separado: si uno falla, los demas siguen.
  for (const name of plan) {
    const s0 = Date.now();
    try {
      results[name] = await STEPS[name]();
    } catch (error) {
      console.error(`FANTASY NFL DAILY ${name}:`, error);
      results[name] = { error: error.message };
      errors.push(`${name}: ${error.message}`);
    }
    results[name].seconds = (Date.now() - s0) / 1000;
  }

  return res.status(200).json({
    ok: errors.length === 0,
    step,
    errores: errors,
    results,
    seconds: (Date.now() - t0) / 1000
  });
};

module.exports.parseDepth = parseDepth;
module.exports.normalizeName = normalizeName;
module.exports.linkPlayer = linkPlayer;
module.exports.buildPlayerIndex = buildPlayerIndex;
module.exports.markMain = markMain;

const { createClient } = require("@supabase/supabase-js"); 
 
const supabaseAdmin = createClient(

  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const ADMIN_EMAIL = "jesushenriquez1488@gmail.com";
async function searchMLBPlayerByName(playerName) {
  if (!playerName) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}`;

  const response = await fetch(url);
  const data = await response.json();

  const people = data?.people || [];

  if (!people.length) return null;

 return {
  id: people[0].id,
  fullName: people[0].fullName,
  primaryPosition: people[0].primaryPosition?.abbreviation || null,
  batSide: people[0].batSide?.code || null,
  pitchHand: people[0].pitchHand?.code || null,
  currentTeamId: people[0].currentTeam?.id || null,
  currentTeamName: people[0].currentTeam?.name || null
};
}
async function getPlayerGameLog(playerId) {
  if (!playerId) return [];

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&season=2026`;

  const response = await fetch(url);
  const data = await response.json();

  return data?.stats?.[0]?.splits || [];
}
async function getPlayerSeasonStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=2026`;

  const response = await fetch(url);
  const data = await response.json();

  const split = data?.stats?.[0]?.splits?.[0];

  if (!split) return null;

  return split.stat || null;
}
async function getPlayerHandSplits(playerId) {
  if (!playerId) return [];

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=vl,vr`;

  const response = await fetch(url);
  const data = await response.json();

  return data?.stats?.[0]?.splits || [];
}
async function getTeamSeasonHittingStats(teamId) {
  if (!teamId) return null;

  const url =
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=2026`;

  const response = await fetch(url);
  const data = await response.json();

  const split = data?.stats?.[0]?.splits?.[0];

  return split?.stat || null;
}
function getHandednessBonus(handSplits, pitcherHand) {
  if (!handSplits || !handSplits.length || !pitcherHand) {
    return {
      factor: 1,
      label: "No hand split available",
      splitUsed: null
    };
  }

  const targetSplit =
    pitcherHand === "R"
      ? "vs Right"
      : pitcherHand === "L"
        ? "vs Left"
        : null;

  if (!targetSplit) {
    return {
      factor: 1,
      label: "Unknown pitcher hand",
      splitUsed: null
    };
  }

  const split = handSplits.find(s =>
    String(s.split || "").toLowerCase().includes(targetSplit.toLowerCase())
  );

  if (!split || !split.stat) {
    return {
      factor: 1,
      label: "Matching hand split not found",
      splitUsed: targetSplit
    };
  }

  const avg = Number(String(split.stat.avg || "0").replace(".", "0."));
  const ops = Number(String(split.stat.ops || "0").replace(".", "0."));

  let factor = 1;
  let label = "Neutral split";

  if (avg >= 0.330 || ops >= 0.900) {
    factor = 1.18;
    label = "Strong hand advantage";
  } else if (avg >= 0.290 || ops >= 0.800) {
    factor = 1.10;
    label = "Positive hand advantage";
  } else if (avg <= 0.220 || ops <= 0.650) {
    factor = 0.84;
    label = "Strong hand penalty";
  } else if (avg <= 0.250 || ops <= 0.700) {
    factor = 0.92;
    label = "Negative hand split";
  }

  return {
    factor,
    label,
    splitUsed: targetSplit,
    avg,
    ops
  };
}
function calculateRecentHitterAverages(gameLogs) {
  if (!gameLogs?.length) return null;

  const last10 = gameLogs.slice(-10);

  const totals = {
    hits: 0,
    totalBases: 0,
    rbi: 0,
    runs: 0,
    homeRuns: 0,
    strikeOuts: 0,
    plateAppearances: 0,
    atBats: 0
  };

  last10.forEach(game => {
    const stat = game.stat || {};

    totals.hits += Number(stat.hits || 0);
    totals.totalBases += Number(stat.totalBases || 0);
    totals.rbi += Number(stat.rbi || 0);
    totals.runs += Number(stat.runs || 0);
    totals.homeRuns += Number(stat.homeRuns || 0);
    totals.strikeOuts += Number(stat.strikeOuts || 0);
    totals.plateAppearances += Number(stat.plateAppearances || 0);
    totals.atBats += Number(stat.atBats || 0);
  });

  const games = Math.max(last10.length, 1);

  return {
    games,
    hits: totals.hits / games,
    totalBases: totals.totalBases / games,
    rbi: totals.rbi / games,
    runs: totals.runs / games,
    homeRuns: totals.homeRuns / games,
    strikeOuts: totals.strikeOuts / games,
    plateAppearances: totals.plateAppearances / games,
    atBats: totals.atBats / games
  };
}

function calculateRecentPitcherAverages(gameLogs) {
  if (!gameLogs?.length) return null;

  const last5 = gameLogs.slice(-5);

  const totals = {
    strikeOuts: 0,
    outs: 0,
    hitsAllowed: 0,
    walks: 0,
    earnedRuns: 0,
    homeRunsAllowed: 0,
    pitches: 0
  };

  last5.forEach(game => {
    const stat = game.stat || {};

    totals.strikeOuts += Number(stat.strikeOuts || 0);
    totals.outs += Number(stat.outs || 0);
    totals.hitsAllowed += Number(stat.hits || 0);
    totals.walks += Number(stat.baseOnBalls || 0);
    totals.earnedRuns += Number(stat.earnedRuns || 0);
    totals.homeRunsAllowed += Number(stat.homeRuns || 0);
    totals.pitches += Number(stat.numberOfPitches || 0);
  });

  const games = Math.max(last5.length, 1);

  return {
    games,
    strikeOuts: totals.strikeOuts / games,
    outs: totals.outs / games,
    innings: (totals.outs / games) / 3,
    hitsAllowed: totals.hitsAllowed / games,
    walks: totals.walks / games,
    earnedRuns: totals.earnedRuns / games,
    homeRunsAllowed: totals.homeRunsAllowed / games,
    pitches: totals.pitches / games
  };
}
function playerSafeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function playerClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const PLAYER_PROP_EDGE_RULES = {
  batter_hits: 0.5,
  batter_total_bases: 1.0,
  batter_rbis: 0.5,
  batter_runs_scored: 0.5,
  batter_home_runs: 1.0,
  pitcher_strikeouts: 2.0,
  pitcher_outs: 4.0
};
function calculatePlayerPropConfidence(market, edge) {
  const e = playerSafeNum(edge);

  if (e <= 0) return 0;

 const rules = {
  batter_hits: {
    showEdge: 0.30,
    premiumEdge: 1.00,
    eliteEdge: 3.00
  },
  batter_total_bases: {
    showEdge: 0.50,
    premiumEdge: 1.00,
    eliteEdge: 2.50
  },
  batter_rbis: {
    showEdge: 0.20,
    premiumEdge: 0.90,
    eliteEdge: 2.00
  },
  batter_runs_scored: {
    showEdge: 0.20,
    premiumEdge: 0.90,
    eliteEdge: 2.00
  },
  batter_home_runs: {
    showEdge: 0.10,
    premiumEdge: 0.75,
    eliteEdge: 1.75
  },
  pitcher_strikeouts: {
  showEdge: 0.75,
  premiumEdge: 1.75,
  eliteEdge: 4.00
},
pitcher_outs: {
  showEdge: 1.50,
  premiumEdge: 3.50,
  eliteEdge: 6.50
}
};
  const rule = rules[market];
  if (!rule || e < rule.showEdge) return 0;

if (e < rule.premiumEdge) {
  const percent =
    55 + ((e - rule.showEdge) / (rule.premiumEdge - rule.showEdge)) * 19;

  return Number(percent.toFixed(1));
}

if (e >= rule.eliteEdge) return 99.0;

const percent =
  75 + ((e - rule.premiumEdge) / (rule.eliteEdge - rule.premiumEdge)) * 24;

return Number(percent.toFixed(1));
}
function seasonPerGame(stat, key) {
  const games = playerSafeNum(stat?.gamesPlayed, 0);
  if (games <= 0) return 0;
  return playerSafeNum(stat?.[key], 0) / games;
}

function splitPerGame(handSplits, pitcherHand, key) {
  if (!handSplits?.length) return 0;

  const target =
    pitcherHand === "R"
      ? "vs Right"
      : pitcherHand === "L"
        ? "vs Left"
        : null;

  if (!target) return 0;

  const split = handSplits.find(s =>
    String(s.split?.description || s.split || "")
      .toLowerCase()
      .includes(target.toLowerCase())
  );

  if (!split?.stat) return 0;

  const games = playerSafeNum(split.stat.gamesPlayed, 0);
  if (games <= 0) return 0;

  return playerSafeNum(split.stat[key], 0) / games;
}

function weightedPlayerProjection(recent, season, split) {
  return recent * 0.50 + season * 0.20 + split * 0.30;
}
function applyPitcherQuality(projection, pitcherQualityFactor, weight = 0.10) {
  return projection * (1 + ((pitcherQualityFactor - 1) * weight));
}
function calculateAdvancedPitcherContactFactor(opponentPitcher = {}) {
  const season = opponentPitcher?.seasonStats || {};
  const recent = opponentPitcher?.recentAverages || {};

  const inningsRecent = playerSafeNum(recent.innings, 0);
  const hitsRecent = playerSafeNum(recent.hitsAllowed, 0);
  const walksRecent = playerSafeNum(recent.walks, 0);
  const hrRecent = playerSafeNum(recent.homeRunsAllowed, 0);

  const h9Recent = inningsRecent > 0 ? (hitsRecent / inningsRecent) * 9 : 0;
  const whipRecent = inningsRecent > 0 ? (hitsRecent + walksRecent) / inningsRecent : 0;
  const hr9Recent = inningsRecent > 0 ? (hrRecent / inningsRecent) * 9 : 0;

  const inningsRaw = String(season.inningsPitched || "0");
  const inningsSeason = Number(inningsRaw.split(".")[0]) + (Number(inningsRaw.split(".")[1] || 0) / 3);

  const hitsSeason = playerSafeNum(season.hits, 0);
  const walksSeason = playerSafeNum(season.baseOnBalls, 0);
  const hbpSeason = playerSafeNum(season.hitByPitch, 0);
  const abSeason = playerSafeNum(season.atBats, 0);
  const sfSeason = playerSafeNum(season.sacFlies, 0);

  const doublesAllowed = playerSafeNum(season.doubles, 0);
  const triplesAllowed = playerSafeNum(season.triples, 0);
  const hrAllowed = playerSafeNum(season.homeRuns, 0);

  const singlesAllowed =
    Math.max(0, hitsSeason - doublesAllowed - triplesAllowed - hrAllowed);

  const totalBasesAllowed =
    singlesAllowed +
    doublesAllowed * 2 +
    triplesAllowed * 3 +
    hrAllowed * 4;

  const h9Season =
    inningsSeason > 0 ? (hitsSeason / inningsSeason) * 9 : 0;

  const whipSeason =
    inningsSeason > 0 ? (hitsSeason + walksSeason) / inningsSeason : 0;

  const hr9Season =
    inningsSeason > 0 ? (hrAllowed / inningsSeason) * 9 : 0;

  const avgAllowed =
    abSeason > 0 ? hitsSeason / abSeason : 0;

  const obpAllowed =
    (abSeason + walksSeason + hbpSeason + sfSeason) > 0
      ? (hitsSeason + walksSeason + hbpSeason) /
        (abSeason + walksSeason + hbpSeason + sfSeason)
      : 0;

  const tbPer9 =
    inningsSeason > 0 ? (totalBasesAllowed / inningsSeason) * 9 : 0;

  const contactDamage =
    hitsSeason > 0 ? totalBasesAllowed / hitsSeason : 0;

  const h9 = h9Season || h9Recent;
  const whip = whipSeason || whipRecent;
  const hr9 = hr9Season || hr9Recent;

  let factor = 1;

  // Hits Allowed / H9
  if (h9 >= 9.8) factor += 0.15;
  else if (h9 >= 9.0) factor += 0.11;
  else if (h9 >= 8.2) factor += 0.06;
  else if (h9 > 0 && h9 <= 6.5) factor -= 0.10;

  // WHIP / traffic
  if (whip >= 1.50) factor += 0.15;
  else if (whip >= 1.35) factor += 0.10;
  else if (whip >= 1.25) factor += 0.05;
  else if (whip > 0 && whip <= 1.05) factor -= 0.10;

  // AVG Allowed
  if (avgAllowed >= 0.285) factor += 0.11;
  else if (avgAllowed >= 0.265) factor += 0.07;
  else if (avgAllowed >= 0.245) factor += 0.03;
  else if (avgAllowed > 0 && avgAllowed <= 0.210) factor -= 0.08;

  // OBP Allowed
  if (obpAllowed >= 0.355) factor += 0.09;
  else if (obpAllowed >= 0.335) factor += 0.06;
  else if (obpAllowed >= 0.315) factor += 0.03;
  else if (obpAllowed > 0 && obpAllowed <= 0.285) factor -= 0.06;

  // HR Allowed / HR9
  if (hr9 >= 1.7) factor += 0.10;
  else if (hr9 >= 1.3) factor += 0.06;
  else if (hr9 > 0 && hr9 <= 0.7) factor -= 0.05;

  // Total Bases Allowed
  if (tbPer9 >= 15.0) factor += 0.12;
  else if (tbPer9 >= 13.0) factor += 0.08;
  else if (tbPer9 >= 11.0) factor += 0.04;
  else if (tbPer9 > 0 && tbPer9 <= 8.0) factor -= 0.06;

  // Quality of Contact Proxy
  if (contactDamage >= 1.75) factor += 0.08;
  else if (contactDamage >= 1.55) factor += 0.05;
  else if (contactDamage > 0 && contactDamage <= 1.25) factor -= 0.04;

  return playerClamp(factor, 0.78, 1.32);
}
function calculatePitcherOpponentLineupFactor({
  opponentTeamStats,
  pitcherHand
}) {
  if (!opponentTeamStats) return 1;

  const games = playerSafeNum(opponentTeamStats.gamesPlayed, 0);
  if (games <= 0) return 1;

  const strikeouts = playerSafeNum(opponentTeamStats.strikeOuts, 0);
  const plateAppearances = playerSafeNum(opponentTeamStats.plateAppearances, 0);

  const kPerGame = strikeouts / games;
  const kRate =
    plateAppearances > 0
      ? strikeouts / plateAppearances
      : 0;

  const leagueAvgKPerGame = 8.5;
  const leagueAvgKRate = 0.225;

  const kGameFactor = kPerGame / leagueAvgKPerGame;
  const kRateFactor = kRate > 0 ? kRate / leagueAvgKRate : 1;

  let factor =
    kGameFactor * 0.65 +
    kRateFactor * 0.35;

  if (pitcherHand === "L") factor += 0.01;

  return playerClamp(factor, 0.82, 1.22);
}
function parseMLBInningsToOuts(value) {
  if (value === null || value === undefined) return 0;

  const raw = String(value);
  const [innings, partial] = raw.split(".");

  const fullInnings = playerSafeNum(innings, 0);
  const extraOuts = playerSafeNum(partial, 0);

  return fullInnings * 3 + playerClamp(extraOuts, 0, 2);
}
function calculatePlayerPropProjection({
  prop,
  playerInfo,
  recentAverages,
  seasonStats,
  handSplits,
  opponentPitcher,
  opponentTeamStats
}) {
  const market = prop.market;
  const line = playerSafeNum(prop.line, 0);
  const pitcherHand = opponentPitcher?.info?.pitchHand || null;

  const pitcherLineupFactor =
    playerInfo?.primaryPosition === "P"
      ? calculatePitcherOpponentLineupFactor({
          opponentTeamStats,
          pitcherHand: playerInfo?.pitchHand
        })
      : 1;

  const pitcherSeasonEra = playerSafeNum(opponentPitcher?.seasonStats?.era, 4.50);
  const pitcherSeasonWhip = playerSafeNum(opponentPitcher?.seasonStats?.whip, 1.30);
  const pitcherRecentEra =
    playerSafeNum(opponentPitcher?.recentAverages?.earnedRuns, 2.5) /
    Math.max(playerSafeNum(opponentPitcher?.recentAverages?.innings, 5), 1) *
    9;

  let pitcherQualityFactor = 1;

  if (pitcherSeasonEra >= 5.25 || pitcherSeasonWhip >= 1.50 || pitcherRecentEra >= 5.50) {
    pitcherQualityFactor = 1.18;
  } else if (pitcherSeasonEra >= 4.50 || pitcherSeasonWhip >= 1.35 || pitcherRecentEra >= 4.75) {
    pitcherQualityFactor = 1.10;
  } else if (pitcherSeasonEra <= 2.75 || pitcherSeasonWhip <= 1.05 || pitcherRecentEra <= 2.75) {
    pitcherQualityFactor = 0.86;
  } else if (pitcherSeasonEra <= 3.40 || pitcherSeasonWhip <= 1.15 || pitcherRecentEra <= 3.40) {
    pitcherQualityFactor = 0.93;
  }

  let projection = 0;

  if (market === "batter_hits") {
    projection = weightedPlayerProjection(
      playerSafeNum(recentAverages.hits),
      seasonPerGame(seasonStats, "hits"),
      splitPerGame(handSplits, pitcherHand, "hits")
    );

    const advancedPitcherFactor =
      calculateAdvancedPitcherContactFactor(opponentPitcher);

    projection = projection * advancedPitcherFactor;
  }

  if (market === "batter_total_bases") {
    projection = weightedPlayerProjection(
      playerSafeNum(recentAverages.totalBases),
      seasonPerGame(seasonStats, "totalBases"),
      splitPerGame(handSplits, pitcherHand, "totalBases")
    );

    const advancedPitcherFactor =
      calculateAdvancedPitcherContactFactor(opponentPitcher);

    projection = projection * advancedPitcherFactor;
  }

  if (market === "batter_rbis") {
    projection = weightedPlayerProjection(
      playerSafeNum(recentAverages.rbi),
      seasonPerGame(seasonStats, "rbi"),
      splitPerGame(handSplits, pitcherHand, "rbi")
    );

    const advancedPitcherFactor =
      calculateAdvancedPitcherContactFactor(opponentPitcher);

    projection = projection * advancedPitcherFactor;
  }

  if (market === "batter_runs_scored") {
    projection = weightedPlayerProjection(
      playerSafeNum(recentAverages.runs),
      seasonPerGame(seasonStats, "runs"),
      splitPerGame(handSplits, pitcherHand, "runs")
    );

    const advancedPitcherFactor =
      calculateAdvancedPitcherContactFactor(opponentPitcher);

    projection = projection * advancedPitcherFactor;
  }

  if (market === "batter_home_runs") {
    projection = weightedPlayerProjection(
      playerSafeNum(recentAverages.homeRuns),
      seasonPerGame(seasonStats, "homeRuns"),
      splitPerGame(handSplits, pitcherHand, "homeRuns")
    );

    const advancedPitcherFactor =
      calculateAdvancedPitcherContactFactor(opponentPitcher);

    projection = projection * advancedPitcherFactor;
  }

if (market === "pitcher_strikeouts") {
  const recentKs = playerSafeNum(recentAverages.strikeOuts, 0);
  const recentInnings = playerSafeNum(recentAverages.innings, 0);

  const seasonKsTotal = playerSafeNum(seasonStats?.strikeOuts, 0);
  const gamesStarted = playerSafeNum(seasonStats?.gamesStarted, 1);

  const seasonOuts = parseMLBInningsToOuts(seasonStats?.inningsPitched);
  const seasonInnings = seasonOuts / 3;

  const recentKPerInning =
    recentInnings > 0 ? recentKs / recentInnings : 0;

  const seasonKPerInning =
    seasonInnings > 0 ? seasonKsTotal / seasonInnings : 0;

  const expectedInnings =
    recentInnings * 0.70 +
    (gamesStarted > 0 ? seasonInnings / gamesStarted : recentInnings) * 0.30;

  const kPerInning =
    recentKPerInning * 0.70 +
    seasonKPerInning * 0.30;
console.log("K PROP MODEL", {
  player: prop.player,
  expectedInnings,
  kPerInning,
  lineupFactor: pitcherLineupFactor
});
  projection = expectedInnings * kPerInning * pitcherLineupFactor;
}

  if (market === "pitcher_outs") {
    const recentOuts = playerSafeNum(recentAverages.outs);
    const seasonInnings = playerSafeNum(seasonStats?.inningsPitched, 0);
    const gamesStarted = playerSafeNum(seasonStats?.gamesStarted, 0);

    const seasonOuts =
      gamesStarted > 0
        ? (seasonInnings * 3) / gamesStarted
        : recentOuts;

    projection = recentOuts * 0.65 + seasonOuts * 0.35;
    projection = projection * playerClamp(pitcherLineupFactor, 0.92, 1.08);
  }

  projection = Number(projection.toFixed(2));

  const listedSide = String(prop.side || "").toUpperCase();

  let edge = 0;

  if (listedSide === "OVER") {
    edge = projection - line;
  } else if (listedSide === "UNDER") {
    edge = line - projection;
  } else {
    return null;
  }

  const confidence = calculatePlayerPropConfidence(market, edge);

  if (confidence <= 0) return null;

  return {
    player: prop.player,
    market,
    side: listedSide,
    line,
    odds: prop.odds,
    bookmaker: prop.bookmaker,
    projection,
    edge: Number(edge.toFixed(2)),
    confidence,
    isPremium: confidence >= 75
  };
}

function normalizeTeamName(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function getMLBGameContextFromStatsAPI(event) {
  if (!event?.commence_time) return null;

  const gameDate = new Date(event.commence_time).toISOString().split("T")[0];

  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${gameDate}&hydrate=probablePitcher,venue`;

  const response = await fetch(url);
  const data = await response.json();

  const games = data?.dates?.[0]?.games || [];

  const targetAway = normalizeTeamName(event.away_team);
  const targetHome = normalizeTeamName(event.home_team);

  const match = games.find(g => {
    const away = normalizeTeamName(g?.teams?.away?.team?.name);
    const home = normalizeTeamName(g?.teams?.home?.team?.name);

    return away === targetAway && home === targetHome;
  });

  if (!match) return null;
const boxscoreUrl =
  `https://statsapi.mlb.com/api/v1/game/${match.gamePk}/boxscore`;

const boxscoreResponse = await fetch(boxscoreUrl);
const boxscoreData = await boxscoreResponse.json();

const awayPlayerIds = new Set(
  Object.values(boxscoreData?.teams?.away?.players || {})
    .map(p => p?.person?.id)
    .filter(Boolean)
);

const homePlayerIds = new Set(
  Object.values(boxscoreData?.teams?.home?.players || {})
    .map(p => p?.person?.id)
    .filter(Boolean)
);
 return {
  gamePk: match.gamePk,
  venue: match.venue || null,

  awayTeam: match.teams?.away?.team?.name || event.away_team,
  homeTeam: match.teams?.home?.team?.name || event.home_team,
  awayPlayerIds,
homePlayerIds,

  awayTeamId: match.teams?.away?.team?.id || null,
  homeTeamId: match.teams?.home?.team?.id || null,

  awayPitcher: match.teams?.away?.probablePitcher || null,
  homePitcher: match.teams?.home?.probablePitcher || null
};
}
async function handlePlayerProps(req, res) {

  const ODDS_API_KEY = process.env.ODDS_API_KEY;

  const response = await fetch(
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${ODDS_API_KEY}`
  );

  const events = await response.json();
if (req.query.listEvents === "true") {
  return res.status(200).json({
    ok: true,
    mode: "player-props-events",
    totalEvents: events.length,
    events: events.map(e => ({
      eventId: e.id,
      game: `${e.away_team} @ ${e.home_team}`,
      commence_time: e.commence_time
    }))
  });
}
const selectedEventId = req.query.eventId || req.body?.eventId || null;
const force = req.query.force === "true" || req.body?.force === true;

const selectedEvent = selectedEventId
  ? events.find(e => e.id === selectedEventId)
  : events[0];

if (!selectedEvent?.id) {
  return res.status(200).json({
    ok: true,
    mode: "player-props",
    noPlay: true,
    reason: "No MLB event found"
  });
}

const today = new Date().toISOString().split("T")[0];

if (!force) {
  const { data: cached } = await supabaseAdmin
    .from("player_props_cache")
    .select("analysis_json")
    .eq("sport", "mlb")
    .eq("event_id", selectedEvent.id)
    .eq("game_date", today)
    .maybeSingle();

  if (cached?.analysis_json) {
    return res.status(200).json({
      ...cached.analysis_json,
      cached: true
    });
  }
}

const eventId = selectedEvent.id;

const oddsResponse = await fetch(
  `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=batter_hits,batter_total_bases,batter_rbis,batter_runs_scored,batter_home_runs,pitcher_strikeouts,pitcher_outs`
);

const oddsData = await oddsResponse.json();

const gameContext = await getMLBGameContextFromStatsAPI(selectedEvent);

const allowedMarkets = [
  "batter_hits",
  "batter_total_bases",
  "pitcher_outs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_home_runs",
  "pitcher_strikeouts"
];

const rawProps = [];

(oddsData.bookmakers || []).forEach(bookmaker => {
  (bookmaker.markets || []).forEach(market => {
    if (!allowedMarkets.includes(market.key)) return;

    (market.outcomes || []).forEach(outcome => {
      rawProps.push({
        eventId,
        game: `${selectedEvent.away_team} @ ${selectedEvent.home_team}`,
        awayTeam: selectedEvent.away_team,
        homeTeam: selectedEvent.home_team,
        player: outcome.description,
        market: market.key,
        side: outcome.name,
        line: outcome.point,
        odds: outcome.price,
        bookmaker: bookmaker.title
      });
    });
  });
});

const bookPriority = [
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
  "Bovada",
  "BetRivers"
];

const uniqueMap = new Map();

rawProps.forEach(prop => {
  const key = `${prop.player}|${prop.market}|${prop.line}`;

  const current = uniqueMap.get(key);

  if (!current) {
    uniqueMap.set(key, prop);
    return;
  }

  const currentRank = bookPriority.indexOf(current.bookmaker);
  const newRank = bookPriority.indexOf(prop.bookmaker);

  const safeCurrentRank = currentRank === -1 ? 999 : currentRank;
  const safeNewRank = newRank === -1 ? 999 : newRank;

  if (safeNewRank < safeCurrentRank) {
    uniqueMap.set(key, prop);
  }
});

const uniqueProps = Array.from(uniqueMap.values()).slice(0, 60);
const analyzedProps = [];
const playerCache = new Map();
const awayTeamHittingStats =
  gameContext?.awayTeamId
    ? await getTeamSeasonHittingStats(gameContext.awayTeamId)
    : null;

const homeTeamHittingStats =
  gameContext?.homeTeamId
    ? await getTeamSeasonHittingStats(gameContext.homeTeamId)
    : null;
for (const prop of uniqueProps) {
  const propLine = Number(prop.line);

  if (prop.market === "batter_hits" && propLine !== 0.5) {
    continue;
  }

  if (prop.market === "batter_home_runs" && propLine !== 0.5) {
    continue;
  }

if (prop.market === "batter_rbis" && propLine > 1) {
  continue;
}

if (prop.market === "batter_runs_scored" && propLine > 1) {
  continue;
}
if (prop.market === "pitcher_strikeouts" && propLine < 3.5) {
  continue;
}

if (prop.market === "pitcher_outs" && propLine < 9.5) {
  continue;
}
 if (prop.market === "batter_total_bases") {
  console.log("TB LINE AUDIT", {
    player: prop.player,
    line: prop.line,
    bookmaker: prop.bookmaker,
    side: prop.side
  });
}
if (
  prop.market === "batter_total_bases" &&
  propLine !== 1.5
) {
  continue;
}
if (prop.market === "batter_runs_scored" && prop.side === "Under" && propLine <= 0.5) {
  continue;
}

if (prop.market === "batter_rbis" && prop.side === "Under" && propLine <= 0.5) {
  continue;
}
  if (
  prop.market === "batter_runs_scored" &&
  String(prop.side).toLowerCase() === "under" &&
  propLine <= 0.5
) {
  continue;
}

if (
  prop.market === "batter_rbis" &&
  String(prop.side).toLowerCase() === "under" &&
  propLine <= 0.5
) {
  continue;
}
  let cachedPlayer = playerCache.get(prop.player);

if (!cachedPlayer) {
  const playerInfo = await searchMLBPlayerByName(prop.player);
  if (!playerInfo?.id) continue;
if (!playerInfo?.currentTeamId) {
  
}
  const logs = await getPlayerGameLog(playerInfo.id);

  const recentAverages =
    playerInfo.primaryPosition === "P"
      ? calculateRecentPitcherAverages(logs)
      : calculateRecentHitterAverages(logs);

  const seasonStats = await getPlayerSeasonStats(playerInfo.id);
  const handSplits = await getPlayerHandSplits(playerInfo.id);

  cachedPlayer = {
    playerInfo,
    recentAverages,
    seasonStats,
    handSplits
  };

  playerCache.set(prop.player, cachedPlayer);
}

const {
  playerInfo,
  recentAverages,
  seasonStats,
  handSplits
} = cachedPlayer;

if (!recentAverages || !seasonStats) continue;
const currentGameContext = gameContext;

let opponentPitcher = null;

if (currentGameContext) {

  const awayPitcherInfo = currentGameContext?.awayPitcher?.id
    ? await searchMLBPlayerByName(
        currentGameContext.awayPitcher.fullName
      )
    : null;

  const homePitcherInfo = currentGameContext?.homePitcher?.id
    ? await searchMLBPlayerByName(
        currentGameContext.homePitcher.fullName
      )
    : null;

  const awayPitcherLogs = awayPitcherInfo?.id
    ? await getPlayerGameLog(awayPitcherInfo.id)
    : [];

  const homePitcherLogs = homePitcherInfo?.id
    ? await getPlayerGameLog(homePitcherInfo.id)
    : [];

  const awayPitcherStats = {
    info: awayPitcherInfo,
    recentAverages: calculateRecentPitcherAverages(
      awayPitcherLogs
    ),
    seasonStats: awayPitcherInfo?.id
      ? await getPlayerSeasonStats(awayPitcherInfo.id)
      : null
  };

  const homePitcherStats = {
    info: homePitcherInfo,
    recentAverages: calculateRecentPitcherAverages(
      homePitcherLogs
    ),
    seasonStats: homePitcherInfo?.id
      ? await getPlayerSeasonStats(homePitcherInfo.id)
      : null
  };

const playerTeamId = playerInfo?.currentTeamId;

const playerId = playerInfo?.id;

if (currentGameContext?.homePlayerIds?.has(playerId)) {
  opponentPitcher = awayPitcherStats;
} else if (currentGameContext?.awayPlayerIds?.has(playerId)) {
  opponentPitcher = homePitcherStats;
} else {
  opponentPitcher = null;
}
 console.log("PLAYER TEAM CHECK", {
  player: prop.player,
  playerId,
  isHomeRoster: currentGameContext?.homePlayerIds?.has(playerId),
  isAwayRoster: currentGameContext?.awayPlayerIds?.has(playerId),
  opponentPitcher:
    opponentPitcher?.info?.fullName ||
    opponentPitcher?.fullName ||
    "NONE"
});
}

let opponentTeamStats = null;

if (currentGameContext?.homePlayerIds?.has(playerInfo?.id)) {
  opponentTeamStats = awayTeamHittingStats;
} else if (currentGameContext?.awayPlayerIds?.has(playerInfo?.id)) {
  opponentTeamStats = homeTeamHittingStats;
}
const result = calculatePlayerPropProjection({
  prop,
  playerInfo,
  recentAverages,
  seasonStats,
  handSplits,
  opponentPitcher,
  opponentTeamStats:
  playerInfo?.primaryPosition === "P"
    ? opponentTeamStats
    : null
});

  if (!result) continue;

  analyzedProps.push(result);
}

analyzedProps.sort((a, b) => b.confidence - a.confidence);

const finalResponse = {
  ok: true,
  mode: "player-props",
  cached: false,
  eventId: selectedEvent.id,
  game: `${selectedEvent.away_team} @ ${selectedEvent.home_team}`,
  gameDate: today,
  generatedAt: new Date().toISOString(),
  totalRawProps: rawProps.length,
  totalUniqueProps: rawProps.length,
  totalAnalyzedProps: analyzedProps.length,
  props: analyzedProps.slice(0, 3),
lockedProps: analyzedProps.slice(3, 40)
};

await supabaseAdmin
  .from("player_props_cache")
  .upsert({
    sport: "mlb",
    event_id: selectedEvent.id,
    game: finalResponse.game,
    game_date: today,
    analysis_json: finalResponse,
    updated_at: new Date().toISOString()
  }, {
    onConflict: "sport,event_id,game_date"
  });

return res.status(200).json(finalResponse);
}
module.exports = async function handler(req, res) {
 res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

try {
  const mode = req.query.mode || req.body?.mode;
if (mode === "player-props") {
  return await handlePlayerProps(req, res);
}
  const {
    userId,
    awayTeam,
    homeTeam,
    awaySpread,
    homeSpread,
    outcomes,
    gameTime,
    totalLine = 8
  } = req.body || {};

  if (mode !== "grade-pending" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
if (mode === "grade-pending") {
  const normalize = (name = "") =>
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const parseDate = (value) => {
    if (!value) return null;
    return String(value).split("T")[0];
  };

  const gradePick = (pick, awayScore, homeScore) => {
    const type = String(pick.pick_type || "").toLowerCase();
    const team = String(pick.pick_team || "");
    const line = Number(pick.line);

    const away = String(pick.away_team || "");
    const home = String(pick.home_team || "");

    const teamIsAway = normalize(team) === normalize(away);
    const teamIsHome = normalize(team) === normalize(home);

    const teamScore = teamIsAway ? awayScore : teamIsHome ? homeScore : null;
    const oppScore = teamIsAway ? homeScore : teamIsHome ? awayScore : null;

    if (type === "ml" || type === "moneyline") {
      if (teamScore === null || oppScore === null) return null;
      if (teamScore > oppScore) return "win";
      if (teamScore < oppScore) return "loss";
      return "push";
    }

    if (type === "runline" || type === "spread") {
      if (teamScore === null || oppScore === null || !Number.isFinite(line)) return null;

      const adjusted = teamScore + line;

      if (adjusted > oppScore) return "win";
      if (adjusted < oppScore) return "loss";
      return "push";
    }

    if (type === "total") {
      const total = awayScore + homeScore;

      const direction = String(
        pick.pick_direction ||
        pick.direction ||
        pick.selection ||
        pick.pick ||
        pick.bet ||
        ""
      ).toLowerCase();

      if (!Number.isFinite(line)) return null;

      if (direction.includes("over")) {
        if (total > line) return "win";
        if (total < line) return "loss";
        return "push";
      }

      if (direction.includes("under")) {
        if (total < line) return "win";
        if (total > line) return "loss";
        return "push";
      }

      return null;
    }

    return null;
  };

  const updateSportRecord = async () => {
    const { data: gradedRows, error: rowsError } = await supabaseAdmin
      .from("picks_history")
      .select("result")
      .eq("sport", "mlb")
      .eq("is_premium", true)
      .not("result", "is", null);

    if (rowsError) throw rowsError;

    const wins = gradedRows.filter(r => r.result === "win").length;
    const losses = gradedRows.filter(r => r.result === "loss").length;
    const pushes = gradedRows.filter(r => r.result === "push").length;
    const total = wins + losses + pushes;
    const decisions = wins + losses;
    const winRate = decisions > 0 ? Number(((wins / decisions) * 100).toFixed(1)) : 0;
const { error: recordError } = await supabaseAdmin
  .from("sport_records")
  .upsert({
    sport: "mlb",
display_name: "MLB",
real_wins: wins,
real_losses: losses,
pushes,
updated_at: new Date().toISOString()
  }, { onConflict: "sport" });

    if (recordError) throw recordError;

  return {
  real_wins: wins,
  real_losses: losses,
  pushes,
  total_picks: total,
  win_rate: winRate
};
};

 const { data: pendingPicks, error: pendingError } = await supabaseAdmin
  .from("picks_history")
  .select("*")
  .eq("sport", "mlb")
  .eq("is_premium", true)
  .eq("result", "pending")
  .order("created_at", { ascending: false })
  .limit(100);

  if (pendingError) throw pendingError;

  if (!pendingPicks || pendingPicks.length === 0) {
    const record = await updateSportRecord();

    return res.status(200).json({
      ok: true,
      sport: "mlb",
      message: "No hay picks MLB pendientes por calificar.",
      graded: 0,
      record
    });
  }

  const uniqueDates = [...new Set(
    pendingPicks
      .map(p => parseDate(p.game_date || p.created_at))
      .filter(Boolean)
  )];

  let graded = 0;
  let skipped = 0;
  const details = [];

  for (const gameDate of uniqueDates) {
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${gameDate}&hydrate=team`;

    const scheduleResponse = await fetch(scheduleUrl);
    const scheduleJson = await scheduleResponse.json();

    const games = scheduleJson?.dates?.[0]?.games || [];

    const picksForDate = pendingPicks.filter(p =>
      parseDate(p.game_date || p.created_at) === gameDate
    );

    for (const pick of picksForDate) {
      const matchingGame = games.find(g => {
        const apiAway = g?.teams?.away?.team?.name || "";
        const apiHome = g?.teams?.home?.team?.name || "";

        return (
          normalize(apiAway) === normalize(pick.away_team) &&
          normalize(apiHome) === normalize(pick.home_team)
        );
      });

      if (!matchingGame) {
        skipped++;
        details.push({
          id: pick.id,
          status: "skipped",
          reason: "Juego no encontrado en MLB StatsAPI"
        });
        continue;
      }

      const status = String(matchingGame?.status?.detailedState || "").toLowerCase();

      const isFinal =
        status.includes("final") ||
        status.includes("game over") ||
        matchingGame?.status?.abstractGameState === "Final";

      if (!isFinal) {
        skipped++;
        details.push({
          id: pick.id,
          status: "skipped",
          reason: "Juego todavía no está final"
        });
        continue;
      }

      const awayScore = Number(matchingGame?.teams?.away?.score);
      const homeScore = Number(matchingGame?.teams?.home?.score);

      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) {
        skipped++;
        details.push({
          id: pick.id,
          status: "skipped",
          reason: "Score final no disponible"
        });
        continue;
      }

      const result = gradePick(pick, awayScore, homeScore);

      if (!result) {
        skipped++;
        details.push({
          id: pick.id,
          status: "skipped",
          reason: "No se pudo calificar el pick. Revisa pick_type, pick_team, line o dirección OVER/UNDER."
        });
        continue;
      }

      const finalScore = `${pick.away_team} ${awayScore} - ${pick.home_team} ${homeScore}`;

      const { error: updateError } = await supabaseAdmin
        .from("picks_history")
        .update({
          result,
          final_score: finalScore,
          graded_at: new Date().toISOString()
        })
        .eq("id", pick.id);

      if (updateError) throw updateError;
await updateSportRecord();
      graded++;

      details.push({
        id: pick.id,
        status: "graded",
        result,
        finalScore
      });
    }
  }

  const record = await updateSportRecord();

  return res.status(200).json({
    ok: true,
    sport: "mlb",
    graded,
    skipped,
    record,
    details
  });
}
   let isPremiumUser = false;
let isAdmin = false;
let profile = null;

if (userId && userId !== "null" && userId !== "undefined" && userId !== "guest") {
  const { data } = await supabaseAdmin
    .from("users")
    .select("is_premium, email")
    .eq("id", userId)
    .maybeSingle();

  profile = data;
  isPremiumUser = profile?.is_premium === true;
  isAdmin = profile?.email === ADMIN_EMAIL;
}
    const origin = "https://www.cashedgeapp.com";
const dataResponse = await fetch(`${origin}/api/mlb-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ awayTeam, homeTeam })
    });

    const mlbData = await dataResponse.json();

    if (!dataResponse.ok) {
      throw new Error(mlbData.error || "No se pudo cargar data MLB");
    }

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const safeNumber = (value, fallback = null) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const avgValid = (...values) => {
      const nums = values
        .map(v => Number(v))
        .filter(v => Number.isFinite(v));

      if (!nums.length) return null;

      return nums.reduce((a, b) => a + b, 0) / nums.length;
    };

    const fillMissing = (value, fallback) => {
      const num = Number(value);
      if (Number.isFinite(num)) return num;

      const fb = Number(fallback);
      return Number.isFinite(fb) ? fb : 0;
    };

    const americanToProb = (odds) => {
      if (!odds) return 0.5;
      return odds > 0
        ? 100 / (odds + 100)
        : Math.abs(odds) / (Math.abs(odds) + 100);
    };

    function erf(x) {
      const sign = x >= 0 ? 1 : -1;
      x = Math.abs(x);

      const a1 = 0.254829592;
      const a2 = -0.284496736;
      const a3 = 1.421413741;
      const a4 = -1.453152027;
      const a5 = 1.061405429;
      const p = 0.3275911;

      const t = 1 / (1 + p * x);

      const y =
        1 -
        (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
          t *
          Math.exp(-x * x));

      return sign * y;
    }

    function normalCDF(x, mean, stdDev) {
      return 0.5 * (1 + erf((x - mean) / (stdDev * Math.sqrt(2))));
    }

function getWeatherRunFactor(weather) {
  if (!weather || weather.active === false) return 1;

  const raw = String(weather.raw || "").trim();

  const hasRealWeather =
    raw.length > 0 ||
    weather.temp !== null ||
    Number(weather.speed) > 0;

  if (!hasRealWeather) return 1;

  let factor = 1;

  const windSpeed = safeNumber(weather.speed, 0);
  const temp =
    weather.temp !== null && weather.temp !== undefined
      ? Number(weather.temp)
      : null;
  const humidity = safeNumber(weather.humidity);

  // WIND: ahora direction ya viene corregida por estadio
  if (weather.direction === "out") {
    if (windSpeed >= 22) factor += 0.26;
    else if (windSpeed >= 18) factor += 0.22;
    else if (windSpeed >= 14) factor += 0.17;
    else if (windSpeed >= 10) factor += 0.11;
    else if (windSpeed >= 6) factor += 0.06;
  }

  if (weather.direction === "in") {
    if (windSpeed >= 22) factor -= 0.26;
    else if (windSpeed >= 18) factor -= 0.22;
    else if (windSpeed >= 14) factor -= 0.17;
    else if (windSpeed >= 10) factor -= 0.11;
    else if (windSpeed >= 6) factor -= 0.06;
  }

  if (weather.direction === "cross") {
    if (windSpeed >= 22) factor -= 0.04;
    else if (windSpeed >= 18) factor -= 0.02;
    else if (windSpeed >= 14) factor += 0.01;
  }

  // TEMPERATURE
  if (temp !== null && Number.isFinite(temp)) {
    if (temp >= 100) factor += 0.13;
    else if (temp >= 95) factor += 0.10;
    else if (temp >= 90) factor += 0.08;
    else if (temp >= 84) factor += 0.05;
    else if (temp >= 78) factor += 0.03;

    else if (temp <= 38) factor -= 0.13;
    else if (temp <= 45) factor -= 0.10;
    else if (temp <= 52) factor -= 0.07;
    else if (temp <= 58) factor -= 0.04;
  }

  // HUMIDITY / AIR WEIGHT
  if (humidity !== null && temp !== null && Number.isFinite(temp)) {
    if (humidity >= 85 && temp >= 88) factor += 0.04;
    else if (humidity >= 75 && temp >= 84) factor += 0.025;

    if (humidity >= 80 && temp <= 68) factor -= 0.03;
    if (humidity <= 30 && temp <= 60) factor -= 0.025;
  }

  // COMBO EFFECTS
  const strongBadWeather =
    weather.direction === "in" &&
    windSpeed >= 14 &&
    temp !== null &&
    temp <= 70;

  const extremeBadWeather =
    weather.direction === "in" &&
    windSpeed >= 18 &&
    temp !== null &&
    temp <= 65;

  const strongGoodWeather =
    weather.direction === "out" &&
    windSpeed >= 14 &&
    temp !== null &&
    temp >= 78;

  const extremeGoodWeather =
    weather.direction === "out" &&
    windSpeed >= 18 &&
    temp !== null &&
    temp >= 84;

  if (strongBadWeather) factor -= 0.04;
  if (extremeBadWeather) factor -= 0.05;

  if (strongGoodWeather) factor += 0.04;
  if (extremeGoodWeather) factor += 0.05;

  // RAIN / STORM
  const condition = String(weather.condition || "").toLowerCase();

  if (condition.includes("storm") || condition.includes("heavy rain")) {
    factor -= 0.06;
  } else if (condition.includes("rain")) {
    factor -= 0.03;
  }

  return clamp(factor, 0.72, 1.42);
}
    function adjustOffense(batting) {
      if (!batting) return null;

      const last7Runs = safeNumber(batting.runs);
      const splitRuns = safeNumber(batting.splitRuns);

      const last7Allowed = safeNumber(batting.runsAllowed);
      const splitAllowed = safeNumber(batting.splitRunsAllowed);

      const fallbackRuns = avgValid(last7Runs, splitRuns, batting.weightedRuns);
      const fallbackAllowed = avgValid(last7Allowed, splitAllowed, batting.weightedRunsAllowed);

      if (fallbackRuns === null || fallbackAllowed === null) return null;

      let offense =
        fillMissing(last7Runs, fallbackRuns) * 0.60 +
        fillMissing(splitRuns, fallbackRuns) * 0.40;

      let defense =
        fillMissing(last7Allowed, fallbackAllowed) * 0.60 +
        fillMissing(splitAllowed, fallbackAllowed) * 0.40;

      const last3Runs = safeNumber(batting.last3?.runs);
      const last3Allowed = safeNumber(batting.last3?.runsAllowed);

      if (last3Runs !== null) {
        if (last3Runs >= 7.5) offense *= 1.12;
        else if (last3Runs >= 6.5) offense *= 1.08;
        else if (last3Runs >= 5.5) offense *= 1.04;

        if (last3Runs <= 2.5) offense *= 0.88;
        else if (last3Runs <= 3.2) offense *= 0.93;
      }

      if (last3Allowed !== null) {
        if (last3Allowed >= 7.5) defense *= 1.10;
        else if (last3Allowed >= 6.5) defense *= 1.06;
        else if (last3Allowed >= 5.5) defense *= 1.03;

        if (last3Allowed <= 2.5) defense *= 0.90;
        else if (last3Allowed <= 3.2) defense *= 0.95;
      }

      return {
        offense: clamp(offense, 1.2, 12.5),
        defense: clamp(defense, 1.2, 12.5)
      };
    }

    function adjustBullpen(bullpen) {
      if (!bullpen) return null;

      const last7 = bullpen.last7 || null;
      const last3 = bullpen.last3 || null;

const baseRuns = safeNumber(bullpen.runsPerGame);
const last7Runs = safeNumber(last7?.ra9 ?? last7?.era ?? last7?.runsPerGame);
const last3Runs = safeNumber(last3?.ra9 ?? last3?.era ?? last3?.runsPerGame);

      const fallback = avgValid(baseRuns, last7Runs, last3Runs);
      if (fallback === null) return null;

      let score =
        fillMissing(last7Runs, fallback) * 0.90 +
        fillMissing(last3Runs, fallback) * 0.10;

      const whip = safeNumber(bullpen.whip);
      const last3Whip = safeNumber(last3?.whip);
      const fatigue = safeNumber(bullpen.fatigue, 0);

      const fatigueFactor = getBullpenFatigueFactor(bullpen);
score *= fatigueFactor;
// PRUEBA TEMPORAL:
// Sin ajuste por WHIP
      
      return clamp(score, 1.0, 12.5);
    }

    function adjustPitcher(stats, sideStats = null) {
      if (!stats) return null;

      const recentRuns = safeNumber(stats.runsPerGame);
      const sideRuns = safeNumber(sideStats?.runsPerGame);
      const innings = safeNumber(stats.innings, 0);

      if (recentRuns === null) return null;

      let score =
        sideRuns !== null
          ? recentRuns * 0.60 + sideRuns * 0.40
          : recentRuns;

      const whip = safeNumber(stats.whip);
      const homeRunsPerInning = safeNumber(stats.homeRunsPerInning);
      const walksPerInning = safeNumber(stats.walksPerInning);
     
if (innings < 2) {
  score *= 2.10;
} else if (innings < 3) {
  score *= 1.70;
} else if (innings < 4) {
  score *= 1.35;
} else if (innings >= 6) {
  score *= 0.96;
}
  let pitcherPenalty = 1;

if (whip !== null) {
  if (whip >= 1.65) pitcherPenalty += 0.06;
  else if (whip >= 1.50) pitcherPenalty += 0.04;
  else if (whip >= 1.35) pitcherPenalty += 0.02;

  if (whip <= 1.00) pitcherPenalty -= 0.07;
  else if (whip <= 1.10) pitcherPenalty -= 0.04;
}

if (homeRunsPerInning !== null) {
  if (homeRunsPerInning >= 0.24) pitcherPenalty += 0.05;
  else if (homeRunsPerInning >= 0.18) pitcherPenalty += 0.03;
}

if (walksPerInning !== null) {
  if (walksPerInning >= 0.55) pitcherPenalty += 0.04;
  else if (walksPerInning >= 0.45) pitcherPenalty += 0.02;
}

pitcherPenalty = clamp(pitcherPenalty, 0.88, 1.12);
score *= pitcherPenalty;


      return clamp(score, 1.0, 12.5);
    }

    function getTeamTrendScore(batting) {
      if (!batting) return 50;

      const offense = avgValid(
        batting.runs,
        batting.splitRuns
      );

      const allowed = avgValid(
        batting.runsAllowed,
        batting.splitRunsAllowed
      );

      if (offense === null && allowed === null) return 50;

      let score = 50;

      if (offense !== null && allowed !== null) {
        score += (offense - allowed) * 8;
      } else if (offense !== null) {
        score += offense * 2;
      } else if (allowed !== null) {
        score -= allowed * 2;
      }

      return clamp(score, 10, 90);
    }

    const venue = mlbData.venue || { parkFactor: 1 };
    const parkFactor = safeNumber(venue.parkFactor, 1);
    const weatherFactor = getWeatherRunFactor(mlbData.weather);
    const runEnvironmentFactor = parkFactor * weatherFactor;

    const awayBatting = mlbData.away?.battingProfile || {};
    const homeBatting = mlbData.home?.battingProfile || {};

    const awayOffenseData = adjustOffense(awayBatting);
    const homeOffenseData = adjustOffense(homeBatting);

    const awayOffenseRaw = awayOffenseData?.offense;
    const homeOffenseRaw = homeOffenseData?.offense;

    const awayDefenseRaw = awayOffenseData?.defense;
    const homeDefenseRaw = homeOffenseData?.defense;

    const awayPitcherStats = mlbData.away?.pitcher?.stats || null;
    const homePitcherStats = mlbData.home?.pitcher?.stats || null;
const awayPitcherConfirmed =
  mlbData.away?.pitcher?.name &&
  awayPitcherStats &&
  safeNumber(awayPitcherStats.innings, 0) > 0;

const homePitcherConfirmed =
  mlbData.home?.pitcher?.name &&
  homePitcherStats &&
  safeNumber(homePitcherStats.innings, 0) > 0;

if (!awayPitcherConfirmed || !homePitcherConfirmed) {
  return res.status(200).json({
    locked: false,
    noPlay: true,
    reason: "Pitchers not confirmed"
  });
}

if (!totalLine || Number(totalLine) <= 0) {
  return res.status(200).json({
    locked: false,
    noPlay: true,
    reason: "No valid total line"
  });
}
    const awayPitcherRaw = adjustPitcher(awayPitcherStats);
    const homePitcherRaw = adjustPitcher(homePitcherStats);

    const awayPitcherInnings = safeNumber(awayPitcherStats?.innings, 0);
    const homePitcherInnings = safeNumber(homePitcherStats?.innings, 0);

    const awayBullpenRaw = adjustBullpen(mlbData.away?.bullpen);
    const homeBullpenRaw = adjustBullpen(mlbData.home?.bullpen);

    const fallbackA = avgValid(
      awayOffenseRaw,
      homePitcherRaw,
      homeBullpenRaw,
      safeNumber(totalLine) / 2
    );

    const fallbackB = avgValid(
      homeOffenseRaw,
      awayPitcherRaw,
      awayBullpenRaw,
      safeNumber(totalLine) / 2
    );

    const awayOffense = fillMissing(awayOffenseRaw, fallbackA);
    const homePitcher = fillMissing(homePitcherRaw, fallbackA);
    const homeBullpen = fillMissing(homeBullpenRaw, fallbackA);

    const homeOffense = fillMissing(homeOffenseRaw, fallbackB);
    const awayPitcher = fillMissing(awayPitcherRaw, fallbackB);
    const awayBullpen = fillMissing(awayBullpenRaw, fallbackB);

    const awayTeamAllowed = fillMissing(awayDefenseRaw, awayPitcher);
    const homeTeamAllowed = fillMissing(homeDefenseRaw, homePitcher);

    function getStarterShare(expectedInnings, pitcherScore) {
  const innings = safeNumber(expectedInnings, 0);
  const pitcher = safeNumber(pitcherScore, 99);

  const starterShareBase = innings / 9;
  let aceBonus = 0;

  if (pitcher <= 2.25 && innings >= 6.5) {
    aceBonus = 0.08;
  } else if (pitcher <= 2.75 && innings >= 6.0) {
    aceBonus = 0.05;
  }

  return clamp(starterShareBase + aceBonus, 0.35, 0.82);
}

function calculateExpectedRuns({
  offense,
  opponentPitcher,
  opponentBullpen,
  opponentTeamAllowed,
  opponentStarterInnings
}) {
  const starterShare = getStarterShare(opponentStarterInnings, opponentPitcher);
  const bullpenShare = 1 - starterShare;

  const starterSegment =
    offense * 0.35 +
    opponentPitcher * 0.65;

  const bullpenSegment =
    offense * 0.40 +
    opponentBullpen * 0.60;

  const teamAllowedAdjustment =
    opponentTeamAllowed * 0.10;

  const expectedRuns =
    starterSegment * starterShare +
    bullpenSegment * bullpenShare +
    teamAllowedAdjustment;

  return {
    expectedRuns,
    starterShare,
    bullpenShare,
    starterSegment,
    bullpenSegment,
    teamAllowedAdjustment
  };
}

const awayRunCalc = calculateExpectedRuns({
  offense: awayOffense,
  opponentPitcher: homePitcher,
  opponentBullpen: homeBullpen,
  opponentTeamAllowed: homeTeamAllowed,
  opponentStarterInnings: homePitcherInnings
});

const homeRunCalc = calculateExpectedRuns({
  offense: homeOffense,
  opponentPitcher: awayPitcher,
  opponentBullpen: awayBullpen,
  opponentTeamAllowed: awayTeamAllowed,
  opponentStarterInnings: awayPitcherInnings
});

let expectedRunsA = awayRunCalc.expectedRuns;
let expectedRunsB = homeRunCalc.expectedRuns;
    expectedRunsA *= runEnvironmentFactor;
    expectedRunsB *= runEnvironmentFactor;

    expectedRunsA = clamp(expectedRunsA, 0.8, 12.5);
    expectedRunsB = clamp(expectedRunsB, 0.8, 12.5);

    const projectedTotal = expectedRunsA + expectedRunsB;
    const runDiff = expectedRunsA - expectedRunsB;

    const awayTrendScore = getTeamTrendScore(awayBatting);
    const homeTrendScore = getTeamTrendScore(homeBatting);

    const pitcherAdvAway = awayPitcher - homePitcher;
    const bullpenAdvAway = awayBullpen - homeBullpen;
    const offenseAdvAway = awayOffense - homeOffense;
    const defenseAdvAway = homeTeamAllowed - awayTeamAllowed;
    const trendAdvAway = awayTrendScore - homeTrendScore;

    const rawAwayWin =
  0.5 +
  runDiff * 0.060 +
  offenseAdvAway * 0.014 -
  pitcherAdvAway * 0.017 -
  bullpenAdvAway * 0.016 +
  defenseAdvAway * 0.010 +
  trendAdvAway * 0.0012;

    const modelProbA = clamp(rawAwayWin, 0.10, 0.90);
    const modelProbB = 1 - modelProbA;

    let awayOdds = null;
    let homeOdds = null;

    if (outcomes?.length) {
      awayOdds = outcomes.find(o => o.name === awayTeam)?.price;
      homeOdds = outcomes.find(o => o.name === homeTeam)?.price;
    }

    const marketProbA = americanToProb(awayOdds);
    const marketProbB = americanToProb(homeOdds);

    const totalStdDev = 2.65;

    const overProb =
      (1 - normalCDF(totalLine + 0.05, projectedTotal, totalStdDev)) * 100;

    const underProb =
      normalCDF(totalLine - 0.05, projectedTotal, totalStdDev) * 100;

    const totalPick = overProb >= underProb ? "OVER" : "UNDER";
    const totalEdge = Math.abs(projectedTotal - totalLine);

    function getSupportForSide(side) {
      const isAway = side === "away";

      const teamName = isAway ? awayTeam : homeTeam;

      const teamExpected = isAway ? expectedRunsA : expectedRunsB;
      const opponentExpected = isAway ? expectedRunsB : expectedRunsA;

      const teamOffense = isAway ? awayOffense : homeOffense;
      const opponentOffense = isAway ? homeOffense : awayOffense;

      const teamPitcherAllowed = isAway ? awayPitcher : homePitcher;
      const opponentPitcherAllowed = isAway ? homePitcher : awayPitcher;

      const teamBullpenAllowed = isAway ? awayBullpen : homeBullpen;
      const opponentBullpenAllowed = isAway ? homeBullpen : awayBullpen;

      const teamDefenseAllowed = isAway ? awayTeamAllowed : homeTeamAllowed;
      const opponentDefenseAllowed = isAway ? homeTeamAllowed : awayTeamAllowed;

      const teamTrend = isAway ? awayTrendScore : homeTrendScore;
      const opponentTrend = isAway ? homeTrendScore : awayTrendScore;

      const modelProb = isAway ? modelProbA : modelProbB;
      const marketProb = isAway ? marketProbA : marketProbB;
      const edge = (modelProb - marketProb) * 100;

      const projectedMargin = teamExpected - opponentExpected;

      let support = 50;

      support += projectedMargin * 10;
      support += (teamOffense - opponentOffense) * 4.5;
      support += (opponentPitcherAllowed - teamPitcherAllowed) * 4.2;
      support += (opponentBullpenAllowed - teamBullpenAllowed) * 4.0;
      support += (opponentDefenseAllowed - teamDefenseAllowed) * 2.2;
      support += (teamTrend - opponentTrend) * 0.30;
      support += edge * 1.05;

      if (!isAway) support += 1.2;

      support = clamp(support, 0, 100);

      return {
        teamName,
        support,
        modelProb,
        marketProb,
        edge,
        projectedMargin,
        teamExpected,
        opponentExpected,
        teamOffense,
        opponentOffense,
        teamPitcherAllowed,
        opponentPitcherAllowed,
        teamBullpenAllowed,
        opponentBullpenAllowed,
        teamDefenseAllowed,
        opponentDefenseAllowed,
        teamTrend,
        opponentTrend
      };
    }

    function estimateRunlineProb(side, spread) {
      const isAway = side === "away";
      const meanMargin = isAway ? runDiff : -runDiff;
      const spreadNumber = safeNumber(spread, 0);
      const marginStdDev = 2.15;

      return (1 - normalCDF(-spreadNumber, meanMargin, marginStdDev)) * 100;
    }

    function buildSideCandidate(side, marketType, spread = null) {
      const supportData = getSupportForSide(side);
      const isRunline = marketType === "RUNLINE";

      let confidence;
      let runlineProb = null;

     if (marketType === "ML") {
  const margin = Math.abs(supportData.projectedMargin);

 confidence = edgeToPercent(margin, "ml");

  if (supportData.modelProb < 0.55) confidence = 0;

} else {
  runlineProb = estimateRunlineProb(side, spread);

  const spreadNumber = Number(spread || 0);
  const protectedEdgeForPercent = supportData.projectedMargin + spreadNumber;

 if (spreadNumber > 0) {
  // RL +1.5 debe valer más que ML porque tiene protección extra
 const baseRlConfidence = edgeToPercent(
  protectedEdgeForPercent,
  "rlplus"
);

  const protectionBonus = Math.min(10, spreadNumber * 6);

  confidence = clamp(baseRlConfidence + protectionBonus, 0, 99);

} else {
  // RL -1.5 es más difícil que ML
 confidence = edgeToPercent(
  protectedEdgeForPercent,
  "rlminus"
);
}
  if (runlineProb < 65) confidence = 0;
}

      const isPositiveRunline = isRunline && Number(spread) > 0;
      const isNegativeRunline = isRunline && Number(spread) < 0;

      const protectedEdge =
        isRunline ? supportData.projectedMargin + Number(spread || 0) : null;

     
     if (isNegativeRunline) {
  if (supportData.projectedMargin >= 3.5) confidence += 3;
  else if (supportData.projectedMargin >= 2.8) confidence += 1.5;
}

if (isPositiveRunline) {
  if (protectedEdge >= 4.5) confidence += 2;
  else if (protectedEdge >= 3.8) confidence += 1;
  else confidence -= 4;
}

      confidence = clamp(confidence, 0, 99);

      const label =
        marketType === "ML"
          ? `${supportData.teamName} ML`
          : `${supportData.teamName} ${spread > 0 ? "+" : ""}${spread}`;

      const title =
        marketType === "ML"
          ? "Jugada Premium ML"
          : "Jugada Premium Runline";

      const premiumRule =
  marketType === "ML"
   ? Math.abs(supportData.projectedMargin) >= 3.0
    : (
        Number(spread) > 0
          ? protectedEdge >= 3.5
: protectedEdge >= 5.0
      );

      return {
        title,
        play: label,
        percentage: Number(confidence.toFixed(1)),
        type: marketType,
        team: supportData.teamName,
        supportScore: Number(supportData.support.toFixed(1)),
        modelProbability: Number((supportData.modelProb * 100).toFixed(1)),
        marketProbability: Number((supportData.marketProb * 100).toFixed(1)),
        edge: Number(supportData.edge.toFixed(1)),
        projectedMargin: Number(supportData.projectedMargin.toFixed(2)),
        protectedEdge: protectedEdge === null ? null : Number(protectedEdge.toFixed(2)),
        runlineProbability: runlineProb === null ? null : Number(runlineProb.toFixed(1)),
        isPremium:
          confidence >= 75 &&
          supportData.support >= 55 &&
          premiumRule
      };
    }

    function buildTotalCandidate(direction) {
      const isOver = direction === "OVER";
      const probability = isOver ? overProb : underProb;
      const diff = projectedTotal - totalLine;

      const offensePressure = awayOffense + homeOffense;
      const pitchingPressure = awayPitcher + homePitcher;
      const bullpenPressure = awayBullpen + homeBullpen;

      const expectedPressure = projectedTotal;

      let support = 50;

      if (isOver) {
        support += diff * 11;
        support += (runEnvironmentFactor - 1) * 100;
        support += (offensePressure - expectedPressure) * 1.5;
        support += (pitchingPressure - expectedPressure) * 1.2;
        support += (bullpenPressure - expectedPressure) * 1.4;
      } else {
        support += -diff * 11;
        support += (1 - runEnvironmentFactor) * 100;
        support += (expectedPressure - offensePressure) * 1.5;
        support += (expectedPressure - pitchingPressure) * 1.2;
        support += (expectedPressure - bullpenPressure) * 1.4;
      }

      support = clamp(support, 0, 100);

    let confidence = edgeToPercent(totalEdge, "total");
if (probability < 62) confidence = 0;

confidence = clamp(confidence, 0, 99);

      return {
        title: "Total Premium",
        play: `${direction} ${totalLine}`,
        percentage: Number(confidence.toFixed(1)),
        type: direction,
        supportScore: Number(support.toFixed(1)),
        totalProbability: Number(probability.toFixed(1)),
        totalEdge: Number(totalEdge.toFixed(2)),
        projectedTotal: Number(projectedTotal.toFixed(2)),
    isPremium:
  confidence >= 75 &&
  support >= 56 &&
  (
    direction === "OVER"
      ? totalEdge >= 3.5
      : totalEdge >= 2.5
  )
      };
    }

    const candidates = [];

    candidates.push(buildSideCandidate("away", "ML"));
    candidates.push(buildSideCandidate("home", "ML"));

    if (awaySpread !== undefined && awaySpread !== null) {
      candidates.push(buildSideCandidate("away", "RUNLINE", Number(awaySpread)));
    }

    if (homeSpread !== undefined && homeSpread !== null) {
      candidates.push(buildSideCandidate("home", "RUNLINE", Number(homeSpread)));
    }

    candidates.push(buildTotalCandidate("OVER"));
    candidates.push(buildTotalCandidate("UNDER"));
function getCandidateRankingEdge(card) {
  if (!card) return 0;

  if (card.type === "OVER" || card.type === "UNDER") {
    return Math.abs(Number(card.totalEdge || 0));
  }

  if (card.type === "RUNLINE") {
    return Math.abs(Number(card.protectedEdge || 0));
  }

  if (card.type === "ML") {
    return Math.abs(Number(card.projectedMargin || 0));
  }

  return Math.abs(Number(card.edge || 0));
}
   const premiumCandidates = candidates
  .filter(c => c.isPremium)
  .sort((a, b) => {
    const edgeDiff =
      getCandidateRankingEdge(b) - getCandidateRankingEdge(a);

    if (edgeDiff !== 0) return edgeDiff;

    return Number(b.percentage || 0) - Number(a.percentage || 0);
  });

const recommendedCards = premiumCandidates.slice(0, 1);
    const locked = recommendedCards.length > 0 && !isPremiumUser;
function edgeToPercent(edge, type = "ml") {
  const e = Math.abs(Number(edge));

  if (!Number.isFinite(e)) return 0;

  let minEdge;
  let maxEdge;

  switch (type) {
    case "ml":
      minEdge = 3.0;
      maxEdge = 6.0;
      break;

    case "total":
      minEdge = 2.5;
      maxEdge = 6.5;
      break;

    case "rlplus":
      minEdge = 3.0;
      maxEdge = 6.0;
      break;

    case "rlminus":
      minEdge = 5.0;
      maxEdge = 7.0;
      break;

    default:
      return 0;
  }

  if (e < minEdge) return 0;
  if (e >= maxEdge) return 99.0;

  const percent =
    75 + ((e - minEdge) / (maxEdge - minEdge)) * 24;

  return Number(percent.toFixed(1));
}
function getBullpenFatigueFactor(bullpen) {
  if (!bullpen) return 1;

  const fatigue = Number(bullpen.fatigue);

  if (!Number.isFinite(fatigue)) return 1;

  if (fatigue >= 28) return 1.34;
  if (fatigue >= 24) return 1.28;
  if (fatigue >= 20) return 1.23;
  if (fatigue >= 16) return 1.18;
  if (fatigue >= 12) return 1.12;
  if (fatigue >= 8) return 1.07;
  if (fatigue >= 5) return 1.03;

  if (fatigue <= 2.5) return 0.93;
  if (fatigue <= 4) return 0.97;

  return 1;
}
    const fullMlbAnalysis = {
  locked: false,
  isPremiumPick: recommendedCards.length > 0,
  noPlay: recommendedCards.length === 0,
  public: {
    awayTeam,
    homeTeam,
    totalLine
  },
  premium: {
    recommendedCards,

    favoriteToWin: modelProbA > modelProbB ? awayTeam : homeTeam,
    favoriteProb: Math.max(modelProbA, modelProbB) * 100,

    expectedRunsA,
    expectedRunsB,
    projectedTotal,
    totalLine,
    totalDiff: projectedTotal - totalLine,

    overProbability: overProb,
    underProbability: underProb,
    totalPick,
    totalEdge,

    venue: mlbData.venue || {
      name: "Unknown Stadium",
      parkFactor: 1,
      roof: "unknown"
    },

    weather: mlbData.weather || {
      raw: "No disponible",
      direction: "neutral",
      speed: 0,
      temp: null,
      active: false
    },

    weatherFactor
  }
};
const teamsSorted = [awayTeam, homeTeam]
  .map(t => String(t).trim())
  .sort();

const gameId = teamsSorted.join("-");
const gameDate = new Date().toISOString().split("T")[0];

const { error: dailyPickError } = await supabaseAdmin
  .from("daily_picks")
  .upsert(
    {
      sport: "mlb",
      game_id: gameId,
      away_team: awayTeam,
      home_team: homeTeam,
      analysis_json: fullMlbAnalysis,
      updated_at: new Date().toISOString(),
      game_date: gameDate
    },
    {
      onConflict: "sport,game_id"
    }
  );

if (dailyPickError) {
  throw new Error(
    "Error guardando MLB daily_picks: " +
    dailyPickError.message
  );
}

if (recommendedCards.length > 0) {
  const card = recommendedCards[0];

  const pickType =
    card.type === "ML"
      ? "ml"
      : card.type === "RUNLINE"
        ? "runline"
        : "total";

  const pickDirection =
    card.type === "OVER" || card.type === "UNDER"
      ? card.type
      : null;

  const pickTeam =
    pickType === "total"
      ? null
      : card.team || null;

  const pickLine =
    pickType === "total"
      ? Number(totalLine)
      : Number(String(card.play).match(/[+-]\d+(\.\d+)?/)?.[0]);

  await supabaseAdmin
    .from("picks_history")
    .delete()
    .eq("sport", "mlb")
    .eq("game_id", gameId);

  const { error: historyError } = await supabaseAdmin
    .from("picks_history")
    .insert({
      game_id: gameId,
      sport: "mlb",
      pick: card.play,
      confidence: card.percentage,
      result: "pending",
      is_premium: true,
      pick_type: pickType,
      pick_team: pickTeam,
      line: pickType === "total" ? Number(totalLine) : pickLine,
      away_team: awayTeam,
      home_team: homeTeam,
      game_date: gameDate,
      pick_direction: pickDirection
    });

  if (historyError) {
    throw new Error("Error guardando pick MLB history: " + historyError.message);
  }
}

    return res.status(200).json({
      locked,
      isPremiumPick: recommendedCards.length > 0,
      public: {
        awayTeam,
        homeTeam,
        totalLine
      },
      premium: locked
        ? null
        : {
            recommendedCards,

            favoriteToWin: modelProbA > modelProbB ? awayTeam : homeTeam,
            favoriteProb: Math.max(modelProbA, modelProbB) * 100,

            expectedRunsA,
            expectedRunsB,
            projectedTotal,
            totalLine,
            totalDiff: projectedTotal - totalLine,

            overProbability: overProb,
            underProbability: underProb,
            totalPick,
            totalEdge,

            venue: mlbData.venue || {
              name: "Unknown Stadium",
              parkFactor: 1,
              roof: "unknown"
            },

            weather: mlbData.weather || {
              raw: "No disponible",
              direction: "neutral",
              speed: 0,
              temp: null,
              active: false
            },

            weatherFactor,

            awayOffense,
            homeOffense,

            awayTeamAllowed,
            homeTeamAllowed,

            awayPitcherAllowed: awayPitcher,
            homePitcherAllowed: homePitcher,

            awayBullpenAllowed: awayBullpen,
            homeBullpenAllowed: homeBullpen,

            awayPitcherName: mlbData.away?.pitcher?.name || "No disponible",
            homePitcherName: mlbData.home?.pitcher?.name || "No disponible",

            awayPitcherInnings,
            homePitcherInnings,

            awayBullpenFatigue: mlbData.away?.bullpen?.fatigue || 0,
            homeBullpenFatigue: mlbData.home?.bullpen?.fatigue || 0,
          awayBullpenWhip: mlbData.away?.bullpen?.whip || null,
homeBullpenWhip: mlbData.home?.bullpen?.whip || null,

awayBullpenLast3Whip: mlbData.away?.bullpen?.last3?.whip || null,
homeBullpenLast3Whip: mlbData.home?.bullpen?.last3?.whip || null,

awayBullpenLast7RA9: mlbData.away?.bullpen?.last7?.ra9 || null,
homeBullpenLast7RA9: mlbData.home?.bullpen?.last7?.ra9 || null,

awayBullpenLast3RA9: mlbData.away?.bullpen?.last3?.ra9 || null,
homeBullpenLast3RA9: mlbData.home?.bullpen?.last3?.ra9 || null,

            awayBullpenFatigueFactor: getBullpenFatigueFactor(mlbData.away?.bullpen),
homeBullpenFatigueFactor: getBullpenFatigueFactor(mlbData.home?.bullpen),

            awayRunEnvironment: expectedRunsA,
            homeRunEnvironment: expectedRunsB,

            runEnvironmentFactor,
            parkFactor
          }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

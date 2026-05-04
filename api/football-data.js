const MAX_GAMES_USED = 7;

const SPORT_PATHS = {
  nfl: "football/nfl",
  ncaaf: "football/college-football"
};

const MAX_WEEKS = {
  nfl: 22,
  ncaaf: 16
};

const TEAM_MAP = {
  // NFL
  kc: { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },
  chiefs: { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },
  "kansas city chiefs": { id: "12", keys: ["kc", "chiefs", "kansas city chiefs", "kansas city"] },

  phi: { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },
  eagles: { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },
  "philadelphia eagles": { id: "21", keys: ["phi", "eagles", "philadelphia eagles", "philadelphia"] },

  dal: { id: "6", keys: ["dal", "cowboys", "dallas cowboys", "dallas"] },
  cowboys: { id: "6", keys: ["dal", "cowboys", "dallas cowboys", "dallas"] },

  buf: { id: "2", keys: ["buf", "bills", "buffalo bills", "buffalo"] },
  bills: { id: "2", keys: ["buf", "bills", "buffalo bills", "buffalo"] },

  // NCAAF
  clemson: { id: "228", keys: ["clemson", "clemson tigers", "tigers"] },
  "clemson tigers": { id: "228", keys: ["clemson", "clemson tigers", "tigers"] },

  unc: { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels"] },
  "north carolina": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels"] },
  "north-carolina": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels"] },
  "north carolina tar heels": { id: "153", keys: ["unc", "north carolina", "north carolina tar heels", "tar heels"] },

  alabama: { id: "333", keys: ["alabama", "alabama crimson tide", "crimson tide"] },
  georgia: { id: "61", keys: ["georgia", "georgia bulldogs", "bulldogs"] },
  "ohio state": { id: "194", keys: ["ohio state", "ohio state buckeyes", "osu"] },
  texas: { id: "251", keys: ["texas", "texas longhorns", "longhorns"] },
  oregon: { id: "2483", keys: ["oregon", "oregon ducks", "ducks"] },
  michigan: { id: "130", keys: ["michigan", "michigan wolverines", "wolverines"] },
  fsu: { id: "52", keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] },
  "florida state": { id: "52", keys: ["fsu", "florida state", "florida state seminoles", "seminoles"] }
};

function cleanText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("-", " ")
    .replaceAll(".", "")
    .trim();
}

function getDefaultSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 8 ? year : year - 1;
}

function normalizeTeam(team) {
  const key = cleanText(team);
  const mapped = TEAM_MAP[key];

  if (mapped) {
    return mapped;
  }

  return {
    id: key,
    keys: [key]
  };
}

function average(numbers) {
  const valid = numbers.filter((n) => Number.isFinite(Number(n)));
  if (!valid.length) return 0;
  return valid.reduce((sum, n) => sum + Number(n), 0) / valid.length;
}

function round(num, decimals = 1) {
  if (!Number.isFinite(Number(num))) return 0;
  return Number(Number(num).toFixed(decimals));
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ESPN error ${response.status}: ${url}`);
  }

  return response.json();
}

function isCompletedGame(event, comp) {
  const statusType = comp?.status?.type || event?.status?.type;

  return (
    statusType?.completed === true ||
    statusType?.name === "STATUS_FINAL" ||
    statusType?.state === "post"
  );
}

function competitorMatchesTeam(competitor, teamRef) {
  const id = String(competitor.team?.id || "");
  const abbreviation = cleanText(competitor.team?.abbreviation);
  const displayName = cleanText(competitor.team?.displayName);
  const shortName = cleanText(competitor.team?.shortDisplayName);
  const location = cleanText(competitor.team?.location);
  const name = cleanText(competitor.team?.name);

  if (String(teamRef.id) === id) return true;

  return teamRef.keys.some((key) => {
    const cleanKey = cleanText(key);

    return (
      abbreviation === cleanKey ||
      displayName === cleanKey ||
      shortName === cleanKey ||
      location === cleanKey ||
      name === cleanKey ||
      displayName.includes(cleanKey)
    );
  });
}

async function getSeasonGames(type, season) {
  const sportPath = SPORT_PATHS[type];
  const weeks = MAX_WEEKS[type];

  const allGames = [];

  for (let week = 1; week <= weeks; week++) {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${season}&seasontype=2&week=${week}`;

    try {
      const data = await fetchJson(url);
      const events = data.events || [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];

        if (competitors.length !== 2) continue;
        if (!isCompletedGame(event, comp)) continue;

        const c1 = competitors[0];
        const c2 = competitors[1];

        const score1 = Number(c1.score);
        const score2 = Number(c2.score);

        if (!Number.isFinite(score1) || !Number.isFinite(score2)) continue;

        allGames.push({
          id: event.id,
          date: event.date,
          week,

          team1Id: String(c1.team?.id || ""),
          team1Abbr: c1.team?.abbreviation || "",
          team1Name: c1.team?.displayName || "",
          team1ShortName: c1.team?.shortDisplayName || "",
          team1Location: c1.team?.location || "",
          team1Mascot: c1.team?.name || "",
          team1Score: score1,

          team2Id: String(c2.team?.id || ""),
          team2Abbr: c2.team?.abbreviation || "",
          team2Name: c2.team?.displayName || "",
          team2ShortName: c2.team?.shortDisplayName || "",
          team2Location: c2.team?.location || "",
          team2Mascot: c2.team?.name || "",
          team2Score: score2
        });
      }
    } catch (err) {
      console.log(`No se pudo cargar ${type} week ${week}:`, err.message);
    }
  }

  return allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function gameSideMatches(game, side, teamRef) {
  const fakeCompetitor =
    side === 1
      ? {
          team: {
            id: game.team1Id,
            abbreviation: game.team1Abbr,
            displayName: game.team1Name,
            shortDisplayName: game.team1ShortName,
            location: game.team1Location,
            name: game.team1Mascot
          }
        }
      : {
          team: {
            id: game.team2Id,
            abbreviation: game.team2Abbr,
            displayName: game.team2Name,
            shortDisplayName: game.team2ShortName,
            location: game.team2Location,
            name: game.team2Mascot
          }
        };

  return competitorMatchesTeam(fakeCompetitor, teamRef);
}

function getTeamGamesFromSeason(allGames, teamRef) {
  return allGames
    .filter((game) => {
      return gameSideMatches(game, 1, teamRef) || gameSideMatches(game, 2, teamRef);
    })
    .map((game) => {
      const isTeam1 = gameSideMatches(game, 1, teamRef);

      return {
        date: game.date,
        week: game.week,

        teamPoints: isTeam1 ? game.team1Score : game.team2Score,
        pointsAllowed: isTeam1 ? game.team2Score : game.team1Score,

        opponentId: isTeam1 ? game.team2Id : game.team1Id,
        opponentName: isTeam1 ? game.team2Name : game.team1Name,
        opponentAbbr: isTeam1 ? game.team2Abbr : game.team1Abbr,
        opponentKeys: [
          isTeam1 ? game.team2Name : game.team1Name,
          isTeam1 ? game.team2Abbr : game.team1Abbr,
          isTeam1 ? game.team2Location : game.team1Location,
          isTeam1 ? game.team2Mascot : game.team1Mascot
        ].map(cleanText)
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getOpponentRefFromGame(game) {
  return {
    id: String(game.opponentId || ""),
    keys: game.opponentKeys || []
  };
}

function getOpponentAveragesFromSeason(allGames, opponentRef, beforeDate) {
  const games = getTeamGamesFromSeason(allGames, opponentRef);

  const previousGames = games
    .filter((game) => new Date(game.date) < new Date(beforeDate))
    .slice(0, MAX_GAMES_USED);

  return {
    opponentAvgPointsAllowed: round(
      average(previousGames.map((g) => g.pointsAllowed))
    ),
    opponentAvgPointsScored: round(
      average(previousGames.map((g) => g.teamPoints))
    ),
    gamesUsedForOpponent: previousGames.length
  };
}

function buildTeamGamesFromSeason(allGames, teamRef) {
  const schedule = getTeamGamesFromSeason(allGames, teamRef);

  const recentGames = schedule.slice(
    0,
    Math.min(MAX_GAMES_USED, schedule.length)
  );

  return recentGames.map((game) => {
    const opponentRef = getOpponentRefFromGame(game);

    const opponentAvg = getOpponentAveragesFromSeason(
      allGames,
      opponentRef,
      game.date
    );

    return {
      date: game.date,
      week: game.week,
      opponent: game.opponentName,
      teamPoints: game.teamPoints,
      pointsAllowed: game.pointsAllowed,
      opponentAvgPointsAllowed: opponentAvg.opponentAvgPointsAllowed,
      opponentAvgPointsScored: opponentAvg.opponentAvgPointsScored,
      opponentGamesUsed: opponentAvg.gamesUsedForOpponent
    };
  });
}

function calculateFootballEdges(games = []) {
  const recentGames = games.slice(
    0,
    Math.min(MAX_GAMES_USED, games.length)
  );

  const usableGames = recentGames.filter(
    (game) => Number(game.opponentGamesUsed) > 0
  );

  const gamesForCalc = usableGames.length ? usableGames : recentGames;

  const offensiveEdges = gamesForCalc.map((game) => {
    return Number(game.teamPoints) - Number(game.opponentAvgPointsAllowed);
  });

  const defensiveEdges = gamesForCalc.map((game) => {
    return Number(game.opponentAvgPointsScored) - Number(game.pointsAllowed);
  });

  return {
    gamesUsed: gamesForCalc.length,
    avgPointsScored: round(average(gamesForCalc.map((g) => g.teamPoints))),
    avgPointsAllowed: round(average(gamesForCalc.map((g) => g.pointsAllowed))),
    avgOffensiveEdge: round(average(offensiveEdges)),
    avgDefensiveEdge: round(average(defensiveEdges)),
    offensiveEdges: offensiveEdges.map((n) => round(n)),
    defensiveEdges: defensiveEdges.map((n) => round(n)),
    games: gamesForCalc
  };
}

function projectFootballTeam(team, opponent) {
  const projectionFromOffense =
    opponent.avgPointsAllowed + team.avgOffensiveEdge;

  const projectionFromOpponentDefense =
    team.avgPointsScored + opponent.avgDefensiveEdge;

  const finalProjection =
    (projectionFromOffense + projectionFromOpponentDefense) / 2;

  return {
    projectionFromOffense: round(projectionFromOffense),
    projectionFromOpponentDefense: round(projectionFromOpponentDefense),
    finalProjection: round(finalProjection)
  };
}

module.exports = async function handler(req, res) {
  try {
    const { type = "nfl", teamA, teamB, season } = req.query;

    if (!teamA || !teamB) {
      return res.status(400).json({
        error: "Faltan teamA y teamB",
        example: "/api/football-data?type=nfl&teamA=KC&teamB=PHI&season=2024"
      });
    }

    if (!SPORT_PATHS[type]) {
      return res.status(400).json({
        error: "type inválido. Usa nfl o ncaaf"
      });
    }

    const selectedSeason = Number(season) || getDefaultSeason();

    const teamARef = normalizeTeam(teamA);
    const teamBRef = normalizeTeam(teamB);

    const allGames = await getSeasonGames(type, selectedSeason);

    const teamAGames = buildTeamGamesFromSeason(allGames, teamARef);
    const teamBGames = buildTeamGamesFromSeason(allGames, teamBRef);

    const teamAEdges = calculateFootballEdges(teamAGames);
    const teamBEdges = calculateFootballEdges(teamBGames);

    const teamAProjection = projectFootballTeam(teamAEdges, teamBEdges);
    const teamBProjection = projectFootballTeam(teamBEdges, teamAEdges);

    const projectedTeamA = teamAProjection.finalProjection;
    const projectedTeamB = teamBProjection.finalProjection;

    return res.status(200).json({
      sport: type,
      season: selectedSeason,
      totalSeasonGamesLoaded: allGames.length,
      teamA: {
        name: teamA,
        ref: teamARef,
        ...teamAEdges,
        projection: teamAProjection
      },
      teamB: {
        name: teamB,
        ref: teamBRef,
        ...teamBEdges,
        projection: teamBProjection
      },
      projectedScore: {
        [teamA]: projectedTeamA,
        [teamB]: projectedTeamB
      },
      projectedTotal: round(projectedTeamA + projectedTeamB),
      projectedSpread: round(projectedTeamA - projectedTeamB)
    });
  } catch (error) {
    console.error("ERROR FOOTBALL DATA:", error);

    return res.status(500).json({
      error: "Error cargando data real football",
      details: error.message
    });
  }
};

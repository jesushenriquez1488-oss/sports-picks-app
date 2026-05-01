export default function handler(req, res) {
  try {
    const { teamA, teamB } = req.body;

    // ===============================
    // HELPERS
    // ===============================

    const clamp = (value, min = 0, max = 100) =>
      Math.max(min, Math.min(max, value));

    const lowerIsBetter = (value, excellent, terrible) => {
      if (value <= excellent) return 100;
      if (value >= terrible) return 0;
      return clamp(100 - ((value - excellent) / (terrible - excellent)) * 100);
    };

    const higherIsBetter = (value, terrible, excellent) => {
      if (value >= excellent) return 100;
      if (value <= terrible) return 0;
      return clamp(((value - terrible) / (excellent - terrible)) * 100);
    };

    // ===============================
    // PITCHER
    // ===============================

    function pitcherRecent(stats) {
      return clamp(
        lowerIsBetter(stats.era, 2, 7) * 0.30 +
        lowerIsBetter(stats.runsPerInning, 0.2, 1.0) * 0.25 +
        lowerIsBetter(stats.hitsPerInning, 0.7, 1.5) * 0.20 +
        lowerIsBetter(stats.walksPerInning, 0.2, 0.8) * 0.15 +
        higherIsBetter(stats.innings, 3.5, 6.5) * 0.10
      );
    }

    function pitcherSplit(stats) {
      return clamp(
        lowerIsBetter(stats.era, 2, 7) * 0.35 +
        lowerIsBetter(stats.runsPerInning, 0.2, 1.0) * 0.30 +
        lowerIsBetter(stats.hitsPerInning, 0.7, 1.5) * 0.20 +
        lowerIsBetter(stats.walksPerInning, 0.2, 0.8) * 0.15
      );
    }

    // ===============================
    // BATEO
    // ===============================

    function battingLast5(stats) {
      return clamp(
        higherIsBetter(stats.runs, 2, 7) * 0.35 +
        higherIsBetter(stats.hits, 5, 11) * 0.25 +
        higherIsBetter(stats.walks, 1.5, 5) * 0.15 +
        higherIsBetter(stats.avg, 0.2, 0.32) * 0.15 +
        lowerIsBetter(stats.k, 5, 11) * 0.10
      );
    }

    function battingLocation(stats) {
      return clamp(
        higherIsBetter(stats.runs, 2, 7) * 0.40 +
        higherIsBetter(stats.hits, 5, 11) * 0.25 +
        higherIsBetter(stats.avg, 0.2, 0.32) * 0.20 +
        higherIsBetter(stats.walks, 1.5, 5) * 0.10 +
        lowerIsBetter(stats.k, 5, 11) * 0.05
      );
    }

    // ===============================
    // BULLPEN
    // ===============================

    function bullpen(stats) {
      return clamp(
        lowerIsBetter(stats.era, 2.5, 6.5) * 0.30 +
        lowerIsBetter(stats.runsPerInning, 0.2, 1.0) * 0.25 +
        lowerIsBetter(stats.hitsPerInning, 0.7, 1.5) * 0.15 +
        lowerIsBetter(stats.walksPerInning, 0.2, 0.8) * 0.15 +
        lowerIsBetter(stats.fatigue, 0, 10) * 0.15
      );
    }

    // ===============================
    // CLIMA
    // ===============================

    function weather(stats) {
      let directionScore = 50;

      if (stats.direction === "out") directionScore = 100;
      if (stats.direction === "in") directionScore = 0;
      if (stats.direction === "cross") directionScore = 55;

      const speedScore = higherIsBetter(stats.speed, 0, 20);

      return clamp(
        directionScore * 0.50 +
        speedScore * 0.30 +
        directionScore * 0.20
      );
    }

    // ===============================
    // TEAM PROJECTION
    // ===============================

    function teamProjection(team) {
      return clamp(
        pitcherRecent(team.pitcherRecent) * 0.28 +
        pitcherSplit(team.pitcherSplit) * 0.18 +
        battingLast5(team.battingLast5) * 0.20 +
        battingLocation(team.battingLocation) * 0.10 +
        bullpen(team.bullpen) * 0.14 +
        weather(team.weather) * 0.10
      );
    }

    const teamAProjection = teamProjection(teamA);
    const teamBProjection = teamProjection(teamB);

    const edge = teamAProjection - teamBProjection;
    const pick = edge > 0 ? "teamA" : "teamB";
    const confidence = Math.min(98, 50 + Math.abs(edge) * 2.4);

    return res.status(200).json({
      pick,
      edge,
      confidence,
      teamAProjection,
      teamBProjection
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

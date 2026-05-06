export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
    const { teamA, teamB } = req.body;

    const clamp = (value, min = 0, max = 100) =>
      Math.max(min, Math.min(max, value));

    const safe = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const lowerIsBetter = (value, excellent, terrible) => {
      value = safe(value, terrible);

      if (value <= excellent) return 100;
      if (value >= terrible) return 0;

      return clamp(100 - ((value - excellent) / (terrible - excellent)) * 100);
    };

    const higherIsBetter = (value, terrible, excellent) => {
      value = safe(value, terrible);

      if (value >= excellent) return 100;
      if (value <= terrible) return 0;

      return clamp(((value - terrible) / (excellent - terrible)) * 100);
    };

    function pitcherRecent(stats = {}) {
      return clamp(
        lowerIsBetter(stats.era, 2.50, 7.00) * 0.30 +
        lowerIsBetter(stats.runsPerInning, 0.25, 1.00) * 0.25 +
        lowerIsBetter(stats.hitsPerInning, 0.75, 1.60) * 0.20 +
        lowerIsBetter(stats.walksPerInning, 0.20, 0.80) * 0.15 +
        higherIsBetter(stats.innings, 3.5, 6.5) * 0.10
      );
    }

    function battingRecent(stats = {}) {
      return clamp(
        higherIsBetter(stats.runs, 2.5, 7.0) * 0.35 +
        higherIsBetter(stats.hits, 6.0, 11.0) * 0.25 +
        higherIsBetter(stats.walks, 1.5, 5.0) * 0.15 +
        higherIsBetter(stats.avg, 0.210, 0.320) * 0.15 +
        lowerIsBetter(stats.k, 11.0, 5.0) * 0.10
      );
    }

    function bullpen(stats = {}) {
      return clamp(
        lowerIsBetter(stats.era, 2.75, 6.75) * 0.30 +
        lowerIsBetter(stats.runsPerInning, 0.25, 1.00) * 0.25 +
        lowerIsBetter(stats.hitsPerInning, 0.75, 1.60) * 0.15 +
        lowerIsBetter(stats.walksPerInning, 0.20, 0.80) * 0.15 +
        lowerIsBetter(stats.fatigue, 0, 10) * 0.15
      );
    }

    function weather(stats = {}) {
      let directionScore = 50;

      if (stats.direction === "out") directionScore = 100;
      if (stats.direction === "in") directionScore = 0;
      if (stats.direction === "cross") directionScore = 55;

      const speedScore = higherIsBetter(stats.speed, 0, 20);

      const tempScore = stats.temp
        ? higherIsBetter(Number(stats.temp), 45, 90)
        : 50;

      return clamp(
        directionScore * 0.50 +
        speedScore * 0.30 +
        tempScore * 0.20
      );
    }

    function teamProjection(team = {}) {
      const pitcherScore = pitcherRecent(team.pitcherRecent || team.pitcher?.stats);
      const battingScore = battingRecent(team.battingLast7 || team.battingLast5);
      const bullpenScore = bullpen(team.bullpen);
      const weatherScore = weather(team.weather);

      return clamp(
        pitcherScore * 0.32 +
        battingScore * 0.30 +
        bullpenScore * 0.25 +
        weatherScore * 0.13
      );
    }

    const teamAProjection = teamProjection(teamA);
    const teamBProjection = teamProjection(teamB);

    const edge = teamAProjection - teamBProjection;
    const pick = edge > 0 ? "teamA" : "teamB";
    const confidence = Math.min(98, 50 + Math.abs(edge) * 2.1);

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

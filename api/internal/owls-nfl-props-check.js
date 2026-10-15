
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (
    !process.env.CRON_SECRET ||
    req.headers["x-internal-secret"] !==
      process.env.CRON_SECRET
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const apiKey = process.env.OWLS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "OWLS_API_KEY missing in Vercel"
    });
  }

  try {
    const response = await fetch(
      "https://api.owlsinsight.com/api/v1/nfl/props",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: "Owls request failed",
        owlsStatus: response.status
      });
    }

    const payload = await response.json();

    if (
      !payload.success ||
      !Array.isArray(payload.data)
    ) {
      return res.status(502).json({
        error: "Unexpected Owls response"
      });
    }

    const categories = [
      "pass_rush_yards",
      "rush_rec_yards",
      "passing_yards",
      "rushing_yards",
      "receiving_yards"
    ];

    const results = [];

    for (const category of categories) {
      const found = [];

      for (const game of payload.data) {
        for (const book of game.books || []) {
          for (const prop of book.props || []) {
            if (prop.category !== category) {
              continue;
            }

            const alternatives =
              Array.isArray(prop.alternateLines)
                ? prop.alternateLines
                : [];

            found.push({
              game: game.gameId,
              player: prop.playerName,
              book: book.key,
              line: prop.line,
              overPrice: prop.overPrice ?? null,
              underPrice: prop.underPrice ?? null,
              marketStructure:
                prop.marketStructure ?? null,
              alternativeCount:
                alternatives.length,
              alternatives: alternatives
                .slice(0, 8)
                .map(alt => ({
                  line: alt.line,
                  odds: alt.odds,
                  side: alt.side ?? null
                }))
            });
          }
        }
      }

      const books = [
        ...new Set(found.map(p => p.book))
      ];

      const withAlternatives =
        found.filter(
          p => p.alternativeCount > 0
        ).length;

      const games = [
        ...new Set(found.map(p => p.game))
      ];

      found.sort(
        (a, b) =>
          b.alternativeCount -
          a.alternativeCount
      );

      results.push({
        category,
        totalMarkets: found.length,
        gamesAvailable: games.length,
        books,
        marketsWithAlternatives:
          withAlternatives,
        examples: found.slice(0, 4)
      });
    }

    return res.status(200).json({
      ok: true,
      source: "Owls Insight NFL",
      checkedAt: new Date().toISOString(),
      totalGames: payload.data.length,
      sourceTimestamp:
        payload.meta?.timestamp ?? null,
      results
    });

  } catch (error) {
    console.error(
      "Owls NFL check failed:",
      error.message
    );

    return res.status(500).json({
      error: "Owls connection failed"
    });
  }
};

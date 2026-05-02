const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      userId,
      awayTeam,
      homeTeam,
      awaySpread,
      homeSpread,
      total,
      awayGames,
      homeGames,
      awayAll,
      homeAll,
      awayInjuries,
      homeInjuries
    } = req.body || {};

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("is_premium")
      .eq("id", userId)
      .single();

    const isPremiumUser = profile?.is_premium === true;

    const clamp = (value, min = 0, max = 100) =>
      Math.max(min, Math.min(max, value));

    function calcTeamFormula(teamGames) {
      const offenseAvg =
        teamGames.reduce((sum, g) => sum + g.scored, 0) / teamGames.length;

      const defenseAllowedAvg =
        teamGames.reduce((sum, g) => sum + g.allowed, 0) / teamGames.length;

      const offensiveEdges = teamGames.map(g => {
        return g.scored - (g.opponentAvgAllowed || g.allowed);
      });

      const offensiveEdgeAvg =
        offensiveEdges.reduce((sum, edge) => sum + edge, 0) / offensiveEdges.length;

      const defensiveEdgeAvg = defenseAllowedAvg - offenseAvg;

      return {
        offenseAvg,
        defenseAllowedAvg,
        offensiveEdgeAvg,
        defensiveEdgeAvg
      };
    }

    function calcProjection(teamGames, opponentGames) {
      const team = calcTeamFormula(teamGames);
      const opponent = calcTeamFormula(opponentGames);

      const opponentDefenseAvg = opponent.defenseAllowedAvg;

      const A = team.offensiveEdgeAvg + opponentDefenseAvg;
      const B = team.offenseAvg + opponent.defensiveEdgeAvg;

      const projection = (A + B) / 2;

      return {
        projection,
        avgDifferential: projection - team.offenseAvg
      };
    }

    function getRestAdjustment(allGames) {
      if (!allGames || allGames.length < 2) {
        return {
          points: 0,
          note: "Descanso no disponible"
        };
      }

      const last = new Date(allGames[0].date);
      const prev = new Date(allGames[1].date);
      const diffDays = Math.round((last - prev) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        return {
          points: -3,
          note: "Back-to-back detectado. El equipo podría mostrar menor energía y eficiencia."
        };
      }

      if (diffDays >= 3) {
        return {
          points: 2,
          note: "Buen descanso. El equipo llega con mejor recuperación física."
        };
      }

      return {
        points: 0,
        note: "Descanso normal"
      };
    }

    function getConfidence(edge) {
      let confidence = 50 + edge * 2.4;
      confidence = Math.max(50, Math.min(99, confidence));
      return Math.round(confidence);
    }

    function getModelAnalysis(verdict) {
      if (verdict === "Premium") {
        return "El modelo detecta una ventaja fuerte contra la línea del mercado.";
      }

      if (verdict === "Moderado") {
        return "El modelo detecta una ventaja moderada contra la línea del mercado.";
      }

      return "El modelo no detecta suficiente ventaja para recomendar entrada fuerte.";
    }

    if (
      !Array.isArray(awayGames) ||
      !Array.isArray(homeGames) ||
      awayGames.length < 5 ||
      homeGames.length < 5
    ) {
      return res.status(400).json({ error: "No hay suficientes juegos recientes." });
    }

    const awayCalc = calcProjection(awayGames, homeGames);
    const homeCalc = calcProjection(homeGames, awayGames);

    const awayRest = getRestAdjustment(awayAll);
    const homeRest = getRestAdjustment(homeAll);

    const awayOffenseImpact = Number(awayInjuries?.offenseImpact || 0);
    const homeOffenseImpact = Number(homeInjuries?.offenseImpact || 0);
    const awayDefenseImpact = Number(awayInjuries?.defenseImpact || 0);
    const homeDefenseImpact = Number(homeInjuries?.defenseImpact || 0);

    const projA =
      awayCalc.projection +
      awayRest.points +
      awayOffenseImpact +
      homeDefenseImpact;

    const projB =
      homeCalc.projection +
      homeRest.points +
      homeOffenseImpact +
      awayDefenseImpact;

    const totalProj = projA + projB;
    const spreadDiff = projA - projB;
    const projectedMargin = projA - projB;

    const awaySpreadEdge = projectedMargin + awaySpread;
    const homeSpreadEdge = -projectedMargin + homeSpread;

    const spreadEdge = Math.max(awaySpreadEdge, homeSpreadEdge);
    const totalEdge = total > 0 ? Math.abs(totalProj - total) : 0;

    const spreadConfidence = getConfidence(spreadEdge);
    const totalConfidence = total > 0 ? getConfidence(totalEdge) : 0;

    let pick = "";
    let confidence = 0;
    let mainEdge = 0;
    let mainEdgeConfidence = 0;

    if (spreadConfidence >= totalConfidence) {
      pick = awaySpreadEdge >= homeSpreadEdge
        ? `${awayTeam} ${awaySpread > 0 ? "+" : ""}${awaySpread} cubre spread`
        : `${homeTeam} ${homeSpread > 0 ? "+" : ""}${homeSpread} cubre spread`;

      confidence = spreadConfidence;
      mainEdge = spreadEdge;
      mainEdgeConfidence = spreadConfidence;
    } else {
      pick = totalProj > total ? "Over" : "Under";
      confidence = totalConfidence;
      mainEdge = totalEdge;
      mainEdgeConfidence = totalConfidence;
    }

    if (confidence < 60) {
      return res.status(200).json({
        locked: false,
        isPremiumPick: false,
        noPlay: true,
        public: {
          title: "No hay ventaja clara",
          message: "El modelo no encontró suficiente edge para recomendar entrada en este juego.",
          reason: "Baja probabilidad según el modelo."
        },
        premium: null
      });
    }

    const verdict =
      confidence >= 74 ? "Premium" :
      confidence >= 60 ? "Moderado" :
      "Evitar";

    const risk =
      confidence >= 74 ? "Bajo" :
      confidence >= 60 ? "Medio" :
      "Alto";

    const isPremiumPick = verdict === "Premium";
    const locked = isPremiumPick && !isPremiumUser;

    return res.status(200).json({
      locked,
      isPremiumPick,
      noPlay: false,
      public: {
        awayTeam,
        homeTeam,
        confidence,
        risk,
        verdict,
        hasPremium: isPremiumPick,
        factors: [
          "Forma reciente",
          "Condición local/visitante",
          "Descanso",
          "Lesiones",
          "Edge contra spread/total"
        ]
      },
      premium: locked ? null : {
        pick,
        confidence,
        risk,
        verdict,
        mainEdge,
        mainEdgeConfidence,
        spreadDiff,
        projA,
        projB,
        totalProj,
        modelAnalysis: getModelAnalysis(verdict),
        awayRestNote: awayRest.note,
        homeRestNote: homeRest.note,
        awayInjuryNote: awayInjuries?.note || "",
        homeInjuryNote: homeInjuries?.note || "",
        awayInjuryPublic: getInjuryPublicMessage(awayTeam, awayInjuries),
        homeInjuryPublic: getInjuryPublicMessage(homeTeam, homeInjuries)
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

function getInjuryPublicMessage(teamName, injury = {}) {
  if (injury.offenseImpact < 0 && injury.defenseImpact > 0) {
    return `${teamName} presenta posibles bajas en ofensiva y defensiva, lo que podría afectar su rendimiento general.`;
  }

  if (injury.offenseImpact < 0) {
    return `${teamName} presenta posibles bajas en ofensiva, lo que podría afectar su producción de puntos.`;
  }

  if (injury.defenseImpact > 0) {
    return `${teamName} presenta posibles bajas en defensiva, lo que podría afectar su capacidad para contener al rival.`;
  }

  return `No se reportan bajas clave que afecten significativamente el rendimiento de ${teamName}.`;
}

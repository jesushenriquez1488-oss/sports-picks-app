
"use strict";

// CASHEDGE FANTASY EDGE
// ESPN NBA DEPTH CHART — DIAGNOSTICO V1
//
// Solo consulta y valida la respuesta de ESPN.
// NO escribe en Supabase.
// NO modifica proyecciones.
// NO cambia Premium Picks ni Player Props.
// NO publica recomendaciones.

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

const ESPN_TEAM_ID = "25";

function preview(value, maxLength = 14000) {
  const json = JSON.stringify(value, null, 2);

  if (!json) return "null";

  if (json.length > maxLength) {
    return json.slice(0, maxLength) +
      "\n... RESPUESTA RECORTADA ...";
  }

  return json;
}

async function getDepthChart(teamId) {
  if (!/^\d+$/.test(String(teamId))) {
    throw new Error("ESPN team ID invalido");
  }

  const url =
    `${ESPN_BASE}/teams/${teamId}/depthcharts`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `ESPN HTTP ${response.status}: ` +
      body.slice(0, 500)
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      "ESPN no devolvio un JSON valido"
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error(
      "La respuesta ESPN tiene un formato inesperado"
    );
  }

  const chart =
    data.depthchart ??
    data.depthcharts ??
    null;

  return {
    provider: "espn",
    teamId: String(teamId),
    checkedAt: new Date().toISOString(),
    endpoint: url,
    responseKeys: Object.keys(data),
    team: data.team ?? null,
    season: data.season ?? null,
    timestamp: data.timestamp ?? null,
    chartPresent: chart !== null,
    chartType: Array.isArray(chart)
      ? "array"
      : typeof chart,
    chartPreview: chart,
    status: data.status ?? null
  };
}

async function main() {
  console.log(
    "===== CASHEDGE ESPN NBA DEPTH CHART ====="
  );

  console.log(
    "Mode: READ ONLY / SHADOW"
  );

  const result = await getDepthChart(
    ESPN_TEAM_ID
  );

  console.log(
    "Team ID:", result.teamId
  );

  console.log(
    "Checked at:", result.checkedAt
  );

  console.log(
    "Response keys:",
    result.responseKeys
  );

  console.log(
    "Depth chart present:",
    result.chartPresent
  );

  console.log(
    "Depth chart type:",
    result.chartType
  );

  console.log(
    "Team:",
    preview(result.team, 1200)
  );

  console.log(
    "Season:",
    preview(result.season, 1200)
  );

  console.log(
    "Status:",
    preview(result.status, 1200)
  );

  console.log(
    "DEPTH CHART STRUCTURE:"
  );

  console.log(
    preview(result.chartPreview)
  );

  if (!result.chartPresent) {
    console.log(
      "WARNING: Depth chart missing."
    );
  }

  console.log(
    "===== END ESPN DEPTH CHART CHECK ====="
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      "ESPN_DEPTHCHART_ERROR:",
      error.message
    );

    process.exitCode = 1;
  });
}

module.exports = {
  getDepthChart
};

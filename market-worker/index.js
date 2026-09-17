// ============================================================
// CASHEDGE LIVE MARKET WORKER
// ============================================================
//
// Este proceso vive 24/7 fuera de Vercel.
//
// Flujo final:
// OWLS WebSocket
//      ↓
// Provider Adapter
//      ↓
// CashEdge Market Intelligence
//
// Por ahora:
// - Arranca de forma segura.
// - No conecta todavía con Owls.
// - No modifica Market Intelligence.
// - No envía datos falsos.
// ============================================================

"use strict";


const WORKER_NAME =
  "cashedge-live-market-worker";

const CASHEDGE_ORIGIN =
  process.env.CASHEDGE_ORIGIN ||
  "https://www.cashedgeapp.com";


// ============================================================
// STARTUP
// ============================================================

function start() {

  console.log(
    `[${WORKER_NAME}] started`
  );

  console.log(
    `[${WORKER_NAME}] CashEdge origin: ${CASHEDGE_ORIGIN}`
  );

  /*
   * Mantiene vivo el proceso en Railway.
   *
   * Cuando conectemos Owls, el WebSocket será
   * quien mantenga naturalmente vivo el worker.
   *
   * No imprimimos heartbeats para no llenar logs.
   */
  setInterval(
    () => {},
    60 * 1000
  );
}


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown(signal) {

  console.log(
    `[${WORKER_NAME}] shutting down: ${signal}`
  );

  process.exit(0);
}


process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);


// ============================================================
// RUN
// ============================================================

start();

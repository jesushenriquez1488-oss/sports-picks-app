// ============================================================
// CASHEDGE LIVE MARKET WORKER
// OWLS INSIGHT LIVE CONNECTION
// ============================================================

"use strict";

const {
  io
} = require("socket.io-client");


const WORKER_NAME =
  "cashedge-live-market-worker";

const OWLS_URL =
  "https://api.owlsinsight.com";

const OWLS_API_KEY =
  process.env.OWLS_API_KEY;

const CASHEDGE_ORIGIN =
  process.env.CASHEDGE_ORIGIN ||
  "https://www.cashedgeapp.com";


// ============================================================
// SAFETY
// ============================================================

if (!OWLS_API_KEY) {
  console.error(
    `[${WORKER_NAME}] OWLS_API_KEY is missing`
  );

  process.exit(1);
}


// ============================================================
// STATE
// ============================================================

let firstOddsUpdateSeen =
  false;


// ============================================================
// OWLS SOCKET
// ============================================================

const socket =
  io(
    OWLS_URL,
    {
      query: {
        apiKey:
          OWLS_API_KEY
      },

      transports: [
        "websocket"
      ],

      reconnection:
        true,

      reconnectionAttempts:
        Infinity,

      reconnectionDelay:
        1000,

      reconnectionDelayMax:
        15000,

      timeout:
        20000
    }
  );


// ============================================================
// CONNECTED
// ============================================================

socket.on(
  "connect",
  () => {

    console.log(
      `[${WORKER_NAME}] connected to Owls Insight`
    );

    /*
     * For now we subscribe by SPORT only.
     *
     * We intentionally do NOT restrict books yet.
     * First we verify the real provider payload and
     * exact sportsbook keys Owls is sending.
     */
    socket.emit(
      "subscribe",
      {
        sports: [
          "mlb",
          "nfl",
          "nba",
          "ncaaf",
          "ncaab",
          "wnba"
        ]
      }
    );

    console.log(
      `[${WORKER_NAME}] subscribed to CashEdge sports`
    );
  }
);


// ============================================================
// ODDS
// ============================================================

socket.on(
  "odds-update",
  data => {

    /*
     * IMPORTANT:
     *
     * We are intentionally NOT sending anything
     * into CashEdge yet.
     *
     * First we verify the exact real Owls payload.
     */

    if (firstOddsUpdateSeen) {
      return;
    }

    firstOddsUpdateSeen =
      true;

    const sports =
      data?.sports &&
      typeof data.sports === "object"
        ? Object.keys(
            data.sports
          )
        : [];

    const counts = {};

    for (
      const sport
      of sports
    ) {
      counts[sport] =
        Array.isArray(
          data.sports[sport]
        )
          ? data.sports[sport].length
          : 0;
    }

    console.log(
      `[${WORKER_NAME}] first Owls odds-update received`
    );

    console.log(
      `[${WORKER_NAME}] sports: ${JSON.stringify(counts)}`
    );
  }
);


// ============================================================
// CONNECTION ERRORS
// ============================================================

socket.on(
  "connect_error",
  error => {

    console.error(
      `[${WORKER_NAME}] Owls connection error: ${error.message}`
    );
  }
);


socket.on(
  "disconnect",
  reason => {

    console.log(
      `[${WORKER_NAME}] disconnected from Owls: ${reason}`
    );
  }
);


// ============================================================
// STARTUP
// ============================================================

console.log(
  `[${WORKER_NAME}] started`
);

console.log(
  `[${WORKER_NAME}] CashEdge origin: ${CASHEDGE_ORIGIN}`
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown(
  signal
) {

  console.log(
    `[${WORKER_NAME}] shutting down: ${signal}`
  );

  socket.disconnect();

  process.exit(0);
}


process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

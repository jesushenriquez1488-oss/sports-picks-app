// ============================================================
// CASHEDGE MARKET INTELLIGENCE
// ONESIGNAL PROVIDER ADAPTER
//
// Responsabilidad:
// - Recibir UNA delivery ya validada.
// - Enviar a UNA subscription exacta de OneSignal.
// - No decide elegibilidad Premium.
// - No hace fanout.
// - No hace retries por sí mismo.
// - No usa segmentos.
// ============================================================

const ONESIGNAL_API_URL =
  "https://api.onesignal.com/notifications";

const DEFAULT_TIMEOUT_MS = 10000;


// ============================================================
// HELPERS
// ============================================================

function cleanString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}


function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


function safeDataObject(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return value;
}


function isHttpUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch (_) {
    return false;
  }
}


function classifyHttpFailure(status) {
  const code = Number(status);

  if (
    code === 408 ||
    code === 409 ||
    code === 425 ||
    code === 429 ||
    code >= 500
  ) {
    return {
      retryable: true,
      category: "provider_transient"
    };
  }

  return {
    retryable: false,
    category: "provider_permanent"
  };
}


function getOneSignalConfig() {
  const appId =
    cleanString(
      process.env.ONESIGNAL_APP_ID
    );

  // Preferimos la nueva App API Key.
  // Dejamos fallback temporal a la legacy key
  // mientras terminamos la migración.
  const apiKey =
    cleanString(
      process.env.ONESIGNAL_APP_API_KEY ||
      process.env.ONESIGNAL_REST_API_KEY
    );

  if (!appId) {
    return {
      ok: false,
      error: "ONESIGNAL_APP_ID_MISSING"
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      error: "ONESIGNAL_APP_API_KEY_MISSING"
    };
  }

  return {
    ok: true,
    appId,
    apiKey
  };
}


// ============================================================
// NORMALIZE PROVIDER RESPONSE
// ============================================================

function normalizeProviderErrorBody(body) {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    return body.slice(0, 1000);
  }

  if (
    Array.isArray(body.errors) &&
    body.errors.length
  ) {
    return body.errors
      .map(item =>
        typeof item === "string"
          ? item
          : JSON.stringify(item)
      )
      .join(" | ")
      .slice(0, 1000);
  }

  if (body.errors) {
    try {
      return JSON
        .stringify(body.errors)
        .slice(0, 1000);
    } catch (_) {
      return "OneSignal provider error";
    }
  }

  if (body.error) {
    return cleanString(body.error)
      .slice(0, 1000);
  }

  return null;
}


// ============================================================
// SEND ONE PUSH
// ============================================================

async function sendOneSignalPush({
  subscriptionId,
  title,
  message,
  url = null,
  data = null,
  priority = null,
  collapseId = null,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {

  const config =
    getOneSignalConfig();

  if (!config.ok) {
    return {
      ok: false,
      provider: "onesignal",
      retryable: false,
      category: "configuration",
      errorCode: config.error,
      errorMessage: config.error,
      httpStatus: null,
      providerMessageId: null
    };
  }


  const cleanSubscriptionId =
    cleanString(subscriptionId);

  const cleanTitle =
    cleanString(title);

  const cleanMessage =
    cleanString(message);


  if (!cleanSubscriptionId) {
    return {
      ok: false,
      provider: "onesignal",
      retryable: false,
      category: "validation",
      errorCode: "SUBSCRIPTION_ID_MISSING",
      errorMessage:
        "OneSignal subscription id is required.",
      httpStatus: null,
      providerMessageId: null
    };
  }


  if (!cleanTitle) {
    return {
      ok: false,
      provider: "onesignal",
      retryable: false,
      category: "validation",
      errorCode: "TITLE_MISSING",
      errorMessage:
        "Push title is required.",
      httpStatus: null,
      providerMessageId: null
    };
  }


  if (!cleanMessage) {
    return {
      ok: false,
      provider: "onesignal",
      retryable: false,
      category: "validation",
      errorCode: "MESSAGE_MISSING",
      errorMessage:
        "Push message is required.",
      httpStatus: null,
      providerMessageId: null
    };
  }


  // ==========================================================
  // EXACT DEVICE TARGETING
  //
  // Nunca usamos:
  // included_segments
  // filters
  // aliases
  //
  // Solamente la subscription exacta que ya pasó
  // por nuestro Delivery Queue.
  // ==========================================================

  const requestBody = {
    app_id:
      config.appId,

    include_subscription_ids: [
      cleanSubscriptionId
    ],

    headings: {
      en: cleanTitle
    },

    contents: {
      en: cleanMessage
    }
  };


  // ==========================================================
  // DEEP LINK / WEB URL
  // ==========================================================

  const cleanUrl =
    cleanString(url);

  if (
    cleanUrl &&
    isHttpUrl(cleanUrl)
  ) {
    requestBody.url =
      cleanUrl;
  }


  // ==========================================================
  // CUSTOM DATA
  //
  // Aquí después podemos mandar:
  // notificationId
  // eventId
  // sport
  // market
  // play
  // kind
  // deepLink
  // etc.
  // ==========================================================

  const safeData =
    safeDataObject(data);

  if (
    Object.keys(safeData).length
  ) {
    requestBody.data =
      safeData;
  }


  // ==========================================================
  // PRIORITY
  //
  // La usaremos para alertas inmediatas como:
  // STALE_LINE
  // VALUE_AVAILABLE
  // WINDOW_CLOSING
  // ==========================================================

  if (
    Number.isFinite(
      Number(priority)
    )
  ) {
    requestBody.priority =
      Number(priority);
  }


  // ==========================================================
  // COLLAPSE ID
  //
  // Permite reemplazar una alerta anterior relacionada
  // con la misma oportunidad cuando corresponda.
  // ==========================================================

  const cleanCollapseId =
    cleanString(collapseId);

  if (cleanCollapseId) {
    requestBody.collapse_id =
      cleanCollapseId.slice(0, 64);
  }


  // ==========================================================
  // REQUEST TIMEOUT
  // ==========================================================

  const controller =
    new AbortController();

  const safeTimeout =
    Number.isFinite(
      Number(timeoutMs)
    )
      ? Math.max(
          1000,
          Math.min(
            Number(timeoutMs),
            30000
          )
        )
      : DEFAULT_TIMEOUT_MS;


  const timer =
    setTimeout(
      () => controller.abort(),
      safeTimeout
    );


  try {

    const response =
      await fetch(
        ONESIGNAL_API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Key ${config.apiKey}`
          },

          body:
            JSON.stringify(
              requestBody
            ),

          signal:
            controller.signal
        }
      );


    let responseBody =
      null;


    try {
      responseBody =
        await response.json();
    } catch (_) {
      responseBody =
        null;
    }


    // ========================================================
    // HTTP ERROR
    // ========================================================

    if (!response.ok) {

      const classification =
        classifyHttpFailure(
          response.status
        );


      return {
        ok: false,

        provider:
          "onesignal",

        retryable:
          classification.retryable,

        category:
          classification.category,

        errorCode:
          `ONESIGNAL_HTTP_${response.status}`,

        errorMessage:
          normalizeProviderErrorBody(
            responseBody
          ) ||
          `OneSignal HTTP ${response.status}`,

        httpStatus:
          response.status,

        providerMessageId:
          null,

        providerResponse:
          responseBody
      };
    }


    // ========================================================
    // ONESIGNAL ACCEPTED HTTP REQUEST BUT CREATED NO MESSAGE
    //
    // OneSignal documents that a valid request can return 200
    // without an id when there are no valid subscriptions in
    // the target audience.
    // ========================================================

    const providerMessageId =
      cleanString(
        responseBody?.id
      );


    if (!providerMessageId) {

      return {
        ok: false,

        provider:
          "onesignal",

        retryable:
          false,

        category:
          "invalid_subscription",

        errorCode:
          "ONESIGNAL_NO_MESSAGE_ID",

        errorMessage:
          normalizeProviderErrorBody(
            responseBody
          ) ||
          "OneSignal accepted the request but no valid subscription received the message.",

        httpStatus:
          response.status,

        providerMessageId:
          null,

        providerResponse:
          responseBody
      };
    }


    // ========================================================
    // SUCCESS
    // ========================================================

    return {
      ok: true,

      provider:
        "onesignal",

      retryable:
        false,

      category:
        "sent",

      errorCode:
        null,

      errorMessage:
        null,

      httpStatus:
        response.status,

      providerMessageId,

      providerResponse:
        responseBody
    };


  } catch (error) {

    // ========================================================
    // TIMEOUT
    // ========================================================

    if (
      error?.name ===
      "AbortError"
    ) {

      return {
        ok: false,

        provider:
          "onesignal",

        retryable:
          true,

        category:
          "provider_timeout",

        errorCode:
          "ONESIGNAL_TIMEOUT",

        errorMessage:
          `OneSignal request exceeded ${safeTimeout}ms.`,

        httpStatus:
          null,

        providerMessageId:
          null
      };
    }


    // ========================================================
    // NETWORK / UNKNOWN PROVIDER FAILURE
    // ========================================================

    return {
      ok: false,

      provider:
        "onesignal",

      retryable:
        true,

      category:
        "provider_network",

      errorCode:
        "ONESIGNAL_NETWORK_ERROR",

      errorMessage:
        cleanString(
          error?.message ||
          error
        ).slice(0, 1000),

      httpStatus:
        null,

      providerMessageId:
        null
    };


  } finally {

    clearTimeout(
      timer
    );
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  sendOneSignalPush
};

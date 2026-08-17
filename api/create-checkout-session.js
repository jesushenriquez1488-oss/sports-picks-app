const Stripe = require("stripe");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();

    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }

    return cookies;
  }, {});
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0]?.trim() || "";
  }

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || "";
  }

  return (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    ""
  );
}

function getTtclidFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("ttclid") || "";
  } catch {
    return "";
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: "STRIPE_SECRET_KEY no está configurada"
      });
    }

    const stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY
    );

   const {
  promoCode = "",
  action = "checkout",
  advertisingConsent = "denied",

  // TikTok
  ttclid = ""
} = req.body || {};

/*
 * =========================
 * AUTHENTICATION
 * =========================
 */

const authHeader =
  String(
    req.headers.authorization || ""
  );

const token =
  authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

if (!token) {
  return res.status(401).json({
    error: "Unauthorized"
  });
}

const {
  data: authData,
  error: authError
} =
  await supabaseAdmin.auth.getUser(
    token
  );

if (
  authError ||
  !authData?.user?.id
) {
  return res.status(401).json({
    error: "Unauthorized"
  });
}

const userId =
  authData.user.id;

const email =
  authData.user.email || "";

    const hasAdvertisingConsent =
      advertisingConsent === "granted";

    const cleanPromoCode = String(
      promoCode || ""
    )
      .trim()
      .toUpperCase();

    console.log(
      "PROMO CODE RECEIVED:",
      cleanPromoCode
    );

    const APP_URL =
      "https://www.cashedgeapp.com";

    if (!userId || userId === "guest") {
      return res.status(400).json({
        error: "Falta userId válido"
      });
    }

    if (action === "portal") {
      const { data: user, error } =
        await supabaseAdmin
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .single();

      if (
        error ||
        !user?.stripe_customer_id
      ) {
        return res.status(404).json({
          error:
            "No se encontró cliente de Stripe para este usuario"
        });
      }

      const portalSession =
        await stripe.billingPortal.sessions.create({
          customer:
            user.stripe_customer_id,
          return_url: APP_URL
        });

      return res.status(200).json({
        url: portalSession.url
      });
    }

    if (!email) {
      return res.status(400).json({
        error: "Falta email"
      });
    }

    const baseMetadata = {
      userId: String(userId),
      email: String(email || ""),
      promoCode: cleanPromoCode,
      advertisingConsent:
        hasAdvertisingConsent
          ? "granted"
          : "denied"
    };

    let metaEventId = null;
    let tiktokEventId = null;

    let trackingMetadata = {
      ...baseMetadata
    };

    if (hasAdvertisingConsent) {
      const cookies = parseCookies(
        req.headers.cookie || ""
      );

      /*
       * =========================
       * EVENT IDS
       * =========================
       */

      metaEventId =
        crypto.randomUUID();

      tiktokEventId =
        crypto.randomUUID();

      /*
       * =========================
       * META
       * =========================
       */

      const fbp =
        cookies._fbp || "";

      const fbc =
        cookies._fbc || "";

      /*
       * =========================
       * TIKTOK
       * =========================
       */

      const ttp =
        cookies._ttp || "";

      /*
       * TikTok añade ttclid a la URL
       * cuando el usuario llega desde
       * un anuncio.
       *
       * Primero usamos el valor que
       * venga desde el frontend.
       * Si no existe, intentamos
       * recuperarlo del Referer.
       */

      const eventSourceUrl =
        req.headers.referer ||
        APP_URL;

      const bodyTtclid =
        String(ttclid || "").trim();

      const urlTtclid =
        getTtclidFromUrl(
          eventSourceUrl
        );

      const finalTtclid =
        bodyTtclid ||
        urlTtclid;

      /*
       * =========================
       * CLIENT DATA
       * =========================
       */

      const clientIpAddress =
        getClientIp(req);

      const clientUserAgent =
        req.headers["user-agent"] ||
        "";

      trackingMetadata = {
        ...baseMetadata,

        /*
         * Meta deduplication
         */
        metaEventId,

        /*
         * TikTok deduplication
         */
        tiktokEventId,

        eventSourceUrl:
          String(eventSourceUrl),

        ...(clientIpAddress
          ? {
              clientIpAddress:
                String(
                  clientIpAddress
                )
            }
          : {}),

        ...(clientUserAgent
          ? {
              clientUserAgent:
                String(
                  clientUserAgent
                )
            }
          : {}),

        /*
         * Meta attribution
         */
        ...(fbp
          ? {
              fbp: String(fbp)
            }
          : {}),

        ...(fbc
          ? {
              fbc: String(fbc)
            }
          : {}),

        /*
         * TikTok attribution
         */
        ...(ttp
          ? {
              ttp: String(ttp)
            }
          : {}),

        ...(finalTtclid
          ? {
              ttclid:
                String(
                  finalTtclid
                )
            }
          : {})
      };
    }

    const session =
      await stripe.checkout.sessions.create({
        mode: "subscription",

        payment_method_types: [
          "card"
        ],

        customer_email: email,

        client_reference_id:
          userId,

        line_items: [
          {
            price:
              "price_1TS20hJxhhhzBuV9O74jwDkT",
            quantity: 1
          }
        ],

        success_url:
          `${APP_URL}?success=true` +
          `&session_id={CHECKOUT_SESSION_ID}` +

          (
            metaEventId
              ? `&meta_event_id=${encodeURIComponent(
                  metaEventId
                )}`
              : ""
          ) +

          (
            tiktokEventId
              ? `&tiktok_event_id=${encodeURIComponent(
                  tiktokEventId
                )}`
              : ""
          ),

        cancel_url:
          `${APP_URL}?canceled=true`,

        metadata:
          trackingMetadata,

        subscription_data: {
          metadata:
            trackingMetadata
        }
      });

    return res.status(200).json({
      url: session.url
    });

  } catch (error) {
    console.error(
      "❌ STRIPE SESSION ERROR:",
      error
    );

    return res.status(500).json({
      error: error.message
    });
  }
};

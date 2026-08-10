const Stripe = require("stripe");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

/* =========================
   META
========================= */

const META_PIXEL_ID =
  process.env.META_PIXEL_ID;

const META_ACCESS_TOKEN =
  process.env.META_ACCESS_TOKEN;

/* =========================
   TIKTOK
========================= */

const TIKTOK_PIXEL_ID =
  process.env.TIKTOK_PIXEL_ID;

const TIKTOK_EVENTS_API_TOKEN =
  process.env.TIKTOK_EVENTS_API_TOKEN;

/* =========================
   SUPABASE
========================= */

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = {
  api: {
    bodyParser: false
  }
};

/* =========================
   HASH
========================= */

function sha256(value) {
  if (!value) return null;

  return crypto
    .createHash("sha256")
    .update(
      String(value)
        .trim()
        .toLowerCase()
    )
    .digest("hex");
}

/* =========================
   META PURCHASE
========================= */

async function sendMetaPurchase({
  email,
  userId,
  value,
  currency = "USD",
  eventId,
  eventSourceUrl,
  clientIpAddress,
  clientUserAgent,
  fbp,
  fbc
}) {

  if (
    !META_PIXEL_ID ||
    !META_ACCESS_TOKEN
  ) {
    console.warn(
      "⚠️ Meta credentials are missing."
    );
    return;
  }

  const userData = {};

  const hashedEmail =
    sha256(email);

  const hashedExternalId =
    sha256(userId);

  if (hashedEmail) {
    userData.em = [
      hashedEmail
    ];
  }

  if (hashedExternalId) {
    userData.external_id = [
      hashedExternalId
    ];
  }

  if (clientIpAddress) {
    userData.client_ip_address =
      clientIpAddress;
  }

  if (clientUserAgent) {
    userData.client_user_agent =
      clientUserAgent;
  }

  if (fbp) {
    userData.fbp = fbp;
  }

  if (fbc) {
    userData.fbc = fbc;
  }

  const payload = {
    data: [
      {
        event_name: "Purchase",

        event_time:
          Math.floor(
            Date.now() / 1000
          ),

        action_source:
          "website",

        event_id:
          eventId,

        event_source_url:
          eventSourceUrl ||
          "https://www.cashedgeapp.com/",

        user_data:
          userData,

        custom_data: {
          currency,
          value,

          content_name:
            "CashEdge Premium Subscription",

          content_type:
            "product"
        }
      }
    ]
  };

  const response =
    await fetch(
      `https://graph.facebook.com/v23.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const result =
    await response.json();

  if (!response.ok) {
    console.error(
      "❌ META PURCHASE ERROR:",
      result
    );

    throw new Error(
      result?.error?.message ||
      "Meta Purchase event failed"
    );
  }

  console.log(
    "✅ META PURCHASE SENT:",
    {
      eventId,
      value,
      currency,
      eventsReceived:
        result.events_received,
      messages:
        result.messages,
      fbtraceId:
        result.fbtrace_id
    }
  );
}

/* =========================
   TIKTOK PURCHASE
========================= */

async function sendTikTokPurchase({
  email,
  userId,
  value,
  currency = "USD",
  eventId,
  eventSourceUrl,
  clientIpAddress,
  clientUserAgent,
  ttclid,
  ttp
}) {

  if (
    !TIKTOK_PIXEL_ID ||
    !TIKTOK_EVENTS_API_TOKEN
  ) {
    console.warn(
      "⚠️ TikTok Events API credentials are missing."
    );
    return;
  }

  const userData = {};

  const hashedEmail =
    sha256(email);

  const hashedExternalId =
    sha256(userId);

  if (hashedEmail) {
    userData.email =
      hashedEmail;
  }

  if (hashedExternalId) {
    userData.external_id =
      hashedExternalId;
  }

  if (clientIpAddress) {
    userData.ip =
      clientIpAddress;
  }

  if (clientUserAgent) {
    userData.user_agent =
      clientUserAgent;
  }

  if (ttclid) {
    userData.ttclid =
      ttclid;
  }

  if (ttp) {
    userData.ttp =
      ttp;
  }

  const cleanValue =
    Number(value || 0);

  const cleanCurrency =
    String(
      currency || "USD"
    ).toUpperCase();

  const payload = {
    event_source:
      "web",

    event_source_id:
      TIKTOK_PIXEL_ID,

    data: [
      {
        event:
          "Purchase",

        event_time:
          Math.floor(
            Date.now() / 1000
          ),

        event_id:
          eventId,

        user:
          userData,

        properties: {
          contents: [
            {
              content_id:
                "premium_monthly",

              content_name:
                "CashEdge Premium Subscription",

              content_type:
                "product",

              quantity: 1,

              price:
                cleanValue
            }
          ],

          content_type:
            "product",

          currency:
            cleanCurrency,

          value:
            cleanValue
        },

        page: {
          url:
            eventSourceUrl ||
            "https://www.cashedgeapp.com/"
        }
      }
    ]
  };

  const response =
    await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Access-Token":
            TIKTOK_EVENTS_API_TOKEN
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const result =
    await response.json();

  if (
    !response.ok ||
    (
      typeof result.code === "number" &&
      result.code !== 0
    )
  ) {

    console.error(
      "❌ TIKTOK PURCHASE ERROR:",
      result
    );

    throw new Error(
      result?.message ||
      "TikTok Purchase event failed"
    );
  }

  console.log(
    "✅ TIKTOK PURCHASE SENT:",
    {
      eventId,
      value:
        cleanValue,
      currency:
        cleanCurrency,
      result
    }
  );
}

/* =========================
   STRIPE WEBHOOK
========================= */

module.exports =
async function handler(
  req,
  res
) {

  if (
    req.method !== "POST"
  ) {
    return res
      .status(405)
      .send(
        "Method not allowed"
      );
  }

  let event;

  try {

    const buf =
      await buffer(req);

    const sig =
      req.headers[
        "stripe-signature"
      ];

    event =
      stripe.webhooks.constructEvent(
        buf,
        sig,
        process.env
          .STRIPE_WEBHOOK_SECRET
      );

  } catch (err) {

    console.error(
      "❌ Error de firma Stripe:",
      err.message
    );

    return res
      .status(400)
      .send(
        `Webhook Error: ${err.message}`
      );
  }

  try {

    console.log(
      "✅ STRIPE EVENT:",
      event.type
    );

    /* =========================
       CHECKOUT COMPLETED
    ========================= */

    if (
      event.type ===
      "checkout.session.completed"
    ) {

      const session =
        event.data.object;

      if (
        session.payment_status !==
        "paid"
      ) {

        console.log(
          "ℹ️ Checkout completed but payment is not paid:",
          {
            sessionId:
              session.id,

            paymentStatus:
              session.payment_status
          }
        );

        return res
          .status(200)
          .json({
            received: true
          });
      }

      const userId =
        session.metadata?.userId ||
        session.client_reference_id;

      const email =
        session.customer_email ||
        session.metadata?.email ||
        "";

      if (
        !userId ||
        userId === "guest"
      ) {

        console.error(
          "❌ Missing valid userId:",
          userId
        );

        return res
          .status(200)
          .json({
            received: true
          });
      }

      /* =========================
         ACTIVATE PREMIUM
      ========================= */

      const {
        data,
        error
      } =
        await supabaseAdmin
          .from("users")
          .upsert(
            {
              id:
                userId,

              email:
                email,

              is_premium:
                true,

              subscription_status:
                "premium",

              stripe_customer_id:
                session.customer ||
                null
            },
            {
              onConflict: "id"
            }
          )
          .select();

      if (error) {

        console.error(
          "❌ SUPABASE PREMIUM ERROR:",
          error.message
        );

        return res
          .status(500)
          .json({
            error:
              error.message
          });
      }

      console.log(
        "✅ PREMIUM ACTIVADO:",
        data
      );

      /* =========================
         PURCHASE DATA
      ========================= */

      const advertisingConsent =
        session.metadata
          ?.advertisingConsent ===
        "granted";

      const purchaseValue =
        Number(
          session.amount_total || 0
        ) / 100;

      const purchaseCurrency =
        session.currency
          ?.toUpperCase() ||
        "USD";

      const eventSourceUrl =
        session.metadata
          ?.eventSourceUrl ||
        "https://www.cashedgeapp.com/";

      const clientIpAddress =
        session.metadata
          ?.clientIpAddress ||
        null;

      const clientUserAgent =
        session.metadata
          ?.clientUserAgent ||
        null;

      /* =========================
         ADVERTISING TRACKING
      ========================= */

      if (
        advertisingConsent
      ) {

        /* =========================
           META CAPI
        ========================= */

        try {

          await sendMetaPurchase({
            email,
            userId,

            value:
              purchaseValue,

            currency:
              purchaseCurrency,

            eventId:
              session.metadata
                ?.metaEventId ||
              session.id,

            eventSourceUrl,

            clientIpAddress,

            clientUserAgent,

            fbp:
              session.metadata
                ?.fbp ||
              null,

            fbc:
              session.metadata
                ?.fbc ||
              null
          });

          console.log(
            "✅ Meta CAPI Purchase sent with advertising consent."
          );

        } catch (
          metaError
        ) {

          console.error(
            "⚠️ Meta CAPI failed, Stripe processing continues:",
            metaError.message
          );
        }

        /* =========================
           TIKTOK EVENTS API
        ========================= */

        try {

          await sendTikTokPurchase({
            email,
            userId,

            value:
              purchaseValue,

            currency:
              purchaseCurrency,

            eventId:
              session.metadata
                ?.tiktokEventId ||
              session.id,

            eventSourceUrl,

            clientIpAddress,

            clientUserAgent,

            ttclid:
              session.metadata
                ?.ttclid ||
              null,

            ttp:
              session.metadata
                ?.ttp ||
              null
          });

          console.log(
            "✅ TikTok Events API Purchase sent with advertising consent."
          );

        } catch (
          tikTokError
        ) {

          console.error(
            "⚠️ TikTok Events API failed, Stripe processing continues:",
            tikTokError.message
          );
        }

      } else {

        console.log(
          "ℹ️ Meta/TikTok Purchase skipped: advertising consent not granted."
        );
      }

      /* =========================
         AFFILIATE
      ========================= */

      const promoCode =
        String(
          session.metadata
            ?.promoCode ||
          ""
        )
          .trim()
          .toUpperCase();

      if (promoCode) {

        const {
          data: affiliate,
          error:
            affiliateError
        } =
          await supabaseAdmin
            .from(
              "affiliate_codes"
            )
            .select(
              "code, owner_name, commission_percent, active"
            )
            .eq(
              "code",
              promoCode
            )
            .eq(
              "active",
              true
            )
            .maybeSingle();

        if (
          affiliateError
        ) {

          console.error(
            "❌ AFFILIATE LOOKUP ERROR:",
            affiliateError.message
          );
        }

        if (affiliate) {

          const amountPaid =
            purchaseValue;

          const commissionPercent =
            Number(
              affiliate
                .commission_percent ||
              30
            );

          const commissionAmount =
            Number(
              (
                amountPaid *
                (
                  commissionPercent /
                  100
                )
              ).toFixed(3)
            );

          const {
            error:
              saleError
          } =
            await supabaseAdmin
              .from(
                "affiliate_sales"
              )
              .insert({
                user_id:
                  userId,

                affiliate_code:
                  affiliate.code,

                owner_name:
                  affiliate
                    .owner_name,

                stripe_customer_id:
                  session.customer ||
                  null,

                stripe_session_id:
                  session.id,

                amount_paid:
                  amountPaid,

                commission_percent:
                  commissionPercent,

                commission_amount:
                  commissionAmount
              });

          if (
            saleError
          ) {

            console.error(
              "❌ AFFILIATE SALE ERROR:",
              saleError.message
            );

          } else {

            console.log(
              "✅ AFFILIATE SALE SAVED:",
              {
                code:
                  affiliate.code,

                owner:
                  affiliate
                    .owner_name,

                amountPaid,

                commissionAmount
              }
            );
          }

        } else {

          console.log(
            "ℹ️ No valid affiliate code found:",
            promoCode
          );
        }
      }
    }

    /* =========================
       CANCEL / PAYMENT FAILED
    ========================= */

    if (
      event.type ===
        "customer.subscription.deleted" ||
      event.type ===
        "invoice.payment_failed"
    ) {

      const subscription =
        event.data.object;

      const customerId =
        subscription.customer;

      const {
        error
      } =
        await supabaseAdmin
          .from("users")
          .update({
            is_premium:
              false,

            subscription_status:
              "canceled"
          })
          .eq(
            "stripe_customer_id",
            customerId
          );

      if (error) {

        console.error(
          "❌ ERROR DESACTIVANDO PREMIUM:",
          error.message
        );
      }
    }

    /* =========================
       SUBSCRIPTION UPDATED
    ========================= */

    if (
      event.type ===
      "customer.subscription.updated"
    ) {

      const subscription =
        event.data.object;

      const customerId =
        subscription.customer;

      const active =
        subscription.status ===
          "active" ||
        subscription.status ===
          "trialing";

      const {
        error
      } =
        await supabaseAdmin
          .from("users")
          .update({
            is_premium:
              active,

            subscription_status:
              active
                ? "premium"
                : subscription.status
          })
          .eq(
            "stripe_customer_id",
            customerId
          );

      if (error) {

        console.error(
          "❌ ERROR ACTUALIZANDO SUBSCRIPCIÓN:",
          error.message
        );
      }
    }

    return res
      .status(200)
      .json({
        received: true
      });

  } catch (error) {

    console.error(
      "❌ WEBHOOK GENERAL ERROR:",
      error.message
    );

    return res
      .status(500)
      .json({
        error:
          error.message
      });
  }
};

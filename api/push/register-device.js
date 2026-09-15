const {
  createClient
} = require("@supabase/supabase-js");


const supabaseAdmin =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        }
      )
    : null;


const ALLOWED_PLATFORMS =
  new Set([
    "web",
    "android",
    "ios"
  ]);


const ALLOWED_PERMISSION_STATES =
  new Set([
    "granted",
    "denied",
    "default",
    "unknown"
  ]);


const ALLOWED_ORIGINS =
  new Set([
    "https://cashedgeapp.com",
    "https://www.cashedgeapp.com",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost"
  ]);


function setCors(
  req,
  res
) {

  const origin =
    String(
      req.headers.origin ||
      ""
    )
      .trim();


  if (
    origin &&
    ALLOWED_ORIGINS.has(
      origin
    )
  ) {

    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );
  }


  res.setHeader(
    "Vary",
    "Origin"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );
}


function cleanString(
  value,
  maxLength = 255
) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const clean =
    String(value)
      .trim();


  if (!clean) {
    return null;
  }


  return clean
    .slice(
      0,
      maxLength
    );
}


function normalizeProvider(
  value
) {

  const provider =
    cleanString(
      value,
      32
    )
      ?.toLowerCase() ||
    null;


  if (!provider) {
    return null;
  }


  if (
    !/^[a-z0-9_-]+$/.test(
      provider
    )
  ) {
    return null;
  }


  return provider;
}


function getBearerToken(req) {

  const header =
    String(
      req.headers.authorization ||
      ""
    )
      .trim();


  const match =
    header.match(
      /^Bearer\s+(.+)$/i
    );


  if (!match) {
    return null;
  }


  const token =
    String(
      match[1] ||
      ""
    )
      .trim();


  if (
    !token ||
    token === "null" ||
    token === "undefined"
  ) {
    return null;
  }


  return token;
}


async function getAuthenticatedUser(
  token
) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .auth
      .getUser(token);


  if (
    error ||
    !data?.user?.id
  ) {

    return {
      user: null,
      error
    };
  }


  return {
    user: data.user,
    error: null
  };
}


async function loadPublicUser(
  userId
) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from("users")
      .select(`
        id,
        is_premium,
        subscription_status,
        stripe_customer_id
      `)
      .eq(
        "id",
        userId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


async function loadInstallation({
  userId,
  provider,
  platform,
  deviceId
}) {

  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "push_devices"
      )
      .select(`
        id,
        user_id,
        platform,
        provider,
        device_id,
        provider_user_id,
        provider_subscription_id,
        permission_state,
        push_enabled,
        is_active,
        app_version,
        last_permission_change_at
      `)
      .eq(
        "user_id",
        userId
      )
      .eq(
        "provider",
        provider
      )
      .eq(
        "platform",
        platform
      )
      .eq(
        "device_id",
        deviceId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


async function loadSubscriptionOwner({
  provider,
  providerSubscriptionId
}) {

  if (
    !providerSubscriptionId
  ) {
    return null;
  }


  const {
    data,
    error
  } =
    await supabaseAdmin
      .from(
        "push_devices"
      )
      .select(`
        id,
        user_id,
        platform,
        provider,
        device_id,
        provider_subscription_id
      `)
      .eq(
        "provider",
        provider
      )
      .eq(
        "provider_subscription_id",
        providerSubscriptionId
      )
      .maybeSingle();


  if (error) {
    throw error;
  }


  return data || null;
}


async function safelyReleaseOldSubscription({
  subscriptionOwner,
  userId,
  platform,
  deviceId
}) {

  if (!subscriptionOwner) {
    return;
  }


  const sameUser =
    subscriptionOwner.user_id ===
      userId;


  const sameInstallation =
    subscriptionOwner.platform ===
      platform &&
    subscriptionOwner.device_id ===
      deviceId;


  // Same exact installation.
  if (
    sameUser &&
    sameInstallation
  ) {
    return;
  }


  // We allow movement only when this is clearly:
  // - the same authenticated user, OR
  // - the same CashEdge installation.
  //
  // We never silently steal an unrelated user's push target.
  if (
    !sameUser &&
    !sameInstallation
  ) {

    const conflict =
      new Error(
        "Push subscription is already linked to another CashEdge account"
      );

    conflict.code =
      "PUSH_SUBSCRIPTION_CONFLICT";

    throw conflict;
  }


  const timestamp =
    new Date()
      .toISOString();


  const {
    error
  } =
    await supabaseAdmin
      .from(
        "push_devices"
      )
      .update({

        provider_subscription_id:
          null,

        push_enabled:
          false,

        is_active:
          false,

        updated_at:
          timestamp
      })
      .eq(
        "id",
        subscriptionOwner.id
      );


  if (error) {
    throw error;
  }
}


module.exports =
async function handler(
  req,
  res
) {

  setCors(
    req,
    res
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();
  }


  if (
    req.method !==
    "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST, OPTIONS"
    );


    return res
      .status(405)
      .json({
        ok: false,
        error:
          "Method not allowed"
      });
  }


  if (!supabaseAdmin) {

    console.error(
      "PUSH REGISTER CONFIG ERROR: Missing Supabase server credentials"
    );


    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Push registration is not configured"
      });
  }


  try {

    // ========================================================
    // 1. AUTHENTICATE CASHEDGE USER
    //
    // user_id is NEVER trusted from req.body.
    // ========================================================

    const token =
      getBearerToken(req);


    if (!token) {

      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Unauthorized"
        });
    }


    const {
      user,
      error: authError
    } =
      await getAuthenticatedUser(
        token
      );


    if (
      authError ||
      !user?.id
    ) {

      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Invalid session"
        });
    }


    const userId =
      user.id;


    // ========================================================
    // 2. VERIFY PUBLIC PROFILE EXISTS
    //
    // Registration is allowed for Free or Premium users.
    // Premium eligibility is checked later at send time.
    // ========================================================

    const profile =
      await loadPublicUser(
        userId
      );


    if (!profile) {

      return res
        .status(403)
        .json({
          ok: false,
          error:
            "CashEdge user profile not found"
        });
    }


    // ========================================================
    // 3. VALIDATE DEVICE PAYLOAD
    // ========================================================

    const body =
      req.body || {};


    const platform =
      cleanString(
        body.platform,
        16
      )
        ?.toLowerCase() ||
      null;


    const provider =
      normalizeProvider(
        body.provider
      );


    const deviceId =
      cleanString(
        body.deviceId ??
        body.device_id,
        200
      );


    const providerUserId =
      cleanString(
        body.providerUserId ??
        body.provider_user_id,
        255
      );


    const providerSubscriptionId =
      cleanString(
        body.providerSubscriptionId ??
        body.provider_subscription_id,
        255
      );


    const permissionState =
      cleanString(
        body.permissionState ??
        body.permission_state ??
        "unknown",
        16
      )
        ?.toLowerCase() ||
      "unknown";


    const appVersion =
      cleanString(
        body.appVersion ??
        body.app_version,
        64
      );


    const requestedPushEnabled =
      body.pushEnabled === true ||
      body.push_enabled === true;


    if (
      !platform ||
      !ALLOWED_PLATFORMS.has(
        platform
      )
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Invalid platform"
        });
    }


    if (!provider) {

      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Invalid provider"
        });
    }


    if (
      !deviceId ||
      deviceId.length < 8
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Valid deviceId is required"
        });
    }


    if (
      !ALLOWED_PERMISSION_STATES.has(
        permissionState
      )
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Invalid permissionState"
        });
    }


    // ========================================================
    // 4. LOAD CURRENT INSTALLATION
    // ========================================================

    let existing =
      await loadInstallation({

        userId,
        provider,
        platform,
        deviceId
      });


    // ========================================================
    // 5. PROVIDER SUBSCRIPTION OWNERSHIP SAFETY
    //
    // Prevent one subscription from belonging to two
    // unrelated CashEdge accounts.
    // ========================================================

    if (
      providerSubscriptionId
    ) {

      const subscriptionOwner =
        await loadSubscriptionOwner({

          provider,
          providerSubscriptionId
        });


      if (
        subscriptionOwner &&
        subscriptionOwner.id !==
          existing?.id
      ) {

        await safelyReleaseOldSubscription({

          subscriptionOwner,
          userId,
          platform,
          deviceId
        });
      }


      existing =
        await loadInstallation({

          userId,
          provider,
          platform,
          deviceId
        });
    }


    // ========================================================
    // 6. EFFECTIVE PUSH STATE
    //
    // A client cannot make itself deliverable unless:
    // - permission is granted
    // - provider subscription exists
    // - client reports push enabled
    // ========================================================

    const effectivePushEnabled =
      requestedPushEnabled &&
      permissionState ===
        "granted" &&
      Boolean(
        providerSubscriptionId ||
        existing
          ?.provider_subscription_id
      );


    const timestamp =
      new Date()
        .toISOString();


    const permissionChanged =
      !existing ||
      existing.permission_state !==
        permissionState;


    const finalProviderUserId =
      providerUserId ||
      existing
        ?.provider_user_id ||
      null;


    const finalProviderSubscriptionId =
      providerSubscriptionId ||
      existing
        ?.provider_subscription_id ||
      null;


    // ========================================================
    // 7. UPSERT INSTALLATION
    // ========================================================

    const {
      data: savedDevice,
      error: saveError
    } =
      await supabaseAdmin
        .from(
          "push_devices"
        )
        .upsert(
          {

            user_id:
              userId,

            platform,

            provider,

            device_id:
              deviceId,

            provider_user_id:
              finalProviderUserId,

            provider_subscription_id:
              finalProviderSubscriptionId,

            permission_state:
              permissionState,

            push_enabled:
              effectivePushEnabled,

            is_active:
              true,

            app_version:
              appVersion ||
              existing
                ?.app_version ||
              null,

            last_seen_at:
              timestamp,

            last_registered_at:
              timestamp,

            last_permission_change_at:
              permissionChanged
                ? timestamp
                : existing
                    ?.last_permission_change_at ||
                  null,

            updated_at:
              timestamp
          },
          {
            onConflict:
              "user_id,provider,platform,device_id"
          }
        )
        .select(`
          id,
          platform,
          provider,
          device_id,
          permission_state,
          push_enabled,
          is_active,
          app_version,
          last_seen_at,
          last_registered_at,
          updated_at
        `)
        .single();


    if (saveError) {

      console.error(
        "PUSH DEVICE REGISTER ERROR:",
        saveError.message
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Unable to register push device"
        });
    }


    // ========================================================
    // 8. RESPONSE
    //
    // No Premium access is granted here.
    // No notification is sent here.
    // ========================================================

    return res
      .status(200)
      .json({

        ok:
          true,

        registered:
          true,

        userId,

        premiumEligibleNow:
          profile.is_premium ===
            true &&
          String(
            profile.subscription_status ||
            ""
          )
            .toLowerCase() ===
            "premium" &&
          Boolean(
            String(
              profile.stripe_customer_id ||
              ""
            )
              .trim()
          ),

        device:
          savedDevice
      });


  } catch (error) {

    if (
      error?.code ===
      "PUSH_SUBSCRIPTION_CONFLICT"
    ) {

      return res
        .status(409)
        .json({
          ok: false,
          error:
            error.message
        });
    }


    console.error(
      "PUSH REGISTER DEVICE FAILED:",
      error?.message ||
      error
    );


    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Push device registration failed"
      });
  }
};

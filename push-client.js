(function () {

  "use strict";


  // ==========================================================
  // CASHEDGE PUSH CLIENT — WEB
  //
  // PURPOSE:
  //
  // Supabase authenticated user
  //        ↓
  // OneSignal external_id = CashEdge user UUID
  //        ↓
  // OneSignal browser Subscription ID
  //        ↓
  // /api/push/register-device
  //        ↓
  // public.push_devices
  //
  // IMPORTANT:
  //
  // - Does NOT send notifications.
  // - Does NOT activate Market Intelligence notifications.
  // - Does NOT grant Premium.
  // - Does NOT prompt for notifications automatically.
  // - Web only for now.
  // - Native Android will get its own integration later.
  // ==========================================================


  if (
    window.__cashEdgePushClientInitialized
  ) {
    return;
  }


  window.__cashEdgePushClientInitialized =
    true;


  const DEVICE_STORAGE_KEY =
    "cashedge_push_device_id_v1";


  const REGISTER_ENDPOINT =
    "/api/push/register-device";


  const PROVIDER =
    "onesignal";


  const PLATFORM =
    "web";


  const state = {

    oneSignal:
      null,

    session:
      null,

    authSubscription:
      null,

    syncTimer:
      null,

    syncing:
      false,

    syncAgain:
      false,

    listenersAttached:
      false,

    lastSignature:
      null,

    logoutWrapped:
      false
  };


  // ==========================================================
  // HELPERS
  // ==========================================================

  function isNativeCapacitor() {

    try {

      return Boolean(
        window.Capacitor &&
        typeof window.Capacitor
          .isNativePlatform ===
          "function" &&
        window.Capacitor
          .isNativePlatform()
      );

    } catch (_) {

      return false;
    }
  }


  function generateFallbackId() {

    return [
      "ce",
      Date.now()
        .toString(36),
      Math.random()
        .toString(36)
        .slice(2),
      Math.random()
        .toString(36)
        .slice(2)
    ]
      .join("-");
  }


  function getDeviceId() {

    try {

      let deviceId =
        localStorage.getItem(
          DEVICE_STORAGE_KEY
        );


      if (
        deviceId &&
        deviceId.length >= 8
      ) {

        return deviceId;
      }


      deviceId =
        typeof crypto !==
          "undefined" &&
        typeof crypto.randomUUID ===
          "function"
          ? crypto.randomUUID()
          : generateFallbackId();


      localStorage.setItem(
        DEVICE_STORAGE_KEY,
        deviceId
      );


      return deviceId;

    } catch (_) {

      /*
       * Storage may be unavailable in some privacy modes.
       * This fallback lasts only for the current page session.
       */

      if (
        !window.__cashEdgePushFallbackDeviceId
      ) {

        window.__cashEdgePushFallbackDeviceId =
          typeof crypto !==
            "undefined" &&
          typeof crypto.randomUUID ===
            "function"
            ? crypto.randomUUID()
            : generateFallbackId();
      }


      return (
        window
          .__cashEdgePushFallbackDeviceId
      );
    }
  }


  function getPermissionState() {

    if (
      !(
        "Notification" in
        window
      )
    ) {

      return "unknown";
    }


    const permission =
      String(
        Notification.permission ||
        "default"
      )
        .toLowerCase();


    if (
      permission === "granted" ||
      permission === "denied" ||
      permission === "default"
    ) {

      return permission;
    }


    return "unknown";
  }


  function getAppVersion() {

    try {

      const version =
        window.CASHEDGE_APP_VERSION ||
        window.__CASHEDGE_APP_VERSION__ ||
        null;


      if (!version) {
        return null;
      }


      return String(version)
        .trim()
        .slice(
          0,
          64
        ) || null;

    } catch (_) {

      return null;
    }
  }


  function getOneSignalState() {

    const OneSignal =
      state.oneSignal;


    if (!OneSignal) {

      return {

        oneSignalId:
          null,

        subscriptionId:
          null,

        optedIn:
          false
      };
    }


    try {

      return {

        oneSignalId:
          OneSignal.User
            ?.onesignalId ||
          null,

        subscriptionId:
          OneSignal.User
            ?.PushSubscription
            ?.id ||
          null,

        optedIn:
          OneSignal.User
            ?.PushSubscription
            ?.optedIn ===
          true
      };

    } catch (_) {

      return {

        oneSignalId:
          null,

        subscriptionId:
          null,

        optedIn:
          false
      };
    }
  }


  async function getCurrentSession() {

    if (
      typeof supabaseClient ===
      "undefined" ||
      !supabaseClient?.auth
    ) {

      return null;
    }


    const {
      data,
      error
    } =
      await supabaseClient
        .auth
        .getSession();


    if (error) {

      console.warn(
        "CashEdge Push: session read failed",
        error.message
      );


      return null;
    }


    return (
      data?.session ||
      null
    );
  }


  // ==========================================================
  // REGISTER CURRENT DEVICE IN CASHEDGE
  // ==========================================================

  async function registerCurrentDevice({

    reason =
      "sync",

    forcePushEnabled =
      null,

    force =
      false

  } = {}) {

    const session =
      state.session ||
      await getCurrentSession();


    if (
      !session?.access_token ||
      !session?.user?.id
    ) {

      return {

        ok:
          false,

        skipped:
          true,

        reason:
          "NO_SESSION"
      };
    }


    state.session =
      session;


    const permissionState =
      getPermissionState();


    const osState =
      getOneSignalState();


    const naturalPushEnabled =
      permissionState ===
        "granted" &&
      osState.optedIn ===
        true &&
      Boolean(
        osState.subscriptionId
      );


    const pushEnabled =
      typeof forcePushEnabled ===
        "boolean"
        ? forcePushEnabled
        : naturalPushEnabled;


    const deviceId =
      getDeviceId();


    const body = {

      platform:
        PLATFORM,

      provider:
        PROVIDER,

      deviceId,

      providerUserId:
        osState.oneSignalId,

      providerSubscriptionId:
        osState.subscriptionId,

      permissionState,

      pushEnabled,

      appVersion:
        getAppVersion()
    };


    /*
     * Prevent repeated writes when several OneSignal events fire
     * with exactly the same state.
     *
     * user ID is deliberately part of the signature because the
     * same browser may switch CashEdge accounts.
     */

    const signature =
      JSON.stringify({

        userId:
          session.user.id,

        deviceId,

        permissionState,

        pushEnabled,

        oneSignalId:
          osState.oneSignalId,

        subscriptionId:
          osState.subscriptionId
      });


    if (
      !force &&
      signature ===
        state.lastSignature
    ) {

      return {

        ok:
          true,

        skipped:
          true,

        reason:
          "UNCHANGED"
      };
    }


    const response =
      await fetch(
        REGISTER_ENDPOINT,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${session.access_token}`
          },

          credentials:
            "same-origin",

          cache:
            "no-store",

          body:
            JSON.stringify(body)
        }
      );


    let data =
      null;


    try {

      data =
        await response.json();

    } catch (_) {

      data =
        null;
    }


    if (!response.ok) {

      const message =
        data?.error ||
        `HTTP ${response.status}`;


      console.warn(
        `CashEdge Push registration failed (${reason}):`,
        message
      );


      return {

        ok:
          false,

        status:
          response.status,

        error:
          message
      };
    }


    state.lastSignature =
      signature;


    console.log(
      "✅ CashEdge push device synchronized:",
      {
        reason,
        pushEnabled,
        permissionState,
        hasSubscription:
          Boolean(
            osState.subscriptionId
          )
      }
    );


    return {

      ok:
        true,

      data
    };
  }


  // ==========================================================
  // IDENTIFY USER IN ONESIGNAL
  //
  // We only provide OneSignal consent automatically when the
  // browser permission has ALREADY been granted.
  //
  // This function NEVER opens the browser permission prompt.
  // ==========================================================

  async function identifyCurrentUser(
    reason =
      "identify"
  ) {

    const session =
      state.session ||
      await getCurrentSession();


    if (
      !session?.user?.id
    ) {

      return;
    }


    state.session =
      session;


    const OneSignal =
      state.oneSignal;


    const permissionState =
      getPermissionState();


    if (
      OneSignal &&
      permissionState ===
        "granted"
    ) {

      try {

        /*
         * index.html uses:
         *
         * requiresUserPrivacyConsent: true
         *
         * Permission was already granted by the user, so the
         * existing CashEdge consent flow can enable OneSignal.
         */

        await OneSignal
          .setConsentGiven(
            true
          );


        /*
         * CashEdge UUID becomes the OneSignal External ID.
         *
         * This unifies Web today and Android/iOS later under
         * the same CashEdge user identity.
         */

        await OneSignal
          .login(
            session.user.id
          );

      } catch (error) {

        /*
         * OneSignal may log an expected 409 when switching to an
         * already-existing External ID. We do not treat that as
         * a reason to break CashEdge.
         */

        console.warn(
          `CashEdge Push OneSignal identity warning (${reason}):`,
          error?.message ||
          error
        );
      }
    }


    await registerCurrentDevice({
      reason
    });
  }


  // ==========================================================
  // SERIALIZED SYNC
  //
  // OneSignal can fire several state changes almost together.
  // Only one backend synchronization runs at a time.
  // ==========================================================

  async function syncNow(
    reason =
      "sync"
  ) {

    if (
      state.syncing
    ) {

      state.syncAgain =
        true;

      return;
    }


    state.syncing =
      true;


    try {

      await identifyCurrentUser(
        reason
      );

    } catch (error) {

      console.warn(
        "CashEdge Push sync failed:",
        error?.message ||
        error
      );

    } finally {

      state.syncing =
        false;


      if (
        state.syncAgain
      ) {

        state.syncAgain =
          false;


        scheduleSync(
          "queued_change",
          100
        );
      }
    }
  }


  function scheduleSync(
    reason =
      "change",
    delay =
      200
  ) {

    if (
      state.syncTimer
    ) {

      clearTimeout(
        state.syncTimer
      );
    }


    state.syncTimer =
      setTimeout(
        () => {

          state.syncTimer =
            null;


          syncNow(
            reason
          );

        },
        delay
      );
  }


  // ==========================================================
  // ONESIGNAL LISTENERS
  // ==========================================================

  function attachOneSignalListeners(
    OneSignal
  ) {

    if (
      state.listenersAttached
    ) {

      return;
    }


    state.listenersAttached =
      true;


    // --------------------------------------------------------
    // Subscription ID / token / optedIn changes
    // --------------------------------------------------------

    try {

      OneSignal.User
        .PushSubscription
        .addEventListener(
          "change",
          function () {

            scheduleSync(
              "push_subscription_change",
              100
            );
          }
        );

    } catch (error) {

      console.warn(
        "CashEdge Push: subscription listener unavailable",
        error?.message ||
        error
      );
    }


    // --------------------------------------------------------
    // Browser permission changes
    // --------------------------------------------------------

    try {

      OneSignal.Notifications
        .addEventListener(
          "permissionChange",
          async function (
            permission
          ) {

            try {

              if (
                permission ===
                  true &&
                state.session?.user?.id
              ) {

                await OneSignal
                  .setConsentGiven(
                    true
                  );


                await OneSignal
                  .login(
                    state.session
                      .user.id
                  );
              }

            } catch (error) {

              console.warn(
                "CashEdge Push permission sync warning:",
                error?.message ||
                error
              );
            }


            scheduleSync(
              "permission_change",
              100
            );
          }
        );

    } catch (error) {

      console.warn(
        "CashEdge Push: permission listener unavailable",
        error?.message ||
        error
      );
    }


    // --------------------------------------------------------
    // OneSignal user identity changes
    // --------------------------------------------------------

    try {

      OneSignal.User
        .addEventListener(
          "change",
          function () {

            scheduleSync(
              "onesignal_user_change",
              150
            );
          }
        );

    } catch (error) {

      console.warn(
        "CashEdge Push: user listener unavailable",
        error?.message ||
        error
      );
    }
  }


  // ==========================================================
  // LOGOUT SAFETY
  //
  // Before CashEdge destroys the Supabase session:
  //
  // 1. mark this backend device push_enabled=false
  // 2. unlink the OneSignal user
  // 3. continue the normal CashEdge logout
  //
  // This is important for shared browsers.
  // ==========================================================

  async function disableCurrentDevice() {

    const session =
      state.session ||
      await getCurrentSession();


    if (
      session?.access_token &&
      session?.user?.id
    ) {

      state.session =
        session;


      try {

        await registerCurrentDevice({

          reason:
            "logout",

          forcePushEnabled:
            false,

          force:
            true
        });

      } catch (error) {

        console.warn(
          "CashEdge Push logout device update failed:",
          error?.message ||
          error
        );
      }
    }


    if (
      state.oneSignal
    ) {

      try {

        await state
          .oneSignal
          .logout();

      } catch (error) {

        console.warn(
          "CashEdge Push OneSignal logout warning:",
          error?.message ||
          error
        );
      }
    }


    state.lastSignature =
      null;
  }


  function wrapCashEdgeLogout() {

    if (
      state.logoutWrapped
    ) {

      return;
    }


    if (
      typeof window.logoutUser !==
      "function"
    ) {

      return;
    }


    const originalLogout =
      window.logoutUser;


    if (
      originalLogout
        .__cashEdgePushWrapped
    ) {

      state.logoutWrapped =
        true;

      return;
    }


    const wrappedLogout =
      async function (...args) {

        try {

          await disableCurrentDevice();

        } catch (error) {

          console.warn(
            "CashEdge Push pre-logout warning:",
            error?.message ||
            error
          );
        }


        return originalLogout
          .apply(
            this,
            args
          );
      };


    wrappedLogout
      .__cashEdgePushWrapped =
      true;


    window.logoutUser =
      wrappedLogout;


    state.logoutWrapped =
      true;
  }


  // ==========================================================
  // SUPABASE AUTH LIFECYCLE
  // ==========================================================

  function attachSupabaseAuthListener() {

    if (
      state.authSubscription
    ) {

      return;
    }


    if (
      typeof supabaseClient ===
        "undefined" ||
      !supabaseClient?.auth
    ) {

      return;
    }


    const {
      data
    } =
      supabaseClient
        .auth
        .onAuthStateChange(
          async (
            event,
            session
          ) => {

            if (
              session?.user?.id
            ) {

              state.session =
                session;


              /*
               * SIGNED_IN
               * TOKEN_REFRESHED
               * USER_UPDATED
               * INITIAL_SESSION
               *
               * We can safely resync all of them.
               */

              scheduleSync(
                `auth_${String(
                  event
                ).toLowerCase()}`,
                150
              );


              return;
            }


            if (
              event ===
              "SIGNED_OUT"
            ) {

              state.session =
                null;

              state.lastSignature =
                null;


              /*
               * Usually disableCurrentDevice() already handled
               * this before signOut through our logout wrapper.
               *
               * This is a second provider-side safety.
               */

              if (
                state.oneSignal
              ) {

                try {

                  await state
                    .oneSignal
                    .logout();

                } catch (_) {
                  // No action required.
                }
              }
            }
          }
        );


    state.authSubscription =
      data?.subscription ||
      null;
  }


  // ==========================================================
  // BOOT
  // ==========================================================

  async function boot() {

    /*
     * This file is specifically the Web push integration.
     *
     * Do not let the OneSignal Web SDK register a fake "web"
     * device when CashEdge is running inside native Capacitor.
     * Android will get its own native registration layer.
     */

    if (
      isNativeCapacitor()
    ) {

      console.log(
        "CashEdge Push: native Capacitor detected; Web push client skipped."
      );

      return;
    }


    if (
      !(
        "Notification" in
        window
      )
    ) {

      console.log(
        "CashEdge Push: Web Push is not supported in this browser."
      );

      return;
    }


    if (
      typeof supabaseClient ===
        "undefined" ||
      !supabaseClient?.auth
    ) {

      console.warn(
        "CashEdge Push: supabaseClient is unavailable."
      );

      return;
    }


    state.session =
      await getCurrentSession();


    attachSupabaseAuthListener();

    wrapCashEdgeLogout();


    window.OneSignalDeferred =
      window.OneSignalDeferred ||
      [];


    window.OneSignalDeferred
      .push(
        async function (
          OneSignal
        ) {

          state.oneSignal =
            OneSignal;


          attachOneSignalListeners(
            OneSignal
          );


          /*
           * Returning authenticated user:
           *
           * If permission was granted previously, identify the
           * user immediately and restore/sync the subscription.
           *
           * If permission is default/denied, no prompt appears.
           * We simply record the non-deliverable device state.
           */

          if (
            state.session
              ?.user?.id
          ) {

            await syncNow(
              "page_load"
            );
          }
        }
      );
  }


  // ==========================================================
  // PUBLIC INTERNAL API
  //
  // Useful later for notification settings UI / QA.
  // ==========================================================

  window.CashEdgePush = {

    sync:
      async function () {

        state.session =
          await getCurrentSession();


        return syncNow(
          "manual_sync"
        );
      },


    disableCurrentDevice,


    getDeviceId,


    getState:
      function () {

        const osState =
          getOneSignalState();


        return {

          userId:
            state.session
              ?.user?.id ||
            null,

          deviceId:
            getDeviceId(),

          platform:
            PLATFORM,

          provider:
            PROVIDER,

          permissionState:
            getPermissionState(),

          oneSignalId:
            osState.oneSignalId,

          providerSubscriptionId:
            osState.subscriptionId,

          optedIn:
            osState.optedIn
        };
      }
  };


  // ==========================================================
  // START
  // ==========================================================

  if (
    document.readyState ===
    "loading"
  ) {

    document
      .addEventListener(
        "DOMContentLoaded",
        boot,
        {
          once:
            true
        }
      );

  } else {

    boot();
  }

})();

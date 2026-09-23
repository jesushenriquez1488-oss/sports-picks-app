const {
  createClient
} =
  require(
    "@supabase/supabase-js"
  );


const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


const PREVIEW_MINUTES =
  15;


// ============================================================
// HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );


    if (
      req.method ===
      "OPTIONS"
    ) {

      return res
        .status(200)
        .end();
    }


    if (
      req.method !==
      "POST"
    ) {

      return res
        .status(405)
        .json({
          ok: false,
          error:
            "Method not allowed"
        });
    }


    try {

      // ======================================================
      // AUTH
      // ======================================================

      const authHeader =
        String(
          req.headers.authorization ||
          ""
        );


      const token =
        authHeader.startsWith(
          "Bearer "
        )
          ? authHeader.slice(7)
          : null;


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
        data: authData,
        error: authError
      } =
        await supabaseAdmin
          .auth
          .getUser(
            token
          );


      if (
        authError ||
        !authData?.user?.id
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Unauthorized"
          });
      }


      const userId =
        authData.user.id;


      // ======================================================
      // CURRENT ACCOUNT STATE
      // ======================================================

      const {
        data: profile,
        error: profileError
      } =
        await supabaseAdmin
          .from(
            "users"
          )
          .select(`
            is_premium,
            market_intelligence_preview_started_at
          `)
          .eq(
            "id",
            userId
          )
          .maybeSingle();


      if (profileError) {
        throw profileError;
      }


      if (!profile) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "User profile not found"
          });
      }


      // ======================================================
      // PREMIUM ALWAYS WINS
      // ======================================================

      if (
        profile.is_premium ===
        true
      ) {

        return res
          .status(200)
          .json({
            ok: true,
            isPremium: true,
            previewActive: false,
            previewAvailable: false
          });
      }


      // ======================================================
      // PREVIEW ALREADY USED
      // ======================================================

      if (
        profile
          .market_intelligence_preview_started_at
      ) {

        const startedAt =
          new Date(
            profile
              .market_intelligence_preview_started_at
          );


        const expiresAt =
          new Date(
            startedAt.getTime() +
            (
              PREVIEW_MINUTES *
              60 *
              1000
            )
          );


        const remainingSeconds =
          Math.max(
            0,
            Math.ceil(
              (
                expiresAt.getTime() -
                Date.now()
              ) /
              1000
            )
          );


        return res
          .status(200)
          .json({
            ok: true,
            isPremium: false,
            previewActive:
              remainingSeconds > 0,
            previewAvailable: false,
            previewStartedAt:
              startedAt.toISOString(),
            previewExpiresAt:
              expiresAt.toISOString(),
            remainingSeconds
          });
      }


      // ======================================================
      // START PREVIEW — ATOMIC
      // ======================================================

      const startedAt =
        new Date();


      const {
        data: startedProfile,
        error: startError
      } =
        await supabaseAdmin
          .from(
            "users"
          )
          .update({
            market_intelligence_preview_started_at:
              startedAt.toISOString()
          })
          .eq(
            "id",
            userId
          )
          .is(
            "market_intelligence_preview_started_at",
            null
          )
          .select(`
            market_intelligence_preview_started_at
          `)
          .maybeSingle();


      if (startError) {
        throw startError;
      }


      // Another request may have started it first.
      if (!startedProfile) {

        const {
          data: currentProfile,
          error: currentError
        } =
          await supabaseAdmin
            .from(
              "users"
            )
            .select(`
              market_intelligence_preview_started_at
            `)
            .eq(
              "id",
              userId
            )
            .maybeSingle();


        if (currentError) {
          throw currentError;
        }


        const existingStartedAt =
          new Date(
            currentProfile
              ?.market_intelligence_preview_started_at
          );


        const existingExpiresAt =
          new Date(
            existingStartedAt.getTime() +
            (
              PREVIEW_MINUTES *
              60 *
              1000
            )
          );


        const remainingSeconds =
          Math.max(
            0,
            Math.ceil(
              (
                existingExpiresAt.getTime() -
                Date.now()
              ) /
              1000
            )
          );


        return res
          .status(200)
          .json({
            ok: true,
            isPremium: false,
            previewActive:
              remainingSeconds > 0,
            previewAvailable: false,
            previewStartedAt:
              existingStartedAt.toISOString(),
            previewExpiresAt:
              existingExpiresAt.toISOString(),
            remainingSeconds
          });
      }


      const actualStartedAt =
        new Date(
          startedProfile
            .market_intelligence_preview_started_at
        );


      const expiresAt =
        new Date(
          actualStartedAt.getTime() +
          (
            PREVIEW_MINUTES *
            60 *
            1000
          )
        );


      return res
        .status(200)
        .json({
          ok: true,
          isPremium: false,
          previewActive: true,
          previewAvailable: false,
          previewStartedAt:
            actualStartedAt.toISOString(),
          previewExpiresAt:
            expiresAt.toISOString(),
          remainingSeconds:
            PREVIEW_MINUTES *
            60
        });


    } catch (error) {

      console.error(
        "MARKET INTELLIGENCE PREVIEW ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Unable to start Market Intelligence preview"
        });
    }
  };

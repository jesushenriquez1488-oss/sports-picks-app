
const { createClient } = require("@supabase/supabase-js");

const {
  AppStoreServerAPIClient,
  Environment
} = require("@apple/app-store-server-library");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // Only the CashEdge administrator may run tests.
    const authorization = String(
      req.headers.authorization || ""
    );

    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;

    if (!token || !process.env.ADMIN_EMAIL) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { data, error } =
      await supabase.auth.getUser(token);

    if (
      error ||
      !data?.user?.email ||
      data.user.email.toLowerCase() !==
        process.env.ADMIN_EMAIL.toLowerCase()
    ) {
      return res.status(403).json({
        error: "Admin access required"
      });
    }

    const privateKey = String(
      process.env.APPLE_IAP_PRIVATE_KEY || ""
    ).replace(/\\n/g, "\n");

    const client = new AppStoreServerAPIClient(
      privateKey,
      process.env.APPLE_IAP_KEY_ID,
      process.env.APPLE_IAP_ISSUER_ID,
      process.env.APPLE_BUNDLE_ID,
      Environment.SANDBOX
    );

    const action = req.body?.action || "send";

    if (action === "send") {
      const result =
        await client.requestTestNotification();

      return res.status(200).json({
        ok: true,
        testNotificationToken:
          result.testNotificationToken
      });
    }

    if (action === "status") {
      const testToken =
        String(req.body?.testNotificationToken || "");

      if (!testToken || testToken.length > 200) {
        return res.status(400).json({
          error: "Invalid test token"
        });
      }

      const result =
        await client.getTestNotificationStatus(testToken);

      return res.status(200).json({
        ok: true,
        attempts: (result.sendAttempts || []).map(
          attempt => ({
            result: attempt.sendAttemptResult,
            date: attempt.sendDate
          })
        )
      });
    }

    return res.status(400).json({
      error: "Invalid action"
    });

  } catch (error) {
    console.error(
      "APPLE TEST NOTIFICATION ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Apple notification test failed"
    });
  }
};

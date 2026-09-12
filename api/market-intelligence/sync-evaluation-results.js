const crypto =
  require("crypto");

const {
  createClient
} =
  require("@supabase/supabase-js");

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


function secureEqual(
  supplied,
  expected
) {

  if (
    !supplied ||
    !expected
  ) {
    return false;
  }

  const a =
    crypto
      .createHash("sha256")
      .update(String(supplied))
      .digest();

  const b =
    crypto
      .createHash("sha256")
      .update(String(expected))
      .digest();

  return crypto
    .timingSafeEqual(
      a,
      b
    );
}

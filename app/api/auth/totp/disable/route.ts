import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { checkRateLimit, releaseRateLimit, rateLimitResponse, REAUTH_LIMIT } from "@/lib/rate-limit";

/**
 * Disable TOTP for the calling user.
 *
 * Requires BOTH a fresh step-up (the TOTP factor itself, via
 * /api/auth/reauth/totp) and the account password. Failures are
 * rate-limited and audited like every other step-up so a hijacked session
 * cannot use this route as a password oracle. Admins cannot end up without
 * TOTP for long: requireAdmin* refuses to act until it is re-enabled.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const svc = createServiceClient();

  // Spend the shared step-up budget before anything is verified (atomic —
  // parallel guesses cannot all pass). Refunded on the paths that are not a
  // wrong credential: a missing step-up cookie, a malformed body, or success.
  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  if (!(await hasFreshReauth(ctx.user.id))) {
    await releaseRateLimit(ctx.user.id, REAUTH_LIMIT);
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 403 });
  }

  const { password } = await request.json().catch(() => ({}));
  if (!password || typeof password !== "string") {
    await releaseRateLimit(ctx.user.id, REAUTH_LIMIT);
    return NextResponse.json({ error: "missing password" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });
  if (error) {
    try {
      await svc.from("audit_log").insert({
        action: "TOTP_DISABLE_FAILED",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
    } catch {}
    return NextResponse.json({ error: "Нууц үг буруу" }, { status: 401 });
  }

  // Correct password — hand the throttle unit back.
  await releaseRateLimit(ctx.user.id, REAUTH_LIMIT);

  await svc
    .from("profiles")
    .update({ totp_secret: null, totp_enabled: false, totp_recovery_codes: [] })
    .eq("id", ctx.user.id);

  await svc.from("audit_log").insert({
    action: "TOTP_DISABLED",
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  return NextResponse.json({ ok: true });
}

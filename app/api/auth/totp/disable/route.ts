import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";

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

  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Хэт олон оролдлого" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } },
    );
  }

  if (!(await hasFreshReauth(ctx.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 403 });
  }

  const { password } = await request.json().catch(() => ({}));
  if (!password || typeof password !== "string") {
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

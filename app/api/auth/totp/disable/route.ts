import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleSecurityEvent } from "@/lib/notify";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { checkRateLimit, releaseRateLimit, rateLimitResponse, REAUTH_LIMIT } from "@/lib/rate-limit";

/**
 * Disable TOTP for the calling user.
 *
 * Requires BOTH a fresh step-up minted by the TOTP factor itself
 * (/api/auth/reauth/totp — a password-minted step-up cookie is refused, see
 * lib/auth/step-up.ts) and the account password. Before the factor was bound
 * into the cookie, both checks collapsed to "knows the password", so a stolen
 * session + password could replace the victim's second factor. Failures are
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

  // Verify the password WITHOUT touching the caller's session: the cookie
  // writing client would replace it with an amr=["password"] session (see
  // /api/auth/reauth for the incident this caused). Throwaway client, dropped.
  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error } = await probe.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });
  try {
    await probe.auth.signOut({ scope: "local" });
  } catch {
    /* best effort — the probe session is not persisted anywhere */
  }
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

  const { error: upErr } = await svc
    .from("profiles")
    .update({ totp_secret: null, totp_enabled: false, totp_recovery_codes: [] })
    .eq("id", ctx.user.id);
  if (upErr) {
    // Nothing changed: do not audit a removal, drop subscriptions or alert
    // the other admins about a second factor that is still in place.
    console.error("[totp/disable] update failed", upErr.message);
    return NextResponse.json({ error: "disable_failed" }, { status: 500 });
  }

  await svc.from("audit_log").insert({
    action: "TOTP_DISABLED",
    detail: `account ${ctx.user.id} (${ctx.profile.role})`,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });
  // A second-factor reset also closes every notification channel registered
  // for the account: a planted push subscription must not outlive it.
  try {
    await svc.from("push_subscriptions").delete().eq("user_id", ctx.user.id);
  } catch {}
  scheduleSecurityEvent({
    action: "TOTP_DISABLED",
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    detail: `second factor removed from ${ctx.profile.role} account ${ctx.user.id}`,
  });

  return NextResponse.json({ ok: true });
}

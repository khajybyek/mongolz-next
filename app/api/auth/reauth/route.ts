import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { checkRateLimit, releaseRateLimit, rateLimitResponse, REAUTH_LIMIT } from "@/lib/rate-limit";
import { buildReauthCookieValue, getFreshReauth } from "@/lib/auth/step-up";

const REAUTH_TTL_MIN = 15;

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const { password } = await request.json().catch(() => ({}));

  if (!password || typeof password !== "string") { // pragma: allowlist secret
    return NextResponse.json({ error: "missing password" }, { status: 400 });
  }

  // Rate limit: 5 wrong answers per minute, shared with every other step-up
  // factor. The unit is spent BEFORE the password is checked (atomic, so
  // parallel guesses cannot all pass) and refunded below once it verified —
  // the bucket counts wrong passwords, not honest step-ups.
  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  // Verify the password WITHOUT touching the caller's session. The cookie
  // writing @supabase/ssr client would replace `sb-<ref>-auth-token` with a
  // session GoTrue minted through grant_type=password — amr = ["password"] —
  // and the data-tier second-factor gate (private.mfa_ok, migration
  // 20260908110000) then refuses that token for every TOTP-enabled admin. A
  // step-up would blind the operator's own console. A throwaway client with no
  // persistence checks the credential and drops the session it receives.
  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error } = await probe.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });
  // The probe minted a real session server-side; end it so the refresh token
  // cannot be replayed from the GoTrue side.
  try {
    await probe.auth.signOut({ scope: "local" });
  } catch {
    /* best effort — the session is not persisted anywhere */
  }

  if (error) {
    // Audit-аас үлдээгээрэй (амжилтгүй оролдлого)
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "REAUTH_FAILED",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
    } catch {}
    return NextResponse.json({ error: "Нууц үг буруу" }, { status: 401 });
  }

  // Correct password — hand the throttle unit back.
  await releaseRateLimit(ctx.user.id, REAUTH_LIMIT);

  // A live TOTP step-up already satisfies every gate the password one does
  // (reveal requests accept either). Overwriting it with a factor=password
  // cookie silently downgraded the admin: the next approval / user / retention
  // action answered REAUTH_REQUIRED again. Keep the stronger cookie.
  const current = await getFreshReauth(ctx.user.id);
  if (current?.factor === "totp") {
    try {
      await createServiceClient().from("audit_log").insert({
        action: "REAUTH_OK",
        detail: "password verified; kept existing totp step-up",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
    } catch {}
    return NextResponse.json({ ok: true, factor: "totp", expires_at: current.expiresAt });
  }

  const expiresAt = new Date(Date.now() + REAUTH_TTL_MIN * 60 * 1000);

  // Audit
  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "REAUTH_OK",
      detail: `TTL ${REAUTH_TTL_MIN}m (factor=password)`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  } catch {}

  let cookieValue: string;
  try {
    cookieValue = buildReauthCookieValue(ctx.user.id, expiresAt, "password");
  } catch (err) {
    // REAUTH_COOKIE_SECRET is fail-closed in production (lib/auth/hmac-secret.ts).
    // Fail loud: Sentry + audit row + a stable code the client translates.
    // Never echo internals (no secret names/values in the response body).
    Sentry.captureException(err);
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "REAUTH_CONFIG_ERROR",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
        detail: "reauth cookie could not be signed — REAUTH_COOKIE_SECRET missing?",
      });
    } catch {}
    return NextResponse.json({ error: "server_config" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true, expires_at: expiresAt.toISOString() });
  res.cookies.set("mongolz-reauth", cookieValue, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REAUTH_TTL_MIN * 60,
  });
  return res;
}

export async function GET() {
  const authGet = await requireAdminApi();
  if (isAuthErr(authGet)) return NextResponse.json({ valid: false }, { status: 401 });

  const fresh = await getFreshReauth(authGet.user.id);
  return NextResponse.json({ valid: Boolean(fresh), factor: fresh?.factor ?? null, expires_at: fresh?.expiresAt ?? null });
}

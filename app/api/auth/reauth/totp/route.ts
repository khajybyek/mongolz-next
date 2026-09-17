import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { checkTotpCode, totpCheckResponse, REAUTH_LIMIT } from "@/lib/rate-limit";
import { buildReauthCookieValue } from "@/lib/auth/step-up";

const REAUTH_TTL_MIN = 15;

/**
 * TOTP-based step-up reauthentication for sensitive admin operations
 * (user CRUD, etc). Sets the `mongolz-reauth` cookie with factor = "totp" —
 * the only factor `hasFreshReauth()` accepts by default. The password route
 * mints a weaker cookie that only the reveal-request flow accepts.
 *
 * The throttle is spent BEFORE the code is verified (`checkTotpCode`, shared
 * with every other TOTP endpoint), so concurrent guesses cannot all slip
 * through the way they did against the old read-then-write counter.
 *
 * Body: { code: string }  (6-digit TOTP)
 * Cookie: mongolz-reauth (HMAC-signed, 15 min)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const { code } = await request.json().catch(() => ({}));

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "missing code" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("totp_secret, totp_enabled")
    .eq("id", ctx.user.id)
    .single();

  if (!profile?.totp_enabled || !profile?.totp_secret) {
    return NextResponse.json(
      { error: "TOTP_NOT_ENABLED" },
      { status: 400 }
    );
  }

  const check = await checkTotpCode({
    userId: ctx.user.id,
    userEmail: ctx.user.email,
    secret: profile.totp_secret,
    code,
    limit: REAUTH_LIMIT,
    failAction: "REAUTH_TOTP_FAILED",
    replayAction: "REAUTH_TOTP_REPLAY_BLOCKED",
    detail: "step-up (totp)",
  });
  if (!check.ok) return totpCheckResponse(check);

  const expiresAt = new Date(Date.now() + REAUTH_TTL_MIN * 60 * 1000);

  try {
    await svc.from("audit_log").insert({
      action: "REAUTH_TOTP_OK",
      detail: `TTL ${REAUTH_TTL_MIN}m (factor=totp)`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  } catch {}

  let cookieValue: string;
  try {
    cookieValue = buildReauthCookieValue(ctx.user.id, expiresAt, "totp");
  } catch (err) {
    // REAUTH_COOKIE_SECRET is fail-closed in production (lib/auth/hmac-secret.ts).
    // Fail loud: Sentry + audit row + a stable code the client translates.
    // Never echo internals (no secret names/values in the response body).
    Sentry.captureException(err);
    try {
      await svc.from("audit_log").insert({
        action: "REAUTH_CONFIG_ERROR",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
        detail: "reauth cookie could not be signed — REAUTH_COOKIE_SECRET missing?",
      });
    } catch {}
    return NextResponse.json({ error: "server_config" }, { status: 503 });
  }

  const res = NextResponse.json({
    ok: true,
    expires_at: expiresAt.toISOString(),
  });
  res.cookies.set("mongolz-reauth", cookieValue, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REAUTH_TTL_MIN * 60,
  });
  return res;
}

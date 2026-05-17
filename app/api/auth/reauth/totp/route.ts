import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";
import { buildReauthCookieValue } from "@/lib/auth/step-up";

const REAUTH_TTL_MIN = 15;

/**
 * TOTP-based step-up reauthentication for sensitive admin operations
 * (user CRUD, etc). Sets the same `mongolz-reauth` cookie as the
 * password-based endpoint — downstream code uses `requireFreshReauth()`
 * without caring which factor was presented.
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

  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Хэт олон оролдлого" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
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

  const result = await verifyTOTPWithReplayCheck(ctx.user.id, profile.totp_secret, code);
  if (result !== "ok") {
    try {
      await svc.from("audit_log").insert({
        action: result === "replayed" ? "REAUTH_TOTP_REPLAY_BLOCKED" : "REAUTH_TOTP_FAILED",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
    } catch {}
    return NextResponse.json(
      { error: result === "replayed" ? "Код өмнө нь хэрэглэгдсэн" : "Код буруу" },
      { status: 401 }
    );
  }

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
    cookieValue = buildReauthCookieValue(ctx.user.id, expiresAt);
  } catch {
    return NextResponse.json(
      { error: "Reauth signing secret тохируулагдаагүй" },
      { status: 500 }
    );
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

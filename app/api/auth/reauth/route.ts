import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";
import { buildReauthCookieValue, getFreshReauth } from "@/lib/auth/step-up";

const REAUTH_TTL_MIN = 15;

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const { password } = await request.json().catch(() => ({}));

  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "missing password" }, { status: 400 });
  }

  // Rate limit: brute force-аас сэргийлж 1 минутад 5 удаа max
  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Хэт олон оролдлого" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  // Тухайн user-ийн email-ээр re-authenticate
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: ctx.user.email,
    password,
  });

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

  const expiresAt = new Date(Date.now() + REAUTH_TTL_MIN * 60 * 1000);

  // Audit
  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "REAUTH_OK",
      detail: `TTL ${REAUTH_TTL_MIN}m`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  } catch {}

  let cookieValue: string;
  try {
    cookieValue = buildReauthCookieValue(ctx.user.id, expiresAt);
  } catch {
    return NextResponse.json({ error: "Reauth signing secret тохируулагдаагүй" }, { status: 500 });
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
  return NextResponse.json({ valid: Boolean(fresh), expires_at: fresh?.expiresAt ?? null });
}

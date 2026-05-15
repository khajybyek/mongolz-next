import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyTOTP } from "@/lib/totp";

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
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

  if (!profile?.totp_secret) {
    return NextResponse.json({ error: "TOTP setup эхлээгүй" }, { status: 400 });
  }

  if (!verifyTOTP(profile.totp_secret, code)) {
    await svc.from("audit_log").insert({
      action: "TOTP_VERIFY_FAILED",
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
    return NextResponse.json({ error: "Код буруу. Дахин оролд." }, { status: 401 });
  }

  // Verify амжилттай — TOTP идэвхжүүлнэ
  if (!profile.totp_enabled) {
    await svc
      .from("profiles")
      .update({ totp_enabled: true })
      .eq("id", ctx.user.id);

    await svc.from("audit_log").insert({
      action: "TOTP_ENABLED",
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  }

  return NextResponse.json({ ok: true, enabled: true });
}

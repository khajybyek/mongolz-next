import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyTOTP, verifyTOTPWithReplayCheck } from "@/lib/totp";
import { generateRecoveryCodes } from "@/lib/totp-recovery";

export async function POST(request: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;
  const { code } = await request.json().catch(() => ({}));

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "missing code" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("totp_secret, totp_enabled, totp_recovery_codes")
    .eq("id", ctx.user.id)
    .single();

  if (!profile?.totp_secret) {
    return NextResponse.json({ error: "TOTP setup эхлээгүй" }, { status: 400 });
  }

  // First-time setup (profile.totp_enabled === false) skips the replay check
  // because the row is being created for the first time. Subsequent verifies
  // go through replay tracking.
  if (profile.totp_enabled) {
    const result = await verifyTOTPWithReplayCheck(ctx.user.id, profile.totp_secret, code);
    if (result !== "ok") {
      await svc.from("audit_log").insert({
        action: result === "replayed" ? "TOTP_REPLAY_BLOCKED" : "TOTP_VERIFY_FAILED",
        user_id: ctx.user.id,
        user_email: ctx.user.email,
      });
      return NextResponse.json(
        { error: result === "replayed" ? "Код өмнө нь хэрэглэгдсэн" : "Код буруу. Дахин оролд." },
        { status: 401 }
      );
    }
  } else if (!verifyTOTP(profile.totp_secret, code)) {
    await svc.from("audit_log").insert({
      action: "TOTP_VERIFY_FAILED",
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
    return NextResponse.json({ error: "Код буруу. Дахин оролд." }, { status: 401 });
  }

  let recovery: string[] | null = null;

  if (!profile.totp_enabled) {
    // First-time enable — generate one-time recovery codes
    const gen = generateRecoveryCodes();
    recovery = gen.plaintext;

    await svc
      .from("profiles")
      .update({ totp_enabled: true, totp_recovery_codes: gen.hashes })
      .eq("id", ctx.user.id);

    await svc.from("audit_log").insert({
      action: "TOTP_ENABLED",
      detail: `Recovery codes generated (${gen.hashes.length})`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    recovery_codes: recovery,
  });
}

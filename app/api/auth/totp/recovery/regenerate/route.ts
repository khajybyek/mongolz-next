import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import { generateRecoveryCodes } from "@/lib/totp-recovery";

export async function POST(request: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;

  const { code } = await request.json().catch(() => ({}));
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "TOTP code required to regenerate" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("totp_secret, totp_enabled")
    .eq("id", ctx.user.id)
    .single();

  if (!profile?.totp_enabled || !profile.totp_secret) {
    return NextResponse.json({ error: "TOTP not enabled" }, { status: 400 });
  }

  const result = await verifyTOTPWithReplayCheck(ctx.user.id, profile.totp_secret, code);
  if (result !== "ok") {
    return NextResponse.json(
      { error: result === "replayed" ? "Code already used" : "Invalid TOTP code" },
      { status: 401 }
    );
  }

  const gen = generateRecoveryCodes();
  const { error } = await svc
    .from("profiles")
    .update({ totp_recovery_codes: gen.hashes })
    .eq("id", ctx.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await svc.from("audit_log").insert({
    action: "TOTP_RECOVERY_REGENERATED",
    detail: `Re-issued ${gen.hashes.length} recovery codes`,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  return NextResponse.json({ ok: true, recovery_codes: gen.plaintext });
}

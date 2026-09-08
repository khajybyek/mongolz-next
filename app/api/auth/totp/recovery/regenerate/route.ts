import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { generateRecoveryCodes } from "@/lib/totp-recovery";
import { checkTotpCode, totpCheckResponse, REAUTH_LIMIT } from "@/lib/rate-limit";

/**
 * Re-issue the ten one-time recovery codes.
 *
 * This is the highest-value TOTP check in the product: whoever passes it walks
 * away with ten durable 2FA bypasses. Until the 2026-09-08 audit (finding 5.9)
 * it was also the least protected — no throttle, no audit row on a wrong code.
 * `checkTotpCode` now spends the shared step-up budget before verifying,
 * records every failure, and returns 429 with Retry-After when the budget is
 * gone. The success row (TOTP_RECOVERY_REGENERATED) is unchanged.
 */
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

  const check = await checkTotpCode({
    userId: ctx.user.id,
    userEmail: ctx.user.email,
    secret: profile.totp_secret,
    code,
    limit: REAUTH_LIMIT,
    failAction: "TOTP_REGEN_FAILED",
    replayAction: "TOTP_REGEN_REPLAY_BLOCKED",
    detail: "recovery code regeneration",
  });
  if (!check.ok) return totpCheckResponse(check);

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

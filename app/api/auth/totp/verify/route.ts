import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateRecoveryCodes } from "@/lib/totp-recovery";
import { checkTotpCode, totpCheckResponse, REAUTH_LIMIT } from "@/lib/rate-limit";

/**
 * Verify a TOTP code — both the first-time enrolment check and every later
 * verification.
 *
 * Until the 2026-09-08 audit (finding 5.9) this route checked codes with no
 * throttle at all and wrote no audit row when one was wrong: an unlimited
 * oracle against a 6-digit space, reachable with nothing but a hijacked
 * session. It now goes through `checkTotpCode`, which spends the shared
 * step-up budget BEFORE verifying, records every wrong code, and answers 429
 * with Retry-After once the budget is gone.
 */
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

  const check = await checkTotpCode({
    userId: ctx.user.id,
    userEmail: ctx.user.email,
    secret: profile.totp_secret,
    code,
    limit: REAUTH_LIMIT,
    failAction: "TOTP_VERIFY_FAILED",
    replayAction: "TOTP_REPLAY_BLOCKED",
    // First-time enrolment (totp_enabled === false) skips the replay ledger:
    // the seed is not active yet, so there is nothing to have replayed.
    skipReplayCheck: !profile.totp_enabled,
    detail: profile.totp_enabled ? "verify" : "enrolment",
  });
  if (!check.ok) return totpCheckResponse(check);

  let recovery: string[] | null = null;

  if (!profile.totp_enabled) {
    // First-time enable — generate one-time recovery codes
    const gen = generateRecoveryCodes();
    recovery = gen.plaintext;

    // Compare-and-set on totp_enabled=false: two parallel enrolment requests
    // must not each hand out a different set of codes (only the last write
    // would survive). A failed write must not report success either — the
    // caller would be signed out holding codes for a factor never enabled.
    const { data: flipped, error: upErr } = await svc
      .from("profiles")
      .update({ totp_enabled: true, totp_recovery_codes: gen.hashes })
      .eq("id", ctx.user.id)
      .eq("totp_enabled", false)
      .select("id");
    if (upErr) {
      console.error("[totp/verify] enable failed", upErr.message);
      return NextResponse.json({ error: "enable_failed" }, { status: 500 });
    }
    if (!flipped || flipped.length === 0) {
      return NextResponse.json({ error: "already_enabled" }, { status: 409 });
    }

    await svc.from("audit_log").insert({
      action: "TOTP_ENABLED",
      detail: `Recovery codes generated (${gen.hashes.length})`,
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });

    // The session this enrolment was made from is password-only (amr =
    // ["password"]). From the moment totp_enabled flips, the data-tier gate
    // (private.mfa_ok, migration 20260908110000) refuses that token, so the
    // console would render empty until the operator happened to sign out.
    // End it here and tell the client to send them back to login.
    try {
      const user = await createClient();
      await user.auth.signOut();
    } catch {
      /* cookie writes can fail in some runtimes — the client still redirects */
    }
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    recovery_codes: recovery,
    // true when this call enrolled the user: their current session no longer
    // satisfies the second-factor gate and they must sign in again.
    relogin_required: recovery !== null,
  });
}

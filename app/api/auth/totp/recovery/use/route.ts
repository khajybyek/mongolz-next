import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { consumeRecoveryCode } from "@/lib/totp-recovery";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;

  const rl = await checkRateLimit(ctx.user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429 });
  }

  const { code } = await request.json().catch(() => ({}));
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "missing recovery code" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("totp_recovery_codes")
    .eq("id", ctx.user.id)
    .single();

  const stored = profile?.totp_recovery_codes ?? [];
  if (stored.length === 0) {
    return NextResponse.json({ error: "No recovery codes available" }, { status: 400 });
  }

  const remaining = consumeRecoveryCode(stored, code);
  if (remaining === null) {
    await svc.from("audit_log").insert({
      action: "TOTP_RECOVERY_FAILED",
      user_id: ctx.user.id,
      user_email: ctx.user.email,
    });
    return NextResponse.json({ error: "Invalid recovery code" }, { status: 401 });
  }

  const { error } = await svc
    .from("profiles")
    .update({ totp_recovery_codes: remaining })
    .eq("id", ctx.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await svc.from("audit_log").insert({
    action: "TOTP_RECOVERY_USED",
    detail: `Remaining: ${remaining.length}`,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  return NextResponse.json({ ok: true, remaining: remaining.length });
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";

/**
 * Right to erasure (GDPR Art.17 / PIPA §36).
 *
 * Permanently deletes the calling user's account. The cascade chain:
 *   profiles row             → deleted
 *   auth.users row           → deleted (via admin.deleteUser)
 *   alerts.labeled_by        → SET NULL (label kept for ML statistics)
 *   reveal_jobs.requested_by → SET NULL
 *   camera_permissions       → CASCADE (FK ON DELETE CASCADE)
 *   audit_log                → RETAINED verbatim. The ledger is immutable
 *                              (hash chain) and has no FK to profiles any
 *                              more, so the row's user_id simply dangles;
 *                              e-mail stays for the legal audit period.
 *
 * Last-admin protection: if the only remaining admin tries to self-delete, the
 * request is rejected — must promote another admin first.
 *
 * Requires fresh TOTP if the user has TOTP enabled. Every write is checked;
 * the route never reports success for an account that still exists.
 */

const schema = z.object({
  totp_code: z.string().regex(/^\d{6}$/).optional(),
  confirm: z.literal("DELETE MY ACCOUNT"),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const { user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must be { confirm: 'DELETE MY ACCOUNT', totp_code? }" },
      { status: 400 },
    );
  }

  const svc = createServiceClient();

  // Same throttle as every other TOTP-checking endpoint.
  const rl = await checkRateLimit(user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.resetSec) } });
  }

  // Pull the canonical profile for totp_secret + role
  const { data: full } = await svc
    .from("profiles")
    .select("id, email, role, totp_enabled, totp_secret")
    .eq("id", user.id)
    .single();
  if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Fresh TOTP if enabled
  if (full.totp_enabled) {
    const code = parsed.data.totp_code;
    if (!code || !full.totp_secret) {
      return NextResponse.json({ error: "Fresh TOTP code required" }, { status: 401 });
    }
    const result = await verifyTOTPWithReplayCheck(user.id, full.totp_secret, code);
    if (result !== "ok") {
      try {
        await svc.from("audit_log").insert({
          action: "REAUTH_TOTP_FAILED",
          detail: "gdpr erase",
          user_id: user.id,
          user_email: user.email,
        });
      } catch {}
      return NextResponse.json(
        { error: result === "replayed" ? "Code already used" : "Fresh TOTP code required" },
        { status: 401 },
      );
    }
  }

  // Super admin is DB-locked; last-admin protection for everyone else.
  if (full.role === "admin") {
    const { count } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last admin. Promote another user first." },
        { status: 409 },
      );
    }
  }

  // Erasure record first (append-only ledger; survives the deletion).
  const { error: auditErr } = await svc.from("audit_log").insert({
    action: "GDPR_ERASE",
    detail: `Subject ${user.email} (role=${full.role}) erased their account.`,
    user_id: user.id,
    user_email: user.email,
  });
  if (auditErr) {
    return NextResponse.json({ error: "Could not record erasure" }, { status: 500 });
  }

  const { error: profileErr } = await svc.from("profiles").delete().eq("id", user.id);
  if (profileErr) {
    console.error("[gdpr/delete] profile delete failed:", profileErr.message);
    return NextResponse.json({ error: "Erasure failed (profile)" }, { status: 500 });
  }

  const { error: authErr } = await svc.auth.admin.deleteUser(user.id);
  if (authErr) {
    console.error("[gdpr/delete] auth user delete failed:", authErr.message);
    return NextResponse.json({ error: "Erasure failed (auth)" }, { status: 500 });
  }

  // Sign out current session (cookie cleanup)
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true, message: "Account erased." });
}

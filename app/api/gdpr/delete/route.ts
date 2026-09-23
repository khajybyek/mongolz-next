import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import { checkRateLimit, REAUTH_LIMIT } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";

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
 * Super-admin protection (2026-09-08 audit, 5.3): the DB trigger
 * `public.protect_super_admin` exempts `service_role`, which is exactly the
 * role every app write uses, so the "DB-locked" account could erase itself
 * through this route while README/COMPLIANCE told the committee it could not.
 * The refusal lives here, before any TOTP code is consumed. Removing the
 * account genuinely requires a database owner in Supabase Studio (clear
 * `profiles.is_super_admin`, or delete the row over a direct SQL session
 * where the trigger's privileged-caller branch applies) — that is the
 * documented break-glass path, and nothing in the app can substitute for it.
 *
 * Requires fresh TOTP if the user has TOTP enabled, and the account password
 * otherwise (viewer / auditor / organiser have no TOTP — typing the phrase
 * alone let an unattended or stolen session erase the account). Every write
 * is checked; the route never reports success for an account that still
 * exists. Every refusal carries a stable `code` the form translates.
 */

const schema = z.object({
  totp_code: z.string().regex(/^\d{6}$/).optional(),
  password: z.string().min(1).max(256).optional(),
  confirm: z.literal("DELETE MY ACCOUNT"),
});

/**
 * Check the password WITHOUT touching the caller's session: a throwaway,
 * non-persisting client (never the cookie-writing one, which would replace
 * the session with an amr=["password"] token — see /api/auth/reauth).
 */
async function passwordMatches(email: string, password: string): Promise<boolean> {
  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error } = await probe.auth.signInWithPassword({ email, password });
  try {
    await probe.auth.signOut({ scope: "local" });
  } catch {
    /* best effort — the probe session is not persisted anywhere */
  }
  return !error;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const { user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must be { confirm: 'DELETE MY ACCOUNT', totp_code?, password? }", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const svc = createServiceClient();
  const { t } = await getT();

  // Pull the canonical profile for totp_secret + role + the DB-locked flag.
  const { data: full } = await svc
    .from("profiles")
    .select("id, email, role, totp_enabled, totp_secret, is_super_admin")
    .eq("id", user.id)
    .single();
  if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // The one account the app may never remove. Checked before the throttle and
  // before the TOTP verify: this request can never succeed, so it must not
  // burn a one-time code or the caller's shared step-up budget.
  if (full.is_super_admin) {
    try {
      await svc.from("audit_log").insert({
        action: "GDPR_ERASE_DENIED",
        detail: "super admin self-erase refused — DB-locked account",
        user_id: user.id,
        user_email: user.email,
      });
    } catch {}
    return NextResponse.json(
      { error: t("gdpr_err_super_admin"), code: "SUPER_ADMIN_LOCKED" },
      { status: 403 },
    );
  }

  // Same throttle as every other TOTP-checking endpoint.
  const rl = await checkRateLimit(user.id, REAUTH_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message, code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } },
    );
  }

  // Fresh TOTP if enabled
  if (full.totp_enabled) {
    const code = parsed.data.totp_code;
    if (!code || !full.totp_secret) {
      return NextResponse.json({ error: "Fresh TOTP code required", code: "TOTP_REQUIRED" }, { status: 401 });
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
        result === "replayed"
          ? { error: "Code already used", code: "TOTP_REPLAYED" }
          : { error: "Fresh TOTP code required", code: "TOTP_REQUIRED" },
        { status: 401 },
      );
    }
  } else {
    // No second factor on this account: the password is the re-authentication.
    const password = parsed.data.password;
    if (!password) {
      return NextResponse.json({ error: "Password required", code: "PASSWORD_REQUIRED" }, { status: 401 });
    }
    if (!(await passwordMatches(full.email ?? user.email, password))) {
      try {
        await svc.from("audit_log").insert({
          action: "REAUTH_PASSWORD_FAILED",
          detail: "gdpr erase",
          user_id: user.id,
          user_email: user.email,
        });
      } catch {}
      return NextResponse.json({ error: "Password incorrect", code: "PASSWORD_INVALID" }, { status: 401 });
    }
  }

  // Super admin is refused above; last-admin protection for everyone else.
  if (full.role === "admin") {
    const { count } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: t("gdpr_err_last_admin"), code: "LAST_ADMIN" },
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

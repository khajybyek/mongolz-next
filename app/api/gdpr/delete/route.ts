import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyTOTP } from "@/lib/totp";

/**
 * Right to erasure (GDPR Art.17 / PIPA §36).
 *
 * Permanently deletes the calling user's account. The cascade chain:
 *   profiles row             → deleted
 *   auth.users row           → deleted (via admin.deleteUser)
 *   alerts.labeled_by        → SET NULL (label kept for ML statistics)
 *   reveal_jobs.requested_by → SET NULL
 *   camera_permissions       → CASCADE (FK ON DELETE CASCADE)
 *   audit_log                → RETAINED (anonymised via user_id NULL, email kept
 *                              for legal audit period; per data retention rules)
 *
 * Last-admin protection: if the only remaining admin tries to self-delete, the
 * request is rejected — must promote another admin first.
 *
 * Requires fresh TOTP if the user has TOTP enabled.
 */

const schema = z.object({
  totp_code: z.string().regex(/^\d{6}$/).optional(),
  confirm: z.literal("DELETE MY ACCOUNT"),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
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
    if (!code || !full.totp_secret || !verifyTOTP(full.totp_secret, code)) {
      return NextResponse.json({ error: "Fresh TOTP code required" }, { status: 401 });
    }
  }

  // Last-admin protection
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

  // Anonymise audit_log: keep records but null out user_id (email kept for
  // legal traceability per retention period).
  await svc
    .from("audit_log")
    .update({ user_id: null })
    .eq("user_id", user.id);

  // Insert the erasure record (final marker)
  await svc.from("audit_log").insert({
    action: "GDPR_ERASE",
    detail: `Subject ${user.email} (role=${full.role}) erased their account.`,
    user_email: user.email,
  });

  // Delete profile
  await svc.from("profiles").delete().eq("id", user.id);

  // Delete auth user (this also sign-outs)
  await svc.auth.admin.deleteUser(user.id);

  // Sign out current session (cookie cleanup)
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true, message: "Account erased." });
}

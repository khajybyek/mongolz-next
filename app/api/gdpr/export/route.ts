import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GDPR / PIPA — subject data export.
 *
 * Returns a ZIP containing the data the system holds about the calling user:
 *   - profile.json           : profile row
 *   - audit_log.json         : audit entries (user_id = me OR email = mine)
 *   - alert_labels.json      : alerts labeled by me
 *   - reveal_jobs.json       : reveal jobs I requested/approved/rejected
 *   - camera_permissions.json: which cameras I have explicit access to
 *   - README.txt             : data dictionary
 *
 * Only the caller's own data — admins use a separate export for other users.
 */
export async function GET() {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  const { user } = auth;

  const svc = createServiceClient();

  const [profile, audit, auditByEmail, labeled, reveal, perms] = await Promise.all([
    svc.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    svc
      .from("audit_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10000),
    svc
      .from("audit_log")
      .select("*")
      .is("user_id", null)
      .eq("user_email", user.email)
      .order("created_at", { ascending: false })
      .limit(2000),
    svc
      .from("alerts")
      .select("id, suspect_name, similarity, camera_name, created_at, label, labeled_at")
      .eq("labeled_by", user.id)
      .order("labeled_at", { ascending: false }),
    svc
      .from("reveal_jobs")
      .select("*")
      .or(`requested_by.eq.${user.id},approved_by.eq.${user.id},rejected_by.eq.${user.id}`) // user.id is a uuid from the session, not user input
      .order("created_at", { ascending: false }),
    svc
      .from("camera_permissions")
      .select("*")
      .eq("user_id", user.id),
  ]);

  // Strip TOTP secret / recovery codes from profile export — already redacted at
  // schema level for selects, but make it explicit here.
  const safeProfile = profile.data
    ? { ...profile.data, totp_secret: "<redacted>", totp_recovery_codes: "<redacted>" }
    : null;

  const zip = new JSZip();
  zip.file(
    "README.txt",
    [
      "MONGOLZ Security — GDPR / PIPA data export",
      `Subject: ${user.email}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "Files:",
      "  profile.json            — profile row (TOTP secrets redacted)",
      "  audit_log.json          — actions logged by/about this user",
      "  alert_labels.json       — TP/FP labels you assigned",
      "  reveal_jobs.json        — reveal jobs you requested/approved/rejected",
      "  camera_permissions.json — explicit camera access rows",
      "",
      "Right to erasure:",
      "  /api/gdpr/delete  (POST) — request account deletion.",
    ].join("\n"),
  );
  zip.file("profile.json", JSON.stringify(safeProfile, null, 2));
  zip.file(
    "audit_log.json",
    JSON.stringify([...(audit.data ?? []), ...(auditByEmail.data ?? [])], null, 2),
  );
  zip.file("alert_labels.json", JSON.stringify(labeled.data ?? [], null, 2));
  zip.file("reveal_jobs.json", JSON.stringify(reveal.data ?? [], null, 2));
  zip.file("camera_permissions.json", JSON.stringify(perms.data ?? [], null, 2));

  const buf = await zip.generateAsync({ type: "uint8array" });

  // Audit the export itself
  try {
    await svc.from("audit_log").insert({
      action: "GDPR_EXPORT",
      detail: `Subject ${user.email} downloaded their data (${(buf.length / 1024).toFixed(1)} KB)`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mongolz-gdpr-${user.email}-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

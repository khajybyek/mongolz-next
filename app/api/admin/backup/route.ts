import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Admin backup endpoint — assembles a JSON snapshot of the application's
 * operational tables PLUS a list of storage objects (without re-uploading
 * blob bytes; recordings/faces stay in the original buckets).
 *
 * Output: ZIP with one .json per table + manifest.txt + README.txt
 *
 * Audit-logged as BACKUP_DOWNLOAD. The ZIP body is streamed to the caller —
 * no copy is stored on the server.
 */

const TABLES = [
  "profiles",
  "cameras",
  "suspects",
  "alerts",
  "alert_rules",
  "audit_log",
  "recordings",
  "reveal_jobs",
  "webhooks",
  "camera_permissions",
  "masking_schedules",
  "retention_policies",
] as const;

const BUCKETS = [
  "recordings",
  "faces",
  "suspects",
  "alert-screenshots",
  "revealed",
] as const;

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const svc = createServiceClient();
  const zip = new JSZip();

  // 1) Schema dump (table rows as JSON)
  const summary: Record<string, number> = {};
  for (const table of TABLES) {
    const { data, error } = await svc.from(table).select("*").limit(50_000);
    if (error) {
      zip.file(`${table}.error.txt`, error.message);
      summary[table] = -1;
      continue;
    }
    zip.file(`tables/${table}.json`, JSON.stringify(data ?? [], null, 2));
    summary[table] = data?.length ?? 0;
  }

  // 2) Storage manifest (object names + sizes only)
  for (const bucket of BUCKETS) {
    const { data: objects, error } = await svc.storage
      .from(bucket)
      .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (error) {
      zip.file(`buckets/${bucket}.error.txt`, error.message);
      continue;
    }
    zip.file(
      `buckets/${bucket}.manifest.json`,
      JSON.stringify(
        (objects ?? []).map((o) => ({
          name: o.name,
          size: o.metadata?.size,
          created_at: o.created_at,
          updated_at: o.updated_at,
        })),
        null,
        2,
      ),
    );
  }

  // 3) README
  zip.file(
    "README.txt",
    [
      "MONGOLZ Security — Database & Storage backup",
      `Created: ${new Date().toISOString()}`,
      "",
      "tables/    — JSON row dumps (one file per table, up to 50K rows each)",
      "buckets/   — Storage object manifests (names + sizes; blob bytes NOT included)",
      "",
      "Row counts:",
      ...Object.entries(summary).map(([t, n]) => `  ${t.padEnd(25)} ${n}`),
      "",
      "To restore:",
      "  1. Recreate the schema via Supabase migrations (already in repo)",
      "  2. INSERT each table.json into its target",
      "  3. Re-upload encrypted blobs from your separate offline backup",
      "",
      "Storage blob bytes are NOT included — they are AES-256-GCM encrypted",
      "and live in Supabase Storage. Use point-in-time backup (Supabase",
      "Dashboard → Database → Backups) or the offline mirror script.",
    ].join("\n"),
  );

  const buf = await zip.generateAsync({ type: "uint8array" });

  // Audit
  try {
    await svc.from("audit_log").insert({
      action: "BACKUP_DOWNLOAD",
      detail: `${(buf.length / 1024).toFixed(1)} KB, ${TABLES.length} tables, ${BUCKETS.length} buckets`,
      user_id: auth.user.id,
      user_email: auth.user.email,
    });
  } catch {}

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mongolz-backup-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

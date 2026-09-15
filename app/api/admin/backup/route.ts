import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";

/**
 * Admin backup endpoint — a JSON snapshot of the operational tables plus a
 * manifest of every Storage object the DATABASE references.
 *
 * Output: ZIP with tables/<table>.json, buckets/<bucket>.manifest.json,
 * manifest.json (machine-readable) and README.txt (human-readable).
 *
 * Two things this artifact deliberately cannot do, stated here, in the ZIP
 * README, in manifest.json and on /backup rather than discovered mid-restore:
 *   • It cannot recreate Supabase auth users. profiles.id is a FK onto
 *     auth.users; a restore needs the auth schema back first (PITR, or
 *     re-invite every operator) or every profile row is rejected.
 *   • Without ?include_biometrics=1 it cannot restore `suspects` or `faces`:
 *     both embedding columns are NOT NULL, and they are biometric personal
 *     data, so they ship only when an admin explicitly asks for them.
 *
 * Audited as BACKUP_DOWNLOAD (plus BACKUP_DOWNLOAD_BIOMETRIC naming the exact
 * columns when the flag is used). The ZIP is streamed; no server-side copy.
 */

type TableSpec = {
  /** Base allow-list — never contains biometrics or auth material. */
  columns: string;
  /** Primary key, used to page deterministically. */
  pk?: string;
  /** Columns added only by ?include_biometrics=1. */
  biometric?: string;
  /** NOT NULL columns that only the biometric flag brings back. */
  biometricRequired?: string[];
  /** NOT NULL columns this artifact never carries, at any setting. */
  omittedRequired?: string[];
  note?: string;
};

/**
 * Column allow-lists. Auth material (TOTP seeds, recovery-code hashes,
 * passkey public keys/counters) and outbound secrets (webhook signing
 * secrets, Slack/Discord URLs are bearer tokens) are deliberately NOT part
 * of a backup an admin can download: a backup that contains every admin's
 * TOTP seed is an account-takeover kit. Supabase PITR covers those rows.
 */
const TABLES: Record<string, TableSpec> = {
  profiles: {
    columns:
      "id, email, full_name, role, totp_enabled, is_super_admin, reveal_level, username, created_at, updated_at",
    note:
      "TOTP seeds, recovery-code hashes and passkeys are never exported — operators re-enrol 2FA after a restore. profiles.id references auth.users, which this artifact cannot recreate.",
  },
  cameras: {
    columns:
      "id, name, cam_type, url, enabled, consent_required, consent_text, mask_default, created_by, created_at",
    note:
      "url is an AES-256-GCM ciphertext produced with CAMERA_URL_KEY. It is exported because the column is NOT NULL and cameras are unreachable without it; it stays unreadable unless the restore environment holds that key (or CAMERA_URL_KEY_PREV).",
  },
  suspects: {
    columns: "id, name, image_path, notes, privacy_tier, created_by, created_at",
    biometric: "embedding",
    biometricRequired: ["embedding"],
    note: "embedding is a 512-dim ArcFace vector — biometric personal data, and NOT NULL.",
  },
  alerts: { columns: "*" },
  alert_rules: { columns: "*" },
  audit_log: { columns: "*" },
  recordings: { columns: "*" },
  faces: {
    columns:
      "id, filename, image_path, camera_id, recording_id, detected_at, bbox, chain_index, crop_sealed, cluster_id, reviewed, review_label, reviewed_by, reviewed_at",
    biometric: "embedding, embedding_sealed",
    biometricRequired: ["embedding"],
    note: "embedding is a 512-dim ArcFace vector — biometric personal data, and NOT NULL.",
  },
  reveal_jobs: {
    columns:
      "id, recording_id, method, suspect_id, face_id, face_ids, threshold, status, progress, output_path, output_duration_sec, error_message, requested_by, requested_email, approved_by, approved_email, approved_at, approval_required, rejected_by, rejected_email, rejected_reason, rejected_at, reason, request_scope, reveal_level, target_start_sec, target_end_sec, reauth_at, created_at, started_at, completed_at",
    biometric: "query_embedding, query_embeddings, reference_sealed",
    note: "query embeddings are the biometric probe of a reveal request (nullable — a restore succeeds without them).",
  },
  incidents: { columns: "*" },
  incident_alerts: { columns: "*", pk: "incident_id" },
  incident_faces: { columns: "*", pk: "incident_id" },
  incident_events: {
    columns: "*",
    note: "The restore tool regenerates this identity key; no table references incident_events.id.",
  },
  incident_recordings: { columns: "*" },
  incident_evidence_exports: { columns: "*" },
  edge_agents: { columns: "*" },
  edge_ingest_events: { columns: "*" },
  webhooks: {
    columns:
      "id, name, kind, enabled, events, last_fired_at, last_status, fail_count, created_by, created_at",
    omittedRequired: ["url"],
    note:
      "url (a Slack/Discord bearer URL) and the HMAC secret are credentials and are never exported — recreate destinations by hand on /webhooks.",
  },
  camera_permissions: { columns: "*" },
  masking_schedules: { columns: "*" },
  privacy_zones: { columns: "*" },
  retention_policies: { columns: "*", pk: "resource" },
  clusters: { columns: "*" },
  push_subscriptions: {
    columns: "id, user_id, enabled, ua, created_at",
    omittedRequired: ["endpoint", "p256dh", "auth"],
    note:
      "endpoint and the p256dh/auth keys are push credentials and are never exported — users re-subscribe from their browser.",
  },
};

/**
 * Storage manifests are derived from the DATABASE, not from a Storage
 * listing: every object lives under a camera/recording prefix, so
 * storage.list("") only ever returned the top-level folder names (the audit
 * found 0 of 106 objects listed). These are the columns that own a path.
 * The `.enc` suffix rule mirrors the retention trigger in
 * supabase/migrations/20260907101000_retention_deletion_queue.sql.
 */
type PathSource = {
  table: string;
  select: string;
  pk?: string;
  /** Human-readable provenance recorded in the manifest. */
  from: string;
  paths: (row: Record<string, unknown>) => (string | null | undefined)[];
};

const STORAGE_SOURCES: Record<string, PathSource[]> = {
  recordings: [
    {
      table: "recordings",
      select: "id, storage_path, original_path",
      from: "recordings.storage_path + recordings.original_path",
      paths: (r) => [r.storage_path as string, r.original_path as string | null],
    },
  ],
  faces: [
    {
      table: "faces",
      select: "id, image_path, crop_sealed",
      from: "faces.image_path (+ '.enc' when crop_sealed)",
      paths: (r) => [r.crop_sealed ? `${r.image_path as string}.enc` : (r.image_path as string)],
    },
  ],
  suspects: [
    {
      table: "suspects",
      select: "id, image_path",
      from: "suspects.image_path",
      paths: (r) => [r.image_path as string],
    },
  ],
  "alert-screenshots": [
    {
      table: "alerts",
      select: "id, screenshot_path",
      from: "alerts.screenshot_path",
      paths: (r) => [r.screenshot_path as string | null],
    },
  ],
  revealed: [
    {
      table: "reveal_jobs",
      select: "id, output_path",
      from: "reveal_jobs.output_path",
      paths: (r) => [r.output_path as string | null],
    },
  ],
};

const PAGE = 1000;
const MAX_ROWS = 50_000;

type Row = Record<string, unknown>;
type PagedClient = {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): {
        range(from: number, to: number): PromiseLike<{
          data: Row[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * PostgREST caps a single response at the project's max-rows (1000 by
 * default), so a `.limit(50000)` select silently truncated large tables.
 * Paging by primary key keeps the page boundaries stable.
 */
async function fetchAll(
  client: PagedClient,
  table: string,
  columns: string,
  pk: string,
): Promise<{ rows: Row[]; error?: string; truncated: boolean }> {
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order(pk, { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return { rows, error: error.message, truncated: false };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return { rows, truncated: false };
  }
  // Distinguish a complete table at the cap from a genuinely partial export.
  const { data, error } = await client.from(table).select(pk)
    .order(pk, { ascending: true }).range(MAX_ROWS, MAX_ROWS);
  return { rows, truncated: Boolean(data?.length), ...(error ? { error: error.message } : {}) };
}

type TableReport = {
  rows: number;
  columns: string;
  restorable: boolean;
  missing_required: string[];
  truncated?: boolean;
  error?: string;
  note?: string;
};

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  // Backup нь audit_log агуулагдсан тул TOTP step-up шаардана: comprised
  // admin session-аар audit мөрийг гадагшаа татах боломжгүй болгоно.
  // The biometric export rides on the same fresh-reauth requirement.
  if (!(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
  }

  const flag = new URL(request.url).searchParams.get("include_biometrics");
  const wantsBiometrics = flag === "1" || flag === "true";
  // ArcFace vectors are the one thing no downloadable artifact has ever
  // carried: a 512-dim embedding re-identifies a person anywhere, forever, and
  // no key protects it once it leaves. Fresh step-up alone is the same gate the
  // ordinary backup already passes, so the biometric copy is additionally
  // restricted to the single DB-locked super admin — the account the schema
  // itself refuses to demote or delete.
  if (wantsBiometrics && !auth.profile.is_super_admin) {
    return NextResponse.json(
      { error: "BIOMETRIC_EXPORT_FORBIDDEN", detail: "super admin only" },
      { status: 403 },
    );
  }
  const includeBiometrics = wantsBiometrics;

  const svc = createServiceClient();
  const paged = svc as unknown as PagedClient;
  const zip = new JSZip();
  const fileHashes: Record<string, string> = {};
  const snapshots: Record<string, Row[]> = {};
  const writeJson = (name: string, value: unknown) => {
    const body = JSON.stringify(value, null, 2);
    zip.file(name, body);
    fileHashes[name] = createHash("sha256").update(body).digest("hex");
  };

  // 1) Table dumps
  const tables: Record<string, TableReport> = {};
  const biometricColumns: string[] = [];
  for (const [table, spec] of Object.entries(TABLES)) {
    const columns =
      includeBiometrics && spec.biometric ? `${spec.columns}, ${spec.biometric}` : spec.columns;
    if (includeBiometrics && spec.biometric) {
      for (const c of spec.biometric.split(",")) biometricColumns.push(`${table}.${c.trim()}`);
    }
    const missing = [
      ...(spec.omittedRequired ?? []),
      ...(includeBiometrics ? [] : (spec.biometricRequired ?? [])),
    ];
    const { rows, error, truncated } = await fetchAll(paged, table, columns, spec.pk ?? "id");
    if (error || truncated) {
      // A bounded HTTP export must never masquerade as a complete backup.
      // Return no ZIP at all; use the database snapshot tooling for large data.
      return NextResponse.json({
        error: "BACKUP_INCOMPLETE", table,
        detail: error ? "Table export failed; retry the export." : `Table exceeds ${MAX_ROWS} rows; use a database snapshot export.`,
      }, { status: error ? 503 : 409, headers: { "Cache-Control": "no-store" } });
    }
    if (table === "reveal_jobs" && !includeBiometrics && rows.some((r) => r.method === "upload" && r.status === "pending_approval" && r.request_scope != null)) {
      missing.push("reference_sealed");
    }
    snapshots[table] = rows;
    writeJson(`tables/${table}.json`, rows);
    tables[table] = {
      rows: rows.length,
      columns,
      restorable: missing.length === 0,
      missing_required: missing,
      ...(truncated ? { truncated: true } : {}),
      ...(spec.note ? { note: spec.note } : {}),
    };
  }

  // 2) Storage manifests, enumerated from the rows that own each path.
  const buckets: Record<string, { objects: number; derived_from: string[]; error?: string }> = {};
  for (const [bucket, sources] of Object.entries(STORAGE_SOURCES)) {
    const seen = new Set<string>();
    const objects: { path: string; source: string; row_id: string }[] = [];
    const errors: string[] = [];
    for (const source of sources) {
      // Reuse the actual table dump, so manifests cannot drift during a
      // second read while capture or retention changes the source database.
      const rows = snapshots[source.table];
      if (!rows) { errors.push(`${source.table}: missing table export`); continue; }
      for (const row of rows) {
        for (const path of source.paths(row)) {
          if (typeof path !== "string" || path.length === 0 || seen.has(path)) continue;
          seen.add(path);
          objects.push({ path, source: source.table, row_id: String(row.id ?? "") });
        }
      }
    }
    const error = errors.length ? errors.join("; ") : undefined;
    buckets[bucket] = {
      objects: objects.length,
      derived_from: sources.map((s) => s.from),
      ...(error ? { error } : {}),
    };
    writeJson(`buckets/${bucket}.manifest.json`, {
      bucket, total_objects: objects.length,
      derived_from: sources.map((s) => s.from),
      complete: !error,
      note: "Paths match the exported database rows. Blob bytes and unreferenced objects are not in this ZIP.",
      ...(error ? { error } : {}), objects,
    });
  }

  const totalObjects = Object.values(buckets).reduce((n, b) => n + b.objects, 0);
  const unrestorable = Object.entries(tables)
    .filter(([, r]) => !r.restorable)
    .map(([table, r]) => `${table} (missing ${r.missing_required.join(", ") || "data"})`);

  // 3) Machine-readable manifest — scripts/restore-from-backup.ts reads it.
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        format: "mongolz-backup/3",
        complete: true,
        consistency: "live-paged-export; pause writes or use a database snapshot for point-in-time recovery",
        file_sha256: fileHashes,
        created_at: new Date().toISOString(),
        created_by: auth.user.email ?? auth.user.id,
        include_biometrics: includeBiometrics,
        biometric_columns: biometricColumns,
        tables,
        buckets,
        cannot_restore: {
          auth_users:
            "Supabase auth.users (passwords, sessions, identities) is not exported. profiles.id references it, so recreate or re-invite the accounts first — otherwise every profile row fails its FK.",
          auth_factors:
            "TOTP seeds, recovery-code hashes and passkey credentials are excluded on purpose; operators re-enrol.",
          secrets:
            "webhooks.url + signing secret and push_subscriptions endpoint/keys are credentials and are excluded — those two tables are reference-only.",
          storage_bytes:
            "Only object paths are listed in this ZIP. scripts/create-recovery-bundle.ts seals every DB file and referenced Storage object into an offline bundle with a separate key escrow.",
        },
      },
      null,
      2,
    ),
  );

  // 4) README — the same limits in prose, in the three UI languages.
  zip.file(
    "README.txt",
    [
      "MONGOLZ Security — Database & Storage backup",
      `Created: ${new Date().toISOString()}`,
      `Biometric columns: ${includeBiometrics ? "INCLUDED (see the warning below)" : "excluded"}`,
      "",
      "tables/    — JSON row dumps; exports exceeding 50K rows per table are refused",
      "Integrity: manifest.json contains SHA-256 hashes and exact exported file counts.",
      "Consistency: live paged export, not a transactional snapshot. Pause writes or use a database snapshot for point-in-time recovery.",
      "buckets/   — Storage object manifests derived from the DB (paths only, no blob bytes)",
      "manifest.json — machine-readable column lists, row counts and restore limits",
      "",
      "Row counts:",
      ...Object.entries(tables).map(
        ([t, r]) => `  ${t.padEnd(22)} ${String(r.rows).padStart(6)}${r.restorable ? "" : "   [NOT RESTORABLE]"}`,
      ),
      "",
      "Storage objects (from the database):",
      ...Object.entries(buckets).map(([b, r]) => `  ${b.padEnd(22)} ${String(r.objects).padStart(6)}`),
      `  ${"TOTAL".padEnd(22)} ${String(totalObjects).padStart(6)}`,
      "",
      ...(includeBiometrics
        ? [
            "!!! WARNING — THIS ARCHIVE CONTAINS BIOMETRIC PERSONAL DATA !!!",
            `Included: ${biometricColumns.join(", ")}`,
            "512-dim ArcFace vectors identify the people they were computed from.",
            "Treat this file like the face database itself: encrypted storage only,",
            "no cloud sync, no chat/email transfer, delete after the restore drill.",
            "The download is recorded in audit_log as BACKUP_DOWNLOAD_BIOMETRIC.",
            "",
          ]
        : [
            "RESTORE LIMITS (English)",
            "  This archive CANNOT restore `suspects` or `faces`: suspects.embedding and",
            "  faces.embedding are NOT NULL and were left out because they are biometric",
            "  personal data. Re-run the export as an admin with the",
            "  'Include biometric embeddings' box ticked (?include_biometrics=1) if you",
            "  need a restorable copy.",
            "",
            "СЭРГЭЭХ ХЯЗГААР (Монгол)",
            "  Энэ архиваас `suspects`, `faces` хүснэгтийг сэргээх БОЛОМЖГҮЙ:",
            "  suspects.embedding, faces.embedding нь NOT NULL боловч биометрик хувийн",
            "  мэдээлэл тул орхигдсон. Сэргээгддэг хуулбар хэрэгтэй бол админаар",
            "  «Биометрик embedding оруулах» сонголттойгоор дахин татна уу.",
            "",
            "복원 한계 (한국어)",
            "  이 아카이브로는 `suspects`, `faces` 테이블을 복원할 수 없습니다.",
            "  suspects.embedding 과 faces.embedding 은 NOT NULL 이지만 생체 개인정보이므로",
            "  제외되었습니다. 복원 가능한 사본이 필요하면 관리자로서",
            "  '생체 임베딩 포함' 옵션을 켜고 다시 내려받으십시오.",
            "",
          ]),
      "Always excluded (every export):",
      "  • Supabase auth.users — passwords, sessions and identities are NOT here.",
      "    profiles.id is a FK onto auth.users: recreate/re-invite the accounts (or",
      "    restore the auth schema from PITR) BEFORE loading profiles.json.",
      "  • TOTP seeds, recovery-code hashes, passkeys — operators re-enrol 2FA.",
      "  • webhooks.url + signing secret, push_subscriptions endpoint/p256dh/auth —",
      "    those two tables are reference-only; recreate the destinations by hand.",
      "  • Storage blob bytes — buckets/*.manifest.json lists paths and totals only.",
      "    Use the complete recovery command below to create an encrypted offline mirror.",
      ...(unrestorable.length
        ? ["", "Tables that cannot be restored from THIS artifact:", ...unrestorable.map((u) => `  • ${u}`)]
        : []),
      "",
      "Complete recovery (full drill: docs/RUNBOOK.md §3):",
      "  1. Create the offline mirror immediately after extraction:",
      "     npm run recovery:create -- <this-dir> <bundle-dir> --key-escrow=<separate-file>",
      "  2. Store bundle, key escrow and RECOVERY_ESCROW_PASSPHRASE separately.",
      "  3. Apply schema and recreate auth users in a DIFFERENT Supabase project.",
      "  4. Validate only: npm run recovery:restore -- <bundle-dir> --key-escrow=<file>",
      "  5. Restore + verify: add --apply. It restores rows and Storage bytes, checks",
      "     every checksum/decrypt/count, and writes a recovery report + audit row.",
    ].join("\n"),
  );

  const buf = await zip.generateAsync({ type: "uint8array" });

  // Audit — the biometric export gets its own row naming the exact columns.
  try {
    await svc.from("audit_log").insert({
      action: "BACKUP_DOWNLOAD",
      detail: `${(buf.length / 1024).toFixed(1)} KB, ${Object.keys(TABLES).length} tables, ${
        Object.keys(STORAGE_SOURCES).length
      } buckets, ${totalObjects} storage objects, biometrics=${includeBiometrics ? "included" : "excluded"}`,
      user_id: auth.user.id,
      user_email: auth.user.email,
    });
    if (includeBiometrics) {
      await svc.from("audit_log").insert({
        action: "BACKUP_DOWNLOAD_BIOMETRIC",
        detail: `biometric columns exported: ${biometricColumns.join(", ")}; rows: suspects=${
          tables.suspects?.rows ?? 0
        }, faces=${tables.faces?.rows ?? 0}, reveal_jobs=${tables.reveal_jobs?.rows ?? 0}`,
        user_id: auth.user.id,
        user_email: auth.user.email,
      });
    }
  } catch {}

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mongolz-backup${
        includeBiometrics ? "-biometric" : ""
      }-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

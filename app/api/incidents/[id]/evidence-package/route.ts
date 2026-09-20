import { createHash } from "node:crypto";
import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";
import { sealEvidenceZip } from "@/lib/evidence-encryption";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ITEMS = 10;
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_PACKAGE_INPUT_BYTES = 180 * 1024 * 1024;

type EvidenceRow = {
  id: string;
  recording_id: string | null;
  recording_filename: string;
  camera_name: string | null;
  recording_started_at: string;
  clip_start_sec: number;
  clip_end_sec: number;
  note: string | null;
  legal_hold: boolean;
  added_at: string;
};

function sha256(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

async function fetchMedia(url: string, token: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw new Error(`media-${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new Error("media-too-large");
  const body = new Uint8Array(await response.arrayBuffer());
  if (!body.length || body.length > MAX_FILE_BYTES) throw new Error("media-size-invalid");
  return body;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  if (!(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid incident id" }, { status: 400 });
  const requestBody = (await request.json().catch(() => null)) as { passphrase?: unknown } | null;
  const passphrase = typeof requestBody?.passphrase === "string" ? requestBody.passphrase : "";
  if (passphrase.length < 12 || passphrase.length > 128) {
    return NextResponse.json({ error: "passphrase must be 12-128 characters" }, { status: 400 });
  }

  const mlUrl = process.env.NEXT_PUBLIC_ML_SERVICE_URL?.replace(/\/$/, "");
  const mlToken = process.env.ML_SERVICE_TOKEN;
  if (!mlUrl || !mlToken) {
    return NextResponse.json({ error: "evidence renderer unavailable" }, { status: 503 });
  }

  const svc = createServiceClient();
  const [incidentRes, evidenceRes, alertRes, faceRes, activityRes, accessRes, retentionRes] = await Promise.all([
    svc.from("incidents").select("id,title,description,status,priority,assignee_id,created_by,resolved_by,created_at,updated_at,resolved_at").eq("id", id).maybeSingle(),
    svc.from("incident_recordings").select("id,recording_id,recording_filename,camera_name,recording_started_at,clip_start_sec,clip_end_sec,note,legal_hold,added_at").eq("incident_id", id).order("added_at"),
    svc.from("incident_alerts").select("added_at,alert:alerts(id,suspect_name,camera_name,similarity,state,created_at,last_seen_at,match_count)").eq("incident_id", id).order("added_at"),
    svc.from("incident_faces").select("added_at,face:faces(id,filename,recording_id,camera_id,detected_at,source_offset_sec,crop_sealed)").eq("incident_id", id).order("added_at"),
    svc.from("incident_events").select("id,event_type,detail,actor_id,actor_email,created_at").eq("incident_id", id).order("created_at"),
    svc.from("audit_log").select("id,action,detail,user_id,user_email,ip,created_at").ilike("detail", `%${id}%`).order("created_at"),
    svc.from("retention_policies").select("resource,retention_days,enabled").in("resource", ["recordings", "faces", "alerts", "audit_log"]),
  ]);
  if (!incidentRes.data) return NextResponse.json({ error: "incident not found" }, { status: 404 });
  const queryError = [incidentRes, evidenceRes, alertRes, faceRes, activityRes, accessRes, retentionRes].find((result) => result.error)?.error;
  if (queryError) return NextResponse.json({ error: "evidence metadata unavailable" }, { status: 503 });

  const evidence = (evidenceRes.data ?? []) as unknown as EvidenceRow[];
  if (!evidence.length) return NextResponse.json({ error: "no recording evidence attached" }, { status: 409 });
  if (evidence.length > MAX_ITEMS) {
    return NextResponse.json({ error: `package supports at most ${MAX_ITEMS} clips` }, { status: 413 });
  }

  const zip = new JSZip();
  const checksums: Array<{ path: string; sha256: string; bytes: number }> = [];
  let inputBytes = 0;
  const add = (path: string, body: Uint8Array | string, store = false) => {
    const bytes = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
    inputBytes += bytes;
    if (inputBytes > MAX_PACKAGE_INPUT_BYTES) throw new Error("package-too-large");
    zip.file(path, body, store ? { compression: "STORE" } : undefined);
    checksums.push({ path, sha256: sha256(body), bytes });
  };

  try {
    add("metadata/incident.json", safeJson(incidentRes.data));
    add("metadata/recording-evidence.json", safeJson(evidence));
    add("metadata/alerts.json", safeJson(alertRes.data ?? []));
    add("metadata/faces.json", safeJson(faceRes.data ?? []));
    add("metadata/activity.json", safeJson(activityRes.data ?? []));
    add("metadata/access-log.json", safeJson(accessRes.data ?? []));
    add("metadata/retention.json", safeJson({
      policies: retentionRes.data ?? [],
      legal_holds: evidence.map((item) => ({ evidence_id: item.id, recording_id: item.recording_id, active: item.legal_hold })),
      note: "An active legal hold overrides scheduled deletion. The downloaded encrypted package is retained by the receiving organisation's evidence policy.",
    }));

    for (const [index, item] of evidence.entries()) {
      if (!item.recording_id) continue; // released hold; metadata remains verifiable
      const params = new URLSearchParams({
        start_sec: String(item.clip_start_sec),
        end_sec: String(item.clip_end_sec),
      });
      const clip = await fetchMedia(
        `${mlUrl}/recording/${encodeURIComponent(item.recording_id)}/evidence-clip?${params}`,
        mlToken,
      );
      const frameAt = item.clip_start_sec + (item.clip_end_sec - item.clip_start_sec) / 2;
      const frame = await fetchMedia(
        `${mlUrl}/recording/${encodeURIComponent(item.recording_id)}/evidence-frame?at_sec=${encodeURIComponent(frameAt)}`,
        mlToken,
      );
      const stem = `${String(index + 1).padStart(2, "0")}-${item.id}`;
      add(`clips/${stem}-masked.mp4`, clip, true);
      add(`images/${stem}-masked.jpg`, frame, true);
    }
  } catch (error) {
    const status = error instanceof Error && error.message.includes("too-large") ? 413 : 502;
    return NextResponse.json({ error: "evidence media could not be packaged" }, { status });
  }

  const exportedAt = new Date().toISOString();
  const readme = [
    "MONGOLZ incident evidence package",
    `Incident: ${id}`,
    `Exported: ${exportedAt}`,
    "",
    "Verify every file with SHA256SUMS.txt. manifest.json records the export",
    "scope, file sizes, checksums, and active legal holds. Video clips and",
    "representative JPEG images are masked by the ML privacy renderer.",
  ].join("\n");
  add("README.txt", readme);
  const manifestBody = safeJson({
    schema_version: 1,
    incident_id: id,
    exported_at: exportedAt,
    exported_by: { id: auth.user.id, email: auth.user.email ?? null },
    privacy: "All included clips and representative images are fully masked.",
    encryption: "The complete ZIP is wrapped with AES-256-GCM; its key is derived from the operator passphrase using scrypt.",
    retention: retentionRes.data ?? [],
    legal_hold_items: evidence.filter((item) => item.legal_hold).map((item) => item.id),
    files: checksums,
  });
  zip.file("manifest.json", manifestBody);
  const manifestSha = sha256(manifestBody);
  const sums = [...checksums, { path: "manifest.json", sha256: manifestSha, bytes: Buffer.byteLength(manifestBody) }]
    .map((file) => `${file.sha256}  ${file.path}`)
    .join("\n") + "\n";
  zip.file("SHA256SUMS.txt", sums);
  const zipBody = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const body = sealEvidenceZip(zipBody, passphrase, { incidentId: id, manifestSha256: manifestSha });

  const userClient = await createClient();
  const logged = await userClient.rpc("log_incident_evidence_export", {
    p_incident_id: id,
    p_manifest_sha256: manifestSha,
    p_file_count: checksums.length + 2,
    p_package_bytes: body.byteLength,
  });
  if (logged.error || !logged.data) {
    return NextResponse.json({ error: "evidence export audit failed" }, { status: 503 });
  }

  const date = exportedAt.slice(0, 10);
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.mongolz.evidence+octet-stream",
      "Content-Disposition": `attachment; filename="incident-${id.slice(0, 8)}-${date}.zip.enc"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

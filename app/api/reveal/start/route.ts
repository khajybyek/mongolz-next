import { createHash, randomUUID } from "node:crypto";
import { RevealReferenceConfigurationError, sealRevealReference } from "@/lib/reveal-reference";
import { REVEAL_REASON_MIN, REVEAL_REASON_MAX, REVEAL_SCOPE_MAX_TARGETS, type RevealScope } from "@/lib/reveal-scope";
import { NextResponse, after, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { mlEmbed, mlTriggerReveal, MLError } from "@/lib/ml-client";
import { checkRateLimit, REVEAL_LIMIT } from "@/lib/rate-limit";
import { notifyRevealRequested, scheduleSecurityEvent } from "@/lib/notify";
import {
  isDatabaseVerdict,
  readSuperAdminSelfReveal,
  REVEAL_START_UNCONFIRMED_CODE,
  REVEAL_TOTP_REQUIRED_CODE,
  SELF_APPROVAL_ABORTED_AUDIT_ACTION,
  SELF_APPROVED_AUDIT_ACTION,
  selfApprovalAuditDetail,
} from "@/lib/reveal-self-approval";
import type { RevealMethod } from "@/lib/database.types";
import type { TablesInsert } from "@/lib/database.generated";
import { readRevealAuthority } from "@/lib/reveal-authority";
import { isFaceEncryptedRecording, recordingRevealable } from "@/lib/recording-mode";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;

  // Step-up auth шалгах. A password step-up is enough to REQUEST a reveal:
  // nothing is decrypted until a second admin approves, and approval demands
  // the TOTP factor (reveal-approvals/actions.ts).
  if (!(await hasFreshReauth(ctx.user.id, { allowPassword: true }))) {
    return NextResponse.json(
      { error: "REAUTH_REQUIRED", code: "REAUTH_REQUIRED", message: "Нууц үгээ дахин оруулна уу" },
      { status: 401 }
    );
  }

  // Owner decision 2026-09-30 (ADR 0003 amendment): the super admin's reveal
  // runs without a second admin. The database decides — the is_super_admin
  // flag plus the super_admin_self_reveal kill switch — and its guard trigger
  // and claim_reveal_job() apply the same verdict. Read it BEFORE the insert:
  // with the switch off the super admin simply takes the 4-eyes path below.
  const svc = createServiceClient();
  const selfApprove = await readSuperAdminSelfReveal(svc, ctx.user.id, ctx.profile.is_super_admin);
  // The super admin is then also the approver, and approving demands the TOTP
  // factor (approveRevealAction), so a password step-up is not enough here.
  if (selfApprove && !(await hasFreshReauth(ctx.user.id))) {
    return NextResponse.json(
      {
        error: "REAUTH_REQUIRED",
        code: REVEAL_TOTP_REQUIRED_CODE,
        message: "A reveal without second-admin approval needs your authenticator code",
      },
      { status: 401 }
    );
  }

  // Rate limit: 1 цагт 20 reveal max — нэг админ ч misuse хийхгүй
  const authority = await readRevealAuthority(ctx.user.id);
  if ("error" in authority) return authority.error;

  const rl = await checkRateLimit(ctx.user.id, REVEAL_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Хэт олон reveal хүсэлт", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  const fd = await request.formData();
  const recording_id = String(fd.get("recording_id") ?? "");
  const method = String(fd.get("method") ?? "") as RevealMethod;
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < REVEAL_REASON_MIN || reason.length > REVEAL_REASON_MAX) {
    return NextResponse.json({ error: "REVEAL_REASON_REQUIRED", code: "REVEAL_REASON_REQUIRED", message: "Reveal reason must contain 10–1000 characters." }, { status: 400 });
  }
  const newJobId = randomUUID();
  let reference_sealed: string | null = null;
  let reference_sha256: string | undefined;
  const targets: RevealScope["targets"] = [];
  const rawThreshold = Number(fd.get("threshold") ?? 0.45);
  // Clamp to the DB CHECK range (reveal_jobs_threshold_check: 0.30–0.85) so
  // a crafted value can neither match everything nor trip a 500.
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(0.85, Math.max(0.3, rawThreshold))
    : 0.45;

  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!UUID_RE.test(recording_id) || !["upload", "suspect", "detected_face"].includes(method)) {
    return NextResponse.json({ error: "invalid params", code: "INVALID_PARAMS" }, { status: 400 });
  }

  // Optional time window — reveal scope-ийг recording-ийн нэг хэсэгт хязгаарлана.
  // Хэрэв start_sec/end_sec хоёулаа байхгүй бол whole recording reveal (хуучин зан төлөв).
  const rawStart = fd.get("start_sec");
  const rawEnd = fd.get("end_sec");
  let target_start_sec: number | null = null;
  let target_end_sec: number | null = null;
  const hasStart = rawStart != null && String(rawStart) !== "";
  const hasEnd = rawEnd != null && String(rawEnd) !== "";
  if (hasStart !== hasEnd) {
    return NextResponse.json({ error: "Both time window bounds are required", code: "INVALID_WINDOW" }, { status: 400 });
  }
  if (hasStart && hasEnd) {
    const s = Number(rawStart);
    const e = Number(rawEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
      return NextResponse.json(
        { error: "invalid time window — start must be ≥0 and end > start", code: "INVALID_WINDOW" },
        { status: 400 },
      );
    }
    target_start_sec = s;
    target_end_sec = e;
  }

  // Recording байгаа эсэхийг шалгах + has_original. A face-encrypted
  // recording (ADR 0013) keeps no raw original: the reveal restores the
  // selected person from the sealed face envelope instead, so it needs that.
  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("recordings")
    .select("id, has_original, blur_strategy, face_envelope_path, filename, duration_sec")
    .eq("id", recording_id)
    .single();

  if (!rec) {
    return NextResponse.json({ error: "recording not found", code: "RECORDING_NOT_FOUND" }, { status: 404 });
  }
  if (!recordingRevealable(rec) && isFaceEncryptedRecording(rec)) {
    return NextResponse.json(
      { error: "This face-encrypted recording has no sealed face envelope — reveal is not possible", code: "NO_FACE_ENVELOPE" },
      { status: 422 }
    );
  }
  if (!recordingRevealable(rec)) {
    return NextResponse.json(
      { error: "Энэ бичлэгт original үлдээгүй — reveal боломжгүй", code: "NO_ORIGINAL" },
      { status: 422 }
    );
  }

  // Time window нь recording-ийн duration-аас давсан эсэхийг шалгана.
  // NULL duration_sec → time window-ийг бид баталгаажуулах боломжгүй, тиймээс
  // time-bounded reveal-ийг REJECT хийнэ (whole-recording reveal зөвшөөрнө).
  if (target_end_sec !== null) {
    if (!rec.duration_sec || rec.duration_sec <= 0) {
      return NextResponse.json(
        { error: "Recording-ийн duration тодорхойгүй тул time-bounded reveal боломжгүй", code: "DURATION_UNKNOWN" },
        { status: 400 },
      );
    }
    if (target_end_sec > rec.duration_sec + 1) {
      return NextResponse.json(
        {
          error: `Time window-ийн end (${target_end_sec}s) recording duration-аас давсан байна (${rec.duration_sec}s)`,
          code: "WINDOW_EXCEEDS_DURATION",
        },
        { status: 400 },
      );
    }
  }

  // Method-аас хамаарч target embedding(-ууд)-ыг бүрдүүлэх
  let queryEmbeddingSingle: number[] | null = null;
  let queryEmbeddingsMulti: number[][] | null = null;
  let suspect_id: string | null = null;
  let face_id_single: string | null = null;
  let face_ids_multi: string[] | null = null;
  let detail = `recording=${rec.filename}`;

  if (method === "upload") {
    const photo = fd.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "missing photo", code: "BAD_PHOTO" }, { status: 400 });
    }
    if (photo.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
      return NextResponse.json({ error: "Use a JPEG, PNG or WebP reference up to 2 MB", code: "BAD_PHOTO" }, { status: 400 });
    }
    const buffer = Buffer.from(await photo.arrayBuffer());
    try {
      reference_sealed = sealRevealReference(newJobId, buffer, photo.type);
    } catch (error) {
      if (error instanceof RevealReferenceConfigurationError) {
        console.error("[reveal/start] reference sealing is not configured");
        return NextResponse.json(
          { error: "REVEAL_REFERENCE_CONFIGURATION", code: "REFERENCE_SEAL_FAILED", message: error.message },
          { status: 503 },
        );
      }
      console.error("[reveal/start] reference sealing failed", error);
      return NextResponse.json({ error: "REVEAL_REFERENCE_SEAL_FAILED", code: "REFERENCE_SEAL_FAILED" }, { status: 500 });
    }
    try {
      queryEmbeddingSingle = await mlEmbed(buffer);
      reference_sha256 = createHash("sha256").update(buffer).digest("hex");
      targets.push({ id: reference_sha256, label: photo.name.trim() || "reference-image" });
    } catch (e) {
      const msg = e instanceof MLError ? e.message : "ML service хариулсангүй";
      return NextResponse.json({ error: msg, code: "ML_UNAVAILABLE" }, { status: 502 });
    }
    detail += " · upload";
  } else if (method === "suspect") {
    suspect_id = String(fd.get("suspect_id") ?? "");
    if (!UUID_RE.test(suspect_id)) {
      return NextResponse.json({ error: "missing suspect_id", code: "INVALID_PARAMS" }, { status: 400 });
    }
    const { data: s } = await svc
      .from("suspects")
      .select("name, embedding")
      .eq("id", suspect_id)
      .single();
    if (!s) return NextResponse.json({ error: "suspect not found", code: "TARGET_NOT_FOUND" }, { status: 404 });
    queryEmbeddingSingle = s.embedding as unknown as number[];
    targets.push({ id: suspect_id, label: s.name });
    detail += ` · suspect=${s.name}`;
  } else if (method === "detected_face") {
    // Шинэ: face_ids[] (олон) — fallback: face_id (нэг)
    const idsRaw = fd.getAll("face_ids").map((v) => String(v)).filter(Boolean);
    const single = String(fd.get("face_id") ?? "").trim();
    const collected = idsRaw.length > 0 ? idsRaw : single ? [single] : [];

    // Дахин давхардуулсныг арилгана + хоосон / буруу id шалгах
    const ids = Array.from(new Set(collected));
    if (ids.length === 0 || ids.length > REVEAL_SCOPE_MAX_TARGETS || !ids.every((i) => UUID_RE.test(i))) {
      return NextResponse.json({ error: "missing or invalid face id(s)", code: "INVALID_PARAMS" }, { status: 400 });
    }

    // Бүх face-ийн embedding-ийг авах (service-role, RLS bypass)
    const { data: rows, error: facesErr } = await svc
      .from("faces")
      .select("id, filename, embedding")
      .in("id", ids);

    if (facesErr) {
      console.error("[reveal/start] faces lookup:", facesErr.message);
      return NextResponse.json({ error: "could not load faces", code: "START_FAILED" }, { status: 500 });
    }
    if (!rows || rows.length !== ids.length) {
      return NextResponse.json({ error: "face(s) not found", code: "TARGET_NOT_FOUND" }, { status: 404 });
    }

    // Embedding-уудыг JSON массив болгож хадгална
    targets.push(...rows.map((r) => ({ id: r.id, label: r.filename })));
    queryEmbeddingsMulti = rows.map((r) => r.embedding as unknown as number[]);

    if (rows.length === 1) {
      // Backward-compat: ганц бол хуучин singular талбарыг нөхөж бичнэ
      face_id_single = rows[0].id;
      queryEmbeddingSingle = rows[0].embedding as unknown as number[];
    }
    face_ids_multi = rows.map((r) => r.id);
    detail += ` · faces=${rows.length} (${rows.map((r) => r.filename).join(", ").slice(0, 120)})`;
  }

  // 1. reveal_jobs row үүсгэх. 4-eyes (ADR 0003): pending_approval — the job
  // does NOT run until a SECOND admin approves it via /reveal-approvals
  // (approveRevealAction sets queued + triggers ML). The ML side
  // (reveal_job.run) also refuses any status outside queued/approved/
  // processing, and claim_reveal_job() refuses an unapproved row, so this
  // gate is enforced at three layers.
  // Super admin (selfApprove): startSelfApproved() below writes the ledger,
  // then creates the row queued and approved by the requester
  // (approval_required = false). The guard trigger refuses such a row for
  // anyone else, or with the kill switch off, and the claim re-checks both —
  // and the ledger row — when the worker picks the job up.
  const baseRow = {
    id: newJobId,
    reason,
    reference_sealed,
    request_scope: {
      version: 1, recording: { id: rec.id, filename: rec.filename, duration_sec: rec.duration_sec },
      method, targets, threshold, start_sec: target_start_sec, end_sec: target_end_sec,
      ...(reference_sha256 ? { reference_sha256 } : {}),
    },
    recording_id,
    method,
    suspect_id,
    face_id: face_id_single,
    face_ids: face_ids_multi,
    query_embedding: queryEmbeddingSingle as never,
    query_embeddings: queryEmbeddingsMulti as never,
    threshold,
    target_start_sec,
    target_end_sec,
    requested_by: ctx.user.id,
    requested_email: ctx.user.email,
    reauth_at: new Date().toISOString(),
    reveal_level: authority.level,
  };
  const actor: Actor = { id: ctx.user.id, email: ctx.user.email };

  // True when the database refused the self-approved row and the request is
  // filed for 4-eyes approval instead: its REVEAL_REQUEST row already exists.
  let selfRefused = false;
  if (selfApprove) {
    const outcome = await startSelfApproved({
      svc,
      actor,
      jobId: newJobId,
      row: {
        ...baseRow,
        status: "queued",
        approval_required: false,
        approved_by: ctx.user.id,
        approved_email: ctx.user.email,
        approved_at: new Date().toISOString(),
      },
      requestDetail: `${detail} · super admin — runs without second-admin approval`,
      ledgerDetail: selfApprovalAuditDetail({ jobId: newJobId, recordingId: recording_id, method, reasonLength: reason.length }),
    });
    if (outcome !== "refused") return outcome;
    selfRefused = true;
  }

  const { data: job, error: jobErr } = await svc
    .from("reveal_jobs")
    .insert({ ...baseRow, status: "pending_approval" })
    .select("id")
    .single();

  if (selfRefused) {
    // Correct the ledger: the REVEAL_REQUEST row written above announced a
    // reveal without second-admin approval. One request, one REVEAL_REQUEST.
    await writeAudit(svc, auditRow(actor, SELF_APPROVAL_ABORTED_AUDIT_ACTION, job && !jobErr
      ? `job ${newJobId} · refused by the database (kill switch off, or not the super admin) · filed for 4-eyes approval instead`
      : `job ${newJobId} · refused by the database; the 4-eyes request could not be created either`));
  }

  if (jobErr || !job) {
    console.error("[reveal/start] job insert:", jobErr?.message);
    return NextResponse.json({ error: "could not create reveal job", code: "START_FAILED" }, { status: 500 });
  }
  const jobId = job.id;

  // 2. Audit — request logged now; the actual decrypt is gated on approval.
  if (!selfRefused) {
    await svc.from("audit_log").insert(auditRow(actor, "REVEAL_REQUEST", `${detail} · awaiting 4-eyes approval`));
  }

  // 3. Tell the other admins a request is waiting — after the response is
  // sent, so a slow webhook/Telegram round-trip never delays the requester.
  // notifyRevealRequested is best-effort and never throws.
  after(() =>
    notifyRevealRequested({
      jobId,
      recordingId: recording_id,
      requesterId: ctx.user.id,
      requesterEmail: ctx.user.email,
      method,
      threshold,
    }),
  );

  // NOTE: ML is intentionally NOT triggered here — see approveRevealAction.
  return NextResponse.json({ job_id: jobId, status: "pending_approval" });
}

type ServiceClient = ReturnType<typeof createServiceClient>;
type Actor = { id: string; email: string | null | undefined };

function auditRow(actor: Actor, action: string, detail: string): TablesInsert<"audit_log"> {
  return { action, detail, user_id: actor.id, user_email: actor.email };
}

/** A ledger row whose failure must not change the answer; logged, never thrown. */
async function writeAudit(svc: ServiceClient, row: TablesInsert<"audit_log">): Promise<void> {
  try {
    const { error } = await svc.from("audit_log").insert(row);
    if (error) console.error(`[reveal/start] audit insert ${row.action}:`, error.message);
  } catch (e) {
    console.error(`[reveal/start] audit insert ${row.action}:`, e instanceof Error ? e.message : e);
  }
}

type SelfApprovedStart = {
  svc: ServiceClient;
  actor: Actor;
  jobId: string;
  /** The job row: queued, approval_required = false, approved by the requester. */
  row: TablesInsert<"reveal_jobs">;
  /** Detail of the REVEAL_REQUEST ledger row. */
  requestDetail: string;
  /** Detail of the REVEAL_SUPER_ADMIN_SELF_APPROVED row (selfApprovalAuditDetail). */
  ledgerDetail: string;
};

/**
 * The super admin's reveal without a second admin (owner decision
 * 2026-09-30, ADR 0003 amendment). Returns the response, or "refused" when
 * the database refused the self-approved row — the kill switch was turned
 * off, or the flag moved, after the verdict was read — so the caller files
 * the request for 4-eyes approval instead.
 *
 * The ledger comes FIRST. Both audit rows name the pre-generated job id and
 * are committed before the job row exists, and claim_reveal_job() refuses a
 * self-approved job whose REVEAL_SUPER_ADMIN_SELF_APPROVED row is missing.
 * The durable ML worker claims any queued row within seconds, without waiting
 * for this route, so a job inserted before its ledger rows could decrypt
 * unrecorded; in this order an audit outage leaves nothing it could run. The
 * other admins are told as soon as a self-approved row exists, or may exist.
 */
async function startSelfApproved(s: SelfApprovedStart): Promise<NextResponse | "refused"> {
  // 2. Ledger: the request row (same action, so the REVEAL_LIMIT quota and
  // /audit filters count it) plus the distinct self-approval row, in ONE
  // insert statement (both or neither). The reason text stays in
  // reveal_jobs; the ledger carries only its length.
  const { error: auditErr } = await s.svc.from("audit_log").insert([
    auditRow(s.actor, "REVEAL_REQUEST", s.requestDetail),
    auditRow(s.actor, SELF_APPROVED_AUDIT_ACTION, s.ledgerDetail),
  ]);
  if (auditErr) {
    console.error("[reveal/start] self-approval audit insert:", auditErr.message);
    // No job row exists: nothing was created that could run.
    return NextResponse.json(
      { error: "audit log unavailable — the reveal was not started", code: "AUDIT_UNAVAILABLE" },
      { status: 503 },
    );
  }

  // 3. The job, queued and approved by the requester.
  const { data: job, error: jobErr } = await s.svc.from("reveal_jobs").insert(s.row).select("id").single();
  if (jobErr?.code === "42501") {
    // The guard trigger refused the row; the statement rolled back.
    console.warn("[reveal/start] self-approval refused by the database; filing for approval");
    return "refused";
  }
  if (jobErr || !job) return abandonSelfApprovedJob(s, jobErr);

  // 4. A self-approved job exists: a single-person reveal is never silent.
  // Every OTHER admin gets a web push and the ops Telegram chat a message,
  // after the response is sent. Scheduled before anything else can fail.
  announceSelfApproved(s);

  // 5. Kick off the ML decrypt now, exactly like approveRevealAction does
  // after a second admin's approval. A failed trigger leaves the row queued:
  // the durable worker discovers it; the error never undoes the approval.
  try {
    await mlTriggerReveal(job.id);
  } catch (e) {
    const msg = e instanceof MLError ? e.message : "ML service unreachable";
    await s.svc
      .from("reveal_jobs")
      .update({ error_message: `Awaiting worker: ${msg}` })
      .eq("id", job.id)
      .eq("status", "queued");
    await s.svc.from("audit_log").insert(
      auditRow(s.actor, "REVEAL_APPROVE_DEFERRED", `job ${job.id} self-approved (super admin) but ML trigger failed: ${msg}`),
    );
  }

  return NextResponse.json({ job_id: job.id, status: "queued", self_approved: true });
}

function announceSelfApproved(s: SelfApprovedStart, note = ""): void {
  scheduleSecurityEvent({
    action: SELF_APPROVED_AUDIT_ACTION,
    actorId: s.actor.id,
    actorEmail: s.actor.email,
    detail: `${s.ledgerDetail}${note}`,
  });
}

/**
 * The self-approved insert failed after its ledger rows were written.
 *
 * A Postgres SQLSTATE means the statement rolled back: no row, nothing to
 * stop. Without one (network failure, lost response) the row may have been
 * committed — and with its ledger rows in place it could run. It is cancelled
 * while still queued: the claim moves a job out of queued atomically, so a
 * cancelled queued row never decrypted anything. When that cannot be proven —
 * the cancel failed, or no queued row was left (never created, or already
 * claimed) — the other admins are notified and the requester is told the
 * outcome is unconfirmed, never that the reveal did not run.
 */
async function abandonSelfApprovedJob(
  s: SelfApprovedStart,
  jobErr: { code?: string | null; message?: string } | null,
): Promise<NextResponse> {
  console.error("[reveal/start] self-approved job insert:", jobErr?.code || "no code", jobErr?.message ?? "no row returned");
  const failed = () =>
    NextResponse.json({ error: "could not create reveal job", code: "START_FAILED" }, { status: 500 });

  if (isDatabaseVerdict(jobErr)) {
    await writeAudit(s.svc, auditRow(s.actor, SELF_APPROVAL_ABORTED_AUDIT_ACTION,
      `job ${s.jobId} · not created (${jobErr?.code}) · nothing ran`));
    return failed();
  }

  let cancelled = false;
  let cancelNote = "no queued row to cancel";
  try {
    const { data, error } = await s.svc
      .from("reveal_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Creation could not be confirmed — cancelled before it ran; submit the reveal again",
      })
      .eq("id", s.jobId)
      .eq("status", "queued")
      .select("id");
    if (error) cancelNote = `the cancel failed (${error.code || error.message})`;
    else cancelled = (data?.length ?? 0) > 0;
  } catch (e) {
    cancelNote = `the cancel failed (${e instanceof Error ? e.message : "unknown"})`;
  }

  if (cancelled) {
    await writeAudit(s.svc, auditRow(s.actor, SELF_APPROVAL_ABORTED_AUDIT_ACTION,
      `job ${s.jobId} · creation unconfirmed · cancelled while still queued · nothing ran`));
    return failed();
  }

  announceSelfApproved(s, " · creation unconfirmed — it may run; check /jobs");
  await writeAudit(s.svc, auditRow(s.actor, SELF_APPROVAL_ABORTED_AUDIT_ACTION,
    `job ${s.jobId} · creation unconfirmed · ${cancelNote} · it may run; the other admins were notified`));
  return NextResponse.json(
    {
      error: "the reveal job could not be confirmed — check /jobs before submitting again",
      code: REVEAL_START_UNCONFIRMED_CODE,
    },
    { status: 500 },
  );
}

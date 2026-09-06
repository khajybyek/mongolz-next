import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { mlEmbed, MLError } from "@/lib/ml-client";
import { checkRateLimit, REVEAL_LIMIT } from "@/lib/rate-limit";
import type { RevealMethod } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const ctx = auth;

  // Step-up auth шалгах
  if (!(await hasFreshReauth(ctx.user.id))) {
    return NextResponse.json(
      { error: "REAUTH_REQUIRED", message: "Нууц үгээ дахин оруулна уу" },
      { status: 401 }
    );
  }

  // Rate limit: 1 цагт 20 reveal max — нэг админ ч misuse хийхгүй
  const rl = await checkRateLimit(ctx.user.id, REVEAL_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Хэт олон reveal хүсэлт" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  const fd = await request.formData();
  const recording_id = String(fd.get("recording_id") ?? "");
  const method = String(fd.get("method") ?? "") as RevealMethod;
  const rawThreshold = Number(fd.get("threshold") ?? 0.45);
  // Clamp to the DB CHECK range (reveal_jobs_threshold_check: 0.30–0.85) so
  // a crafted value can neither match everything nor trip a 500.
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(0.85, Math.max(0.3, rawThreshold))
    : 0.45;

  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!UUID_RE.test(recording_id) || !["upload", "suspect", "detected_face"].includes(method)) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  // Optional time window — reveal scope-ийг recording-ийн нэг хэсэгт хязгаарлана.
  // Хэрэв start_sec/end_sec хоёулаа байхгүй бол whole recording reveal (хуучин зан төлөв).
  const rawStart = fd.get("start_sec");
  const rawEnd = fd.get("end_sec");
  let target_start_sec: number | null = null;
  let target_end_sec: number | null = null;
  if (rawStart != null && rawEnd != null && String(rawStart) !== "" && String(rawEnd) !== "") {
    const s = Number(rawStart);
    const e = Number(rawEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
      return NextResponse.json(
        { error: "invalid time window — start must be ≥0 and end > start" },
        { status: 400 },
      );
    }
    target_start_sec = s;
    target_end_sec = e;
  }

  // Recording байгаа эсэхийг шалгах + has_original
  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("recordings")
    .select("id, has_original, filename, duration_sec")
    .eq("id", recording_id)
    .single();

  if (!rec) {
    return NextResponse.json({ error: "recording not found" }, { status: 404 });
  }
  if (!rec.has_original) {
    return NextResponse.json(
      { error: "Энэ бичлэгт original үлдээгүй — reveal боломжгүй" },
      { status: 422 }
    );
  }

  // Time window нь recording-ийн duration-аас давсан эсэхийг шалгана.
  // NULL duration_sec → time window-ийг бид баталгаажуулах боломжгүй, тиймээс
  // time-bounded reveal-ийг REJECT хийнэ (whole-recording reveal зөвшөөрнө).
  if (target_end_sec !== null) {
    if (!rec.duration_sec || rec.duration_sec <= 0) {
      return NextResponse.json(
        { error: "Recording-ийн duration тодорхойгүй тул time-bounded reveal боломжгүй" },
        { status: 400 },
      );
    }
    if (target_end_sec > rec.duration_sec + 1) {
      return NextResponse.json(
        { error: `Time window-ийн end (${target_end_sec}s) recording duration-аас давсан байна (${rec.duration_sec}s)` },
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

  const svc = createServiceClient();

  if (method === "upload") {
    const photo = fd.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "missing photo" }, { status: 400 });
    }
    try {
      const buffer = Buffer.from(await photo.arrayBuffer());
      queryEmbeddingSingle = await mlEmbed(buffer);
    } catch (e) {
      const msg = e instanceof MLError ? e.message : "ML service хариулсангүй";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    detail += " · upload";
  } else if (method === "suspect") {
    suspect_id = String(fd.get("suspect_id") ?? "");
    if (!UUID_RE.test(suspect_id)) return NextResponse.json({ error: "missing suspect_id" }, { status: 400 });
    const { data: s } = await svc
      .from("suspects")
      .select("name, embedding")
      .eq("id", suspect_id)
      .single();
    if (!s) return NextResponse.json({ error: "suspect not found" }, { status: 404 });
    queryEmbeddingSingle = s.embedding as unknown as number[];
    detail += ` · suspect=${s.name}`;
  } else if (method === "detected_face") {
    // Шинэ: face_ids[] (олон) — fallback: face_id (нэг)
    const idsRaw = fd.getAll("face_ids").map((v) => String(v)).filter(Boolean);
    const single = String(fd.get("face_id") ?? "").trim();
    const collected = idsRaw.length > 0 ? idsRaw : single ? [single] : [];

    // Дахин давхардуулсныг арилгана + хоосон / буруу id шалгах
    const ids = Array.from(new Set(collected));
    if (ids.length === 0 || ids.length > 50 || !ids.every((i) => UUID_RE.test(i))) {
      return NextResponse.json({ error: "missing or invalid face id(s)" }, { status: 400 });
    }

    // Бүх face-ийн embedding-ийг авах (service-role, RLS bypass)
    const { data: rows, error: facesErr } = await svc
      .from("faces")
      .select("id, filename, embedding")
      .in("id", ids);

    if (facesErr) {
      console.error("[reveal/start] faces lookup:", facesErr.message);
      return NextResponse.json({ error: "could not load faces" }, { status: 500 });
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "face(s) not found" }, { status: 404 });
    }

    // Embedding-уудыг JSON массив болгож хадгална
    queryEmbeddingsMulti = rows.map((r) => r.embedding as unknown as number[]);

    if (rows.length === 1) {
      // Backward-compat: ганц бол хуучин singular талбарыг нөхөж бичнэ
      face_id_single = rows[0].id;
      queryEmbeddingSingle = rows[0].embedding as unknown as number[];
    }
    face_ids_multi = rows.map((r) => r.id);
    detail += ` · faces=${rows.length} (${rows.map((r) => r.filename).join(", ").slice(0, 120)})`;
  }

  // Requester-ийн reveal authority level (ADR 0009). profiles.reveal_level
  // нь шинэ багана тул PublicProfile type-д багтаагүй байж болзошгүй —
  // service client-ээр шууд татна. Default 0 = director (бүгдийг хардаг).
  let reveal_level = 0;
  {
    const { data: prof } = await svc
      .from("profiles")
      .select("reveal_level")
      .eq("id", ctx.user.id)
      .single();
    reveal_level = (prof as { reveal_level?: number } | null)?.reveal_level ?? 0;
  }

  // 1. reveal_jobs row үүсгэх — 4-eyes: ALWAYS pending_approval.
  // The job does NOT run until a SECOND admin approves it via
  // /reveal-approvals (approveRevealAction sets queued + triggers ML). The ML
  // side (reveal_job.run) also refuses any status outside queued/approved/
  // processing, so this gate is enforced at three layers.
  const { data: job, error: jobErr } = await svc
    .from("reveal_jobs")
    .insert({
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
      reveal_level,
      status: "pending_approval",
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    console.error("[reveal/start] job insert:", jobErr?.message);
    return NextResponse.json({ error: "could not create reveal job" }, { status: 500 });
  }

  // 2. Audit — request logged now; the actual decrypt is gated on approval.
  await svc.from("audit_log").insert({
    action: "REVEAL_REQUEST",
    detail: `${detail} · awaiting 4-eyes approval`,
    user_id: ctx.user.id,
    user_email: ctx.user.email,
  });

  // NOTE: ML is intentionally NOT triggered here — see approveRevealAction.
  return NextResponse.json({ job_id: job.id, status: "pending_approval" });
}

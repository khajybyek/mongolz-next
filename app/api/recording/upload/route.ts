import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { isUploadAcknowledged } from "@/lib/recording-upload";

export const runtime = "nodejs";
// Vercel Hobby tier caps function duration at 60 s; any larger value
// is silently ignored. Pinning to 60 makes the limit visible in code
// and lets us bump it to 300 the moment we upgrade to Pro without
// chasing through other files.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const fd = await request.formData();
  const file = fd.get("file");
  const cameraName = String(fd.get("camera_name") ?? "Browser camera");
  // Chunked-session metadata (optional)
  const sessionId = fd.get("session_id");
  const chunkIndexRaw = fd.get("chunk_index");
  const isFinalRaw = fd.get("is_final");
  const isChunk = typeof sessionId === "string" && sessionId.length > 0;
  const chunkIndex = isChunk ? Number(chunkIndexRaw ?? 0) : null;
  const isFinal = String(isFinalRaw ?? "false") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  // A chunked session may close with an empty final marker (the recorder's
  // last buffer had already been flushed); everything else needs bytes.
  if (file.size === 0 && !(isChunk && isFinal)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (isChunk) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId))) {
      return NextResponse.json({ error: "invalid session_id" }, { status: 400 });
    }
    if (!Number.isInteger(chunkIndex) || (chunkIndex as number) < 0 || (chunkIndex as number) >= 400) {
      return NextResponse.json({ error: "invalid chunk_index" }, { status: 400 });
    }
  }

  // Хэт том файл шалгах
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json(
      {
        error:
          "Файл хэтэрхий том (100MB-аас бага байх ёстой). Урт бичлэг бол IP CCTV ашиглана уу.",
      },
      { status: 413 }
    );
  }

  // ML service-руу forward
  const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL;
  const ML_TOKEN = process.env.ML_SERVICE_TOKEN;

  if (!ML_URL || ML_URL.includes("placeholder")) {
    return NextResponse.json(
      {
        error:
          "ML service URL тохируулагдаагүй. Vercel env-д NEXT_PUBLIC_ML_SERVICE_URL-ыг Railway URL-аар шинэчилнэ үү.",
      },
      { status: 503 }
    );
  }
  if (!ML_TOKEN) {
    return NextResponse.json(
      { error: "ML_SERVICE_TOKEN тохируулагдаагүй — admin-аас засуулна уу." },
      { status: 503 }
    );
  }

  // Multipart-ыг ML-руу шууд дамжуулна
  const mlForm = new FormData();
  mlForm.append("file", file, file.name || "recording");
  mlForm.append("camera_name", cameraName.slice(0, 80));
  if (isChunk) {
    mlForm.append("session_id", String(sessionId));
    mlForm.append("chunk_index", String(chunkIndex));
    mlForm.append("is_final", String(isFinal));
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ML_TOKEN}`,
    };

    const res = await fetch(`${ML_URL}/process-upload`, {
      method: "POST",
      headers,
      body: mlForm,
      signal: AbortSignal.timeout(50_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.error ?? `ML алдаа: ${res.status}` },
        { status: res.status }
      );
    }

    if (!isUploadAcknowledged(data, !isChunk || isFinal)) {
      return NextResponse.json({ error: "ML upload acknowledgement missing or invalid" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      status: data.status,
      recording_id: data.recording_id ?? null,
      camera_id: data.camera_id ?? null,
      size_mb: data.size_mb ?? null,
      session_id: isChunk ? sessionId : undefined,
      chunk_index: chunkIndex,
      is_final: isFinal,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? `ML холбогдсонгүй: ${e.message}` : "ML алдаа",
      },
      { status: 502 }
    );
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
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
  if (cameraName) mlForm.append("camera_name", cameraName);
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
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.error ?? `ML алдаа: ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      recording_id: data.recording_id,
      camera_id: data.camera_id,
      size_mb: data.size_mb,
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

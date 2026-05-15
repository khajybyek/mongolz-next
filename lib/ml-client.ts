/**
 * Python ML service client — Modal/Railway/Render-д deploy хийсэн FastAPI.
 *
 * Endpoint-ууд (ml-service/main.py):
 *   POST /embed     — image bytes → 512-dim ArcFace embedding
 *   POST /detect    — image bytes → faces[] (bbox, embedding бүгд)
 *   POST /search    — image bytes → suspects/faces матч
 *   POST /reveal    — recording_id, suspect_id → reveal job
 *   GET  /stream/:camera_id  — HLS playlist
 *   POST /camera/start  — RTSP уншиж эхлэх
 *   POST /camera/stop   — RTSP зогсоох
 */

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "http://localhost:8000";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

class MLError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "MLError";
  }
}

async function mlFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (ML_TOKEN) headers.set("Authorization", `Bearer ${ML_TOKEN}`);

  const res = await fetch(`${ML_URL}${path}`, { ...init, headers, cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MLError(`ML ${path}: ${res.status} ${text.slice(0, 200)}`, res.status);
  }
  return res;
}

/** Зураг → 512-dim embedding */
export async function mlEmbed(image: Buffer | Blob): Promise<number[]> {
  const form = new FormData();
  const blob = image instanceof Blob ? image : new Blob([image as BlobPart]);
  form.append("file", blob, "image.jpg");

  const res = await mlFetch("/embed", { method: "POST", body: form });
  const data = (await res.json()) as { embedding: number[] };

  if (!Array.isArray(data.embedding) || data.embedding.length !== 512) {
    throw new MLError("Invalid embedding response");
  }
  return data.embedding;
}

/** Зураг доторх бүх нүүр илрүүлэх */
export interface DetectedFace {
  bbox: [number, number, number, number];
  confidence: number;
  embedding: number[];
}
export async function mlDetect(image: Buffer | Blob): Promise<DetectedFace[]> {
  const form = new FormData();
  const blob = image instanceof Blob ? image : new Blob([image as BlobPart]);
  form.append("file", blob, "image.jpg");

  const res = await mlFetch("/detect", { method: "POST", body: form });
  const data = (await res.json()) as { faces: DetectedFace[] };
  return data.faces ?? [];
}

/** Камер RTSP-г унших ажил эхлүүлэх */
export async function mlStartCamera(cameraId: string, rtspUrl: string): Promise<void> {
  await mlFetch("/camera/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_id: cameraId, url: rtspUrl }),
  });
}

export async function mlStopCamera(cameraId: string): Promise<void> {
  await mlFetch("/camera/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_id: cameraId }),
  });
}

/** Reveal job-ийг ML service-руу trigger хийнэ. job_id өмнө нь DB-д үүссэн байна. */
export async function mlTriggerReveal(jobId: string): Promise<void> {
  await mlFetch("/reveal/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });
}

export function isMlAvailable(): boolean {
  return Boolean(ML_URL);
}

/** HLS playlist URL — <video> tag-д шууд тавьж болно */
export function mlStreamUrl(cameraId: string): string {
  return `/api/ml/stream/${encodeURIComponent(cameraId)}/index.m3u8`;
}

export { MLError };

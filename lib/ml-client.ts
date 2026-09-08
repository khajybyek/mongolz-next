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

  const timeout = AbortSignal.timeout(15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const res = await fetch(`${ML_URL}${path}`, { ...init, headers, signal, cache: "no-store" });

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
export async function mlStartCamera(cameraId: string, rtspUrl: string, cameraName?: string | null): Promise<void> {
  await mlFetch("/camera/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camera_id: cameraId,
      url: rtspUrl,
      ...(cameraName ? { camera_name: cameraName } : {}),
    }),
  });
}

export async function mlStopCamera(cameraId: string): Promise<void> {
  await mlFetch("/camera/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_id: cameraId }),
  });
}

export interface ActiveCamera {
  camera_id: string;
  camera_name: string | null;
  started_at: string | null;
  fps: number | null;
  /** Supervisor restarts since the session was first started (ML ≥ 2026-09-07). */
  restart_count?: number | null;
  last_error?: string | null;
}

/**
 * Cameras the ML service is currently capturing (HLS playable). Resolves to
 * `null` when the service is unreachable so callers can distinguish "nothing
 * streaming" from "ML down".
 */
export async function mlActiveCameras(): Promise<ActiveCamera[] | null> {
  try {
    const res = await mlFetch("/camera/active");
    const data = (await res.json()) as { cameras?: ActiveCamera[] };
    return Array.isArray(data.cameras) ? data.cameras : [];
  } catch {
    return null;
  }
}

/**
 * Quick reachability probe — admin-аас камер нэмэх/засах үед URL хүрэх
 * эсэхийг шалгахад. ML side timeout ~8s. Үргэлж resolved JSON буцаана
 * (200-аас өөр статусыг ML side-ээс гаргадаггүй, no-throw гэрээгээр UI
 * нь { ok: false, error } гэдэг payload-оор алдааг харуулна).
 */
export interface CameraTestResult {
  ok: boolean;
  error?: string;
  info?: { width: number; height: number; fps: number };
}

export async function mlTestCamera(
  url: string,
  camType: string,
): Promise<CameraTestResult> {
  try {
    const res = await mlFetch("/camera/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, cam_type: camType }),
    });
    return (await res.json()) as CameraTestResult;
  } catch (e) {
    const msg = e instanceof MLError ? `ML ${e.status ?? ""}`.trim() : "ML холбогдсонгүй";
    return { ok: false, error: msg };
  }
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

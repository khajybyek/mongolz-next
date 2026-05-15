import * as ort from "onnxruntime-web";

export interface DetectedFace {
  bbox: [number, number, number, number];
  confidence: number;
}

export type InferenceBackend = "webgpu" | "wasm";

interface DetectorState {
  session: ort.InferenceSession | null;
  backend: InferenceBackend;
  initPromise: Promise<InferenceBackend> | null;
  modelUrl: string | null;
}

const state: DetectorState = {
  session: null,
  backend: "wasm",
  initPromise: null,
  modelUrl: null,
};

async function createSession(modelUrl: string, backend: InferenceBackend): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelUrl, { executionProviders: [backend] });
}

export async function initDetector(
  modelUrl: string,
  preferredBackend: InferenceBackend = "webgpu",
): Promise<InferenceBackend> {
  if (state.session) return state.backend;
  if (state.initPromise) return state.initPromise;

  state.modelUrl = modelUrl;
  state.initPromise = (async () => {
    try {
      const backendToTry: InferenceBackend[] =
        preferredBackend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];

      for (const backend of backendToTry) {
        try {
          state.session = await createSession(modelUrl, backend);
          state.backend = backend;
          return backend;
        } catch {
          continue;
        }
      }

      throw new Error("No supported inference backend available");
    } finally {
      state.initPromise = null;
    }
  })();

  return state.initPromise;
}

async function fallbackToWasm(): Promise<void> {
  if (state.backend === "wasm" || !state.modelUrl) return;
  if (state.session) {
    try { await state.session.release(); } catch { /* ignore */ }
    state.session = null;
  }
  state.session = await createSession(state.modelUrl, "wasm");
  state.backend = "wasm";
}

function isKernelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("kernel") || msg.includes("webgpu") || msg.includes("output[");
}

export function isReady(): boolean {
  return state.session !== null;
}

export function getBackend(): InferenceBackend {
  return state.backend;
}

// UltraFace-RFB-320 expects a 320 x 240 (W x H) image in NCHW float32.
// Outputs: scores [1, N, 2]  (background, face) and boxes [1, N, 4] in normalized [0,1].
const INPUT_W = 320;
const INPUT_H = 240;

export async function detectFaces(
  imageData: ImageData,
  confidenceThreshold = 0.5,
): Promise<DetectedFace[]> {
  if (!state.session) throw new Error("Detector not initialized");

  const { width: imgW, height: imgH } = imageData;

  const canvas = new OffscreenCanvas(INPUT_W, INPUT_H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2d context");

  const bitmap = await createImageBitmap(imageData);
  try {
    ctx.drawImage(bitmap, 0, 0, INPUT_W, INPUT_H);
  } finally {
    bitmap.close();
  }
  const resized = ctx.getImageData(0, 0, INPUT_W, INPUT_H);

  const planeSize = INPUT_W * INPUT_H;
  const float32Data = new Float32Array(3 * planeSize);
  // UltraFace normalization: (px - 127) / 128
  for (let i = 0; i < planeSize; i++) {
    float32Data[i] = (resized.data[i * 4] - 127) / 128;
    float32Data[planeSize + i] = (resized.data[i * 4 + 1] - 127) / 128;
    float32Data[2 * planeSize + i] = (resized.data[i * 4 + 2] - 127) / 128;
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, INPUT_H, INPUT_W]);
  let results: ort.InferenceSession.OnnxValueMapType;
  try {
    const inputName = state.session.inputNames[0] ?? "input";
    results = await state.session.run({ [inputName]: inputTensor });
  } catch (err) {
    if (state.backend === "webgpu" && isKernelError(err) && state.modelUrl) {
      console.warn("[face-detector] WebGPU kernel failed, falling back to WASM:", err);
      await fallbackToWasm();
      const inputName = state.session.inputNames[0] ?? "input";
      results = await state.session.run({ [inputName]: inputTensor });
    } else {
      throw err;
    }
  }

  // Find scores (last dim=2) and boxes (last dim=4) by tensor shape, not index order.
  let scoresTensor: ort.Tensor | undefined;
  let boxesTensor: ort.Tensor | undefined;
  for (const key of Object.keys(results)) {
    const t = results[key];
    const lastDim = t.dims[t.dims.length - 1];
    if (lastDim === 2) scoresTensor = t;
    else if (lastDim === 4) boxesTensor = t;
  }
  if (!scoresTensor || !boxesTensor) return [];

  const scores = scoresTensor.data as Float32Array;
  const boxes = boxesTensor.data as Float32Array;
  const numBoxes = scores.length / 2;

  const faces: DetectedFace[] = [];
  for (let i = 0; i < numBoxes; i++) {
    const confidence = scores[i * 2 + 1];
    if (confidence < confidenceThreshold) continue;
    // Boxes are normalized [0,1]; scale to source image dims.
    const x1 = Math.round(boxes[i * 4] * imgW);
    const y1 = Math.round(boxes[i * 4 + 1] * imgH);
    const x2 = Math.round(boxes[i * 4 + 2] * imgW);
    const y2 = Math.round(boxes[i * 4 + 3] * imgH);
    faces.push({ bbox: [x1, y1, x2, y2], confidence: Number(confidence) });
  }

  return nms(faces, 0.4);
}

function nms(faces: DetectedFace[], iouThreshold: number): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedFace[] = [];

  for (const face of sorted) {
    let suppress = false;
    for (const kept_face of kept) {
      if (computeIoU(face.bbox, kept_face.bbox) > iouThreshold) {
        suppress = true;
        break;
      }
    }
    if (!suppress) kept.push(face);
  }

  return kept;
}

function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

export async function dispose(): Promise<void> {
  if (state.initPromise) {
    try { await state.initPromise; } catch { /* ignore */ }
  }
  if (state.session) {
    await state.session.release();
    state.session = null;
  }
  state.initPromise = null;
}

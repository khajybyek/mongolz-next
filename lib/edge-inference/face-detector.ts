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
}

const state: DetectorState = {
  session: null,
  backend: "wasm",
  initPromise: null,
};

export async function initDetector(
  modelUrl: string,
  preferredBackend: InferenceBackend = "webgpu",
): Promise<InferenceBackend> {
  if (state.session) return state.backend;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    try {
      const backendToTry: InferenceBackend[] =
        preferredBackend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];

      for (const backend of backendToTry) {
        try {
          state.session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: [backend],
          });
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

export function isReady(): boolean {
  return state.session !== null;
}

export function getBackend(): InferenceBackend {
  return state.backend;
}

export async function detectFaces(
  imageData: ImageData,
  confidenceThreshold = 0.5,
): Promise<DetectedFace[]> {
  if (!state.session) throw new Error("Detector not initialized");

  const { width, height } = imageData;
  const inputSize = 320;

  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2d context");

  const bitmap = await createImageBitmap(imageData);
  try {
    ctx.drawImage(bitmap, 0, 0, inputSize, inputSize);
  } finally {
    bitmap.close();
  }
  const resized = ctx.getImageData(0, 0, inputSize, inputSize);

  const float32Data = new Float32Array(3 * inputSize * inputSize);
  const mean = [127, 127, 127];
  for (let i = 0; i < inputSize * inputSize; i++) {
    float32Data[i] = (resized.data[i * 4] - mean[0]) / 128;
    float32Data[inputSize * inputSize + i] = (resized.data[i * 4 + 1] - mean[1]) / 128;
    float32Data[2 * inputSize * inputSize + i] = (resized.data[i * 4 + 2] - mean[2]) / 128;
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, inputSize, inputSize]);
  const results = await state.session.run({ input: inputTensor });

  const faces: DetectedFace[] = [];
  const outputNames = Object.keys(results);

  if (outputNames.length >= 2) {
    const scores = results[outputNames[0]].data as Float32Array;
    const boxes = results[outputNames[1]].data as Float32Array;

    const scaleX = width / inputSize;
    const scaleY = height / inputSize;

    for (let i = 0; i < scores.length / 2; i++) {
      const confidence = scores[i * 2 + 1];
      if (confidence > confidenceThreshold) {
        const x1 = Math.round(boxes[i * 4] * scaleX);
        const y1 = Math.round(boxes[i * 4 + 1] * scaleY);
        const x2 = Math.round(boxes[i * 4 + 2] * scaleX);
        const y2 = Math.round(boxes[i * 4 + 3] * scaleY);
        faces.push({ bbox: [x1, y1, x2, y2], confidence: Number(confidence) });
      }
    }
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

import { useCallback, useRef, useState } from "react";
import type { DetectedFace, InferenceBackend } from "./face-detector";

interface EdgeDetectorState {
  ready: boolean;
  backend: InferenceBackend | null;
  loading: boolean;
  error: string | null;
  missingModel: boolean;
  lastInferenceMs: number | null;
}

export function useEdgeDetector(modelUrl = "/models/face_detect.onnx") {
  const [state, setState] = useState<EdgeDetectorState>({
    ready: false,
    backend: null,
    loading: false,
    error: null,
    missingModel: false,
    lastInferenceMs: null,
  });
  const detectorRef = useRef<typeof import("./face-detector") | null>(null);

  const init = useCallback(
    async (preferWebGPU = true) => {
      setState((s) => ({ ...s, loading: true, error: null, missingModel: false }));
      try {
        const head = await fetch(modelUrl, { method: "HEAD" });
        if (!head.ok) {
          setState((s) => ({
            ...s,
            loading: false,
            missingModel: true,
            error: `Model not found at ${modelUrl} (HTTP ${head.status})`,
          }));
          return;
        }

        const detector = await import("./face-detector");
        detectorRef.current = detector;
        const backend = await detector.initDetector(
          modelUrl,
          preferWebGPU ? "webgpu" : "wasm",
        );
        setState({
          ready: true,
          backend,
          loading: false,
          error: null,
          missingModel: false,
          lastInferenceMs: null,
        });
      } catch (e) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : "Init failed",
        }));
      }
    },
    [modelUrl],
  );

  const detect = useCallback(async (imageData: ImageData, threshold = 0.5): Promise<DetectedFace[]> => {
    if (!detectorRef.current) throw new Error("Not initialized");
    const start = performance.now();
    const faces = await detectorRef.current.detectFaces(imageData, threshold);
    setState((s) => ({ ...s, lastInferenceMs: Math.round(performance.now() - start) }));
    return faces;
  }, []);

  const cleanup = useCallback(async () => {
    if (detectorRef.current) {
      await detectorRef.current.dispose();
      detectorRef.current = null;
      setState({
        ready: false,
        backend: null,
        loading: false,
        error: null,
        missingModel: false,
        lastInferenceMs: null,
      });
    }
  }, []);

  return { ...state, init, detect, cleanup };
}

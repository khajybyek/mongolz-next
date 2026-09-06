"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Cpu, Upload, Loader2, Zap, AlertTriangle } from "lucide-react";
import { useEdgeDetector } from "@/lib/edge-inference/use-edge-detector";
import type { DetectedFace } from "@/lib/edge-inference/face-detector";

export function EdgeDetectView() {
  const { ready, backend, loading, error, missingModel, lastInferenceMs, init, detect, cleanup } =
    useEdgeDetector();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const [processing, setProcessing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  const handleInit = useCallback(
    async (webgpu: boolean) => {
      await init(webgpu);
    },
    [init],
  );

  const [inferenceError, setInferenceError] = useState<string | null>(null);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !ready) return;

      setProcessing(true);
      setInferenceError(null);
      setFaces([]);

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onerror = () => {
        setInferenceError("Failed to load image file");
        setProcessing(false);
        URL.revokeObjectURL(objectUrl);
      };

      img.onload = async () => {
        try {
          const canvas = canvasRef.current;
          if (!canvas) throw new Error("Canvas not available");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("2D context not available");
          ctx.drawImage(img, 0, 0);
          setImageLoaded(true);

          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const detectedFaces = await detect(imageData);
          setFaces(detectedFaces);

          ctx.drawImage(img, 0, 0);
          for (const face of detectedFaces) {
            const [x1, y1, x2, y2] = face.bbox;
            ctx.strokeStyle = "#3b82f6";
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

            ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
            ctx.font = "14px monospace";
            ctx.fillText(`${(face.confidence * 100).toFixed(1)}%`, x1, y1 - 4);
          }
        } catch (err) {
          setInferenceError(err instanceof Error ? err.message : "Inference failed");
        } finally {
          setProcessing(false);
          URL.revokeObjectURL(objectUrl);
        }
      };

      img.src = objectUrl;
    },
    [ready, detect],
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-3">
        <h3 className="section-title flex items-center gap-2">
          <Cpu className="w-4 h-4 text-accent" />
          Inference Engine
        </h3>

        {!ready ? (
          <div className="flex gap-2">
            <button
              onClick={() => handleInit(true)}
              disabled={loading}
              className="btn-primary"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Init WebGPU
            </button>
            <button
              onClick={() => handleInit(false)}
              disabled={loading}
              className="btn-ghost"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5" />}
              Init WASM
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-xs">
            <span className="badge bg-success/15 text-success">Ready</span>
            <span className="text-text-soft">
              Backend: <span className="text-text font-mono">{backend}</span>
            </span>
            {lastInferenceMs !== null && (
              <span className="text-text-soft">
                Last: <span className="text-text font-mono">{lastInferenceMs}ms</span>
              </span>
            )}
          </div>
        )}

        {missingModel ? (
          <div className="bg-warning/10 border border-warning/20 rounded-md px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-warning font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              Face detection model not deployed
            </div>
            <p className="text-xs text-text-soft leading-relaxed">
              This page needs an ONNX face-detection model at <code className="font-mono text-text-soft">public/models/face_detect.onnx</code>.
              Drop a compatible model (e.g.{" "}
              <a
                href="https://github.com/onnx/models/tree/main/validated/vision/body_analysis/ultraface"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                UltraFace-RFB-320
              </a>
              ) into that directory and redeploy.
            </p>
          </div>
        ) : error ? (
          <div className="text-xs text-danger bg-danger/10 rounded-md px-3 py-2">{error}</div>
        ) : null}
      </div>

      {ready && (
        <div className="card space-y-3">
          <label className="btn-secondary">
            <Upload className="w-4 h-4" />
            Upload image for detection
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
              disabled={processing}
            />
          </label>

          {processing && (
            <div className="flex items-center gap-2 text-xs text-text-soft">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Running inference...
            </div>
          )}

          {inferenceError && !processing && (
            <div className="text-xs text-danger bg-danger/10 rounded-md px-3 py-2">
              {inferenceError}
            </div>
          )}

          <canvas
            ref={canvasRef}
            className={`w-full rounded-lg bg-black ${imageLoaded ? "" : "hidden"}`}
          />

          {faces.length > 0 && (
            <div className="text-xs text-text-soft">
              Detected <span className="text-text font-medium">{faces.length}</span> face{faces.length !== 1 && "s"}
              {lastInferenceMs !== null && (
                <> in <span className="text-text font-mono">{lastInferenceMs}ms</span></>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card bg-accent/5 border border-accent/20 text-xs text-text-soft leading-relaxed space-y-2">
        <p>
          <strong className="text-text-soft">WebGPU</strong> uses the GPU for inference — fastest on
          supported browsers (Chrome 113+). Falls back to <strong className="text-text-soft">WASM</strong> for
          universal compatibility.
        </p>
        <p>
          Edge inference runs entirely in your browser. No image data is sent to any server
          until you explicitly choose to upload or process further.
        </p>
      </div>
    </div>
  );
}

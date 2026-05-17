"use client";

import { useState } from "react";
import { Upload, BarChart3, Loader2, AlertTriangle } from "lucide-react";

type Tab = "detection" | "blur" | "system";

interface DetectionResult {
  predicted_count: number;
  gt_count: number;
  metrics: {
    tp: number;
    fp: number;
    fn: number;
    precision: number;
    recall: number;
    f1: number;
    fpr: number;
  };
}

interface BlurResult {
  face_count: number;
  ssim_per_face: number[];
  ssim_mean: number;
  blur_effectiveness: number;
}

interface SystemInfo {
  engine: { model: string; embedding_dim: number } | null;
  thresholds: Record<string, number>;
  active_cameras: number;
}

export function EvalDashboard() {
  const [tab, setTab] = useState<Tab>("detection");

  return (
    <div className="space-y-4">
      <div className="card flex gap-2 p-2 w-fit">
        {(["detection", "blur", "system"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              tab === t ? "bg-accent/15 text-accent" : "text-text-soft hover:bg-white/5"
            }`}
          >
            {t === "detection" ? "Detection F1" : t === "blur" ? "Blur SSIM" : "System"}
          </button>
        ))}
      </div>

      {tab === "detection" && <DetectionEval />}
      {tab === "blur" && <BlurEval />}
      {tab === "system" && <SystemEval />}
    </div>
  );
}

function DetectionEval() {
  const [file, setFile] = useState<File | null>(null);
  const [gtBoxes, setGtBoxes] = useState("[]");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("gt_boxes", gtBoxes);
      const res = await fetch("/api/eval/detection", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-text-soft">Detection Accuracy Test</h3>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
        />
        <div>
          <label className="text-xs text-text-soft mb-1 block">
            Ground Truth Boxes (JSON: [[x1,y1,x2,y2], ...])
          </label>
          <textarea
            value={gtBoxes}
            onChange={(e) => setGtBoxes(e.target.value)}
            className="input font-mono text-xs"
            rows={3}
          />
        </div>
        <button onClick={run} disabled={!file || loading} className="btn-primary w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Run Detection Eval
        </button>
        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-text-soft flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Results
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Precision" value={result.metrics.precision} color="accent" />
            <MetricCard label="Recall" value={result.metrics.recall} color="accent" />
            <MetricCard label="F1 Score" value={result.metrics.f1} color="success" />
            <MetricCard label="FPR" value={result.metrics.fpr} color="danger" />
          </div>
          <div className="text-xs text-text-muted space-y-1">
            <div>Predicted: {result.predicted_count} faces | GT: {result.gt_count} faces</div>
            <div>TP: {result.metrics.tp} | FP: {result.metrics.fp} | FN: {result.metrics.fn}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function BlurEval() {
  const [original, setOriginal] = useState<File | null>(null);
  const [blurred, setBlurred] = useState<File | null>(null);
  const [result, setResult] = useState<BlurResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!original || !blurred) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("original", original);
      fd.append("blurred", blurred);
      const res = await fetch("/api/eval/blur", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-text-soft">Blur Quality (SSIM)</h3>
        <div>
          <label className="text-xs text-text-soft mb-1 block">Original Image</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setOriginal(e.target.files?.[0] ?? null)}
            className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
          />
        </div>
        <div>
          <label className="text-xs text-text-soft mb-1 block">Blurred Image</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setBlurred(e.target.files?.[0] ?? null)}
            className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
          />
        </div>
        <button onClick={run} disabled={!original || !blurred || loading} className="btn-primary w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Run Blur Eval
        </button>
        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-text-soft flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Blur Quality Results
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="SSIM Mean" value={result.ssim_mean} color="accent" />
            <MetricCard label="Blur Effectiveness" value={result.blur_effectiveness} color="success" />
          </div>
          <div className="text-xs text-text-muted">
            Faces detected: {result.face_count}
          </div>
          {result.ssim_per_face.length > 0 && (
            <div className="text-xs text-text-soft space-y-1">
              {result.ssim_per_face.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span>Face #{i + 1}:</span>
                  <div className="flex-1 h-2 bg-bg-tertiary rounded overflow-hidden">
                    <div
                      className="h-full bg-accent rounded"
                      style={{ width: `${(1 - s) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono w-14 text-right">{(1 - s).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SystemEval() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/eval/system");
      if (res.ok) setInfo(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-text-soft">System Info & Thresholds</h3>
      <button onClick={load} disabled={loading} className="btn-primary">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
        Load System Info
      </button>

      {info && (
        <div className="space-y-3">
          {info.engine && (
            <div className="text-xs text-text-soft">
              Model: <span className="text-text">{info.engine.model}</span> |
              Embedding dim: <span className="text-text">{info.engine.embedding_dim}</span> |
              Active cameras: <span className="text-text">{info.active_cameras}</span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(info.thresholds).map(([key, val]) => (
              <div key={key} className="bg-bg-tertiary rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
                  {key.replace(/_/g, " ")}
                </div>
                <div className="text-lg font-bold text-text">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="bg-bg-tertiary rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</div>
      <div className={`text-2xl font-bold text-${color}`}>{pct}%</div>
      <div className="h-1.5 bg-black/30 rounded mt-2 overflow-hidden">
        <div className={`h-full bg-${color} rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

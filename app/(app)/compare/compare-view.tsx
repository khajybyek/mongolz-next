"use client";

import { useState, useRef } from "react";
import { Upload, Loader2 } from "lucide-react";

type Algorithm = "cubist" | "gaussian" | "pixelate";

interface CompareResult {
  algorithm: Algorithm;
  processing_ms: number;
  faces_found: number;
  ssim: number;
  image_b64: string;
}

export function CompareView() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function handleFile(f: File | null) {
    setFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
    setResults([]);
  }

  async function runCompare() {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/eval/compare", { method: "POST", body: fd });
      if (!res.ok) throw new Error("ML error");
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
        />
        <button onClick={runCompare} disabled={!file || loading} className="btn-primary">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Compare Algorithms
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Original */}
        {preview && (
          <div className="card p-0 overflow-hidden">
            <div className="text-xs uppercase tracking-wide text-neutral-400 px-3 py-2 bg-bg-tertiary">
              Original
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="original" className="w-full" />
          </div>
        )}

        {results.map((r) => (
          <div key={r.algorithm} className="card p-0 overflow-hidden">
            <div className="text-xs uppercase tracking-wide text-neutral-400 px-3 py-2 bg-bg-tertiary flex justify-between">
              <span>{r.algorithm}</span>
              <span className="text-neutral-500">{r.processing_ms}ms</span>
            </div>
            {r.image_b64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/jpeg;base64,${r.image_b64}`} alt={r.algorithm} className="w-full" />
            ) : (
              <div className="aspect-video bg-bg-tertiary flex items-center justify-center text-xs text-neutral-500">
                No result
              </div>
            )}
            <div className="px-3 py-2 text-xs text-neutral-400 flex justify-between">
              <span>SSIM: {r.ssim.toFixed(3)}</span>
              <span>Blur: {((1 - r.ssim) * 100).toFixed(0)}%</span>
              <span>{r.faces_found} faces</span>
            </div>
          </div>
        ))}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import {
  Upload,
  Loader2,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
  Boxes,
  Waves,
  Trash2,
} from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { Alert } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

type Algorithm = "cubist" | "gaussian" | "pixelate";

interface CompareResult {
  algorithm: Algorithm;
  processing_ms: number;
  faces_found: number;
  ssim: number;
  image_b64: string;
}

const ALG_META: Record<Algorithm, { icon: typeof Boxes; label: string; tone: string }> = {
  cubist: { icon: Sparkles, label: "Cubist Mosaic", tone: "text-accent" },
  gaussian: { icon: Waves, label: "Gaussian Blur", tone: "text-info" },
  pixelate: { icon: Boxes, label: "Pixelate", tone: "text-warning" },
};

export function CompareView() {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setError(null);
    setResults([]);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  }

  async function runCompare() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/eval/compare", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `ML error (${res.status})`);
      }
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("compare_ml_err"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const winner = results.length
    ? results.reduce((a, b) => (b.ssim < a.ssim ? b : a))
    : null;

  return (
    <div className="space-y-5">
      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative rounded-2xl border-2 border-dashed transition-colors ${
          dragging
            ? "border-accent bg-accent/5"
            : "border-border-strong bg-surface hover:border-white/20"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="px-6 py-10 flex flex-col items-center text-center pointer-events-none">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 text-accent inline-flex items-center justify-center mb-3">
            <Upload className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-text">
            {file ? file.name : t("compare_drop_here")}
          </p>
          <p className="text-2xs text-text-muted mt-1">
            {t("compare_drop_hint")}
          </p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={runCompare}
          disabled={!file || loading}
          className="btn-primary"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {t("compare_run_btn")}
        </button>
        {file && !loading && (
          <button
            onClick={() => {
              handleFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="btn-ghost btn-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("compare_clear")}
          </button>
        )}
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {/* Side-by-side grid */}
      {preview ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ImageCard
            label={t("compare_original")}
            tone="text-text"
            src={preview}
            statsLine={t("compare_no_mask")}
          />
          {results.map((r) => {
            const meta = ALG_META[r.algorithm];
            const Icon = meta.icon;
            const isWinner = winner?.algorithm === r.algorithm;
            return (
              <div
                key={r.algorithm}
                className={`card p-0 overflow-hidden ${
                  isWinner ? "card-glow ring-1 ring-accent/40" : ""
                }`}
              >
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface-elevated/40">
                  <span className={`text-2xs uppercase tracking-wider font-semibold inline-flex items-center gap-1.5 ${meta.tone}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                  {isWinner && (
                    <span className="badge-accent">
                      <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                      {t("compare_winner")}
                    </span>
                  )}
                </div>
                {r.image_b64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/jpeg;base64,${r.image_b64}`}
                    alt={r.algorithm}
                    className="w-full block"
                  />
                ) : (
                  <div className="aspect-video bg-surface-elevated flex items-center justify-center text-xs text-text-muted">
                    {t("compare_no_result")}
                  </div>
                )}
                <div className="px-4 py-3 grid grid-cols-3 gap-2 text-2xs">
                  <Stat
                    label={t("compare_ssim")}
                    value={r.ssim.toFixed(3)}
                    hint={t("compare_ssim_hint")}
                  />
                  <Stat
                    label={t("compare_obscure")}
                    value={`${((1 - r.ssim) * 100).toFixed(0)}%`}
                  />
                  <Stat
                    label={t("compare_faces_found")}
                    value={`${r.faces_found}`}
                  />
                </div>
                <div className="px-4 pb-3 text-2xs text-text-muted text-right tabular-nums">
                  {r.processing_ms} ms
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          message={t("compare_empty_title")}
          description={t("compare_empty_desc")}
          icon={ImageIcon}
        />
      )}

      {/* Methodology note */}
      {results.length > 0 && (
        <div className="card bg-gradient-radial-accent">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold tracking-tight">
                {t("compare_methodology_title")}
              </h4>
              <p className="text-xs text-text-soft mt-1.5 leading-relaxed text-balance">
                {t("compare_methodology_body")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageCard({
  label,
  src,
  statsLine,
}: {
  label: string;
  tone?: string;
  src: string;
  statsLine: string;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface-elevated/40">
        <span className="text-2xs uppercase tracking-wider font-semibold text-text-soft">
          {label}
        </span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="w-full block" />
      <div className="px-4 py-3 text-2xs text-text-muted">{statsLine}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-text">{value}</div>
      {hint && <div className="text-[10px] text-text-faint">{hint}</div>}
    </div>
  );
}

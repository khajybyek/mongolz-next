"use client";

import { useRef, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Upload,
  Loader2,
  Layers,
  RefreshCcw,
} from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import { Empty } from "@/components/ui/empty";
import { useT } from "@/lib/i18n/client";

type Tab = "antispoof" | "fusion";

interface SpoofResp {
  spoof_score?: number;
  is_spoof?: boolean;
  laplacian?: { score: number; variance: number };
  color?: { score: number; variance: number };
  frequency?: { score: number; ratio: number };
  error?: string;
}

interface FuseResp {
  embedding?: number[];
  strategy?: string;
  frame_count?: number;
  similarity_to_first?: number;
  error?: string;
}

export function MlLabView() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("antispoof");

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "antispoof", label: t("ml_lab_tab_antispoof") },
          { value: "fusion", label: t("ml_lab_tab_fusion") },
        ]}
      />
      {tab === "antispoof" ? <AntiSpoofPanel /> : <FusionPanel />}
    </div>
  );
}

function AntiSpoofPanel() {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpoofResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setResult(null);
    setError(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function run() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ml/anti-spoof", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("compare_ml_err"));
    } finally {
      setLoading(false);
    }
  }

  const verdict = result
    ? result.is_spoof === true
      ? "spoof"
      : "live"
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* Drop zone */}
      <div className="card p-0 overflow-hidden">
        <div
          onClick={() => inputRef.current?.click()}
          className="aspect-video bg-surface-elevated flex items-center justify-center cursor-pointer relative"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="upload" className="max-h-full max-w-full" />
          ) : (
            <div className="text-center px-6">
              <Upload className="w-10 h-10 mx-auto text-text-muted mb-2" />
              <div className="text-sm text-text-soft">{t("ml_lab_drop")}</div>
              <div className="text-2xs text-text-muted mt-1">{t("ml_lab_drop_hint")}</div>
            </div>
          )}
        </div>
        <div className="px-4 py-3 flex items-center gap-2">
          <button
            onClick={run}
            disabled={!file || loading}
            className="btn-primary btn-sm"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
            {t("ml_lab_run_antispoof")}
          </button>
          {file && (
            <button
              onClick={() => {
                pick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="btn-ghost btn-sm"
            >
              {t("compare_clear")}
            </button>
          )}
        </div>
      </div>

      {/* Result panel */}
      <div className="space-y-3">
        {error && <Alert variant="danger">{error}</Alert>}

        {!result && !error && (
          <Empty message={t("ml_lab_no_result")} description={t("ml_lab_no_result_desc")} icon={ShieldCheck} />
        )}

        {result && (
          <>
            <div
              className={`card ${
                verdict === "spoof"
                  ? "border-danger/40 bg-danger-soft"
                  : "border-success/40 bg-success-soft"
              }`}
            >
              <div className="flex items-center gap-2">
                {verdict === "spoof" ? (
                  <ShieldAlert className="w-5 h-5 text-danger" />
                ) : (
                  <ShieldCheck className="w-5 h-5 text-success" />
                )}
                <h3
                  className={`text-base font-semibold ${
                    verdict === "spoof" ? "text-danger" : "text-success"
                  }`}
                >
                  {verdict === "spoof"
                    ? t("ml_lab_verdict_spoof")
                    : t("ml_lab_verdict_live")}
                </h3>
              </div>
              <div className="text-2xs text-text-muted mt-2">
                {t("ml_lab_spoof_score")} ·{" "}
                <span className="font-mono">
                  {(result.spoof_score ?? 0).toFixed(3)}
                </span>{" "}
                / 1.000
              </div>
            </div>

            <ScoreRow
              label={t("ml_lab_laplacian")}
              hint={t("ml_lab_laplacian_hint")}
              score={result.laplacian?.score ?? 0}
              extra={result.laplacian ? `var=${result.laplacian.variance.toFixed(1)}` : null}
            />
            <ScoreRow
              label={t("ml_lab_color")}
              hint={t("ml_lab_color_hint")}
              score={result.color?.score ?? 0}
              extra={result.color ? `σ²=${result.color.variance.toFixed(1)}` : null}
            />
            <ScoreRow
              label={t("ml_lab_frequency")}
              hint={t("ml_lab_frequency_hint")}
              score={result.frequency?.score ?? 0}
              extra={result.frequency ? `ratio=${result.frequency.ratio.toFixed(3)}` : null}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  hint,
  score,
  extra,
}: {
  label: string;
  hint: string;
  score: number;
  extra: string | null;
}) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-text">{label}</span>
        <span className="text-2xs text-text-muted font-mono">{score.toFixed(3)}</span>
      </div>
      <div className="text-2xs text-text-muted mb-2">{hint}</div>
      <div className="h-1.5 rounded-full bg-surface-elevated overflow-hidden">
        <div
          className="h-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      {extra && (
        <div className="text-2xs text-text-faint mt-1.5 font-mono">{extra}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Embedding fusion demo (synthetic frames so we don't need a live camera)
// ────────────────────────────────────────────────────

function randomEmbedding(seed: number, noise: number): number[] {
  const out: number[] = new Array(512);
  let s = seed;
  for (let i = 0; i < 512; i++) {
    s = (s * 9301 + 49297) % 233280;
    out[i] = (s / 233280 - 0.5) + (Math.random() - 0.5) * noise;
  }
  // L2 normalize
  let n = 0;
  for (const v of out) n += v * v;
  n = Math.sqrt(n) || 1;
  return out.map((v) => v / n);
}

function FusionPanel() {
  const { t } = useT();
  const [frameCount, setFrameCount] = useState(5);
  const [noise, setNoise] = useState(0.15);
  const [strategy, setStrategy] = useState<"weighted_mean" | "median">("weighted_mean");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FuseResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const frames = Array.from({ length: frameCount }).map((_, i) => ({
        embedding: randomEmbedding(1000 + i, noise),
        // Higher quality on middle frames (simulates a real recording)
        quality: 0.5 + 0.5 * Math.cos(((i - frameCount / 2) / frameCount) * Math.PI),
      }));
      const res = await fetch("/api/ml/fuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames, strategy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("compare_ml_err"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="card space-y-5">
        <div>
          <h3 className="text-sm font-semibold mb-1">{t("ml_lab_fusion_sim_title")}</h3>
          <p className="text-2xs text-text-muted">{t("ml_lab_fusion_sim_desc")}</p>
        </div>

        <div>
          <label className="label">
            {t("ml_lab_frame_count")}: <span className="font-mono text-accent">{frameCount}</span>
          </label>
          <input
            type="range"
            min={2}
            max={15}
            value={frameCount}
            onChange={(e) => setFrameCount(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        <div>
          <label className="label">
            {t("ml_lab_noise")}: <span className="font-mono text-accent">{noise.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={noise}
            onChange={(e) => setNoise(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <p className="text-2xs text-text-muted mt-1">{t("ml_lab_noise_hint")}</p>
        </div>

        <div>
          <label className="label">{t("ml_lab_strategy")}</label>
          <div className="flex gap-2">
            {(["weighted_mean", "median"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStrategy(s)}
                className={
                  s === strategy
                    ? "btn-primary btn-sm flex-1"
                    : "btn-secondary btn-sm flex-1"
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <button onClick={run} disabled={loading} className="btn-primary w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
          {t("ml_lab_run_fusion")}
        </button>
      </div>

      <div className="space-y-3">
        {error && <Alert variant="danger">{error}</Alert>}

        {!result && !error && (
          <Empty message={t("ml_lab_fusion_no_result")} icon={Layers} />
        )}

        {result && (
          <>
            <div className="card">
              <div className="text-2xs uppercase tracking-wide text-text-muted mb-1">
                {t("ml_lab_similarity_to_first")}
              </div>
              <div className="text-3xl font-bold font-mono text-accent">
                {result.similarity_to_first?.toFixed(4) ?? "—"}
              </div>
              <div className="text-2xs text-text-muted mt-1">
                {t("ml_lab_similarity_hint")}
              </div>
            </div>

            <div className="card text-2xs space-y-1.5 text-text-soft">
              <div className="flex justify-between">
                <span>{t("ml_lab_strategy")}</span>
                <span className="font-mono text-text">{result.strategy}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("ml_lab_frames_used")}</span>
                <span className="font-mono text-text">{result.frame_count}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("ml_lab_embedding_dim")}</span>
                <span className="font-mono text-text">{result.embedding?.length ?? 0}</span>
              </div>
            </div>

            <button
              onClick={run}
              disabled={loading}
              className="btn-ghost btn-sm w-full"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              {t("ml_lab_resimulate")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

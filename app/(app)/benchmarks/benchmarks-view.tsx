"use client";

import { useState } from "react";
import { Play, Loader2, Activity, Cpu, Clock, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface Stats {
  n: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms: number;
  max_ms: number;
}

interface BenchResult {
  iterations: number;
  input_resolution: string;
  /** Where the frame came from — a bundled sample face, or synthetic noise. */
  input_source?: string;
  faces_detected?: number;
  /** false = nothing was detected, so the embedding row timed a failed detect. */
  embedding_measured?: boolean;
  warning?: string;
  detection: Stats;
  embedding: Stats;
  end_to_end: Stats;
  effective_fps: number;
  effective_fps_end_to_end?: number;
  engine: Record<string, unknown>;
}

const PRESETS = [10, 25, 50];

export function BenchmarksView() {
  const { t } = useT();
  const [result, setResult] = useState<BenchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(10);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ml/bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iterations }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bench failed");
    } finally {
      setLoading(false);
    }
  }

  function StatRow({ label, stats, icon: Icon }: { label: string; stats: Stats; icon: typeof Activity }) {
    if (!stats || stats.n === 0) return null;
    return (
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-accent" />
          <h3 className="section-title">{label}</h3>
          <span className="text-[10px] text-text-muted ml-auto">{stats.n} samples</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          <Stat label="mean" value={`${stats.mean_ms}ms`} highlight />
          <Stat label="p50" value={`${stats.p50_ms}ms`} />
          <Stat label="p95" value={`${stats.p95_ms}ms`} />
          <Stat label="p99" value={`${stats.p99_ms}ms`} />
          <Stat label="min" value={`${stats.min_ms}ms`} muted />
          <Stat label="max" value={`${stats.max_ms}ms`} muted />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="section-title flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent" />
              Microbenchmark configuration
            </h3>
            <p className="text-xs text-text-soft mt-1">
              {result
                ? `${result.input_resolution}${result.input_source ? ` · ${result.input_source}` : ""} · ${result.iterations} ${t("bench_iterations_label")}`
                : t("bench_config_hint")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setIterations(n)}
                className={`px-3 py-1.5 rounded text-xs ${
                  iterations === n ? "bg-accent/15 text-accent" : "bg-text-muted/5 text-text-soft hover:bg-text-muted/10"
                }`}
              >
                {n} iter
              </button>
            ))}
            <button onClick={run} disabled={loading} className="btn-primary">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2">{error}</div>
        )}
      </div>

      {result?.warning && (
        <div className="card border border-warning/30 bg-warning-soft flex items-start gap-2.5 mb-4">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <p className="text-xs text-warning/90 leading-relaxed">{result.warning}</p>
        </div>
      )}

      {result && (
        <>
          <div className="card flex items-center justify-between bg-accent/5 border-accent/20">
            <div>
              <div className="text-xs text-text-soft">Effective throughput</div>
              <div className="text-2xl font-bold text-accent font-mono">
                {result.effective_fps} FPS
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-soft">Input</div>
              <div className="text-sm font-mono">{result.input_resolution}</div>
              <div className="text-[10px] text-text-muted">{result.iterations} iterations</div>
            </div>
          </div>

          <StatRow label="Face detection" stats={result.detection} icon={Cpu} />
          <StatRow label="Embedding generation" stats={result.embedding} icon={Activity} />
          <StatRow label="End-to-end (detect + embed)" stats={result.end_to_end} icon={Clock} />

          <div className="card text-xs text-text-soft space-y-2 leading-relaxed">
            <div className="flex gap-2">
              <strong className="text-text-soft w-24 shrink-0">Engine:</strong>
              <code className="font-mono text-text">{String(result.engine?.model ?? "unknown")}</code>
            </div>
            {result.engine?.embedding_dim !== undefined && (
              <div className="flex gap-2">
                <strong className="text-text-soft w-24 shrink-0">Embedding:</strong>
                <code className="font-mono text-text">{String(result.engine.embedding_dim)}-dim</code>
              </div>
            )}
            {result.engine?.det_size !== undefined && (
              <div className="flex gap-2">
                <strong className="text-text-soft w-24 shrink-0">Det size:</strong>
                <code className="font-mono text-text">{JSON.stringify(result.engine.det_size)}</code>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wide ${muted ? "text-text-faint" : "text-text-muted"}`}>{label}</div>
      <div className={`text-sm font-mono ${highlight ? "text-accent font-bold" : muted ? "text-text-muted" : "text-text"}`}>{value}</div>
    </div>
  );
}

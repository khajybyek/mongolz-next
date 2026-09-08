"use client";

import { useState } from "react";
import { Loader2, Layers } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface Cluster {
  id: number;
  size: number;
  face_ids: string[];
}

interface ClusterResult {
  total: number;
  cluster_count: number;
  noise: number;
  clusters: Cluster[];
}

export function ClusterView() {
  const { t } = useT();
  const [eps, setEps] = useState(0.5);
  const [minSamples, setMinSamples] = useState(2);
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCluster() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eps, min_samples: minSamples }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("clusters_failed"));
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("clusters_failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t("clusters_eps")}</label>
            <input
              type="range"
              min={0.2}
              max={1.0}
              step={0.05}
              value={eps}
              onChange={(e) => setEps(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="text-sm text-text-soft font-mono mt-1">{eps}</div>
          </div>
          <div>
            <label className="label">{t("clusters_min_samples")}</label>
            <input
              type="range"
              min={2}
              max={10}
              step={1}
              value={minSamples}
              onChange={(e) => setMinSamples(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="text-sm text-text-soft font-mono mt-1">{minSamples}</div>
          </div>
        </div>
        <button onClick={runCluster} disabled={loading} className="btn-primary">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
          {t("clusters_run")}
        </button>
        {error && (
          <div className="helper-error">{error}</div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="card text-center">
              <div className="text-2xl font-bold text-accent">{result.cluster_count}</div>
              <div className="text-xs text-text-muted">{t("clusters_count")}</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-text">{result.total}</div>
              <div className="text-xs text-text-muted">{t("clusters_total_faces")}</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-warning">{result.noise}</div>
              <div className="text-xs text-text-muted">{t("clusters_noise")}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {result.clusters.map((c) => (
              <div key={c.id} className="card">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-text">
                    {t("clusters_cluster_label")} #{c.id}
                  </span>
                  <span className="badge bg-accent/15 text-accent">
                    {c.size} {t("clusters_faces_unit")}
                  </span>
                </div>
                <div className="text-[10px] text-text-muted font-mono break-all">
                  {c.face_ids.join(", ")}
                  {c.size > 10 && ` … (+${c.size - 10} ${t("clusters_more_suffix")})`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

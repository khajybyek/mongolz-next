"use client";

import { useState } from "react";
import { Shield, Play, Loader2 } from "lucide-react";

interface SweepResult {
  epsilon: number;
  sigma: number;
  f1: number;
  precision: number;
  recall: number;
  privacy: string;
}

export function PrivacyDashboard() {
  const [results, setResults] = useState<SweepResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSweep() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ml/dp/sweep", { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" />
            Epsilon Sweep — Privacy vs. Accuracy Tradeoff
          </h3>
          <button
            onClick={runSweep}
            disabled={loading}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run Sweep
          </button>
        </div>

        {error && (
          <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2">{error}</div>
        )}

        <p className="text-xs text-neutral-400">
          Tests multiple epsilon values against simulated face pairs to measure how differential
          privacy noise affects matching accuracy. Lower epsilon = stronger privacy, but lower F1.
        </p>
      </div>

      {results.length > 0 && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary/50">
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 text-left">ε (Epsilon)</th>
                <th className="px-4 py-2.5 text-left">σ (Noise)</th>
                <th className="px-4 py-2.5 text-left">Precision</th>
                <th className="px-4 py-2.5 text-left">Recall</th>
                <th className="px-4 py-2.5 text-left">F1</th>
                <th className="px-4 py-2.5 text-left">Privacy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {results.map((r) => (
                <tr key={r.epsilon} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-mono">{r.epsilon}</td>
                  <td className="px-4 py-2.5 font-mono text-neutral-400">{r.sigma}</td>
                  <td className="px-4 py-2.5">
                    <span className={r.precision >= 0.8 ? "text-success" : r.precision >= 0.5 ? "text-warning" : "text-danger"}>
                      {(r.precision * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={r.recall >= 0.8 ? "text-success" : r.recall >= 0.5 ? "text-warning" : "text-danger"}>
                      {(r.recall * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    <span className={r.f1 >= 0.8 ? "text-success" : r.f1 >= 0.5 ? "text-warning" : "text-danger"}>
                      {(r.f1 * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">{r.privacy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card bg-accent/5 border border-accent/20 text-xs text-neutral-400 leading-relaxed space-y-2">
        <p>
          <strong className="text-neutral-300">Differential Privacy</strong> adds calibrated Gaussian noise
          to face embeddings before storage. This provides formal privacy guarantees — even if the
          database is compromised, individual face data cannot be reconstructed.
        </p>
        <p>
          Recommended: <strong className="text-neutral-300">ε = 5.0</strong> balances privacy
          and matching accuracy for surveillance use cases. For maximum privacy, use ε ≤ 1.0.
        </p>
      </div>
    </div>
  );
}

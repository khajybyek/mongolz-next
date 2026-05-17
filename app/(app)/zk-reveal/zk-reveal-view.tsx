"use client";

import { useState } from "react";
import { Shield, Play, Loader2, CheckCircle, XCircle, Lock } from "lucide-react";

interface SimResult {
  success: number;
  fail_threshold: number;
  fail_proof: number;
  total: number;
}

const PROTOCOL_STEPS = [
  {
    step: "1. Commit",
    desc: "Admin generates nonce r, computes C = H(embedding || r) and sends C to server",
    detail: "SHA3-256 commitment hides the embedding while binding the admin to it",
  },
  {
    step: "2. Challenge",
    desc: "Server generates random challenge c and sends to admin",
    detail: "Prevents pre-computation — each reveal requires a fresh interaction",
  },
  {
    step: "3. Respond",
    desc: "Admin computes response = H(embedding || r || c)",
    detail: "Proves knowledge of the embedding without revealing it",
  },
  {
    step: "4. Verify",
    desc: "Server checks H(stored_embedding || r || c) == response",
    detail: "If valid + similarity above threshold, reveal is authorized",
  },
];

export function ZKRevealView() {
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trials, setTrials] = useState(100);

  async function runSimulation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ml/zk/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n_trials: trials }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4 text-accent" />
          Protocol Steps
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROTOCOL_STEPS.map((s) => (
            <div key={s.step} className="bg-bg-tertiary rounded-lg p-3 space-y-1">
              <div className="text-xs font-semibold text-accent">{s.step}</div>
              <div className="text-xs text-text-soft">{s.desc}</div>
              <div className="text-[10px] text-text-muted mt-1">{s.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" />
            Protocol Simulation
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-soft">Trials:</label>
            <input
              type="number"
              value={trials}
              onChange={(e) => setTrials(Number(e.target.value))}
              className="w-20 bg-bg-tertiary border border-text-muted/10 rounded px-2 py-1 text-xs"
              min={10}
              max={1000}
            />
            <button
              onClick={runSimulation}
              disabled={loading}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Simulate
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2">{error}</div>
        )}

        {result && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-bg-tertiary rounded-lg p-3 text-center">
              <CheckCircle className="w-5 h-5 text-success mx-auto mb-1" />
              <div className="text-lg font-bold text-success">{result.success}</div>
              <div className="text-[10px] text-text-muted">Valid proofs</div>
            </div>
            <div className="bg-bg-tertiary rounded-lg p-3 text-center">
              <XCircle className="w-5 h-5 text-warning mx-auto mb-1" />
              <div className="text-lg font-bold text-warning">{result.fail_threshold}</div>
              <div className="text-[10px] text-text-muted">Below threshold</div>
            </div>
            <div className="bg-bg-tertiary rounded-lg p-3 text-center">
              <XCircle className="w-5 h-5 text-danger mx-auto mb-1" />
              <div className="text-lg font-bold text-danger">{result.fail_proof}</div>
              <div className="text-[10px] text-text-muted">Invalid proof</div>
            </div>
          </div>
        )}
      </div>

      <div className="card bg-accent/5 border border-accent/20 text-xs text-text-soft leading-relaxed space-y-2">
        <p>
          <strong className="text-text-soft">Zero-Knowledge Proofs</strong> allow an admin to
          prove they have a legitimate face match without revealing the actual face embedding
          during the authorization process.
        </p>
        <p>
          The audit log records only the cryptographic commitment — not the embedding itself.
          This provides accountability without compromising biometric data privacy.
        </p>
        <p>
          Uses <strong className="text-text-soft">SHA3-256</strong> commitments with
          Schnorr-style challenge-response, timing-safe comparison, and 5-minute challenge TTL
          to prevent replay attacks.
        </p>
      </div>
    </div>
  );
}

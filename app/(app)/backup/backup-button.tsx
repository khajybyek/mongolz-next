"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

export function BackupButton({
  label,
  biometricLabel,
  biometricHelp,
  canIncludeBiometrics,
}: {
  label: string;
  biometricLabel: string;
  biometricHelp: string;
  /** Only the DB-locked super admin may export ArcFace vectors. */
  canIncludeBiometrics: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeBiometrics, setIncludeBiometrics] = useState(false);
  const retryRef = useRef(false);
  // The retried download must use the checkbox state the operator confirmed,
  // not whatever it was toggled to while the TOTP prompt was open.
  const pendingRef = useRef(false);

  async function download(withBiometrics: boolean) {
    setBusy(true);
    setError(null);
    try {
      const url = withBiometrics
        ? "/api/admin/backup?include_biometrics=1"
        : "/api/admin/backup";
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.error === REAUTH_REQUIRED) {
          retryRef.current = true;
          pendingRef.current = withBiometrics;
          setNeedsTotp(true);
          return;
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `mongolz-backup${withBiometrics ? "-biometric" : ""}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canIncludeBiometrics && (
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeBiometrics}
            onChange={(e) => setIncludeBiometrics(e.target.checked)}
            className="mt-0.5 accent-danger"
          />
          <span className="text-xs text-text-soft leading-relaxed">{biometricLabel}</span>
        </label>
      )}

      {canIncludeBiometrics && includeBiometrics && (
        <div className="card border border-danger/30 bg-danger-soft">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
            <p className="text-xs text-danger/90 leading-relaxed">{biometricHelp}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => download(includeBiometrics)}
        disabled={busy}
        className="btn-primary w-full"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {label}
      </button>
      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          retryRef.current = false;
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          if (retryRef.current) {
            retryRef.current = false;
            download(pendingRef.current);
          }
        }}
      />
    </>
  );
}

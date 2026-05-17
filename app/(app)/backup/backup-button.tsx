"use client";

import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

export function BackupButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(false);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.error === REAUTH_REQUIRED) {
          retryRef.current = true;
          setNeedsTotp(true);
          return;
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mongolz-backup-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="btn-primary w-full text-center justify-center"
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
            download();
          }
        }}
      />
    </>
  );
}

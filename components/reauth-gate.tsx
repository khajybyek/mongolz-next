"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, AlertCircle, Lock } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Full-page TOTP step-up gate. Used on sensitive *views* (vs the modal
 * version used for inline actions). The server decides whether to render
 * this gate by calling `hasFreshReauth(userId)` before the protected
 * content. On successful TOTP the reauth cookie is set server-side and
 * we just `router.refresh()` so the server re-evaluates the gate.
 */
export function ReauthGate({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { t } = useT();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reauth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: true; error?: string }
        | null;
      if (!res.ok) {
        if (data?.error === "TOTP_NOT_ENABLED") {
          setError(t("totp_prompt_not_enabled"));
        } else {
          setError(data?.error ?? t("totp_prompt_invalid"));
        }
        return;
      }
      router.refresh();
    } catch {
      setError(t("totp_prompt_network_err"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card border border-accent/20 shadow-glow">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text">
              {title ?? t("reauth_gate_title")}
            </h2>
            <p className="text-xs text-text-soft mt-0.5">
              {subtitle ?? t("reauth_gate_subtitle")}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="reauth_gate_code" className="label">
              {t("totp_prompt_label")}
            </label>
            <input
              ref={inputRef}
              id="reauth_gate_code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              disabled={busy}
              className="input text-center text-2xl tracking-[0.5em] font-mono"
            />
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={code.length !== 6 || busy}
            className="btn-primary w-full justify-center"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {t("totp_prompt_verify")}
          </button>

          <p className="text-2xs text-text-muted leading-relaxed border-t border-border pt-3">
            {t("totp_prompt_ttl_hint")}
          </p>
        </form>
      </div>
    </div>
  );
}

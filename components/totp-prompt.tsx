"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * TOTP step-up prompt. Shown when a user-CRUD action returns
 * `REAUTH_REQUIRED`. On success, the parent retries the original action.
 */
export function TotpPrompt({ open, onClose, onSuccess }: Props) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
      setBusy(false);
      // Focus after dialog animates in
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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
        } else if (data?.error === "server_config") {
          setError(t("totp_prompt_server_config"));
        } else {
          setError(data?.error ?? t("totp_prompt_invalid"));
        }
        return;
      }
      onSuccess();
    } catch {
      setError(t("totp_prompt_network_err"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" />
          {t("totp_prompt_title")}
        </span>
      }
      description={t("totp_prompt_desc")}
      size="sm"
      footer={null}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="totp_step_up_code" className="label">
            {t("totp_prompt_label")}
          </label>
          <input
            ref={inputRef}
            id="totp_step_up_code"
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

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={code.length !== 6 || busy}
            className="btn-primary flex-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {t("totp_prompt_verify")}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t("cancel_btn")}
          </button>
        </div>

        <p className="text-2xs text-text-muted leading-relaxed border-t border-border pt-3">
          {t("totp_prompt_ttl_hint")}
        </p>
      </form>
    </Dialog>
  );
}

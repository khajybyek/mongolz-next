"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Why this action needs the second factor, in the caller's words. Falls
   * back to the generic `totp_prompt_desc`, which names no particular action.
   */
  description?: string;
}

/**
 * TOTP step-up prompt. Shown when a sensitive action (user management,
 * camera and schedule changes, retention, webhooks, passkeys and so on)
 * answers `REAUTH_REQUIRED`. On success, the parent retries the action.
 */
export function TotpPrompt({ open, onClose, onSuccess, description }: Props) {
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
        | { ok?: true; error?: string; code?: string; retry_after_sec?: number }
        | null;
      if (!res.ok) {
        // `totp_required` is what requireAdminApi answers for an admin who
        // has not enrolled TOTP yet — same meaning, same copy.
        if (data?.error === "TOTP_NOT_ENABLED" || data?.error === "totp_required") {
          setError(t("totp_prompt_not_enabled"));
        } else if (data?.error === "server_config") {
          setError(t("totp_prompt_server_config"));
        } else if (res.status === 429) {
          // Locked out: every further code is refused until the window ends,
          // so "invalid code" would send the user round in circles.
          const wait = Number(data?.retry_after_sec);
          setError(
            `${t("rl_too_many_attempts")}${Number.isFinite(wait) && wait > 0 ? ` (${Math.ceil(wait)} s)` : ""}`,
          );
        } else if (res.status === 401 && data?.code !== "invalid" && data?.code !== "replayed") {
          // No `code` = the session itself was refused (middleware 401,
          // session_invalid from a pin mismatch), not the TOTP code.
          setError(t("totp_prompt_session_expired"));
        } else {
          // Never render a raw server code; the remaining refusals (bad
          // code, replay) all mean "try another code".
          setError(t("totp_prompt_invalid"));
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
      description={description ?? t("totp_prompt_desc")}
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

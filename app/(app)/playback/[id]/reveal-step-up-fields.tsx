"use client";

import { KeyRound, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import {
  normalizeTotpInput,
  revealStepUpFactors,
  TOTP_INPUT_MAX_LENGTH,
  type RevealStepUpFactor,
} from "@/lib/step-up-client";

/**
 * Step 2 of the reveal modal: pick the step-up factor, read what it does, and
 * type it. The authenticator code (POST /api/auth/reauth/totp) is offered only
 * when the profile has TOTP enrolled; the password (POST /api/auth/reauth) is
 * always available, because the reveal request still accepts it.
 *
 * `confirmOnly`: a step-up from the last 15 minutes is still live, so nothing
 * is typed — step 2 says so and the modal's Confirm sends the request.
 */
export function RevealStepUpFields({
  confirmOnly = false,
  totpEnabled,
  factor,
  onFactorChange,
  code,
  onCodeChange,
  password,
  onPasswordChange,
  busy,
}: {
  confirmOnly?: boolean;
  totpEnabled: boolean;
  factor: RevealStepUpFactor;
  onFactorChange: (factor: RevealStepUpFactor) => void;
  code: string;
  onCodeChange: (code: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  busy: boolean;
}) {
  const { t } = useT();
  const factors = revealStepUpFactors(totpEnabled);

  if (confirmOnly) {
    return (
      <div data-reauth-note="fresh" className="bg-success/5 border border-success/30 rounded-lg p-3 text-xs flex gap-2">
        <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden />
        <div className="leading-relaxed">{t("pb_reauth_note_fresh")}</div>
      </div>
    );
  }

  return (
    <>
      {factors.length > 1 && (
        <div
          role="group"
          aria-label={t("pb_reauth_factor_label")}
          data-reveal-factors
          className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-surface-elevated/60 p-0.5"
        >
          {factors.map((f) => {
            const Icon = f === "totp" ? Smartphone : KeyRound;
            const active = factor === f;
            return (
              <button
                key={f}
                type="button"
                data-factor={f}
                aria-pressed={active}
                onClick={() => onFactorChange(f)}
                disabled={busy}
                className={cn(
                  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-center text-xs font-medium leading-tight transition",
                  active ? "bg-accent/15 text-accent" : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {f === "totp" ? t("pb_reauth_factor_totp") : t("login_pass")}
              </button>
            );
          })}
        </div>
      )}

      <div data-reauth-note={factor} className="bg-warning/5 border border-warning/30 rounded-lg p-3 text-xs flex gap-2">
        <Lock className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
        <div className="leading-relaxed">
          {t(factor === "totp" ? "pb_reauth_note_totp" : "pb_reauth_note")}
        </div>
      </div>

      {/* Distinct keys: switching factor mounts a fresh input, so autoFocus
          lands in the field the operator just chose. */}
      {factor === "totp" ? (
        <input
          key="totp"
          id="reveal-totp-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={TOTP_INPUT_MAX_LENGTH}
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => onCodeChange(normalizeTotpInput(e.target.value))}
          placeholder="000000"
          aria-label={t("totp_prompt_label")}
          disabled={busy}
          className="input text-center text-2xl tracking-[0.5em] font-mono"
        />
      ) : (
        <input
          key="password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={t("login_pass")}
          aria-label={t("login_pass")}
          autoFocus
          className="input"
          disabled={busy}
        />
      )}
    </>
  );
}

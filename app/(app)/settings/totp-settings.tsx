"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, CheckCircle2, AlertTriangle, KeyRound } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";
import { RecoveryCodes } from "./recovery-codes";

interface Props {
  email: string;
  enabled: boolean;
  role: "admin" | "viewer" | "auditor";
}

/** Machine error codes returned by the TOTP routes → translated copy. */
const ROUTE_ERRORS: Record<string, TranslationKey> = {
  setup_failed: "set_totp_setup_failed",
  enable_failed: "set_totp_enable_failed",
  already_enabled: "set_totp_already_enabled",
  disable_failed: "set_totp_disable_failed",
  regenerate_failed: "set_totp_regen_failed",
};

export function TotpSettings({ email, enabled: initialEnabled, role }: Props) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "disable" | "regen" | "codes">("idle");
  // Plaintext recovery codes exist only in this state, only until the
  // operator confirms they saved them (the server keeps hashes).
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [codesThen, setCodesThen] = useState<"relogin" | "stay">("stay");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const router = useRouter();

  function routeError(data: { error?: unknown } | null, fallback: TranslationKey): string {
    const code = typeof data?.error === "string" ? data.error : null;
    if (code && ROUTE_ERRORS[code]) return t(ROUTE_ERRORS[code]);
    return code ?? t(fallback);
  }

  function showCodes(codes: string[], then: "relogin" | "stay") {
    setRecoveryCodes(codes);
    setCodesThen(then);
    setStep("codes");
  }

  function confirmCodesSaved() {
    const then = codesThen;
    setRecoveryCodes(null);
    setStep("idle");
    if (then === "relogin") {
      // The enrolment already ended this session (see the verify route);
      // only now, after the codes were acknowledged, leave the page.
      router.push("/login?error=totp_enrolled" as never);
      return;
    }
    setSuccess(t("set_totp_regen_done"));
  }

  async function submitRegenerate() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/auth/totp/recovery/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.recovery_codes)) {
        throw new Error(routeError(data, "set_totp_regen_failed"));
      }
      setCode("");
      showCodes(data.recovery_codes as string[], "stay");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(routeError(data, "set_totp_setup_failed"));
      setQr(data.qr_data_uri);
      setSecret(data.secret);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(routeError(data, "set_totp_verify_failed"));
      setEnabled(true);
      setStep("idle");
      setQr(null);
      setSecret(null);
      setCode("");
      setSuccess(t("set_totp_enabled_msg"));
      if (data?.relogin_required) {
        // Enrolling ends the password-only session (see the verify route).
        // The recovery codes are shown exactly once, here: no refresh and no
        // timed redirect — the page leaves only after the operator confirms.
        setSuccess(`${t("set_totp_enabled_msg")} ${t("set_totp_relogin")}`);
        if (Array.isArray(data.recovery_codes) && data.recovery_codes.length > 0) {
          showCodes(data.recovery_codes as string[], "relogin");
        } else {
          router.push("/login?error=totp_enrolled" as never);
        }
        return;
      }
      // Server-rendered "must set up TOTP" banner + middleware gate re-evaluate.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function submitDisable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.status === 403 && data?.error === "REAUTH_REQUIRED") {
        // Disabling the second factor needs the second factor first.
        setNeedsTotp(true);
        return;
      }
      if (!res.ok) throw new Error(routeError(data, "set_totp_disable_failed"));
      setEnabled(false);
      setStep("idle");
      setPassword("");
      setSuccess(t("set_totp_disabled_msg"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <TotpPrompt
        open={needsTotp}
        onClose={() => setNeedsTotp(false)}
        onSuccess={() => {
          setNeedsTotp(false);
          void submitDisable();
        }}
      />
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            enabled ? "bg-success/15 text-success" : "bg-text-muted/5 text-text-soft"
          }`}
        >
          <Shield className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="section-title">{t("set_totp_title")}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t("set_totp_desc")}
          </p>
        </div>
        <span
          className={`badge ${
            enabled ? "bg-success/15 text-success" : "bg-text-muted/5 text-text-soft"
          }`}
        >
          {enabled ? t("on") : t("off")}
        </span>
      </div>

      {success && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-2.5 text-xs text-success flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          {success}
        </div>
      )}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* IDLE — toggle button */}
      {step === "idle" && !enabled && (
        <button onClick={startSetup} disabled={busy} className="btn-primary w-full">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          {t("zones_enable")}
        </button>
      )}
      {step === "idle" && enabled && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => {
              setCode("");
              setError(null);
              setSuccess(null);
              setStep("regen");
            }}
            className="btn-secondary flex-1"
          >
            <KeyRound className="w-4 h-4" />
            {t("set_totp_regen")}
          </button>
          <button onClick={() => setStep("disable")} className="btn-ghost flex-1">
            {t("set_disable")}
          </button>
        </div>
      )}

      {/* REGEN — a fresh authenticator code re-issues the recovery codes */}
      {step === "regen" && (
        <div className="space-y-3 border-t border-text-muted/5 pt-3">
          <p className="text-xs text-text-soft leading-relaxed">{t("set_totp_regen_desc")}</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder={t("set_totp_code_placeholder")}
            aria-label={t("set_totp_code_label")}
            className="input text-center text-lg tracking-widest"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setCode("");
              }}
              className="btn-ghost flex-1"
              disabled={busy}
            >
              {t("cancel")}
            </button>
            <button
              onClick={submitRegenerate}
              disabled={busy || code.length !== 6}
              className="btn-primary flex-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t("confirm")}
            </button>
          </div>
        </div>
      )}

      {/* CODES — shown once after enrolment or regeneration */}
      {step === "codes" && recoveryCodes && (
        <RecoveryCodes
          codes={recoveryCodes}
          email={email}
          confirmLabel={
            codesThen === "relogin" ? t("set_totp_recovery_saved_relogin") : t("set_totp_recovery_saved")
          }
          onConfirm={confirmCodesSaved}
        />
      )}

      {/* VERIFY — QR + 6-digit code */}
      {step === "verify" && qr && secret && (
        <div className="space-y-3 border-t border-text-muted/5 pt-3">
          <p className="text-xs text-text-soft leading-relaxed">
            {t("set_totp_step1")}
            <br />
            {t("set_totp_step2")}
            <br />
            {t("set_totp_step3")}
          </p>
          <div className="flex justify-center bg-white p-3 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="TOTP QR" className="w-48 h-48" />
          </div>
          <details className="text-[11px] text-text-muted">
            <summary className="cursor-pointer hover:text-text-soft">
              {t("set_totp_manual_secret")}
            </summary>
            <code className="block mt-2 p-2 bg-bg-tertiary rounded break-all">
              {secret}
            </code>
          </details>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder={t("set_totp_code_placeholder")}
            className="input text-center text-lg tracking-widest"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setQr(null);
                setSecret(null);
                setCode("");
              }}
              className="btn-ghost flex-1"
              disabled={busy}
            >
              {t("cancel")}
            </button>
            <button
              onClick={submitVerify}
              disabled={busy || code.length !== 6}
              className="btn-primary flex-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t("confirm")}
            </button>
          </div>
        </div>
      )}

      {/* DISABLE — password confirm */}
      {step === "disable" && (
        <div className="space-y-3 border-t border-text-muted/5 pt-3">
          <p className="text-xs text-warning">
            {t("set_totp_disable_warning")}
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("set_password_confirm_placeholder")}
            className="input"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setPassword("");
              }}
              className="btn-ghost flex-1"
              disabled={busy}
            >
              {t("cancel")}
            </button>
            <button
              onClick={submitDisable}
              disabled={busy || !password}
              className="btn-danger flex-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t("set_disable")}
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-text-muted leading-relaxed border-t border-text-muted/5 pt-3">
        {t("menu_account")}: <b>{email}</b> · {t("users_role")}: <b>{t(`role_${role}`)}</b>
      </p>
    </div>
  );
}

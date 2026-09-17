"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

interface Props {
  email: string;
  enabled: boolean;
  role: "admin" | "viewer" | "auditor" | "organiser";
}

export function TotpSettings({ email, enabled: initialEnabled, role }: Props) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "disable">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const router = useRouter();

  async function startSetup() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("set_totp_setup_failed"));
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("set_totp_verify_failed"));
      setEnabled(true);
      setStep("idle");
      setQr(null);
      setSecret(null);
      setCode("");
      setSuccess(t("set_totp_enabled_msg"));
      if (data.relogin_required) {
        // Enrolling ends the password-only session (see the verify route): the
        // recovery codes stay on screen, and the next navigation goes to login.
        setSuccess(`${t("set_totp_enabled_msg")} ${t("set_totp_relogin")}`);
        setTimeout(() => router.push("/login?error=session_pin" as never), 15_000);
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
      if (!res.ok) throw new Error(data.error ?? t("set_totp_disable_failed"));
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
        <button onClick={() => setStep("disable")} className="btn-ghost w-full">
          {t("set_disable")}
        </button>
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
        {t("menu_account")}: <b>{email}</b> · {t("users_role")}: <b>{role}</b>
      </p>
    </div>
  );
}

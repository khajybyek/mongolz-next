"use client";

import { useState } from "react";
import { Shield, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  email: string;
  enabled: boolean;
  role: "admin" | "viewer" | "auditor";
}

export function TotpSettings({ email, enabled: initialEnabled, role }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "disable">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Setup алдаа");
      setQr(data.qr_data_uri);
      setSecret(data.secret);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
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
      if (!res.ok) throw new Error(data.error ?? "Шалгах алдаа");
      setEnabled(true);
      setStep("idle");
      setQr(null);
      setSecret(null);
      setCode("");
      setSuccess("✓ TOTP 2FA идэвхжсэн!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
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
      if (!res.ok) throw new Error(data.error ?? "Унтраах алдаа");
      setEnabled(false);
      setStep("idle");
      setPassword("");
      setSuccess("TOTP унтраагдлаа");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            enabled ? "bg-success/15 text-success" : "bg-white/5 text-neutral-400"
          }`}
        >
          <Shield className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">TOTP 2-Factor Authentication</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Google Authenticator / Authy / 1Password зэрэг app-аар нууцлал нэмэх
          </p>
        </div>
        <span
          className={`badge ${
            enabled ? "bg-success/15 text-success" : "bg-white/5 text-neutral-400"
          }`}
        >
          {enabled ? "ON" : "OFF"}
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
          Идэвхжүүлэх
        </button>
      )}
      {step === "idle" && enabled && (
        <button onClick={() => setStep("disable")} className="btn-ghost w-full">
          Унтраах
        </button>
      )}

      {/* VERIFY — QR + 6-digit code */}
      {step === "verify" && qr && secret && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <p className="text-xs text-neutral-400 leading-relaxed">
            1. <b>Google Authenticator</b> эсвэл <b>Authy</b>-аа нээ
            <br />
            2. + дарна → <b>Scan QR code</b>
            <br />
            3. Доорх QR-ыг сэкэн хийгээд харагдсан 6-digit код тавь
          </p>
          <div className="flex justify-center bg-white p-3 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="TOTP QR" className="w-48 h-48" />
          </div>
          <details className="text-[11px] text-neutral-500">
            <summary className="cursor-pointer hover:text-neutral-300">
              QR ажиллахгүй бол энэ secret-ыг гараар оруул
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
            placeholder="6-digit код"
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
              Болих
            </button>
            <button
              onClick={submitVerify}
              disabled={busy || code.length !== 6}
              className="btn-primary flex-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Баталгаажуулах
            </button>
          </div>
        </div>
      )}

      {/* DISABLE — password confirm */}
      {step === "disable" && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <p className="text-xs text-warning">
            ⚠️ TOTP-г унтрааснаар таны бүртгэл нь нууц үгээр л хамгаалагдана.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Нууц үг (баталгаажуулахад)"
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
              Болих
            </button>
            <button
              onClick={submitDisable}
              disabled={busy || !password}
              className="btn-danger flex-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Унтраах
            </button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-neutral-500 leading-relaxed border-t border-white/5 pt-3">
        Аккаунт: <b>{email}</b> · Role: <b>{role}</b>
      </p>
    </div>
  );
}

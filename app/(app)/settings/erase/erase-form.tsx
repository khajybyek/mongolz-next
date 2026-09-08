"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface Props {
  email: string;
  role: "admin" | "viewer" | "auditor";
  totpEnabled: boolean;
}

export function EraseForm({ email, role, totpEnabled }: Props) {
  const { t } = useT();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/gdpr/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm,
          totp_code: totpEnabled ? totp : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("set_erase_failed"));
      // Logged out — go to login. No ?error= code: /login only renders codes
      // it knows and falls back to "Sign-in failed", which would be the wrong
      // thing to tell someone whose erasure just succeeded.
      router.push("/login" as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ui_error_title"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card border border-danger/30 bg-danger/[0.04] space-y-3">
      <div className="flex items-start gap-2.5 text-warning">
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="text-sm leading-relaxed">
          <p className="font-semibold mb-1">{t("set_erase_irreversible")}</p>
          <ul className="text-xs text-text-soft space-y-1 list-disc list-inside">
            <li>{t("set_erase_li_profile")}</li>
            <li>{t("set_erase_li_auth")}</li>
            <li>{t("set_erase_li_audit")}</li>
            <li>{t("set_erase_li_labels")}</li>
            <li>{t("set_erase_li_perms")}</li>
            {role === "admin" && <li>{t("set_erase_li_last_admin")}</li>}
          </ul>
        </div>
      </div>

      <div>
        <label className="label">{t("set_erase_email_label")}</label>
        <input value={email} disabled className="input" />
      </div>

      <div>
        <label className="label">{t("set_erase_confirm_label")}</label>
        <input
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t("set_erase_confirm_placeholder")}
          className="input"
          autoComplete="off"
        />
      </div>

      {totpEnabled && (
        <div>
          <label className="label">{t("set_totp_code_label")}</label>
          <input
            required
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            maxLength={6}
            inputMode="numeric"
            pattern="\d{6}"
            placeholder="000000"
            className="input text-center text-lg tracking-widest"
          />
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || confirm !== "DELETE MY ACCOUNT" || (totpEnabled && totp.length !== 6)}
        className="btn-danger w-full"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {t("erase_title")}
      </button>
    </form>
  );
}

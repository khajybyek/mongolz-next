"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";

/** Stable route codes → copy in the operator's language (never raw server text). */
const ERROR_KEYS: Record<string, TranslationKey> = {
  TOTP_REQUIRED: "set_erase_err_totp",
  TOTP_REPLAYED: "set_erase_err_totp_replayed",
  PASSWORD_REQUIRED: "set_erase_err_password",
  PASSWORD_INVALID: "set_erase_err_password",
  RATE_LIMITED: "set_erase_err_rate",
  INVALID_BODY: "set_erase_failed",
};

interface Props {
  email: string;
  role: "admin" | "viewer" | "auditor" | "organiser";
  totpEnabled: boolean;
}

export function EraseForm({ email, role, totpEnabled }: Props) {
  const { t } = useT();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [totp, setTotp] = useState("");
  const [password, setPassword] = useState("");
  const id = useId();
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
          password: totpEnabled ? undefined : password,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!res.ok) {
        // SUPER_ADMIN_LOCKED / LAST_ADMIN arrive already translated.
        const key = data?.code ? ERROR_KEYS[data.code] : undefined;
        const serverTranslated = data?.code === "SUPER_ADMIN_LOCKED" || data?.code === "LAST_ADMIN";
        throw new Error(key ? t(key) : serverTranslated && data?.error ? data.error : t("set_erase_failed"));
      }
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
        <label className="label" htmlFor={`${id}-email`}>{t("set_erase_email_label")}</label>
        <input id={`${id}-email`} value={email} disabled className="input" />
      </div>

      <div>
        <label className="label" htmlFor={`${id}-confirm`}>{t("set_erase_confirm_label")}</label>
        <input
          id={`${id}-confirm`}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t("set_erase_confirm_placeholder")}
          className="input"
          autoComplete="off"
        />
      </div>

      {totpEnabled ? (
        <div>
          <label className="label" htmlFor={`${id}-totp`}>{t("set_totp_code_label")}</label>
          <input
            id={`${id}-totp`}
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
      ) : (
        <div>
          <label className="label" htmlFor={`${id}-password`}>{t("set_erase_password_label")}</label>
          <input
            id={`${id}-password`}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="input"
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
        disabled={
          busy ||
          confirm !== "DELETE MY ACCOUNT" ||
          (totpEnabled ? totp.length !== 6 : password.length === 0)
        }
        className="btn-danger w-full"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {t("erase_title")}
      </button>
    </form>
  );
}

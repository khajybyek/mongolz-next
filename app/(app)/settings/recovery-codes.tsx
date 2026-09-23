"use client";

import { useState } from "react";
import { Check, Copy, Download, KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface Props {
  codes: string[];
  email: string;
  /** Label of the confirmation button — the parent decides what happens next. */
  confirmLabel: string;
  onConfirm: () => void;
}

/** Plain-text file body for the download button. Exported for tests. */
export function recoveryCodesText(codes: string[], email: string): string {
  return [
    "MONGOLZ Security — TOTP recovery codes",
    `Account: ${email}`,
    "Each code works once, in place of the 6-digit code at sign-in.",
    "",
    ...codes,
    "",
  ].join("\n");
}

/**
 * One-time display of freshly issued recovery codes. The server stores only
 * their SHA-256 hashes, so this is the single moment anyone can read them:
 * the parent keeps them on screen until the operator explicitly confirms.
 */
export function RecoveryCodes({ codes, email, confirmLabel, onConfirm }: Props) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the codes stay visible and downloadable */
    }
  }

  function download() {
    const blob = new Blob([recoveryCodesText(codes, email)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mongolz-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 border-t border-text-muted/5 pt-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-warning" />
        <h4 className="text-sm font-semibold">{t("set_totp_recovery_title")}</h4>
      </div>
      <p className="text-xs text-warning leading-relaxed">{t("set_totp_recovery_desc")}</p>
      <ol
        className="grid grid-cols-2 gap-1.5 rounded-lg bg-bg-tertiary p-3 font-mono text-sm tracking-wider"
        aria-label={t("set_totp_recovery_title")}
      >
        {codes.map((c) => (
          <li key={c} className="select-all text-center">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className="btn-secondary flex-1">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? t("set_totp_recovery_copied") : t("set_totp_recovery_copy")}
        </button>
        <button type="button" onClick={download} className="btn-secondary flex-1">
          <Download className="w-4 h-4" />
          {t("set_totp_recovery_download")}
        </button>
      </div>
      <button type="button" onClick={onConfirm} className="btn-primary w-full">
        {confirmLabel}
      </button>
    </div>
  );
}

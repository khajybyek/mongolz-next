"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { addSuspectAction, type AddSuspectResult } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

export function AddSuspectForm() {
  const { t } = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const lastFormRef = useRef<FormData | null>(null);

  function describe(res: Exclude<AddSuspectResult, { ok: true }>): string {
    switch (res.error) {
      case "MISSING":
      case "INVALID_TIER":
        return t("suspect_add_missing");
      case "ML_FAILED":
        return t("suspect_add_ml_failed");
      default:
        return t("suspect_add_failed");
    }
  }

  function submit(fd: FormData) {
    setError(null);
    setOk(false);
    lastFormRef.current = fd;
    startTransition(async () => {
      const res = await addSuspectAction(fd);
      if ("error" in res) {
        if (res.error === "REAUTH_REQUIRED") {
          setNeedsTotp(true);
          return;
        }
        setError(describe(res));
        return;
      }
      setOk(true);
      formRef.current?.reset();
      router.refresh();
      setTimeout(() => setOk(false), 3000);
    });
  }

  return (
    <div className="card mb-6">
      <TotpPrompt
        open={needsTotp}
        onClose={() => setNeedsTotp(false)}
        onSuccess={() => {
          setNeedsTotp(false);
          if (lastFormRef.current) submit(lastFormRef.current);
        }}
      />
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="grid grid-cols-1 md:grid-cols-4 gap-3"
      >
        <input name="name" placeholder={t("suspect_name")} required maxLength={120} className="input" disabled={pending} />
        <input
          name="photo"
          type="file"
          accept="image/*"
          required
          disabled={pending}
          className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
        />
        <select name="privacy_tier" defaultValue="standard" className="input" disabled={pending}>
          <option value="vip">{t("suspect_tier_vip")}</option>
          <option value="standard">{t("suspect_tier_standard")}</option>
          <option value="relaxed">{t("suspect_tier_relaxed")}</option>
        </select>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {t("add_suspect")}
        </button>
      </form>
      {error && (
        <div className="mt-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {ok && (
        <div className="mt-3 text-xs text-success flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t("suspect_added")}
        </div>
      )}
      <p className="text-xs text-text-muted mt-2">
        {t("suspect_pipeline_note")}
      </p>
    </div>
  );
}

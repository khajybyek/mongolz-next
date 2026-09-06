"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { approveRevealAction, rejectRevealAction, type DecisionResult } from "./actions";
import { TotpPrompt } from "@/components/totp-prompt";
import { useT } from "@/lib/i18n/client";

/**
 * Approve / reject controls for one pending reveal job. Pending state disables
 * both buttons (a double-click on Approve used to race into a thrown
 * "already decided" error), errors render inline, and a stale step-up opens
 * the TOTP prompt and replays the decision afterwards.
 */
export function DecisionForms({ jobId }: { jobId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  function describe(res: Exclude<DecisionResult, { ok: true }>): string {
    switch (res.error) {
      case "ALREADY_DECIDED":
        return t("approvals_already_decided");
      case "SELF":
        return t("approvals_self");
      case "ML_FAILED":
        return `${t("approvals_ml_failed")}${res.detail ? ` — ${res.detail}` : ""}`;
      case "NOT_FOUND":
        return t("ui_not_found_title");
      default:
        return t("ui_error_title");
    }
  }

  function run(exec: () => Promise<DecisionResult>, retry: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await exec();
      if ("error" in res) {
        if (res.error === "REAUTH_REQUIRED") {
          retryRef.current = retry;
          setNeedsTotp(true);
          return;
        }
        setError(describe(res));
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  const approve = () => run(() => approveRevealAction(jobId), approve);
  const reject = () => {
    if (reason.trim().length < 3) return;
    run(() => rejectRevealAction(jobId, reason.trim()), reject);
  };

  return (
    <div className="space-y-2">
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          retryRef.current = null;
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          const retry = retryRef.current;
          retryRef.current = null;
          if (retry) retry();
        }}
      />
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="btn-primary flex-1 text-sm"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {t("approve")}
        </button>
        <form
          className="flex-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reject();
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reject_reason")}
            required
            minLength={3}
            maxLength={500}
            disabled={pending}
            className="input text-sm flex-1"
            aria-label={t("reject_reason")}
          />
          <button type="submit" disabled={pending || reason.trim().length < 3} className="btn-danger text-sm">
            <XCircle className="w-4 h-4" />
            {t("reject")}
          </button>
        </form>
      </div>
      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Check, X, Loader2, HelpCircle } from "lucide-react";
import { reviewFaceAction } from "./actions";
import { useT } from "@/lib/i18n/client";
import { workflowCopy } from "@/lib/workflow-copy";
import { useRouter } from "next/navigation";

export function ReviewActions({ faceId }: { faceId: string }) {
  const { t, lang } = useT();
  const copy = workflowCopy(lang);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleReview(label: "confirmed" | "rejected" | "uncertain") {
    startTransition(async () => {
      setError(null);
      try {
        const result = await reviewFaceAction(faceId, label);
        if ("error" in result) setError(result.error === "conflict" ? copy.reviewConflict : copy.reviewFailed);
        else router.refresh();
      } catch { setError(copy.reviewFailed); }
    });
  }

  if (pending) {
    return (
      <div className="flex justify-center py-1">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-2"><div className="flex gap-1">
      <button
        onClick={() => handleReview("confirmed")}
        className="btn-success btn-sm flex-1"
        title={t("review_confirm")}
        aria-label={t("review_confirm")}
      >
        <Check className="w-3 h-3" />
      </button>
      <button
        onClick={() => handleReview("rejected")}
        className="btn-danger btn-sm flex-1"
        title={t("review_reject")}
        aria-label={t("review_reject")}
      >
        <X className="w-3 h-3" />
      </button>
      <button onClick={() => handleReview("uncertain")} className="btn-secondary btn-sm flex-1" title={copy.uncertain} aria-label={copy.uncertain}><HelpCircle className="w-3 h-3" /></button>
    </div>{error && <div role="alert" className="text-xs text-danger"><p>{error}</p><button className="btn-ghost btn-sm" onClick={() => router.refresh()}>{copy.refresh}</button></div>}</div>
  );
}

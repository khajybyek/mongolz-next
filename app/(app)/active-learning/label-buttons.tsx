"use client";

import { useState, useTransition } from "react";
import { Check, X, RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

type Label = "true_positive" | "false_positive" | "unknown";

export function LabelButtons({ id, current }: { id: string; current: Label }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<Label>(current);
  const [busy, setBusy] = useState<Label | null>(null);

  async function set(label: Label) {
    if (busy) return;
    setBusy(label);
    startTransition(async () => {
      const res = await fetch(`/api/alerts/${id}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      setBusy(null);
      if (res.ok) {
        setActive(label);
        router.refresh();
      }
    });
  }

  const baseCls = "p-1.5 rounded transition";
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => set("true_positive")}
        disabled={pending}
        title={t("al_label_tp_tip")}
        className={`${baseCls} ${
          active === "true_positive"
            ? "bg-success/20 text-success"
            : "hover:bg-white/5 text-text-muted hover:text-success"
        }`}
      >
        {busy === "true_positive" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Check className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        onClick={() => set("false_positive")}
        disabled={pending}
        title={t("al_label_fp_tip")}
        className={`${baseCls} ${
          active === "false_positive"
            ? "bg-danger/20 text-danger"
            : "hover:bg-white/5 text-text-muted hover:text-danger"
        }`}
      >
        {busy === "false_positive" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </button>
      {active !== "unknown" && (
        <button
          onClick={() => set("unknown")}
          disabled={pending}
          title={t("al_label_clear_tip")}
          className={`${baseCls} hover:bg-white/5 text-text-faint hover:text-text-soft`}
        >
          {busy === "unknown" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3" />
          )}
        </button>
      )}
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { fill, schAdminCopy } from "./admin-copy";
import { sweepOrphanReceiptsAction, type SchSweepResult } from "./actions";

/**
 * Removes abandoned receipt uploads (no registration row, older than a day).
 * One click, one audit row; the count comes back in the toast.
 */
export function ReceiptSweepButton() {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sweep() {
    startTransition(async () => {
      let result: SchSweepResult;
      try {
        result = await sweepOrphanReceiptsAction();
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        toast({ title: copy.unavailable, tone: "danger" });
        return;
      }
      toast({
        title: result.removed > 0 ? fill(copy.sweepDone, { n: result.removed }) : copy.sweepNone,
        tone: result.removed > 0 ? "success" : "info",
        duration: 3000,
      });
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn-ghost" onClick={sweep} disabled={pending} title={copy.sweepHint}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eraser className="h-4 w-4" aria-hidden />}
      {copy.sweepReceipts}
    </button>
  );
}

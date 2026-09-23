"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { SCH_CLOSE_OUT_WORD } from "@/lib/sch/close-out";
import { fill, schAdminCopy } from "./admin-copy";
import { closeOutEventAction, type SchCloseOutResult } from "./actions";

interface Props {
  /** Admin viewer; organisers see the explanation but no control. */
  canClose: boolean;
  /** YYYY-MM-DD (KST) from which the purge is accepted. */
  opensOn: string;
  available: boolean;
}

/**
 * Post-event purge of the registrants' personal data (receipts, rows, teams).
 * The server re-checks everything: admin, fresh TOTP step-up, typed word,
 * and the date. This panel only collects the confirmation.
 */
export function CloseOutPanel({ canClose, opensOn, available }: Props) {
  const { lang } = useT();
  const copy = schAdminCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [word, setWord] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);

  function run() {
    startTransition(async () => {
      let result: SchCloseOutResult;
      try {
        result = await closeOutEventAction({ confirm: word });
      } catch {
        result = { error: "unavailable" };
      }
      if ("error" in result) {
        if (result.error === "REAUTH_REQUIRED") {
          setNeedsTotp(true);
          return;
        }
        const title =
          result.error === "too_early" ? fill(copy.closeOutTooEarly, { date: opensOn })
            : result.error === "forbidden" ? copy.closeOutForbidden
              : result.error === "invalid" ? copy.invalid
                : copy.unavailable;
        toast({ title, tone: "danger" });
        return;
      }
      setWord("");
      toast({
        title: fill(copy.closeOutDone, { registrations: result.registrations, teams: result.teams, receipts: result.receipts }),
        tone: "success",
      });
      router.refresh();
    });
  }

  const ready = canClose && available && word === SCH_CLOSE_OUT_WORD && !pending;

  return (
    <section className="card space-y-3 border-danger/30" aria-labelledby="sch-close-out-title">
      <TotpPrompt
        open={needsTotp}
        onClose={() => setNeedsTotp(false)}
        onSuccess={() => {
          setNeedsTotp(false);
          run();
        }}
      />
      <h2 id="sch-close-out-title" className="section-title flex items-center gap-2">
        <Trash2 className="h-4 w-4 text-danger" aria-hidden />{copy.closeOutTitle}
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{copy.closeOutDesc}</p>
      <p className="max-w-2xl text-xs leading-relaxed text-text-muted">{copy.closeOutDrive}</p>
      {!canClose ? (
        <p className="text-sm text-text-soft">{copy.closeOutAdminOnly}</p>
      ) : !available ? (
        <p className="text-sm text-text-soft">{fill(copy.closeOutTooEarly, { date: opensOn })}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">{fill(copy.closeOutConfirm, { word: SCH_CLOSE_OUT_WORD })}</span>
            <input
              className="input"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
            />
          </label>
          <button type="button" className="btn-danger" onClick={run} disabled={!ready}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
            {pending ? copy.closeOutRunning : copy.closeOutButton}
          </button>
        </div>
      )}
    </section>
  );
}

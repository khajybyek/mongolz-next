"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheckBig, RotateCcw, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

import type { AlertState } from "@/lib/database.types";

const NOTE_MAX = 500;

/**
 * Per-row workflow buttons for /alerts. Which buttons render depends on the
 * current state (new: acknowledge + close · acknowledged: close + reopen ·
 * closed: reopen). Close goes through a dialog so an optional note can be
 * attached; the server enforces the transition rules again.
 */
export function AlertStateActions({
  id,
  state,
  note,
}: {
  id: string;
  state: AlertState;
  note?: string | null;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closeOpen, setCloseOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note ?? "");

  const closeDialog = useCallback(() => {
    if (!pending) setCloseOpen(false);
  }, [pending]);

  function transition(next: AlertState, extra?: { note?: string }) {
    startTransition(async () => {
      let res: Response | null = null;
      try {
        res = await fetch(`/api/alerts/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: next, ...extra }),
        });
      } catch {
        res = null;
      }
      if (res?.ok) {
        setCloseOpen(false);
        toast({ title: t("al_state_saved"), tone: "success", duration: 2000 });
        router.refresh();
        return;
      }
      // requireAdminApi answers 403 {error:"totp_required"} for admins without
      // TOTP — say so instead of a generic status.
      const body = res ? await res.json().catch(() => null) : null;
      const totp = res?.status === 403 && body?.error === "totp_required";
      toast({
        title: t("al_state_failed"),
        description: totp ? t("toast_totp_required") : res ? `HTTP ${res.status}` : undefined,
        tone: "danger",
      });
      // A 409 means someone else moved the row first — show the live state.
      if (res?.status === 409) router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {state === "new" && (
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={() => transition("acknowledged")}
          disabled={pending}
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {t("al_ack")}
        </button>
      )}
      {state !== "closed" && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setCloseOpen(true)}
          disabled={pending}
        >
          <CircleCheckBig className="w-3.5 h-3.5" />
          {t("al_close")}
        </button>
      )}
      {state !== "new" && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => transition("new")}
          disabled={pending}
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          {t("al_reopen")}
        </button>
      )}

      <Dialog
        open={closeOpen}
        onClose={closeDialog}
        title={t("al_close_title")}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={closeDialog} disabled={pending}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => transition("closed", { note: noteDraft })}
              disabled={pending}
            >
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleCheckBig className="w-3.5 h-3.5" />}
              {t("al_close_confirm")}
            </button>
          </>
        }
      >
        <label className="label" htmlFor={`alert-note-${id}`}>
          {t("al_note")}
        </label>
        <textarea
          id={`alert-note-${id}`}
          className="input min-h-[5.5rem] resize-y"
          rows={3}
          maxLength={NOTE_MAX}
          placeholder={t("al_note_placeholder")}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          disabled={pending}
        />
        <p className="helper text-right tabular-nums">
          {noteDraft.length}/{NOTE_MAX}
        </p>
      </Dialog>
    </div>
  );
}

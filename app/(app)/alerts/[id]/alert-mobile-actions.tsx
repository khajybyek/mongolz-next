"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, FolderPlus, Loader2, PlayCircle, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { incidentCopy } from "@/lib/incident-copy";
import { workflowCopy } from "@/lib/workflow-copy";
import { AlertStateActions } from "../alert-state-actions";
import type { AlertLabel, AlertState } from "@/lib/database.types";

export function AlertMobileActions({
  id, state, label, note, playbackHref,
}: {
  id: string;
  state: AlertState;
  label: AlertLabel;
  note: string | null;
  playbackHref: string | null;
}) {
  const { t, lang } = useT();
  const incident = incidentCopy(lang);
  const workflow = workflowCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  // Seeded from the stored note each time the dialog opens, so a refresh
  // after a save (or another admin's edit) is never shadowed by a stale copy.
  const [noteDraft, setNoteDraft] = useState("");

  function setLabel(next: AlertLabel) {
    startTransition(async () => {
      const response = await fetch(`/api/alerts/${id}/label`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: next }),
      }).catch(() => null);
      if (!response?.ok) { toast({ title: t("al_state_failed"), tone: "danger" }); return; }
      toast({ title: t("al_state_saved"), tone: "success", duration: 1800 });
      router.refresh();
    });
  }

  function saveNote() {
    startTransition(async () => {
      const response = await fetch(`/api/alerts/${id}/note`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: noteDraft }),
      }).catch(() => null);
      if (!response?.ok) { toast({ title: t("al_state_failed"), tone: "danger" }); return; }
      setNoteOpen(false);
      toast({ title: t("al_state_saved"), tone: "success", duration: 1800 });
      router.refresh();
    });
  }

  return (
    <>
      {/* Below lg this floats just above MobileTabbar (same side insets, its
          68px row + border, and a 0.5rem gap) instead of covering it, so the
          main navigation stays usable on the page push notifications open. */}
      <div className="fixed left-[max(0.75rem,env(safe-area-inset-left,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+70px+0.5rem)] z-40 rounded-2xl border border-border bg-bg-primary/95 p-3 shadow-2xl backdrop-blur lg:sticky lg:inset-auto lg:bottom-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 lg:justify-between">
          <div className="flex flex-wrap justify-center gap-2">
            {playbackHref && <Link href={playbackHref as never} className="btn-secondary btn-sm"><PlayCircle className="h-4 w-4" />{workflow.openRecording}</Link>}
            <Link href={`/incidents?alert=${id}` as never} className="btn-secondary btn-sm"><FolderPlus className="h-4 w-4" />{incident.createFromAlert}</Link>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setNoteDraft(note ?? ""); setNoteOpen(true); }}><FileText className="h-4 w-4" />{t("al_note")}</button>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={label === "true_positive" ? "btn-primary btn-sm" : "btn-outline btn-sm"} disabled={pending} onClick={() => setLabel("true_positive")}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("al_true_positive")}
            </button>
            <button type="button" className={label === "false_positive" ? "btn-secondary btn-sm" : "btn-outline btn-sm"} disabled={pending} onClick={() => setLabel("false_positive")}>
              <X className="h-4 w-4" />{t("al_false_positive")}
            </button>
            <AlertStateActions id={id} state={state} note={note} />
          </div>
        </div>
      </div>
      <Dialog
        open={noteOpen}
        onClose={() => { if (!pending) setNoteOpen(false); }}
        title={t("al_note")}
        size="sm"
        footer={<><button type="button" className="btn-secondary" disabled={pending} onClick={() => setNoteOpen(false)}>{incident.cancel}</button><button type="button" className="btn-primary" disabled={pending} onClick={saveNote}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{incident.save}</button></>}
      >
        <textarea className="input min-h-28 resize-y" maxLength={500} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
        <p className="helper text-right tabular-nums">{noteDraft.length}/500</p>
      </Dialog>
    </>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Download, Film, Link2, Loader2, LockKeyhole, Plus, Save, UnlockKeyhole } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { incidentCopy, incidentPriorityLabel, incidentStatusLabel } from "@/lib/incident-copy";
import { evidenceExportErrorKey } from "@/lib/incident-export-error";
import { INCIDENT_PRIORITIES, INCIDENT_STATUSES } from "@/lib/incidents";
import { useToast } from "@/components/ui/toast";
import { TotpPrompt } from "@/components/totp-prompt";
import { Dialog } from "@/components/ui/dialog";
import {
  attachAlertToIncidentAction,
  attachRecordingToIncidentAction,
  createIncidentAction,
  setEvidenceHoldAction,
  updateIncidentAction,
  type IncidentActionResult,
} from "./actions";
import type { Incident, IncidentPriority, IncidentStatus } from "@/lib/database.types";

export interface AdminOption { id: string; email: string; full_name: string | null }
export interface AlertOption { id: string; label: string }
export interface RecordingOption { id: string; label: string; durationSec: number | null }

function errorMessage(result: Exclude<IncidentActionResult, { ok: true }>, copy: ReturnType<typeof incidentCopy>) {
  return result.error === "conflict" ? copy.conflict : result.error === "invalid" ? copy.invalid : copy.unavailable;
}

export function CreateIncidentForm({
  admins,
  alerts,
  initialAlertId = "",
}: {
  admins: AdminOption[];
  alerts: AlertOption[];
  initialAlertId?: string;
}) {
  const { lang } = useT();
  const copy = incidentCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(Boolean(initialAlertId));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await createIncidentAction({
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? ""),
        priority: String(data.get("priority") ?? "medium"),
        assigneeId: String(data.get("assignee") ?? ""),
        alertId: String(data.get("alert") ?? ""),
      });
      if ("error" in result) {
        toast({ title: errorMessage(result, copy), tone: "danger" });
        return;
      }
      toast({ title: copy.createdOk, tone: "success" });
      router.push(`/incidents/${result.id}`);
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />{copy.newIncident}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card mb-6 space-y-4 border-accent/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4 text-accent" />{copy.newIncident}</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={pending}>{copy.cancel}</button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="incident-title">{copy.name}</label>
          <input id="incident-title" name="title" required minLength={3} maxLength={160} className="input" autoFocus />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="incident-description">{copy.description} · {copy.optional}</label>
          <textarea id="incident-description" name="description" maxLength={2000} rows={3} className="input resize-y" />
        </div>
        <div>
          <label className="label" htmlFor="incident-priority">{copy.priority}</label>
          <select id="incident-priority" name="priority" defaultValue="medium" className="select">
            {INCIDENT_PRIORITIES.map((value) => <option key={value} value={value}>{incidentPriorityLabel(value, lang)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="incident-assignee">{copy.assignee}</label>
          <select id="incident-assignee" name="assignee" defaultValue="" className="select">
            <option value="">{copy.unassigned}</option>
            {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.full_name || admin.email}</option>)}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="incident-alert">{copy.attachAlert} · {copy.optional}</label>
          <select id="incident-alert" name="alert" defaultValue={initialAlertId} className="select">
            <option value="">{copy.chooseAlert}</option>
            {alerts.map((alert) => <option key={alert.id} value={alert.id}>{alert.label}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{copy.create}
      </button>
    </form>
  );
}

export function IncidentUpdateForm({ incident, admins }: { incident: Incident; admins: AdminOption[] }) {
  const { lang } = useT();
  const copy = incidentCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(incident.title);
  const [description, setDescription] = useState(incident.description ?? "");
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [priority, setPriority] = useState<IncidentPriority>(incident.priority);
  const [assignee, setAssignee] = useState(incident.assignee_id ?? "");
  const [note, setNote] = useState("");

  useEffect(() => {
    setTitle(incident.title);
    setDescription(incident.description ?? "");
    setStatus(incident.status);
    setPriority(incident.priority);
    setAssignee(incident.assignee_id ?? "");
  }, [incident.assignee_id, incident.description, incident.priority, incident.status, incident.title, incident.updated_at]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateIncidentAction({
        id: incident.id, expectedUpdatedAt: incident.updated_at, title, description,
        status, priority, assigneeId: assignee, note,
      });
      if ("error" in result) {
        toast({ title: errorMessage(result, copy), tone: "danger" });
        if (result.error === "conflict") router.refresh();
        return;
      }
      setNote("");
      toast({ title: copy.savedOk, tone: "success" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="section-title">{copy.details}</h2>
      <div>
        <label className="label" htmlFor="case-title">{copy.name}</label>
        <input id="case-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />
      </div>
      <div>
        <label className="label" htmlFor="case-description">{copy.description}</label>
        <textarea id="case-description" className="input resize-y" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="case-status">{copy.status}</label><select id="case-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>{INCIDENT_STATUSES.map((value) => <option key={value} value={value}>{incidentStatusLabel(value, lang)}</option>)}</select></div>
        <div><label className="label" htmlFor="case-priority">{copy.priority}</label><select id="case-priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value as IncidentPriority)}>{INCIDENT_PRIORITIES.map((value) => <option key={value} value={value}>{incidentPriorityLabel(value, lang)}</option>)}</select></div>
        <div><label className="label" htmlFor="case-assignee">{copy.assignee}</label><select id="case-assignee" className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">{copy.unassigned}</option>{admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.full_name || admin.email}</option>)}</select></div>
      </div>
      <div>
        <label className="label" htmlFor="case-note">{copy.note} · {copy.optional}</label>
        <textarea id="case-note" className="input resize-y" rows={3} maxLength={2000} placeholder={copy.noteHint} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{pending ? copy.saving : copy.save}
      </button>
    </form>
  );
}

export function AttachAlertForm({ incidentId, alerts }: { incidentId: string; alerts: AlertOption[] }) {
  const { lang } = useT();
  const copy = incidentCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [alertId, setAlertId] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!alertId) return;
    startTransition(async () => {
      const result = await attachAlertToIncidentAction(incidentId, alertId);
      if ("error" in result) toast({ title: errorMessage(result, copy), tone: "danger" });
      else {
        setAlertId("");
        toast({ title: copy.attachedOk, tone: "success" });
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <select className="select min-w-0 flex-1" value={alertId} onChange={(e) => setAlertId(e.target.value)} aria-label={copy.chooseAlert}>
        <option value="">{copy.chooseAlert}</option>
        {alerts.map((alert) => <option key={alert.id} value={alert.id}>{alert.label}</option>)}
      </select>
      <button className="btn-secondary shrink-0" type="submit" disabled={!alertId || pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{copy.attachAlert}
      </button>
    </form>
  );
}

export function AttachRecordingForm({ incidentId, recordings }: { incidentId: string; recordings: RecordingOption[] }) {
  const { lang } = useT();
  const copy = incidentCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [recordingId, setRecordingId] = useState("");
  const [startSec, setStartSec] = useState("0");
  const [endSec, setEndSec] = useState("30");
  const [note, setNote] = useState("");
  const [legalHold, setLegalHold] = useState(true);

  function choose(id: string) {
    setRecordingId(id);
    const duration = recordings.find((recording) => recording.id === id)?.durationSec;
    setStartSec("0");
    setEndSec(String(Math.max(0.1, Math.min(duration ?? 30, 30))));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await attachRecordingToIncidentAction({
        incidentId,
        recordingId,
        startSec: Number(startSec),
        endSec: Number(endSec),
        note,
        legalHold,
      });
      if ("error" in result) {
        toast({ title: errorMessage(result, copy), tone: "danger" });
        return;
      }
      setRecordingId("");
      setNote("");
      toast({ title: copy.recordingAttachedOk, tone: "success" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-bg-secondary/40 p-3">
      <div>
        <label className="label" htmlFor="evidence-recording">{copy.chooseRecording}</label>
        <select id="evidence-recording" className="select" value={recordingId} onChange={(event) => choose(event.target.value)} required>
          <option value="">{copy.chooseRecording}</option>
          {recordings.map((recording) => <option key={recording.id} value={recording.id}>{recording.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="clip-start">{copy.clipStart}</label><input id="clip-start" className="input" type="number" min="0" max="86400" step="0.1" value={startSec} onChange={(event) => setStartSec(event.target.value)} required /></div>
        <div><label className="label" htmlFor="clip-end">{copy.clipEnd}</label><input id="clip-end" className="input" type="number" min="0.1" max="86400" step="0.1" value={endSec} onChange={(event) => setEndSec(event.target.value)} required /></div>
      </div>
      <p className="text-xs text-text-muted">{copy.maxClip}</p>
      <div><label className="label" htmlFor="evidence-note">{copy.note} · {copy.optional}</label><textarea id="evidence-note" className="input resize-y" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <label className="flex cursor-pointer items-start gap-2.5 text-xs text-text-soft">
        <input className="mt-0.5 accent-accent" type="checkbox" checked={legalHold} onChange={(event) => setLegalHold(event.target.checked)} />
        <span><strong className="block text-text">{copy.legalHold}</strong>{copy.legalHoldHelp}</span>
      </label>
      <button type="submit" className="btn-secondary" disabled={pending || !recordingId}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}{copy.attachRecording}
      </button>
    </form>
  );
}

export function EvidenceHoldButton({ incidentId, evidenceId, legalHold }: { incidentId: string; evidenceId: string; legalHold: boolean }) {
  const { lang } = useT();
  const copy = incidentCopy(lang);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Releasing a hold needs a fresh TOTP step-up; the prompt opens on
  // REAUTH_REQUIRED and the same change is retried after a correct code.
  const [needsTotp, setNeedsTotp] = useState(false);
  const submit = () => startTransition(async () => {
    const result = await setEvidenceHoldAction({ incidentId, evidenceId, legalHold: !legalHold });
    if ("error" in result) {
      if (result.error === "REAUTH_REQUIRED") { setNeedsTotp(true); return; }
      toast({ title: errorMessage(result, copy), tone: "danger" });
    } else { toast({ title: copy.holdUpdatedOk, tone: "success" }); router.refresh(); }
  });
  return (
    <>
      <TotpPrompt open={needsTotp} onClose={() => setNeedsTotp(false)} onSuccess={() => { setNeedsTotp(false); submit(); }} />
      <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={submit}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : legalHold ? <UnlockKeyhole className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
        {legalHold ? copy.releaseHold : copy.applyHold}
      </button>
    </>
  );
}

export function EvidenceExportButton({ incidentId }: { incidentId: string }) {
  const { lang, t } = useT();
  const copy = incidentCopy(lang);
  const [busy, setBusy] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const retryRef = useRef(false);

  async function download() {
    if (passphrase.length < 12 || passphrase !== passphraseConfirm) {
      setError(copy.passphraseInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/evidence-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.error === "REAUTH_REQUIRED") {
          retryRef.current = true;
          setNeedsTotp(true);
          return;
        }
        // Never surface the route's raw English error text; map it to copy.
        const key = evidenceExportErrorKey(response.status, body?.error);
        setError(key ? t(key) : copy.exportFailed);
        return;
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `incident-${incidentId.slice(0, 8)}-${Date.now()}.zip.enc`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setExportOpen(false);
      setPassphrase("");
      setPassphraseConfirm("");
    } catch {
      setError(copy.exportFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => { setError(null); setExportOpen(true); }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{busy ? copy.exporting : copy.packageExport}
        </button>
        <p className="max-w-2xl text-xs leading-relaxed text-text-muted">{copy.exportHelp}</p>
        {/* While the dialog is open its backdrop covers this line — the same
            message is rendered inside the dialog instead (see below). */}
        {error && !exportOpen && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <Dialog
        open={exportOpen}
        onClose={() => { if (!busy) setExportOpen(false); }}
        title={copy.encryptPackage}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setExportOpen(false)}>{copy.cancel}</button>
            <button type="button" className="btn-primary" disabled={busy || passphrase.length < 12 || passphrase !== passphraseConfirm} onClick={() => void download()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{copy.packageExport}
            </button>
          </>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-text-muted">{copy.passphraseHelp}</p>
        <div className="space-y-3">
          <div><label className="label" htmlFor={`evidence-passphrase-${incidentId}`}>{copy.passphrase}</label><input id={`evidence-passphrase-${incidentId}`} type="password" className="input" minLength={12} maxLength={128} autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
          <div><label className="label" htmlFor={`evidence-passphrase-confirm-${incidentId}`}>{copy.passphraseConfirm}</label><input id={`evidence-passphrase-confirm-${incidentId}`} type="password" className="input" minLength={12} maxLength={128} autoComplete="new-password" value={passphraseConfirm} onChange={(event) => setPassphraseConfirm(event.target.value)} /></div>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Dialog>
      <TotpPrompt
        open={needsTotp}
        onClose={() => { setNeedsTotp(false); retryRef.current = false; }}
        onSuccess={() => { setNeedsTotp(false); if (retryRef.current) { retryRef.current = false; void download(); } }}
      />
    </>
  );
}

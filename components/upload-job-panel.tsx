"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { workflowCopy, workflowStatus } from "@/lib/workflow-copy";
import { canCancelUpload, isActiveUpload, isUploadJobStatus, type UploadJob } from "@/lib/recording-upload";

/** The durable job owns completion. Finishing an HTTP upload never means ready. */
export function UploadJobPanel({ jobId }: { jobId: string }) {
  const { lang } = useT();
  const c = workflowCopy(lang);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [failed, setFailed] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/upload-jobs/${jobId}`, { signal, cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.job || data.job.id !== jobId || !isUploadJobStatus(data.job.status)) throw new Error("invalid job");
      if (!signal?.aborted) { setJob(data.job); setFailed(false); }
    } catch { if (!signal?.aborted) setFailed(true); }
  }, [jobId]);
  const active = !job || isActiveUpload(job.status);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    const interval = active ? setInterval(update, 5_000) : null;
    document.addEventListener("visibilitychange", update);
    return () => { controller.abort(); if (interval) clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [refresh, active]);
  async function act(action: "retry" | "cancel") {
    setActing(true); setActionFailed(false);
    try {
      const res = await fetch(`/api/upload-jobs/${jobId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error("action failed");
      await refresh();
    } catch { setActionFailed(true); } finally { setActing(false); }
  }
  return <section className="rounded-lg border border-border bg-bg-tertiary p-3 space-y-3" aria-live="polite">
    <p className="text-sm">{job ? workflowStatus(job.status, lang) : c.uploadAccepted}</p>
    {job && <>
      <p className="text-xs text-text-soft">{job.camera_name}</p>
      {isActiveUpload(job.status) && <><progress className="w-full h-2" max={100} value={Math.max(0, Math.min(100, job.progress))} /><p className="text-xs text-text-muted">{job.progress}% · {c.autoRefresh}</p></>}
      {job.error_message && <p role="alert" className="text-xs text-danger break-words">{job.error_message}</p>}
      <div className="flex flex-wrap gap-2">
        {job.status === "ready" && <a className="btn-primary btn-sm" href={`/playback/${job.recording_id}`}>{c.recording}</a>}
        {job.status === "failed" && <button className="btn-secondary btn-sm" disabled={acting} onClick={() => act("retry")}>{c.retryJob}</button>}
        {canCancelUpload(job.status) && <button className="btn-ghost btn-sm" disabled={acting} onClick={() => act("cancel")}>{c.cancel}</button>}
      </div>
    </>}
    {(failed || actionFailed) && <p role="alert" className="text-xs text-warning">{actionFailed ? c.actionFailed : c.unavailable}</p>}
    <div className="flex gap-2"><button className="btn-ghost btn-sm" disabled={acting} onClick={() => refresh()}>{c.refresh}</button><a className="btn-ghost btn-sm" href="/jobs?kind=upload">{c.detail}</a></div>
  </section>;
}

"use client";

import { useState } from "react";
import { TotpPrompt } from "@/components/totp-prompt";
import { UploadJobPanel } from "@/components/upload-job-panel";
import { useT } from "@/lib/i18n/client";
import { workflowCopy } from "@/lib/workflow-copy";

export function UploadJobDetails({ jobId }: { jobId: string }) {
  const { lang } = useT();
  const c = workflowCopy(lang);
  const [open, setOpen] = useState(false);
  return <div><button className="btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{c.detail}</button>{open && <div className="mt-3"><UploadJobPanel jobId={jobId} /></div>}</div>;
}

export function RevealOutcome({ jobId }: { jobId: string }) {
  const { lang } = useT();
  const c = workflowCopy(lang);
  const [reauth, setReauth] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true); setError(false); setReady(false);
    try {
      const res = await fetch(`/api/reveal/${jobId}`, { cache: "no-store" });
      const body = await res.json();
      if (res.status === 401 && body.error === "REAUTH_REQUIRED") { setReauth(true); return; }
      if (!res.ok || body.status !== "completed" || !body.signed_url) throw new Error("output unavailable");
      setReady(true);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <button className="btn-secondary btn-sm" disabled={busy} onClick={open}>{c.result}</button>
    {ready && <video controls preload="metadata" className="w-full rounded-lg bg-black max-h-96" src={`/api/reveal/${jobId}/output`} onError={() => { setError(true); setReady(false); }} />}
    {error && <p role="alert" className="text-xs text-warning">{c.unavailable}</p>}
    <TotpPrompt open={reauth} onClose={() => setReauth(false)} onSuccess={() => { setReauth(false); void open(); }} />
  </div>;
}

import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { workflowCopy, workflowStatus } from "@/lib/workflow-copy";
import { JOB_PAGE_SIZE, pageNumber, type QueryParams } from "@/lib/workflow-query";
import { readMfaOk, shapeCount, shapeRows, type RpcCapableClient } from "@/lib/metrics";
import { WorkflowPagination } from "@/components/workflow-pagination";
import { WorkflowRefresh } from "@/components/workflow-refresh";
import { isActiveUpload } from "@/lib/recording-upload";
import { RevealOutcome, UploadJobDetails } from "./job-outcome";
import { revealErrorText } from "@/lib/reveal-errors";

export const dynamic = "force-dynamic";
const REVEAL_ACTIVE = ["pending_approval", "queued", "processing"] as const;
const REVEAL_FINISHED = ["completed", "failed", "rejected"] as const;

export default async function JobsPage({ searchParams }: { searchParams?: Promise<QueryParams> }) {
  const { profile } = await requireUser();
  const { t, lang } = await getT();
  const c = workflowCopy(lang);
  const params = (await searchParams) ?? {};
  const kind = params.kind ?? (profile.role === "admin" ? "all" : "upload");
  const state = params.state ?? "all";
  const revealPage = pageNumber(params.reveal_page);
  const uploadPage = pageNumber(params.upload_page);
  const admin = profile.role === "admin";
  if (revealPage === null || uploadPage === null || !["all", "upload", "reveal"].includes(String(kind)) || !["all", "active", "finished"].includes(String(state)) || typeof kind !== "string" || typeof state !== "string") return <><PageHeader title={t("jobs_title")} /><Empty message={c.invalidFilters} action={<a href="/jobs" className="btn-secondary">{c.clear}</a>} /></>;
  const client = await createClient();
  const showReveal = admin && kind !== "upload";
  const showUpload = kind !== "reveal";
  let rq = client.from("reveal_jobs").select("id, status, progress, method, recording_id, requested_email, error_message, rejected_reason, created_at, completed_at", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (state !== "all") rq = rq.in("status", state === "active" ? [...REVEAL_ACTIVE] : [...REVEAL_FINISHED]);
  let uq = client.from("upload_jobs").select("id, camera_name, recording_id, status, progress, attempts, error_message, created_at, updated_at, completed_at", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (state !== "all") uq = uq.in("status", state === "active" ? ["queued", "processing", "delivering"] : ["ready", "failed", "cancelled"]);
  const [revealRes, uploadRes, mfa] = await Promise.all([
    showReveal ? rq.range((revealPage - 1) * JOB_PAGE_SIZE, revealPage * JOB_PAGE_SIZE - 1) : Promise.resolve({ data: [], count: 0, error: null }),
    showUpload ? uq.range((uploadPage - 1) * JOB_PAGE_SIZE, uploadPage * JOB_PAGE_SIZE - 1) : Promise.resolve({ data: [], count: 0, error: null }),
    readMfaOk(client as unknown as RpcCapableClient),
  ]);
  const reveals = shapeRows(revealRes, mfa && admin);
  const uploads = shapeRows(uploadRes, mfa);
  const revealTotal = shapeCount(revealRes, mfa && admin);
  const uploadTotal = shapeCount(uploadRes, mfa);
  const active = (reveals.state === "ok" && reveals.rows.some((job) => REVEAL_ACTIVE.some((status) => status === job.status))) || (uploads.state === "ok" && uploads.rows.some((job) => isActiveUpload(job.status)));
  const queryParams = { kind, state, reveal_page: revealPage > 1 ? revealPage : undefined, upload_page: uploadPage > 1 ? uploadPage : undefined };
  return <>
    <PageHeader title={t("jobs_title")} subtitle={c.jobsScope} />
    <form method="get" className="card flex flex-wrap items-center gap-3 mb-4">
      <select aria-label={c.detail} className="input w-auto" name="kind" defaultValue={kind}>
        {admin && <option value="all">{c.all}</option>}{admin && <option value="reveal">{c.reveal}</option>}<option value="upload">{c.upload}</option>
      </select>
      <select aria-label={t("col_status")} className="input w-auto" name="state" defaultValue={state}><option value="all">{c.all}</option><option value="active">{c.active}</option><option value="finished">{c.finished}</option></select>
      <button className="btn-primary" type="submit">{c.apply}</button>
    </form>
    <WorkflowRefresh active={active || state === "active"} />
    {!admin && kind === "reveal" && <Empty message={c.noAccess} />}
    <div className="space-y-6">
      {showReveal && <section className="space-y-3"><h2 className="section-title">{c.reveal}{revealTotal.state === "ok" ? ` · ${revealTotal.value}` : ""}</h2>
        {reveals.state !== "ok" || revealTotal.state !== "ok" ? <Empty message={reveals.state === "denied" || revealTotal.state === "denied" ? c.noAccess : c.unavailable} /> : !reveals.rows.length ? <Empty message={c.noResults} /> : reveals.rows.map((job) => <article key={job.id} className="card space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-mono text-text-soft">{job.id.slice(0, 8)} · {job.method}</span><JobStatus status={job.status} label={workflowStatus(job.status, lang)} /></div>
          <p className="text-xs text-text-muted">{job.requested_email ?? "—"} · {formatDate(job.created_at)}{job.completed_at ? ` → ${formatDate(job.completed_at)}` : ""}</p>
          {(job.status === "queued" || job.status === "processing") && <Progress value={job.progress ?? 0} />}
          {(job.error_message || job.rejected_reason) && <p role="alert" className="text-xs text-danger break-words">{revealErrorText(job.error_message, t) || job.rejected_reason}</p>}
          <div className="flex flex-wrap gap-2"><a className="btn-secondary btn-sm" href={`/playback/${job.recording_id}`}>{c.recording}</a>{job.status === "pending_approval" && <a className="btn-primary btn-sm" href="/reveal-approvals">{c.approval}</a>}</div>
          {job.status === "completed" && <RevealOutcome jobId={job.id} />}
        </article>)}
        {revealTotal.state === "ok" && <WorkflowPagination path="/jobs" params={queryParams} pageKey="reveal_page" page={revealPage} total={revealTotal.value} pageSize={JOB_PAGE_SIZE} lang={lang} />}
      </section>}
      {showUpload && <section className="space-y-3"><h2 className="section-title">{c.upload}{uploadTotal.state === "ok" ? ` · ${uploadTotal.value}` : ""}</h2>
        {uploads.state !== "ok" || uploadTotal.state !== "ok" ? <Empty message={uploads.state === "denied" || uploadTotal.state === "denied" ? c.noAccess : c.unavailable} /> : !uploads.rows.length ? <Empty message={c.noResults} /> : uploads.rows.map((job) => <article key={job.id} className="card space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="text-sm">{job.camera_name}</span><JobStatus status={job.status} label={workflowStatus(job.status, lang)} /></div>
          <p className="text-xs text-text-muted"><span className="font-mono">{job.id.slice(0, 8)}</span> · {formatDate(job.created_at)}{job.completed_at ? ` → ${formatDate(job.completed_at)}` : ""}</p>
          {isActiveUpload(job.status) && <Progress value={job.progress} />}
          {job.error_message && <p role="alert" className="text-xs text-danger break-words">{job.error_message}</p>}
          {job.status === "ready" && <a className="btn-primary btn-sm" href={`/playback/${job.recording_id}`}>{c.recording}</a>}
          <UploadJobDetails jobId={job.id} />
        </article>)}
        {uploadTotal.state === "ok" && <WorkflowPagination path="/jobs" params={queryParams} pageKey="upload_page" page={uploadPage} total={uploadTotal.value} pageSize={JOB_PAGE_SIZE} lang={lang} />}
      </section>}
    </div>
  </>;
}
function JobStatus({ status, label }: { status: string; label: string }) {
  const color = ["ready", "completed"].includes(status) ? "bg-success/15 text-success" : ["failed", "rejected"].includes(status) ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent";
  return <span className={`badge ${color}`}>{label}</span>;
}
function Progress({ value }: { value: number }) { const pct = Math.max(0, Math.min(100, value)); return <div className="flex items-center gap-2"><progress className="w-full h-2" value={pct} max={100} /><span className="text-xs text-text-muted">{pct}%</span></div>; }

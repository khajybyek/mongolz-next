import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { FaceThumb } from "@/components/face-thumb";
import { ReviewActions } from "./review-actions";
import { WorkflowPagination } from "@/components/workflow-pagination";
import { pageNumber, recordingFaceHref, REVIEW_PAGE_SIZE, type QueryParams } from "@/lib/workflow-query";
import { workflowCopy } from "@/lib/workflow-copy";
import { readMfaOk, shapeRows, shapeCount, formatMetric, type RpcCapableClient } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams?: Promise<QueryParams> }) {
  await requireAdmin();
  const { t, lang } = await getT();
  const c = workflowCopy(lang);
  const params = (await searchParams) ?? {};
  const page = pageNumber(params.page);
  const state = params.state ?? "pending";
  if (page === null || (state !== "pending" && state !== "reviewed")) return <><PageHeader title={t("review_title")} /><Empty message={c.invalidFilters} action={<a href="/review" className="btn-secondary">{c.clear}</a>} /></>;
  const supabase = await createClient();
  const query = supabase
    .from("faces")
    .select("id, filename, detected_at, recording_id, reviewed, review_label, crop_sealed", { count: "exact" })
    .order("detected_at", { ascending: false }).order("id", { ascending: false });
  // Filter in SQL before pagination: an older pending item must remain reachable.
  const filtered = state === "pending" ? query.or("reviewed.is.null,reviewed.eq.false") : query.eq("reviewed", true);
  const [reply, pendingReply, reviewedReply, mfaOk] = await Promise.all([
    filtered.range((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE - 1),
    supabase.from("faces").select("id", { count: "exact", head: true }).or("reviewed.is.null,reviewed.eq.false"),
    supabase.from("faces").select("id", { count: "exact", head: true }).eq("reviewed", true),
    readMfaOk(supabase as unknown as RpcCapableClient),
  ]);
  const result = shapeRows(reply, mfaOk);
  const total = shapeCount(reply, mfaOk);
  const pendingCount = shapeCount(pendingReply, mfaOk);
  const reviewedCount = shapeCount(reviewedReply, mfaOk);

  return (
    <>
      <PageHeader
        title={t("review_title")}
        subtitle={`${formatMetric(pendingCount)} ${t("review_unreviewed")} · ${formatMetric(reviewedCount)} ${t("review_reviewed")}`}
      />
      <nav className="flex gap-2 mb-4"><a className={state === "pending" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} href="/review">{c.outstanding}</a><a className={state === "reviewed" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} href="/review?state=reviewed">{c.reviewed}</a></nav>
      {pendingCount.state === "error" || reviewedCount.state === "error" ? <p role="alert" className="text-xs text-warning mb-3">{c.countUnavailable}</p> : null}
      {result.state !== "ok" || total.state !== "ok" ? <Empty message={result.state === "denied" || total.state === "denied" ? c.noAccess : c.unavailable} action={<a href="" className="btn-secondary">{c.retry}</a>} /> : !result.rows.length ? (
        <Empty message={t("review_empty")} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {result.rows.map((f) => (
            <div key={f.id} className="card p-0 overflow-hidden">
              <FaceThumb faceId={f.id} alt={f.filename} className="aspect-square" sealed={f.crop_sealed} />
              <div className="p-2 space-y-1.5">
                <div className="text-[10px] text-text-muted truncate">{formatDate(f.detected_at)}</div>
                {recordingFaceHref(f.recording_id, f.id) ? <a className="text-accent text-xs underline" href={recordingFaceHref(f.recording_id, f.id)!}>{c.openRecording}</a> : <p className="text-xs text-text-muted">{c.missingRecording}</p>}
                {state === "pending" ? <ReviewActions faceId={f.id} /> : <span className="text-xs text-text-soft">{f.review_label === "confirmed" ? t("review_confirm") : f.review_label === "rejected" ? t("review_reject") : c.uncertain}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {total.state === "ok" && <WorkflowPagination path="/review" params={{ state }} page={page} total={total.value} pageSize={REVIEW_PAGE_SIZE} lang={lang} />}
    </>
  );
}

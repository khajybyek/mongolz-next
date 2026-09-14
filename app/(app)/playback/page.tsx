import Link from "next/link";
import { PlayCircle, FileVideo, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { readMfaOk, readScope, shapeCount, shapeRows, rpcRows, type RpcCapableClient } from "@/lib/metrics";
import { archiveFilters, ARCHIVE_PAGE_SIZE, type QueryParams } from "@/lib/workflow-query";
import { workflowCopy, workflowStatus } from "@/lib/workflow-copy";
import { WorkflowPagination } from "@/components/workflow-pagination";

// Шинэ recording, шинэ faces автоматаар харагдах ёстой
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlaybackPage({ searchParams }: { searchParams?: Promise<QueryParams> }) {
  const { profile } = await requireUser();
  const { t, lang } = await getT();
  const c = workflowCopy(lang);
  const filters = archiveFilters((await searchParams) ?? {});
  const supabase = await createClient();
  const rpc = supabase as unknown as RpcCapableClient;
  if (!filters) return <><PageHeader title={t("nav_playback")} /><Empty message={c.invalidFilters} action={<Link className="btn-secondary" href="/playback">{c.clear}</Link>} /></>;

  let query = supabase.from("recordings")
    .select("id, filename, duration_sec, size_bytes, encrypted, camera_name, started_at, has_original, capture_status, capture_error", { count: "exact" })
    .order("started_at", { ascending: false }).order("id", { ascending: false });
  if (filters.camera) query = query.eq("camera_id", filters.camera);
  if (filters.since) query = query.gte("started_at", filters.since);
  if (filters.until) query = query.lt("started_at", filters.until);
  const [recordingRes, cameraRes, mfaOk] = await Promise.all([
    query.range((filters.page - 1) * ARCHIVE_PAGE_SIZE, filters.page * ARCHIVE_PAGE_SIZE - 1),
    supabase.from("cameras").select("id, name").order("name"),
    readMfaOk(rpc),
  ]);
  const scope = readScope(profile.role, mfaOk);
  const result = shapeRows(recordingRes, scope.recordings);
  const total = shapeCount(recordingRes, scope.recordings);
  const recordings = result.state === "ok" ? result.rows : [];
  const recIds = recordings.map((r) => r.id);
  const counts = scope.faces && recIds.length
    ? await rpcRows<{ recording_id: string; face_count: number | string }>(rpc, "recording_face_counts", { p_recording_ids: recIds })
    : { data: [], error: null };
  const faceCounts = new Map((counts.data ?? []).map((r) => [r.recording_id, Number(r.face_count)]));
  const queryParams = { from: filters.from, to: filters.to, camera: filters.camera };

  // Огноогоор бүлэглэх
  const grouped = new Map<string, typeof recordings>();
  for (const r of recordings ?? []) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.started_at));
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(r);
  }

  return (
    <>
      <PageHeader title={t("nav_playback")} />

      <form method="get" className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <label className="space-y-1 text-xs text-text-soft">{c.from}<input className="input" type="date" name="from" defaultValue={filters.from} /></label>
        <label className="space-y-1 text-xs text-text-soft">{c.to}<input className="input" type="date" name="to" defaultValue={filters.to} /></label>
        <label className="space-y-1 text-xs text-text-soft">{c.camera}<select className="input" name="camera" defaultValue={filters.camera}>
          <option value="">{c.allCameras}</option>
          {(cameraRes.data ?? []).map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
          {filters.camera && !cameraRes.data?.some((camera) => camera.id === filters.camera) && <option value={filters.camera}>{filters.camera}</option>}
        </select></label>
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">{c.apply}</button><Link className="btn-secondary" href="/playback">{c.clear}</Link></div>
        <p className="text-xs text-text-muted lg:col-span-4">{c.kst}</p>
      </form>
      {cameraRes.error && <p role="alert" className="text-warning text-xs mb-3">{c.camera}: {c.unavailable}</p>}
      {result.state !== "ok" || total.state !== "ok" ? (
        <Empty message={result.state === "denied" || total.state === "denied" ? c.noAccess : c.unavailable} action={<a className="btn-secondary" href="">{c.retry}</a>} />
      ) : !recordings.length ? (
        <Empty message={c.noResults} action={<Link className="btn-secondary" href="/playback">{c.clear}</Link>} />
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([day, items]) => (
            <div key={day}>
              <h2 className="text-xs uppercase tracking-wide text-text-soft mb-3">
                {day} · {items?.length ?? 0}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items?.map((r) => {
                  const fc = faceCounts.get(r.id);
                  return (
                    <a
                      key={r.id}
                      href={`/playback/${r.id}`}
                      className="card flex items-center gap-3 hover:bg-text-muted/[0.02] transition"
                    >
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <FileVideo className="w-5 h-5 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {r.filename}
                          {r.encrypted && <Lock className="w-3 h-3 text-warning" />}
                        </div>
                        <div className="text-xs text-text-muted flex items-center gap-1.5">
                          <span>{formatDate(r.started_at)}</span>
                          <span>·</span>
                          <span>{r.camera_name ?? "—"}</span>
                          <span>·</span>
                          <span>{r.size_bytes ? `${Math.round(r.size_bytes / 1024 / 1024)}MB` : "—"}</span>
                          <span>·</span>
                          {scope.faces && <span className={(fc ?? 0) > 0 ? "text-accent" : "text-text-faint"}>
                            {counts.error || fc === undefined ? c.countUnavailable : `${fc} · ${t("faces_label")}`}
                          </span>}
                          {r.capture_status !== "ready" && <span className="text-warning">{workflowStatus(r.capture_status, lang)}</span>}
                          {!r.has_original && (
                            <>
                              <span>·</span>
                              <span className="text-text-faint">{t("pb_no_reveal")}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <PlayCircle className={`w-4 h-4 ${r.capture_status === "ready" ? "text-text-soft" : "text-warning"}`} />
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {total.state === "ok" && <WorkflowPagination path="/playback" params={queryParams} page={filters.page} total={total.value} pageSize={ARCHIVE_PAGE_SIZE} lang={lang} />}
    </>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  pending_approval: "bg-warning/15 text-warning",
  queued: "bg-warning/15 text-warning",
  processing: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  rejected: "bg-danger/15 text-danger",
};

export default async function JobsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("reveal_jobs")
    .select("id, status, progress, method, recording_id, requested_email, error_message, created_at, started_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const waiting = (jobs ?? []).filter((j) => j.status === "pending_approval");
  const active = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "processing");
  const done = (jobs ?? []).filter((j) => j.status === "completed" || j.status === "failed" || j.status === "rejected");

  return (
    <>
      <PageHeader
        title="Job Queue"
        subtitle={`${waiting.length} awaiting approval · ${active.length} active · ${done.length} finished`}
      />

      {!jobs?.length ? (
        <Empty message="No reveal jobs yet" />
      ) : (
        <div className="space-y-4">
          {waiting.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-warning">Awaiting 4-eyes approval</h3>
              {waiting.map((j) => (
                <div key={j.id} className="bg-bg-tertiary rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-mono text-text-soft">{j.id.slice(0, 8)}</span>
                    <span className="text-[10px] text-text-muted ml-2">{j.method} · {j.requested_email}</span>
                  </div>
                  <span className={cn("badge", STATUS_COLORS[j.status])}>{j.status}</span>
                </div>
              ))}
            </div>
          )}
          {active.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-text-soft">Active Jobs</h3>
              {active.map((j) => (
                <div key={j.id} className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono text-text-soft">{j.id.slice(0, 8)}</span>
                    <span className={cn("badge", STATUS_COLORS[j.status])}>{j.status}</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-accent rounded transition-all"
                      style={{ width: `${j.progress ?? 0}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-text-muted flex justify-between">
                    <span>{j.method} · {j.requested_email}</span>
                    <span>{j.progress ?? 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Requested By</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {done.map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-xs">{j.id.slice(0, 8)}</td>
                    <td>{j.method}</td>
                    <td>
                      <span className={cn("badge", STATUS_COLORS[j.status])}>{j.status}</span>
                    </td>
                    <td className="text-xs">{j.requested_email}</td>
                    <td className="text-xs">
                      <span className="text-text-muted">{formatDate(j.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

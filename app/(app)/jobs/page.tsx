import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-warning/15 text-warning",
  processing: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
};

export default async function JobsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("reveal_jobs")
    .select("id, status, progress, method, recording_id, requested_email, error_message, created_at, started_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const active = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "processing");
  const done = (jobs ?? []).filter((j) => j.status === "completed" || j.status === "failed");

  return (
    <>
      <PageHeader
        title="Job Queue"
        subtitle={`${active.length} active · ${done.length} completed`}
      />

      {!jobs?.length ? (
        <Empty message="No reveal jobs yet" />
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-neutral-400">Active Jobs</h3>
              {active.map((j) => (
                <div key={j.id} className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono text-neutral-300">{j.id.slice(0, 8)}</span>
                    <span className={cn("badge", STATUS_COLORS[j.status])}>{j.status}</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-accent rounded transition-all"
                      style={{ width: `${j.progress ?? 0}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-neutral-500 flex justify-between">
                    <span>{j.method} · {j.requested_email}</span>
                    <span>{j.progress ?? 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary/50">
                <tr className="text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 text-left">Job ID</th>
                  <th className="px-4 py-2.5 text-left">Method</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Requested By</th>
                  <th className="px-4 py-2.5 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {done.map((j) => (
                  <tr key={j.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-xs">{j.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-neutral-400">{j.method}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("badge", STATUS_COLORS[j.status])}>{j.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-400 text-xs">{j.requested_email}</td>
                    <td className="px-4 py-2.5 text-neutral-500 text-xs">{formatDate(j.created_at)}</td>
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

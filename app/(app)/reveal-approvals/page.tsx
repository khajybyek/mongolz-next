import { Clock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { DecisionForms } from "./decision-forms";

export const dynamic = "force-dynamic";

interface RevealRow {
  id: string;
  status: string;
  reason: string | null;
  requested_by: string;
  requested_email: string | null;
  recording_id: string | null;
  threshold: number | null;
  target_start_sec: number | null;
  target_end_sec: number | null;
  created_at: string;
  approved_email: string | null;
  approved_at: string | null;
  rejected_email: string | null;
  rejected_reason: string | null;
  rejected_at: string | null;
}

function fmtSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function RevealApprovalsPage() {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const svc = createServiceClient();

  const { data: pending } = await svc
    .from("reveal_jobs")
    .select(
      "id, status, reason, requested_by, requested_email, recording_id, threshold, target_start_sec, target_end_sec, created_at, approved_email, approved_at, rejected_email, rejected_reason, rejected_at",
    )
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false });

  const { data: recent } = await svc
    .from("reveal_jobs")
    .select(
      "id, status, reason, requested_by, requested_email, recording_id, threshold, target_start_sec, target_end_sec, created_at, approved_email, approved_at, rejected_email, rejected_reason, rejected_at",
    )
    .in("status", ["queued", "processing", "completed", "rejected", "failed"])
    .order("created_at", { ascending: false })
    .limit(20);

  const pendingRows = (pending ?? []) as RevealRow[];
  const recentRows = (recent ?? []) as RevealRow[];

  return (
    <>
      <PageHeader title={t("reveal_approvals_title")} subtitle={t("reveal_approvals_subtitle")} />

      {/* Pending */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-warning mt-6 mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        {t("pending_label")} ({pendingRows.length})
      </h2>

      {pendingRows.length === 0 ? (
        <Empty message={t("no_pending")} />
      ) : (
        <div className="space-y-3">
          {pendingRows.map((j) => {
            const isSelfRequested = j.requested_by === ctx.user.id;
            return (
              <div
                key={j.id}
                className="card border border-warning/30 bg-warning/[0.04] space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="badge bg-warning/15 text-warning">pending</span>
                      <span className="font-mono text-text-soft">{j.id.slice(0, 8)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-text-soft">{t("requested_by")}: </span>
                      <span className="font-medium">{j.requested_email}</span>
                    </div>
                    {j.reason && (
                      <p className="text-xs text-text-soft bg-bg-tertiary/50 rounded p-2 mt-1">
                        <span className="text-text-muted mr-1">{t("reason")}:</span>
                        {j.reason}
                      </p>
                    )}
                    <div className="text-[11px] text-text-muted flex gap-3 flex-wrap">
                      <span>{formatDate(j.created_at)}</span>
                      {j.recording_id && (
                        <span className="font-mono">recording {j.recording_id.slice(0, 8)}</span>
                      )}
                      {j.threshold !== null && <span>threshold {j.threshold}</span>}
                      {j.target_start_sec !== null && j.target_end_sec !== null && (
                        <span className="text-accent font-mono">
                          ⏱ {fmtSec(j.target_start_sec)} → {fmtSec(j.target_end_sec)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {isSelfRequested ? (
                  <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2 items-start">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {t("approvals_self")}
                  </div>
                ) : (
                  <DecisionForms jobId={j.id} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent decisions */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-soft mt-8 mb-3">
        {t("recent_decisions")}
      </h2>
      {recentRows.length === 0 ? (
        <Empty message={t("no_decisions")} />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Job</th>
                <th>Хүсэлт</th>
                <th>Шийдвэр</th>
                <th>Status</th>
                <th className="num">Цаг</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-xs">
                    {j.id.slice(0, 8)}
                  </td>
                  <td className="text-xs">{j.requested_email ?? "—"}</td>
                  <td className="text-xs">
                    {j.approved_email ? (
                      <span className="text-success">✓ {j.approved_email}</span>
                    ) : j.rejected_email ? (
                      <span className="text-danger" title={j.rejected_reason ?? ""}>
                        ✗ {j.rejected_email}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        j.status === "completed"
                          ? "bg-success/15 text-success"
                          : j.status === "rejected" || j.status === "failed"
                          ? "bg-danger/15 text-danger"
                          : "bg-accent/15 text-accent"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="num text-xs">
                    <span className="text-text-muted">{formatDate(j.created_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

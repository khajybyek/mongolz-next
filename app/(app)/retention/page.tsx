import { Calendar, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { updateRetentionAction, runSweepAction } from "./actions";

export const dynamic = "force-dynamic";

interface Policy {
  resource: string;
  retention_days: number;
  enabled: boolean;
  last_swept_at: string | null;
  last_swept_rows: number | null;
}

const LABELS: Record<string, { mn: string; warn?: boolean }> = {
  recordings: { mn: "Бичлэгүүд" },
  faces: { mn: "Илрүүлсэн царайнууд" },
  alerts: { mn: "Alerts" },
  audit_log: { mn: "Audit log", warn: true },
  reveal_jobs: { mn: "Reveal jobs" },
  reveal_outputs: { mn: "Reveal output файлууд" },
};

export default async function RetentionPage() {
  await requireAdmin();
  const { t } = await getT();
  const svc = createServiceClient();
  const { data } = await svc
    .from("retention_policies")
    .select("resource, retention_days, enabled, last_swept_at, last_swept_rows")
    .order("resource");

  const policies = (data ?? []) as Policy[];

  return (
    <>
      <PageHeader title={t("retention_title")} subtitle={t("retention_subtitle")} />

      <form action={runSweepAction} className="mt-3 mb-6">
        <button type="submit" className="btn-secondary text-sm">
          <RefreshCw className="w-3.5 h-3.5" />
          {t("run_sweep")}
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {policies.map((p) => {
          const meta = LABELS[p.resource];
          return (
            <form
              key={p.resource}
              action={updateRetentionAction}
              className="card space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{meta?.mn ?? p.resource}</h3>
                  <code className="text-[10px] text-neutral-500">{p.resource}</code>
                </div>
                {meta?.warn && (
                  <span className="badge bg-warning/15 text-warning text-[10px]">
                    legal hold
                  </span>
                )}
              </div>

              <input type="hidden" name="resource" value={p.resource} />

              <div>
                <label className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1 block">
                  {t("retention_days")}
                </label>
                <input
                  type="number"
                  name="retention_days"
                  min={1}
                  max={36500}
                  defaultValue={p.retention_days}
                  required
                  className="input text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={p.enabled}
                  value="true"
                  className="w-4 h-4 rounded border-white/20 bg-bg-tertiary"
                />
                {t("active")}
              </label>

              {p.last_swept_at && (
                <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 border-t border-white/5 pt-2">
                  <Calendar className="w-3 h-3" />
                  {t("last_swept")}: {formatDate(p.last_swept_at)} ({p.last_swept_rows ?? 0})
                </div>
              )}

              <button type="submit" className="btn-primary w-full text-sm">
                {t("save")}
              </button>
            </form>
          );
        })}
      </div>

      <div className="card mt-4 text-xs text-neutral-400 leading-relaxed">
        💡 <b className="text-neutral-200">Audit log</b> нь default-аар disabled (legal hold).
        Зөвхөн хууль зүйн зөвлөгөөн дагуу идэвхжүүлнэ. Бусад resource-ыг өөрчилөхөд cron
        дараагийн өдөр устгана.
      </div>
    </>
  );
}

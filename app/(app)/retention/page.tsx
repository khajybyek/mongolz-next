import { Calendar, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translations";
import { updateRetentionAction, runSweepAction } from "./actions";

export const dynamic = "force-dynamic";

interface Policy {
  resource: string;
  retention_days: number;
  enabled: boolean;
  last_swept_at: string | null;
  last_swept_rows: number | null;
}

const LABELS: Record<string, { key: TranslationKey; warn?: boolean }> = {
  recordings: { key: "ret_res_recordings" },
  faces: { key: "ret_res_faces" },
  alerts: { key: "ret_res_alerts" },
  audit_log: { key: "ret_res_audit_log", warn: true },
  reveal_jobs: { key: "ret_res_reveal_jobs" },
  reveal_outputs: { key: "ret_res_reveal_outputs" },
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
        <button type="submit" className="btn-secondary">
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
                  <h3 className="section-title">{meta ? t(meta.key) : p.resource}</h3>
                  <code className="text-[10px] text-text-muted">{p.resource}</code>
                </div>
                {meta?.warn && (
                  <span className="badge bg-warning/15 text-warning text-[10px]">
                    {t("ret_legal_hold")}
                  </span>
                )}
              </div>

              <input type="hidden" name="resource" value={p.resource} />

              <div>
                <label className="label">
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
                  className="w-4 h-4 rounded border-text-muted/20 bg-bg-tertiary"
                />
                {t("active")}
              </label>

              {p.last_swept_at && (
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted border-t border-text-muted/5 pt-2">
                  <Calendar className="w-3 h-3" />
                  {t("last_swept")}: {formatDate(p.last_swept_at)} ({p.last_swept_rows ?? 0})
                </div>
              )}

              <button type="submit" className="btn-primary w-full">
                {t("save")}
              </button>
            </form>
          );
        })}
      </div>

      <div className="card mt-4 text-xs text-text-soft leading-relaxed">
        💡 {t("ret_note")}
      </div>
    </>
  );
}

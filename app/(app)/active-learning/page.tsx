import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, pct } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { LabelButtons } from "./label-buttons";
import { ThresholdsCard } from "./thresholds-card";

export const dynamic = "force-dynamic";

export default async function ActiveLearningPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, suspect_name, camera_name, similarity, label, screenshot_path, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const stats = {
    total: alerts?.length ?? 0,
    tp: alerts?.filter((a) => a.label === "true_positive").length ?? 0,
    fp: alerts?.filter((a) => a.label === "false_positive").length ?? 0,
    pending: alerts?.filter((a) => a.label === "unknown").length ?? 0,
  };

  return (
    <>
      <PageHeader
        title={t("active_learning_title")}
        subtitle={`${stats.pending} ${t("label_unknown")} · ${stats.tp} ${t("label_tp")} · ${stats.fp} ${t("label_fp")}`}
      />

      <ThresholdsCard />

      <div className="card mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <div>
          <div className="text-2xs uppercase tracking-wide text-text-muted">{t("col_total")}</div>
          <div className="text-xl font-bold text-text">{stats.total}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-text-muted">True positive</div>
          <div className="text-xl font-bold text-success">{stats.tp}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-text-muted">False positive</div>
          <div className="text-xl font-bold text-danger">{stats.fp}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-text-muted">
            {t("al_pending")}
          </div>
          <div className="text-xl font-bold text-warning">{stats.pending}</div>
        </div>
      </div>

      {!alerts?.length ? (
        <Empty message={t("no_alerts_yet")} />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("col_suspect")}</th>
                  <th>{t("col_camera")}</th>
                  <th>{t("col_similarity")}</th>
                  <th>{t("col_when")}</th>
                  <th>Label</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium text-text">{a.suspect_name}</td>
                    <td>{a.camera_name ?? "—"}</td>
                    <td>
                      <Badge variant="warning">{pct(a.similarity)}</Badge>
                    </td>
                    <td className="text-2xs">{formatDate(a.created_at)}</td>
                    <td>
                      <LabelButtons
                        id={a.id}
                        current={a.label as "true_positive" | "false_positive" | "unknown"}
                      />
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

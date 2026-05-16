import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
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
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">{t("col_total") || "Total"}</div>
          <div className="text-xl font-bold">{stats.total}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">True positive</div>
          <div className="text-xl font-bold text-success">{stats.tp}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">False positive</div>
          <div className="text-xl font-bold text-danger">{stats.fp}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Хүлээгдэж буй</div>
          <div className="text-xl font-bold text-warning">{stats.pending}</div>
        </div>
      </div>

      {!alerts?.length ? (
        <Empty message="Сэрэмжлүүлэг байхгүй" />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary/50">
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 text-left">Сэжигтэн</th>
                <th className="px-4 py-2.5 text-left">Камер</th>
                <th className="px-4 py-2.5 text-left">Таарц</th>
                <th className="px-4 py-2.5 text-left">Цаг</th>
                <th className="px-4 py-2.5 text-left">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-medium">{a.suspect_name}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{a.camera_name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="badge bg-warning/15 text-warning">{pct(a.similarity)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">{formatDate(a.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <LabelButtons id={a.id} current={a.label as "true_positive" | "false_positive" | "unknown"} />
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

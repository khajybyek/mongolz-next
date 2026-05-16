import { Download } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate, pct } from "@/lib/utils";

export default async function AlertsPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, suspect_name, similarity, screenshot_path, camera_name, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <>
      <PageHeader
        title={t("alert_history")}
        actions={
          <Link href="/api/alerts/csv" className="btn-ghost text-xs">
            <Download className="w-3.5 h-3.5" />
            {t("export_csv")}
          </Link>
        }
      />

      {!alerts?.length ? (
        <Empty message={t("no_alerts")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary/50">
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 text-left">{t("col_suspect")}</th>
                <th className="px-4 py-2.5 text-left">{t("col_camera")}</th>
                <th className="px-4 py-2.5 text-left">{t("col_similarity")}</th>
                <th className="px-4 py-2.5 text-left">{t("col_when")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-medium">{a.suspect_name}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{a.camera_name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="badge bg-danger/15 text-danger">{pct(a.similarity)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400">{formatDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

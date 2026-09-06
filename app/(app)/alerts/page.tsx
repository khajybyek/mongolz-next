import { Download, Bell, Cctv, Clock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate, pct } from "@/lib/utils";

function severity(sim: number | null | undefined): "danger" | "warning" | "info" {
  const s = sim ?? 0;
  if (s >= 0.7) return "danger";
  if (s >= 0.5) return "warning";
  return "info";
}

export default async function AlertsPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, suspect_name, similarity, screenshot_path, camera_name, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const total = alerts?.length ?? 0;
  const high = alerts?.filter((a) => (a.similarity ?? 0) >= 0.7).length ?? 0;
  const today = alerts?.filter((a) => {
    const d = new Date(a.created_at);
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    return d >= t0;
  }).length ?? 0;

  return (
    <>
      <PageHeader
        title={t("alert_history")}
        subtitle={t("alert_history_subtitle") || `${total.toLocaleString()} ${t("col_total") || "total"}`}
        icon={<Bell className="w-5 h-5" />}
        actions={
          <Link href="/api/alerts/csv" className="btn-secondary btn-sm">
            <Download className="w-3.5 h-3.5" />
            {t("export_csv")}
          </Link>
        }
      />

      {/* Quick summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryPill label={t("col_total") || "Total"} value={total} variant="muted" />
        <SummaryPill
          label={t("alerts_high") || "High severity"}
          value={high}
          variant="danger"
        />
        <SummaryPill label={t("today_alerts") || "Today"} value={today} variant="warning" />
      </div>

      {!alerts?.length ? (
        <Empty message={t("no_alerts")} />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("col_suspect")}</th>
                <th>{t("col_camera")}</th>
                <th>{t("col_similarity")}</th>
                <th>{t("col_when")}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-danger-soft border border-danger/20 inline-flex items-center justify-center shrink-0">
                        <Bell className="w-3.5 h-3.5 text-danger" />
                      </div>
                      <span className="font-medium text-text">{a.suspect_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Cctv className="w-3.5 h-3.5 opacity-60" />
                      {a.camera_name ?? "—"}
                    </span>
                  </td>
                  <td>
                    <Badge variant={severity(a.similarity)}>{pct(a.similarity)}</Badge>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-text-muted">
                      <Clock className="w-3.5 h-3.5 opacity-60" />
                      {formatDate(a.created_at)}
                    </span>
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

function SummaryPill({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "muted" | "danger" | "warning";
}) {
  const accentBg = {
    muted: "bg-text-muted/[0.04] border-border text-text",
    danger: "bg-danger-soft border-danger/20 text-danger",
    warning: "bg-warning-soft border-warning/20 text-warning",
  }[variant];

  return (
    <div className={`rounded-xl border px-4 py-3 ${accentBg}`}>
      <div className="text-2xs uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

import { Activity, BarChart3, Users, Bell, Calendar } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { AnalyticsCharts } from "./charts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireUser();
  const { t } = await getT();
  const supabase = await createClient();

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: byHour },
    { data: byDate },
    { data: alertsByDate },
    { data: topSuspects },
    { count: faces7d },
    { count: alerts7d },
    { count: recordings7d },
    { data: severitySplit },
  ] = await Promise.all([
    supabase.from("faces_by_hour").select("*"),
    supabase.from("faces_by_date").select("*").limit(30),
    supabase.from("alerts_by_date").select("*").limit(30),
    supabase.from("top_suspects").select("*"),
    supabase
      .from("faces")
      .select("id", { count: "exact", head: true })
      .gte("detected_at", since7d),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7d),
    supabase
      .from("recordings")
      .select("id", { count: "exact", head: true })
      .gte("started_at", since7d),
    supabase
      .from("alerts")
      .select("similarity")
      .gte("created_at", since7d)
      .limit(500),
  ]);

  const sev = { high: 0, med: 0, low: 0 };
  for (const row of severitySplit ?? []) {
    const s = (row.similarity ?? 0) as number;
    if (s >= 0.7) sev.high++;
    else if (s >= 0.5) sev.med++;
    else sev.low++;
  }

  // The reporting views expose nullable columns (aggregates over an outer
  // join); coerce once here so the chart component gets a strict shape.
  const byHourRows = (byHour ?? []).map((r) => ({ h: r.h ?? 0, c: r.c ?? 0 }));
  const byDateRows = (byDate ?? []).map((r) => ({ d: r.d ?? "", c: r.c ?? 0 }));
  const alertsByDateRows = (alertsByDate ?? []).map((r) => ({ d: r.d ?? "", c: r.c ?? 0 }));
  const topSuspectRows = (topSuspects ?? []).map((r) => ({
    suspect_name: r.suspect_name ?? "—",
    c: r.c ?? 0,
  }));

  const hasData =
    (byHour?.length ?? 0) +
      (byDate?.length ?? 0) +
      (alertsByDate?.length ?? 0) +
      (topSuspects?.length ?? 0) >
    0;

  return (
    <>
      <PageHeader
        title={t("analytics")}
        subtitle={t("analytics_subtitle")}
        icon={<BarChart3 className="w-5 h-5" />}
      />

      {/* KPI tiles — 7-day window */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t("analytics_kpi_faces_7d")}
          value={(faces7d ?? 0).toLocaleString()}
          icon={Users}
          accent="info"
        />
        <StatCard
          label={t("analytics_kpi_alerts_7d")}
          value={(alerts7d ?? 0).toLocaleString()}
          icon={Bell}
          accent={alerts7d && alerts7d > 0 ? "danger" : "default"}
        />
        <StatCard
          label={t("analytics_kpi_recordings_7d")}
          value={(recordings7d ?? 0).toLocaleString()}
          icon={Calendar}
          accent="warning"
        />
        <StatCard
          label={t("analytics_kpi_high_severity")}
          value={`${sev.high} / ${(severitySplit ?? []).length}`}
          icon={Activity}
          accent={sev.high > 0 ? "danger" : "default"}
          hint={`${sev.med} ${t("alerts_high_med")} · ${sev.low} ${t("alerts_high_low")}`}
        />
      </div>

      {!hasData ? (
        <Empty
          message={t("empty")}
          description={t("analytics_empty_desc")}
          icon={BarChart3}
        />
      ) : (
        <AnalyticsCharts
          byHour={byHourRows}
          byDate={byDateRows}
          alertsByDate={alertsByDateRows}
          topSuspects={topSuspectRows}
          labels={{
            hourly: t("hourly_chart"),
            daily: t("daily_chart"),
            alert: t("alert_chart"),
            top: t("top_suspects"),
          }}
        />
      )}
    </>
  );
}

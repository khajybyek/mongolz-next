import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { AnalyticsCharts } from "./charts";

export default async function AnalyticsPage() {
  await requireUser();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: byHour }, { data: byDate }, { data: alertsByDate }, { data: topSuspects }] =
    await Promise.all([
      supabase.from("faces_by_hour").select("*"),
      supabase.from("faces_by_date").select("*").limit(30),
      supabase.from("alerts_by_date").select("*").limit(30),
      supabase.from("top_suspects").select("*"),
    ]);

  const hasData =
    (byHour?.length ?? 0) +
      (byDate?.length ?? 0) +
      (alertsByDate?.length ?? 0) +
      (topSuspects?.length ?? 0) >
    0;

  return (
    <>
      <PageHeader title={t("analytics")} subtitle={t("nav_analytics")} />
      {!hasData ? (
        <Empty message={t("empty")} />
      ) : (
        <AnalyticsCharts
          byHour={byHour ?? []}
          byDate={byDate ?? []}
          alertsByDate={alertsByDate ?? []}
          topSuspects={topSuspects ?? []}
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

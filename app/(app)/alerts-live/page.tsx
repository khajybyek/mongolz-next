import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { LiveAlertsView } from "./live-view";

export const dynamic = "force-dynamic";

export default async function AlertsLivePage() {
  await requireAdmin();
  const { t } = await getT();
  const svc = createServiceClient();

  // Seed last 60 minutes for the chart
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await svc
    .from("alerts")
    .select("id, suspect_name, similarity, camera_name, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader title={t("alerts_live_title")} subtitle={t("alerts_live_subtitle")} />
      <LiveAlertsView
        seed={recent ?? []}
        labels={{
          channel: t("realtime_channel"),
          connected: t("connected"),
          connecting: t("connecting"),
          totalIn60m: t("total_in_60m"),
          topSuspects: t("top_suspects_label"),
          topCameras: t("top_cameras_label"),
          recentTitle: t("recent_alerts_live"),
        }}
      />
    </>
  );
}

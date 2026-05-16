import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { LiveAlertsView } from "./live-view";

export const dynamic = "force-dynamic";

export default async function AlertsLivePage() {
  await requireAdmin();
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
      <PageHeader
        title="Real-time Alerts"
        subtitle="Сүүлийн 60 минутын alerts + шууд урсгал (Supabase Realtime)"
      />
      <LiveAlertsView seed={recent ?? []} />
    </>
  );
}

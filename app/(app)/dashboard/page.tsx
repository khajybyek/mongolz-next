import { Users, UserSearch, Bell, Video } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatDate, pct } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { t } = await getT();

  const [
    { count: faceCount },
    { count: suspectCount },
    { count: alertCount },
    { count: recordingCount },
    { data: recentAlerts },
  ] = await Promise.all([
    supabase.from("faces").select("*", { count: "exact", head: true }),
    supabase.from("suspects").select("*", { count: "exact", head: true }),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte(
      "created_at",
      new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    ),
    supabase.from("recordings").select("*", { count: "exact", head: true }),
    supabase
      .from("alerts")
      .select("id, suspect_name, similarity, created_at, camera_name")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <>
      <PageHeader
        title={t("nav_dashboard")}
        subtitle="MONGOLZ Security — AI-Powered Surveillance"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t("total_faces")} value={faceCount ?? 0} icon={Users} />
        <StatCard label={t("suspects")} value={suspectCount ?? 0} icon={UserSearch} />
        <StatCard label={t("today_alerts")} value={alertCount ?? 0} icon={Bell} />
        <StatCard label={t("recording_days")} value={recordingCount ?? 0} icon={Video} />
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-4">
          {t("recent_alerts")}
        </h2>

        {!recentAlerts?.length ? (
          <Empty message={t("no_alerts")} />
        ) : (
          <div className="divide-y divide-white/5">
            {recentAlerts.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{a.suspect_name}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {a.camera_name ?? "—"} · {formatDate(a.created_at)}
                  </div>
                </div>
                <span className="badge bg-danger/15 text-danger">
                  {pct(a.similarity)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

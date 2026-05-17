import Link from "next/link";
import {
  Users,
  UserSearch,
  Bell,
  Video,
  ArrowRight,
  ShieldAlert,
  Activity,
  Cctv,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatDate, pct } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { t } = await getT();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sinceToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [
    { count: faceCount },
    { count: suspectCount },
    { count: alertCount },
    { count: recordingCount },
    { count: cameraCount },
    { count: alerts24h },
    { data: recentAlerts },
  ] = await Promise.all([
    supabase.from("faces").select("*", { count: "exact", head: true }),
    supabase.from("suspects").select("*", { count: "exact", head: true }),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", sinceToday),
    supabase.from("recordings").select("*", { count: "exact", head: true }),
    supabase.from("cameras").select("*", { count: "exact", head: true }).eq("enabled", true),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", since24h),
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
        subtitle={t("dashboard_subtitle") || "AI-Powered Surveillance — overview"}
        icon={<Activity className="w-5 h-5" />}
        actions={
          <Link href={"/ai" as never} className="btn-secondary btn-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("nav_ai")}</span>
          </Link>
        }
      />

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t("total_faces")}
          value={(faceCount ?? 0).toLocaleString()}
          icon={Users}
          accent="info"
        />
        <StatCard
          label={t("suspects")}
          value={(suspectCount ?? 0).toLocaleString()}
          icon={UserSearch}
          accent="warning"
        />
        <StatCard
          label={t("today_alerts")}
          value={(alertCount ?? 0).toLocaleString()}
          icon={Bell}
          accent={alertCount && alertCount > 0 ? "danger" : "default"}
          hint={`${alerts24h ?? 0} ${t("alerts_24h") || "in 24h"}`}
        />
        <StatCard
          label={t("recording_days")}
          value={(recordingCount ?? 0).toLocaleString()}
          icon={Video}
          accent="default"
        />
      </div>

      {/* Two-column lower section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent alerts (2/3) */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-text-soft" />
              <h2 className="text-sm font-semibold tracking-tight">{t("recent_alerts")}</h2>
            </div>
            <Link
              href={"/alerts" as never}
              className="text-xs text-text-soft hover:text-accent transition inline-flex items-center gap-1"
            >
              {t("see_all") || "See all"}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {!recentAlerts?.length ? (
            <Empty message={t("no_alerts")} />
          ) : (
            <ul className="divide-y divide-border">
              {recentAlerts.map((a) => (
                <li
                  key={a.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-danger-soft border border-danger/20 inline-flex items-center justify-center shrink-0">
                      <ShieldAlert className="w-4 h-4 text-danger" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-text truncate">{a.suspect_name}</div>
                      <div className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
                        <Cctv className="w-3 h-3 opacity-60" />
                        <span className="truncate">{a.camera_name ?? "—"}</span>
                        <span className="opacity-40">·</span>
                        <span>{formatDate(a.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="danger">{pct(a.similarity)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* System status (1/3) */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="section-title mb-3">{t("system_status") || "System status"}</h3>
            <div className="space-y-3">
              <StatusRow
                label={t("cameras_online") || "Cameras"}
                value={`${cameraCount ?? 0}`}
                status="ok"
              />
              <StatusRow
                label="ML Service"
                value={t("operational") || "Operational"}
                status="ok"
              />
              <StatusRow label="Database" value={t("status_db_connected")} status="ok" />
              <StatusRow
                label={t("alerts_24h") || "Alerts (24h)"}
                value={`${alerts24h ?? 0}`}
                status={alerts24h && alerts24h > 10 ? "warn" : "ok"}
              />
            </div>
          </div>

          <div className="card-glow">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold tracking-tight">
                  {t("ai_card_title") || "AI Insights"}
                </h4>
                <p className="text-xs text-text-soft mt-1 text-balance">
                  {t("ai_card_desc") ||
                    "Run anomaly detection and natural-language summaries on your alert stream."}
                </p>
                <Link
                  href={"/ai" as never}
                  className="text-xs text-accent hover:underline mt-2 inline-flex items-center gap-1"
                >
                  {t("ai_card_cta") || "Open AI"}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatusRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "ok" | "warn" | "down";
}) {
  const dotColor =
    status === "ok" ? "bg-success" : status === "warn" ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2.5">
        <span className={`relative inline-flex w-2 h-2 rounded-full ${dotColor}`}>
          <span
            className={`absolute inset-0 rounded-full ${dotColor} opacity-60 animate-ping`}
            style={{ animationDuration: "2s" }}
          />
        </span>
        <span className="text-text-soft">{label}</span>
      </div>
      <span className="text-xs font-medium text-text tabular-nums">{value}</span>
    </div>
  );
}

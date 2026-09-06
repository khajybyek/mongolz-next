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
  Search,
  UserPlus,
  ClipboardCheck,
  PlayCircle,
  BarChart3,
  FileVideo,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { cn, formatDate, pct } from "@/lib/utils";
import { alertStateLabelKey, asAlertState, stateBadgeVariant } from "@/lib/alerts";
import { LiveActivityFeed, type ActivityItem } from "./live-activity-feed";
import { probeDb, probeMl } from "@/lib/health-probes";

const DAY_MS = 24 * 60 * 60 * 1000;
const kstDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const kstWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" });

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { t } = await getT();
  const sp = (await searchParams) ?? {};
  const bounceMessage =
    sp.error === "admin-only" ? t("err_admin_only") : sp.error === "forbidden" ? t("err_forbidden") : null;
  const isAdmin = profile.role === "admin";

  const now = Date.now();
  const since24h = new Date(now - DAY_MS).toISOString();
  const sinceToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const since14d = new Date(now - 14 * DAY_MS).toISOString();

  const [
    { count: faceCount },
    { count: suspectCount },
    { count: alertCount },
    { count: recordingCount },
    { count: cameraCount },
    { count: alerts24h },
    { count: newAlerts },
    { data: recentAlerts },
    { data: trendRows },
    { data: cameraRows },
    { data: recordingRows },
    mlHealth,
    dbHealth,
  ] = await Promise.all([
    supabase.from("faces").select("*", { count: "exact", head: true }),
    supabase.from("suspects").select("*", { count: "exact", head: true }),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", sinceToday),
    supabase.from("recordings").select("*", { count: "exact", head: true }),
    supabase.from("cameras").select("*", { count: "exact", head: true }).eq("enabled", true),
    supabase.from("alerts").select("*", { count: "exact", head: true }).gte("created_at", since24h),
    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("state", "new"),
    supabase
      .from("alerts")
      .select("id, suspect_name, similarity, created_at, camera_name, state")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("alerts").select("created_at").gte("created_at", since14d).limit(5000),
    supabase
      .from("cameras")
      .select("id, name, cam_type, enabled")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("recordings")
      .select("id, filename, camera_name, started_at, duration_sec, encrypted")
      .order("started_at", { ascending: false })
      .limit(4),
    probeMl(2500),
    probeDb(2500),
  ]);

  // 14-day daily buckets (KST) → last 7 vs previous 7.
  const buckets = new Map<string, number>();
  for (let i = 13; i >= 0; i--) buckets.set(kstDay.format(new Date(now - i * DAY_MS)), 0);
  for (const row of trendRows ?? []) {
    const key = kstDay.format(new Date(row.created_at));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const series = [...buckets.entries()].map(([day, count]) => ({ day, count }));
  const last7 = series.slice(7);
  const prev7 = series.slice(0, 7);
  const last7Total = last7.reduce((s, d) => s + d.count, 0);
  const prev7Total = prev7.reduce((s, d) => s + d.count, 0);
  const delta = prev7Total === 0 ? (last7Total > 0 ? 100 : 0) : Math.round(((last7Total - prev7Total) / prev7Total) * 100);

  // Live-activity initial payload — last N alerts + audit rows merged.
  const [{ data: feedAlerts }, { data: feedAudit }] = await Promise.all([
    supabase
      .from("alerts")
      .select("id, created_at, type, suspect_name, similarity, camera_name, anomaly_z")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("audit_log")
      .select("id, action, detail, user_email, created_at")
      .in("action", [
        "LOGIN",
        "LOGIN_FAILED",
        "LOGIN_BLOCKED",
        "LOGOUT",
        "REVEAL_REQUESTED",
        "REVEAL_APPROVED",
        "REVEAL_REJECTED",
        "REVEAL_COMPLETED",
      ])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const initialActivity: ActivityItem[] = [];
  for (const a of (feedAlerts ?? []) as Array<{
    id: string;
    created_at: string;
    type: "match" | "anomaly" | null;
    suspect_name: string | null;
    similarity: number | null;
    camera_name: string | null;
    anomaly_z: number | null;
  }>) {
    if ((a.type ?? "match") === "anomaly") {
      const z = a.anomaly_z != null ? `z=${a.anomaly_z.toFixed(2)}` : "";
      initialActivity.push({
        id: `alert:${a.id}`,
        kind: "alert_anomaly",
        label: `Anomaly · ${a.camera_name ?? "Camera"}`,
        detail: z,
        ts: a.created_at,
      });
    } else {
      const score = a.similarity != null ? `${Math.round(a.similarity * 100)}%` : "—";
      initialActivity.push({
        id: `alert:${a.id}`,
        kind: "alert_match",
        label: a.suspect_name ?? "Unknown suspect",
        detail: `${a.camera_name ?? "—"} · ${score}`,
        ts: a.created_at,
      });
    }
  }
  for (const r of (feedAudit ?? []) as Array<{
    id: number;
    action: string;
    detail: string | null;
    user_email: string | null;
    created_at: string;
  }>) {
    const stripped = r.detail ? r.detail.split(" · ")[0] : null;
    const k = r.action;
    const id = `audit:${r.id}`;
    if (k === "LOGIN") {
      initialActivity.push({ id, kind: "login", label: "Login", actor: r.user_email, detail: stripped, ts: r.created_at });
    } else if (k === "LOGIN_FAILED" || k === "LOGIN_BLOCKED") {
      initialActivity.push({ id, kind: "login_failed", label: k === "LOGIN_BLOCKED" ? "Login blocked" : "Login failed", actor: r.user_email, detail: stripped, ts: r.created_at });
    } else if (k === "LOGOUT") {
      initialActivity.push({ id, kind: "logout", label: "Logout", actor: r.user_email, ts: r.created_at });
    } else if (k.startsWith("REVEAL_")) {
      initialActivity.push({ id, kind: "reveal", label: k.replace("_", " ").toLowerCase(), actor: r.user_email, detail: r.detail, ts: r.created_at });
    }
  }
  initialActivity.sort((a, b) => b.ts.localeCompare(a.ts));

  type QuickAction = {
    href: string;
    icon: LucideIcon;
    label: string;
    adminOnly?: boolean;
    tone?: "accent" | "default";
  };
  const allActions: QuickAction[] = [
    { href: "/live", icon: Video, label: t("qa_start_live"), tone: "accent" },
    { href: "/playback", icon: PlayCircle, label: t("qa_playback") },
    { href: "/search", icon: Search, label: t("qa_search_face"), adminOnly: true },
    { href: "/suspects", icon: UserPlus, label: t("qa_add_suspect"), adminOnly: true },
    { href: "/review", icon: ClipboardCheck, label: t("qa_review"), adminOnly: true },
    { href: "/analytics", icon: BarChart3, label: t("qa_analytics") },
  ];
  const quickActions = allActions.filter((a) => isAdmin || !a.adminOnly);

  return (
    <>
      {bounceMessage && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          {bounceMessage}
        </div>
      )}
      <PageHeader
        title={t("nav_dashboard")}
        subtitle={t("dashboard_subtitle") || "AI-Powered Surveillance — overview"}
        icon={<Activity className="w-5 h-5" />}
        actions={
          isAdmin ? (
            <Link href={"/ai" as never} className="btn-secondary btn-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t("nav_ai")}</span>
            </Link>
          ) : undefined
        }
      />

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
        <StatCard
          label={t("total_faces")}
          value={(faceCount ?? 0).toLocaleString()}
          icon={Users}
          accent="info"
          href={isAdmin ? "/faces" : undefined}
        />
        <StatCard
          label={t("suspects")}
          value={(suspectCount ?? 0).toLocaleString()}
          icon={UserSearch}
          accent="warning"
          href={isAdmin ? "/suspects" : undefined}
        />
        <StatCard
          label={t("today_alerts")}
          value={(alertCount ?? 0).toLocaleString()}
          icon={Bell}
          accent={alertCount && alertCount > 0 ? "danger" : "default"}
          hint={`${alerts24h ?? 0} ${t("alerts_24h") || "in 24h"} · ${newAlerts ?? 0} ${t("al_new_count")}`}
          href={isAdmin ? "/alerts" : undefined}
        />
        <StatCard
          label={t("recording_days")}
          value={(recordingCount ?? 0).toLocaleString()}
          icon={Video}
          accent="default"
          href="/playback"
        />
      </div>

      {/* Quick actions */}
      <div className="mb-4 md:mb-6">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="section-title">{t("dash_quick_actions")}</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href as never}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition-all hover-lift",
                  a.tone === "accent"
                    ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15 hover:border-accent/50"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-elevated text-text",
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 border transition-transform group-hover:scale-110",
                    a.tone === "accent"
                      ? "bg-accent/15 border-accent/20"
                      : "bg-text-muted/[0.05] border-border text-text-soft",
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="truncate">{a.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent alerts (2/3) */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-text-soft" />
              <h2 className="text-sm font-semibold tracking-tight">{t("recent_alerts")}</h2>
            </div>
            {isAdmin && (
              <Link
                href={"/alerts" as never}
                className="text-xs text-text-soft hover:text-accent transition inline-flex items-center gap-1"
              >
                {t("see_all") || "See all"}
                <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          {!recentAlerts?.length ? (
            <div className="p-6">
              <Empty
                icon={Bell}
                message={t("no_alerts")}
                description={t("ai_card_desc")}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentAlerts.map((a) => (
                <li
                  key={a.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-text-muted/[0.02] transition-colors"
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
                        <span className="tabular-nums">{formatDate(a.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={stateBadgeVariant(asAlertState(a.state))} dot>
                      {t(alertStateLabelKey(asAlertState(a.state)))}
                    </Badge>
                    <Badge variant={(a.similarity ?? 0) >= 0.7 ? "danger" : (a.similarity ?? 0) >= 0.5 ? "warning" : "info"}>
                      {pct(a.similarity ?? 0)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column: system status + AI card */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="section-title mb-3">{t("system_status") || "System status"}</h3>
            <div className="space-y-3">
              <StatusRow label={t("cameras_online") || "Cameras"} value={`${cameraCount ?? 0}`} status="ok" />
              <StatusRow
                label="ML Service"
                value={mlHealth.ok ? t("operational") : t("status_ml_down")}
                status={mlHealth.ok ? "ok" : "down"}
              />
              <StatusRow
                label="Database"
                value={dbHealth.ok ? t("status_db_connected") : t("status_db_down")}
                status={dbHealth.ok ? "ok" : "down"}
              />
              <StatusRow
                label={t("alerts_24h") || "Alerts (24h)"}
                value={`${alerts24h ?? 0}`}
                status={alerts24h && alerts24h > 10 ? "warn" : "ok"}
              />
            </div>
          </div>

          {isAdmin && (
            <div className="card-glow">
              <div className="flex items-start gap-3">
                <div className="icon-tile w-10 h-10">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold tracking-tight">{t("ai_card_title") || "AI Insights"}</h4>
                  <p className="text-xs text-text-soft mt-1 text-pretty">
                    {t("ai_card_desc") ||
                      "Run anomaly detection and natural-language summaries on your alert stream."}
                  </p>
                  <Link href={"/ai" as never} className="link text-xs mt-2 inline-flex items-center gap-1">
                    {t("ai_card_cta") || "Open AI"}
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Trend + cameras + recordings */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
        <div className="card">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="section-title">{t("dash_trend_7d")}</h3>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight tabular-nums">{last7Total.toLocaleString()}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium",
                    delta > 0 ? "text-danger" : delta < 0 ? "text-success" : "text-text-muted",
                  )}
                >
                  {delta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : delta < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                  {delta > 0 ? "+" : ""}
                  {delta}%
                </span>
              </div>
              <div className="text-2xs text-text-muted mt-0.5">{t("dash_vs_prev")}</div>
            </div>
            <span className="icon-tile w-9 h-9 bg-danger-soft text-danger border-danger/20">
              <Bell className="w-4 h-4" />
            </span>
          </div>
          <TrendBars data={last7} />
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">{t("dash_cameras")}</h3>
            {isAdmin && (
              <Link href={"/cameras" as never} className="text-xs text-text-soft hover:text-accent transition inline-flex items-center gap-1">
                {t("dash_manage")}
                <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          {!cameraRows?.length ? (
            <p className="text-xs text-text-muted py-6 text-center">{t("dash_no_cameras")}</p>
          ) : (
            <ul className="divide-y divide-border -mx-1">
              {cameraRows.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-1 py-2.5">
                  <span className="w-8 h-8 rounded-lg bg-text-muted/[0.05] border border-border inline-flex items-center justify-center text-text-soft shrink-0">
                    <Cctv className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text truncate">{c.name}</div>
                    <div className="text-2xs text-text-muted font-mono uppercase">{c.cam_type}</div>
                  </div>
                  <Badge variant={c.enabled ? "success" : "muted"} dot>
                    {c.enabled ? t("dash_cam_enabled") : t("dash_cam_disabled")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card md:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">{t("dash_recent_recordings")}</h3>
            <Link href={"/playback" as never} className="text-xs text-text-soft hover:text-accent transition inline-flex items-center gap-1">
              {t("see_all") || "See all"}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {!recordingRows?.length ? (
            <p className="text-xs text-text-muted py-6 text-center">{t("dash_no_recordings")}</p>
          ) : (
            <ul className="divide-y divide-border -mx-1">
              {recordingRows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/playback/${r.id}` as never}
                    className="flex items-center gap-3 px-1 py-2.5 rounded-lg hover:bg-text-muted/[0.03] transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 inline-flex items-center justify-center text-accent shrink-0">
                      <FileVideo className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text truncate inline-flex items-center gap-1.5 max-w-full">
                        <span className="truncate">{r.filename}</span>
                        {r.encrypted && <Lock className="w-3 h-3 text-warning shrink-0" />}
                      </div>
                      <div className="text-2xs text-text-muted truncate tabular-nums">
                        {formatDate(r.started_at)} · {r.camera_name ?? "—"}
                        {r.duration_sec ? ` · ${Math.round(r.duration_sec)}s` : ""}
                      </div>
                    </div>
                    <PlayCircle className="w-4 h-4 text-text-muted shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Live activity feed — realtime stream of alerts + audit events. */}
      <div className="mt-4">
        <LiveActivityFeed initial={initialActivity} />
      </div>
    </>
  );
}

function TrendBars({ data }: { data: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 h-24" role="img" aria-label={data.map((d) => `${d.day}: ${d.count}`).join(", ")}>
      {data.map((d) => {
        const h = Math.max(4, Math.round((d.count / max) * 100));
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0" title={`${d.day} · ${d.count}`}>
            <div className="w-full flex items-end h-16">
              <div
                className={cn(
                  "w-full rounded-md transition-colors",
                  d.count === 0 ? "bg-text-muted/[0.08]" : d.count === max ? "bg-danger/70" : "bg-accent/60",
                )}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="text-[10px] text-text-muted uppercase truncate">
              {kstWeekday.format(new Date(d.day + "T12:00:00+09:00"))}
            </span>
          </div>
        );
      })}
    </div>
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
  const dotColor = status === "ok" ? "bg-success" : status === "warn" ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center justify-between text-sm gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`relative inline-flex w-2 h-2 rounded-full shrink-0 ${dotColor}`}>
          {status === "ok" && (
            <span
              className={`absolute inset-0 rounded-full ${dotColor} opacity-60 animate-ping`}
              style={{ animationDuration: "2s" }}
            />
          )}
        </span>
        <span className="text-text-soft truncate">{label}</span>
      </div>
      <span className={cn("text-xs font-medium tabular-nums shrink-0", status === "down" ? "text-danger" : "text-text")}>
        {value}
      </span>
    </div>
  );
}

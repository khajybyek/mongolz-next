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
  LayoutGrid,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus,
  Server,
  Database,
  ArrowUpRight,
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
import type { Lang } from "@/lib/i18n/translations";
import { LiveActivityFeed, type ActivityItem } from "./live-activity-feed";
import { probeDb, probeMl } from "@/lib/health-probes";

const DAY_MS = 24 * 60 * 60 * 1000;
const kstDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { t, lang } = await getT();
  const sp = (await searchParams) ?? {};
  const bounceMessage =
    sp.error === "admin-only" ? t("err_admin_only") : sp.error === "forbidden" ? t("err_forbidden") : null;
  const isAdmin = profile.role === "admin";

  const now = Date.now();
  const since24h = new Date(now - DAY_MS).toISOString();
  const sinceToday = new Date(`${kstDay.format(new Date(now))}T00:00:00+09:00`).toISOString();
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
  const delta = prev7Total === 0 ? (last7Total > 0 ? null : 0) : Math.round(((last7Total - prev7Total) / prev7Total) * 100);

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
    // NVR grid — admins start / stop, viewers monitor read-only.
    { href: "/grid", icon: LayoutGrid, label: t("nav_grid") },
    { href: "/playback", icon: PlayCircle, label: t("qa_playback") },
    { href: "/search", icon: Search, label: t("qa_search_face"), adminOnly: true },
    { href: "/suspects", icon: UserPlus, label: t("qa_add_suspect"), adminOnly: true },
    { href: "/review", icon: ClipboardCheck, label: t("qa_review"), adminOnly: true },
    { href: "/analytics", icon: BarChart3, label: t("qa_analytics") },
  ];
  const quickActions = allActions.filter((a) => isAdmin || !a.adminOnly);

  const countLabel = (count: number | null) => count == null ? "—" : count.toLocaleString();

  return (
    <>
      {bounceMessage && (
        <div className="mb-5 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
          {bounceMessage}
        </div>
      )}
      <PageHeader
        title={t("nav_dashboard")}
        subtitle={t("dashboard_subtitle")}
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            {isAdmin && (
              <Link href={"/ai" as never} className="btn-secondary">
                <Sparkles className="h-4 w-4" />
                {t("nav_ai")}
              </Link>
            )}
            <Link href="/live" className="btn-primary">
              <Video className="h-4 w-4" />
              {t("qa_start_live")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        }
      />

      <section aria-label={t("dash_operations")} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label={t("total_faces")}
          value={countLabel(faceCount)}
          icon={Users}
          accent="info"
          href={isAdmin ? "/faces" : undefined}
        />
        <StatCard
          label={t("suspects")}
          value={countLabel(suspectCount)}
          icon={UserSearch}
          accent="warning"
          href={isAdmin ? "/suspects" : undefined}
        />
        <StatCard
          label={t("today_alerts")}
          value={countLabel(alertCount)}
          icon={Bell}
          accent={alertCount && alertCount > 0 ? "danger" : "default"}
          hint={`${countLabel(newAlerts)} ${t("al_new_count")}`}
          href={isAdmin ? "/alerts" : undefined}
        />
        <StatCard
          label={t("total_recordings")}
          value={countLabel(recordingCount)}
          icon={FileVideo}
          accent="default"
          href="/playback"
        />
      </section>

      <div className="mb-6 grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="card min-w-0 p-5 sm:p-6 xl:col-span-2" aria-labelledby="alert-trend-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="alert-trend-title" className="text-sm font-semibold text-text">{t("dash_trend_7d")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("dash_trend_description")}</p>
            </div>
            <Link href={"/analytics" as never} className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-text-soft transition-colors hover:text-accent">
              <span className="hidden sm:inline">{t("qa_analytics")}</span>
              <ArrowUpRight className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:hidden">{t("qa_analytics")}</span>
            </Link>
          </div>
          <div className="mb-5 mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums text-text">{trendRows ? last7Total.toLocaleString() : "—"}</span>
            {trendRows && (
              <div>
                {delta == null ? (
                  <span className="text-xs text-text-muted">{t("dash_no_baseline")}</span>
                ) : (
                  <>
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", delta > 0 ? "text-warning" : delta < 0 ? "text-success" : "text-text-soft")}>
                      {delta > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : delta < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      {delta > 0 ? "+" : ""}{delta}%
                    </span>
                    <p className="mt-0.5 text-xs text-text-muted">{t("dash_vs_prev")}</p>
                  </>
                )}
              </div>
            )}
          </div>
          {trendRows ? <TrendBars data={last7} lang={lang} /> : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">{t("dash_data_unavailable")}</div>
          )}
        </section>

        <section className="card flex min-w-0 flex-col p-5 sm:p-6" aria-labelledby="system-status-title">
          <div className="mb-5 flex items-center gap-2.5">
            <Server className="h-4 w-4 text-text-muted" />
            <h2 id="system-status-title" className="text-sm font-semibold text-text">{t("system_status")}</h2>
          </div>
          <div className="space-y-4">
            <StatusRow icon={Server} label={t("dash_ml_service")} value={mlHealth.ok ? t("operational") : t("status_ml_down")} status={mlHealth.ok ? "ok" : "down"} />
            <StatusRow icon={Database} label={t("dash_database")} value={dbHealth.ok ? t("status_db_connected") : t("status_db_down")} status={dbHealth.ok ? "ok" : "down"} />
            <div className="border-t border-border" />
            <StatusRow icon={Cctv} label={t("dash_enabled_cameras")} value={countLabel(cameraCount)} />
            <StatusRow icon={Bell} label={t("alerts_24h")} value={countLabel(alerts24h)} />
          </div>
          {isAdmin && (
            <Link href={"/ai" as never} className="group mt-5 flex items-start gap-3 rounded-xl border border-accent/15 bg-accent/[0.04] p-3.5 transition-colors hover:bg-accent/[0.08]">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-text">
                  {t("ai_card_title")}
                  <ArrowUpRight className="h-3.5 w-3.5 text-text-muted transition-colors group-hover:text-accent" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{t("ai_card_desc")}</p>
              </div>
            </Link>
          )}
        </section>
      </div>

      <nav aria-label={t("dash_quick_actions")} className="mb-6">
        <h2 className="mb-3 text-xs font-medium text-text-muted">{t("dash_quick_actions")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:flex 2xl:flex-wrap">
          {quickActions.map(({ href, icon: Icon, label, tone }) => (
            <Link
              key={href}
              href={href as never}
              className={cn(
                "group inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border px-3.5 py-3 text-xs font-medium transition-colors 2xl:flex-1",
                tone === "accent" ? "border-accent/20 bg-accent/[0.06] text-accent hover:bg-accent/10" : "border-border bg-surface text-text-soft hover:border-border-strong hover:bg-surface-elevated hover:text-text",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="leading-snug">{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="mb-6 grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <section className="card min-w-0 overflow-hidden p-0 xl:col-span-2" aria-labelledby="recent-alerts-title">
          <div className="flex min-h-[76px] items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <ShieldAlert className="h-4 w-4 text-text-muted" />
              <h2 id="recent-alerts-title" className="text-sm font-semibold text-text">{t("recent_alerts")}</h2>
              {newAlerts != null && newAlerts > 0 && <Badge variant="accent">{newAlerts} {t("al_new_count")}</Badge>}
            </div>
            {isAdmin && (
              <Link href={"/alerts" as never} className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 text-xs font-medium text-text-soft transition-colors hover:text-accent">
                {t("see_all")}<ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          {!recentAlerts?.length ? (
            <Empty
              icon={Bell}
              message={recentAlerts ? t("no_alerts") : t("dash_data_unavailable")}
              description={recentAlerts ? t("dash_alerts_empty_description") : undefined}
              className="min-h-[330px] rounded-none border-0 bg-transparent shadow-none"
              action={<Link href="/grid" className="btn-secondary btn-sm"><LayoutGrid className="h-4 w-4" />{t("nav_grid")}</Link>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentAlerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-elevated sm:flex-nowrap sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-elevated">
                      <ShieldAlert className="h-4 w-4 text-text-soft" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{a.suspect_name ?? t("label_unknown")}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                        <span className="inline-flex min-w-0 items-center gap-1"><Cctv className="h-3 w-3 shrink-0" /><span className="max-w-40 truncate">{a.camera_name ?? "—"}</span></span>
                        <time dateTime={a.created_at} className="tabular-nums">{formatDate(a.created_at)}</time>
                      </div>
                    </div>
                  </div>
                  <div className="ml-12 flex shrink-0 items-center gap-2 sm:ml-0">
                    <Badge variant={stateBadgeVariant(asAlertState(a.state))} dot>{t(alertStateLabelKey(asAlertState(a.state)))}</Badge>
                    <span title={t("col_similarity")} className="min-w-10 text-right font-mono text-xs text-text-soft">{a.similarity == null ? "—" : pct(a.similarity)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <LiveActivityFeed initial={initialActivity} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="card min-w-0 p-5 sm:p-6" aria-labelledby="dashboard-cameras-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5"><Cctv className="h-4 w-4 text-text-muted" /><h2 id="dashboard-cameras-title" className="text-sm font-semibold text-text">{t("dash_cameras")}</h2></div>
            <Link href={(isAdmin ? "/cameras" : "/grid") as never} className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-text-soft transition-colors hover:text-accent">
              {isAdmin ? t("dash_manage") : t("nav_grid")}<ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {!cameraRows?.length ? (
            <Empty icon={Cctv} message={cameraRows ? t("dash_no_cameras") : t("dash_data_unavailable")} size="compact" className="border-dashed bg-transparent shadow-none"
              action={isAdmin ? <Link href={"/cameras" as never} className="btn-secondary btn-sm">{t("dash_manage")}<ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {cameraRows.map((c) => (
                <li key={c.id}>
                  <Link href={`/grid?focus=${c.id}` as never} className="group flex items-center gap-3 rounded-lg py-3.5 transition-colors hover:bg-surface-elevated">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-elevated text-text-soft"><Cctv className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text">{c.name}</p><p className="mt-0.5 font-mono text-xs uppercase text-text-muted">{c.cam_type}</p></div>
                    <Badge variant={c.enabled ? "accent" : "muted"}>{c.enabled ? t("dash_cam_enabled") : t("dash_cam_disabled")}</Badge>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-text-muted group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-5 sm:p-6" aria-labelledby="dashboard-recordings-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5"><FileVideo className="h-4 w-4 text-text-muted" /><h2 id="dashboard-recordings-title" className="text-sm font-semibold text-text">{t("dash_recent_recordings")}</h2></div>
            <Link href="/playback" className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 text-xs font-medium text-text-soft transition-colors hover:text-accent">{t("see_all")}<ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          {!recordingRows?.length ? (
            <Empty icon={FileVideo} message={recordingRows ? t("dash_no_recordings") : t("dash_data_unavailable")} size="compact" className="border-dashed bg-transparent shadow-none"
              action={<Link href="/live" className="btn-secondary btn-sm"><Video className="h-3.5 w-3.5" />{t("qa_start_live")}</Link>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recordingRows.map((r) => (
                <li key={r.id}>
                  <Link href={`/playback/${r.id}` as never} className="group flex items-center gap-3 rounded-lg py-3.5 transition-colors hover:bg-surface-elevated">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.06] text-accent"><FileVideo className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-text"><span className="truncate">{r.filename}</span>{r.encrypted && <Lock className="h-3 w-3 shrink-0 text-text-muted" aria-label={t("rec_encrypted")} />}</div>
                      <p className="mt-1 truncate text-xs tabular-nums text-text-muted">{formatDate(r.started_at)} · {r.camera_name ?? "—"}{r.duration_sec ? ` · ${Math.round(r.duration_sec)}s` : ""}</p>
                    </div>
                    <PlayCircle className="h-5 w-5 shrink-0 text-text-muted group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function TrendBars({ data, lang }: { data: Array<{ day: string; count: number }>; lang: Lang }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const formatter = new Intl.DateTimeFormat(lang === "kr" ? "ko-KR" : lang === "mn" ? "mn-MN" : "en-US", { timeZone: "Asia/Seoul", weekday: "short" });
  return (
    <div className="relative pt-5" role="img" aria-label={data.map((d) => `${d.day}: ${d.count}`).join(", ")}>
      <div className="pointer-events-none absolute inset-x-0 bottom-7 top-5 flex flex-col justify-between" aria-hidden>
        {[0, 1, 2].map((line) => <div key={line} className="border-t border-dashed border-border" />)}
      </div>
      <div className="relative flex gap-3 sm:gap-5">
        {data.map((d, index) => (
          <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center" title={`${d.day} · ${d.count}`}>
            <div className="relative flex h-28 w-full max-w-14 items-end sm:h-32">
              <div
                className={cn("relative w-full rounded-t-md", d.count === 0 ? "bg-text-muted/20" : index === data.length - 1 ? "bg-accent" : "bg-accent/35 group-hover:bg-accent/60")}
                style={{ height: d.count === 0 ? "2px" : `${Math.max(3, (d.count / max) * 100)}%` }}
              >
                <span className="absolute -top-5 inset-x-0 text-center text-xs font-medium tabular-nums text-text-soft">{d.count}</span>
              </div>
            </div>
            <span className="mt-3 max-w-full truncate text-xs text-text-muted">{formatter.format(new Date(`${d.day}T12:00:00+09:00`))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusRow({ icon: Icon, label, value, status }: { icon: LucideIcon; label: string; value: string; status?: "ok" | "down" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2.5 text-xs text-text-soft"><Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" /><span>{label}</span></span>
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums", status === "down" ? "text-warning" : "text-text")}>
        {status && <span className={cn("h-1.5 w-1.5 rounded-full", status === "ok" ? "bg-success" : "bg-warning")} aria-hidden />}
        {value}
      </span>
    </div>
  );
}

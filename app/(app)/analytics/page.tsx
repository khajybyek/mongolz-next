import { Activity, BarChart3, Users, Bell, Calendar, RotateCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import {
  formatMetric,
  kstStartOfDayBeforeISO,
  readMfaOk,
  readScope,
  rpcRows,
  shapeCount,
  shapeRows,
  type MetricList,
  type MetricValue,
  type RpcCapableClient,
} from "@/lib/metrics";
import type { TranslationKey } from "@/lib/i18n/translations";
import { AnalyticsCharts, type ChartSeries } from "./charts";

export const dynamic = "force-dynamic";

/** Chart window, in Asia/Seoul days (today plus the 29 before it). */
const WINDOW_DAYS = 30;
/** KPI window, in Asia/Seoul days. */
const KPI_DAYS = 7;

// Rows of the aggregates in 20260909100000_analytics_aggregates.sql. int8
// arrives as a JSON number, but coerce anyway — PostgREST may widen it.
type HourRow = { hour_kst: number | string; n_faces: number | string };
type FacesDayRow = { day_kst: string; n_faces: number | string };
type AlertsDayRow = { day_kst: string; n_total: number | string; n_high: number | string };
type TopRow = { suspect: string | null; n_alerts: number | string };
type SeverityRow = {
  n_total: number | string;
  n_high: number | string;
  n_medium: number | string;
  n_low: number | string;
};

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

export default async function AnalyticsPage() {
  const { profile } = await requireUser();
  const { t } = await getT();
  const supabase = await createClient();
  const rpc = supabase as unknown as RpcCapableClient;

  // KPI windows are cut on Asia/Seoul day boundaries so they line up with the
  // charts (and with the dashboard), instead of on a rolling UTC 168 hours.
  const sinceKpi = kstStartOfDayBeforeISO(KPI_DAYS - 1);

  const [
    mfaOk,
    hourRes,
    facesDayRes,
    alertsDayRes,
    topRes,
    faces7dRes,
    alerts7dRes,
    recordings7dRes,
    severityRes,
  ] = await Promise.all([
    readMfaOk(rpc),
    rpcRows<HourRow>(rpc, "faces_hourly_kst", { p_days: WINDOW_DAYS }),
    rpcRows<FacesDayRow>(rpc, "faces_daily_kst", { p_days: WINDOW_DAYS }),
    rpcRows<AlertsDayRow>(rpc, "alerts_daily_kst", { p_days: WINDOW_DAYS }),
    rpcRows<TopRow>(rpc, "top_suspects_kst", { p_days: WINDOW_DAYS, p_limit: 10 }),
    supabase.from("faces").select("id", { count: "exact", head: true }).gte("detected_at", sinceKpi),
    supabase.from("alerts").select("id", { count: "exact", head: true }).gte("created_at", sinceKpi),
    supabase.from("recordings").select("id", { count: "exact", head: true }).gte("started_at", sinceKpi),
    // Exact split over the whole window. This used to be computed from the
    // newest 500 alert rows and printed as "high / total".
    rpcRows<SeverityRow>(rpc, "alerts_severity_kst", { p_days: KPI_DAYS }),
  ]);

  const scope = readScope(profile.role, mfaOk);

  const faces7d = shapeCount(faces7dRes, scope.faces);
  const alerts7d = shapeCount(alerts7dRes, scope.alerts);
  const recordings7d = shapeCount(recordings7dRes, scope.recordings);

  // The aggregates return a filled calendar even when RLS withheld every row,
  // so rows must not be read as proof of access here.
  const noProof = { rowsProveAccess: false } as const;
  const hourly = shapeRows<HourRow>(hourRes, scope.faces, noProof);
  const facesDaily = shapeRows<FacesDayRow>(facesDayRes, scope.faces, noProof);
  const alertsDaily = shapeRows<AlertsDayRow>(alertsDayRes, scope.alerts, noProof);
  const topSuspects = shapeRows<TopRow>(topRes, scope.alerts, noProof);
  const severity = shapeRows<SeverityRow>(severityRes, scope.alerts, noProof);

  const severityRow = severity.state === "ok" ? severity.rows[0] ?? null : null;
  const severityField = (pick: (r: SeverityRow) => number | string): MetricValue => {
    if (severity.state === "denied") return { state: "denied" };
    if (severity.state === "error") return { state: "error", message: severity.message };
    if (!severityRow) return { state: "error", message: "severity split returned no row" };
    return { state: "ok", value: num(pick(severityRow)) };
  };
  const sevTotal = severityField((r) => r.n_total);
  const sevHigh = severityField((r) => r.n_high);
  const sevMedium = severityField((r) => r.n_medium);
  const sevLow = severityField((r) => r.n_low);

  const deniedKey: TranslationKey = mfaOk ? "metric_no_access" : "metric_mfa_session";
  const hintFor = (m: MetricValue, okHint?: string): string | undefined =>
    m.state === "ok" ? okHint : m.state === "denied" ? t(deniedKey) : t("metric_unavailable");

  const toSeries = <T, U>(m: MetricList<T>, map: (rows: T[]) => U[]): ChartSeries<U> =>
    m.state === "ok" ? { state: "ok", rows: map(m.rows) } : { state: m.state };

  const charts = {
    byHour: toSeries(hourly, (rows) => rows.map((r) => ({ h: num(r.hour_kst), c: num(r.n_faces) }))),
    byDate: toSeries(facesDaily, (rows) => rows.map((r) => ({ d: r.day_kst, c: num(r.n_faces) }))),
    alertsByDate: toSeries(alertsDaily, (rows) => rows.map((r) => ({ d: r.day_kst, c: num(r.n_total) }))),
    topSuspects: toSeries(topSuspects, (rows) =>
      rows.map((r) => ({ suspect_name: r.suspect ?? t("label_unknown"), c: num(r.n_alerts) })),
    ),
  };

  const seriesStates = [hourly, facesDaily, alertsDaily, topSuspects];
  const everySeriesOk = seriesStates.every((m) => m.state === "ok");
  const noData =
    everySeriesOk &&
    seriesStates.every((m) => (m.state === "ok" ? m.rows.every((r) => rowIsEmpty(r)) : false));
  const failed = [faces7d, alerts7d, recordings7d, sevTotal, ...seriesStates].some((m) => m.state === "error");

  return (
    <>
      <PageHeader
        title={t("analytics")}
        subtitle={`${t("analytics_subtitle")} · ${t("metric_tz_kst")}`}
        icon={<BarChart3 className="w-5 h-5" />}
      />

      {failed && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-warning">{t("metric_error_title")}</p>
            <p className="mt-0.5 text-xs text-text-muted">{t("metric_error_desc")}</p>
          </div>
          <a href="/analytics" className="btn-secondary btn-sm shrink-0">
            <RotateCw className="w-3.5 h-3.5" />
            {t("metric_retry")}
          </a>
        </div>
      )}

      {/* KPI tiles — 7 KST days */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t("analytics_kpi_faces_7d")}
          value={formatMetric(faces7d)}
          icon={Users}
          accent={faces7d.state === "ok" ? "info" : "default"}
          hint={hintFor(faces7d, t("analytics_window_7d"))}
        />
        <StatCard
          label={t("analytics_kpi_alerts_7d")}
          value={formatMetric(alerts7d)}
          icon={Bell}
          accent={alerts7d.state === "ok" && alerts7d.value > 0 ? "danger" : "default"}
          hint={hintFor(alerts7d, t("analytics_window_7d"))}
        />
        <StatCard
          label={t("analytics_kpi_recordings_7d")}
          value={formatMetric(recordings7d)}
          icon={Calendar}
          accent={recordings7d.state === "ok" ? "warning" : "default"}
          hint={hintFor(recordings7d, profile.role === "admin" ? t("analytics_window_7d") : t("metric_scoped_permissions"))}
        />
        <StatCard
          label={t("analytics_kpi_high_severity")}
          value={sevHigh.state === "ok" && sevTotal.state === "ok" ? `${sevHigh.value.toLocaleString()} / ${sevTotal.value.toLocaleString()}` : "—"}
          icon={Activity}
          accent={sevHigh.state === "ok" && sevHigh.value > 0 ? "danger" : "default"}
          hint={
            hintFor(
              sevHigh,
              sevMedium.state === "ok" && sevLow.state === "ok"
                ? `${sevMedium.value} ${t("alerts_high_med")} · ${sevLow.value} ${t("alerts_high_low")}`
                : undefined,
            )
          }
        />
      </div>

      {noData ? (
        <Empty message={t("empty")} description={t("analytics_empty_desc")} icon={BarChart3} />
      ) : (
        <AnalyticsCharts
          byHour={charts.byHour}
          byDate={charts.byDate}
          alertsByDate={charts.alertsByDate}
          topSuspects={charts.topSuspects}
          labels={{
            hourly: t("hourly_chart"),
            daily: t("daily_chart"),
            alert: t("alert_chart"),
            top: t("top_suspects"),
          }}
          note={`${t("analytics_window_30d")} · ${t("metric_tz_kst")}`}
          messages={{
            denied: mfaOk ? t("metric_denied_title") : t("metric_mfa_session"),
            deniedDesc: t("metric_denied_desc"),
            error: t("metric_error_title"),
            errorDesc: t("metric_error_desc"),
            retry: t("metric_retry"),
            retryHref: "/analytics",
          }}
        />
      )}
    </>
  );
}

/** True when an aggregate row carries no observations (a filled-in gap). */
function rowIsEmpty(row: unknown): boolean {
  if (!row || typeof row !== "object") return true;
  const counts = Object.entries(row as Record<string, unknown>)
    .filter(([k]) => k.startsWith("n_"))
    .map(([, v]) => Number(v ?? 0) || 0);
  return counts.every((n) => n === 0);
}

import { Download, Bell, Cctv, Clock, RotateCw, FolderPlus, PlayCircle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { cn, formatDate, pct } from "@/lib/utils";
import {
  formatMetric,
  kstStartOfDayISO,
  readMfaOk,
  readScope,
  shapeCount,
  shapeRows,
  type MetricValue,
  type RpcCapableClient,
} from "@/lib/metrics";
import {
  ALERT_STATES,
  alertStateLabelKey,
  asAlertState,
  isAlertState,
  stateBadgeVariant,
} from "@/lib/alerts";
import { AlertStateActions } from "./alert-state-actions";
import { incidentCopy } from "@/lib/incident-copy";
import { workflowCopy } from "@/lib/workflow-copy";
import { recordingFaceHref } from "@/lib/workflow-query";

import type { AlertState } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/translations";

type StateFilter = AlertState | "all";

/**
 * How many rows the table renders. The summary pills and the tab badges are
 * exact head counts, so this cap only limits what is *listed* — and it is
 * labelled underneath the table rather than passed off as a total.
 */
const ROW_CAP = 500;

function severity(sim: number | null | undefined): "danger" | "warning" | "info" {
  const s = sim ?? 0;
  if (s >= 0.7) return "danger";
  if (s >= 0.5) return "warning";
  return "info";
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: Promise<{ state?: string }>;
}) {
  const { profile } = await requireAdmin();
  const { t, lang } = await getT();
  const incident = incidentCopy(lang);
  const workflow = workflowCopy(lang);
  const supabase = await createClient();

  const sp = (await searchParams) ?? {};
  const filter: StateFilter = isAlertState(sp.state) ? sp.state : "all";
  const sinceToday = kstStartOfDayISO();

  let query = supabase
    .from("alerts")
    .select(
      "id, suspect_id, suspect_name, similarity, screenshot_path, camera_id, camera_name, face_id, face:faces(recording_id), created_at, state, note, acknowledged_by, acknowledged_at, closed_by, closed_at, match_count, last_seen_at",
    )
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (filter !== "all") query = query.eq("state", filter);

  /** Head count over the rows this tab is showing — exact, never a sample. */
  const scoped = () => {
    const q = supabase.from("alerts").select("*", { count: "exact", head: true });
    return filter === "all" ? q : q.eq("state", filter);
  };
  const countBy = (s: AlertState) =>
    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("state", s);

  const [
    rowsRes,
    totalRes,
    highRes,
    todayRes,
    newRes,
    ackRes,
    closedRes,
    mfaOk,
  ] = await Promise.all([
    query,
    scoped(),
    scoped().gte("similarity", 0.7),
    // "Today" means today in Asia/Seoul — the zone every timestamp in the
    // table is printed in. The old boundary was the server's local midnight
    // (UTC on Vercel), so the pill disagreed with the rows next to it.
    scoped().gte("created_at", sinceToday),
    countBy("new"),
    countBy("acknowledged"),
    countBy("closed"),
    readMfaOk(supabase as unknown as RpcCapableClient),
  ]);

  // An admin whose session never proved the second factor reads every gated
  // table as empty (20260908110000). That must not print as "0 alerts".
  const scope = readScope(profile.role, mfaOk);
  const alerts = shapeRows(rowsRes, scope.alerts, { limit: ROW_CAP });
  const total = shapeCount(totalRes, scope.alerts);
  const high = shapeCount(highRes, scope.alerts);
  const today = shapeCount(todayRes, scope.alerts);
  const stateCounts: Record<Exclude<StateFilter, "all">, MetricValue> = {
    new: shapeCount(newRes, scope.alerts),
    acknowledged: shapeCount(ackRes, scope.alerts),
    closed: shapeCount(closedRes, scope.alerts),
  };
  const allCount: MetricValue =
    stateCounts.new.state === "ok" && stateCounts.acknowledged.state === "ok" && stateCounts.closed.state === "ok"
      ? { state: "ok", value: stateCounts.new.value + stateCounts.acknowledged.value + stateCounts.closed.value }
      : stateCounts.new.state === "denied" ? { state: "denied" } : { state: "error" };

  // Resolve who acknowledged / closed each row for the badge tooltip. One
  // lookup for the whole page; admins can read every profile under RLS.
  const rows = alerts.state === "ok" ? alerts.rows : [];
  const actorIds = new Set<string>();
  for (const a of rows) {
    if (a.acknowledged_by) actorIds.add(a.acknowledged_by);
    if (a.closed_by) actorIds.add(a.closed_by);
  }
  const actorEmail = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", [...actorIds]);
    for (const p of profiles ?? []) actorEmail.set(p.id, p.email);
  }

  const tabs: Array<{ value: StateFilter; label: string; href: string; count: MetricValue }> = [
    { value: "all", label: t("al_tab_all"), href: "/alerts", count: allCount },
    ...ALERT_STATES.map((s) => ({
      value: s as StateFilter,
      label: t(alertStateLabelKey(s)),
      href: `/alerts?state=${s}`,
      count: stateCounts[s],
    })),
  ];

  const deniedKey: TranslationKey = mfaOk ? "metric_no_access" : "metric_mfa_session";
  const pillNote = (m: MetricValue): string | undefined =>
    m.state === "ok" ? undefined : m.state === "denied" ? t(deniedKey) : t("metric_unavailable");
  const failed = [alerts, total, high, today, allCount].some((m) => m.state === "error");

  return (
    <>
      <PageHeader
        title={t("alert_history")}
        subtitle={t("alert_history_subtitle")}
        icon={<Bell className="w-5 h-5" />}
        actions={
          <Link href="/api/alerts/csv" className="btn-secondary btn-sm">
            <Download className="w-3.5 h-3.5" />
            {t("export_csv")}
          </Link>
        }
      />

      {failed && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-warning">{t("metric_error_title")}</p>
            <p className="mt-0.5 text-xs text-text-muted">{t("metric_error_desc")}</p>
          </div>
          <a href={filter === "all" ? "/alerts" : `/alerts?state=${filter}`} className="btn-secondary btn-sm shrink-0">
            <RotateCw className="w-3.5 h-3.5" />
            {t("metric_retry")}
          </a>
        </div>
      )}

      {/* Quick summary — exact counts over the whole tab, not over the page of
          rows below. `metric_kst_note` says which day "Today" means. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <SummaryPill label={t("col_total")} metric={total} note={pillNote(total)} variant="muted" />
        <SummaryPill label={t("alerts_high")} metric={high} note={pillNote(high)} variant="danger" />
        <SummaryPill label={t("today_alerts")} metric={today} note={pillNote(today) ?? t("metric_kst_note")} variant="warning" />
      </div>

      {/* Workflow-state tabs (server-rendered links so the filter is shareable) */}
      <nav className="tabs mb-4 overflow-x-auto" aria-label={t("al_state")}>
        {tabs.map((tab) => {
          const active = tab.value === filter;
          return (
            <Link
              key={tab.value}
              href={tab.href as never}
              aria-current={active ? "page" : undefined}
              className={cn("tab inline-flex items-center gap-2 whitespace-nowrap", active && "tab-active")}
            >
              {tab.label}
              <Badge variant={active ? "accent" : "muted"}>{formatMetric(tab.count)}</Badge>
            </Link>
          );
        })}
      </nav>

      {alerts.state === "denied" ? (
        <Empty
          icon={Bell}
          message={mfaOk ? t("metric_denied_title") : t("metric_mfa_session")}
          description={t("metric_denied_desc")}
        />
      ) : alerts.state === "error" ? (
        <Empty
          icon={Bell}
          message={t("metric_error_title")}
          description={t("metric_error_desc")}
          action={
            <a href={filter === "all" ? "/alerts" : `/alerts?state=${filter}`} className="btn-secondary btn-sm">
              <RotateCw className="w-3.5 h-3.5" />
              {t("metric_retry")}
            </a>
          }
        />
      ) : alerts.rows.length === 0 ? (
        <Empty
          message={t("no_alerts")}
          action={
            filter !== "all" ? (
              <Link href={"/alerts" as never} className="btn-secondary btn-sm">
                {t("al_tab_all")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("col_suspect")}</th>
                  <th>{t("col_camera")}</th>
                  <th>{t("col_similarity")}</th>
                  <th>{t("al_state")}</th>
                  <th>{t("col_when")}</th>
                  <th className="text-right">{t("col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.rows.map((a) => {
                  const state = asAlertState(a.state);
                  const face = Array.isArray(a.face) ? a.face[0] : a.face;
                  const playbackHref = a.face_id ? recordingFaceHref(face?.recording_id ?? null, a.face_id) : null;
                  const stateTitle = stateTooltip(state, {
                    ackBy: a.acknowledged_by ? actorEmail.get(a.acknowledged_by) ?? a.acknowledged_by.slice(0, 8) : null,
                    ackAt: a.acknowledged_at,
                    closedBy: a.closed_by ? actorEmail.get(a.closed_by) ?? a.closed_by.slice(0, 8) : null,
                    closedAt: a.closed_at,
                    ackLabel: t("al_ack"),
                    closeLabel: t("al_close"),
                  });
                  return (
                    <tr key={a.id} id={`alert-${a.id}`} className="scroll-mt-24 target:bg-accent/5">
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-danger-soft border border-danger/20 inline-flex items-center justify-center shrink-0">
                            <Bell className="w-3.5 h-3.5 text-danger" />
                          </div>
                          <div className="min-w-0">
                            {a.suspect_id ? (
                              <Link
                                href={`/suspects/${a.suspect_id}` as never}
                                className="font-medium text-text hover:text-accent transition-colors"
                              >
                                {a.suspect_name}
                              </Link>
                            ) : (
                              <span className="font-medium text-text">{a.suspect_name}</span>
                            )}
                            {a.note && (
                              <div
                                className="text-2xs text-text-muted truncate max-w-[16rem] mt-0.5"
                                title={a.note}
                              >
                                {a.note}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {a.camera_id ? (
                          <Link
                            href={`/grid?focus=${a.camera_id}` as never}
                            className="inline-flex items-center gap-1.5 hover:text-accent transition-colors"
                          >
                            <Cctv className="w-3.5 h-3.5 opacity-60" />
                            {a.camera_name ?? "—"}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <Cctv className="w-3.5 h-3.5 opacity-60" />
                            {a.camera_name ?? "—"}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge variant={severity(a.similarity)}>{pct(a.similarity)}</Badge>
                      </td>
                      <td>
                        <Badge variant={stateBadgeVariant(state)} dot title={stateTitle}>
                          {t(alertStateLabelKey(state))}
                        </Badge>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-text-muted">
                          <Clock className="w-3.5 h-3.5 opacity-60" />
                          {formatDate(a.created_at)}
                        </span>
                        {/* Repeat sightings merge into the open alert, so without
                            these the row silently understates the incident. */}
                        {(a.match_count ?? 1) > 1 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-2xs text-text-soft whitespace-nowrap">
                            <Badge variant="warning">×{a.match_count}</Badge>
                            {a.last_seen_at ? `${t("al_last_seen")} ${formatDate(a.last_seen_at)}` : null}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {playbackHref && (
                            <Link href={playbackHref as never} className="btn-secondary btn-sm" title={workflow.openRecording}>
                              <PlayCircle className="h-3.5 w-3.5" />
                              {workflow.openRecording}
                            </Link>
                          )}
                          <Link href={`/incidents?alert=${a.id}` as never} className="btn-ghost btn-sm" title={incident.createFromAlert}>
                            <FolderPlus className="h-3.5 w-3.5" />
                            {incident.createFromAlert}
                          </Link>
                          <AlertStateActions id={a.id} state={state} note={a.note} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* The list is a page, the pills above are the totals. Say so. */}
          <p className="mt-2 text-xs text-text-muted">
            {alerts.capped ? `${t("metric_capped_rows")} (${ROW_CAP.toLocaleString()})` : `${alerts.rows.length.toLocaleString()} / ${formatMetric(total)}`}
          </p>
        </>
      )}
    </>
  );
}

/** "Acknowledge · admin@x · 2026.09.07 10:12" style tooltip for the state badge. */
function stateTooltip(
  state: AlertState,
  v: {
    ackBy: string | null;
    ackAt: string | null;
    closedBy: string | null;
    closedAt: string | null;
    ackLabel: string;
    closeLabel: string;
  },
): string | undefined {
  const parts: string[] = [];
  if (v.ackAt) parts.push(`${v.ackLabel} · ${v.ackBy ?? "—"} · ${formatDate(v.ackAt)}`);
  if (state === "closed" && v.closedAt) {
    parts.push(`${v.closeLabel} · ${v.closedBy ?? "—"} · ${formatDate(v.closedAt)}`);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function SummaryPill({
  label,
  metric,
  note,
  variant,
}: {
  label: string;
  metric: MetricValue;
  note?: string;
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
      <div className={cn("text-2xl font-bold tabular-nums", metric.state !== "ok" && "text-text-muted")}>
        {formatMetric(metric)}
      </div>
      {note && <div className="text-2xs opacity-70 mt-1">{note}</div>}
    </div>
  );
}

import { Download, Bell, Cctv, Clock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { cn, formatDate, pct } from "@/lib/utils";
import {
  ALERT_STATES,
  alertStateLabelKey,
  asAlertState,
  isAlertState,
  stateBadgeVariant,
} from "@/lib/alerts";
import { AlertStateActions } from "./alert-state-actions";

import type { AlertState } from "@/lib/database.types";

type StateFilter = AlertState | "all";

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
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const sp = (await searchParams) ?? {};
  const filter: StateFilter = isAlertState(sp.state) ? sp.state : "all";

  let query = supabase
    .from("alerts")
    .select(
      "id, suspect_id, suspect_name, similarity, screenshot_path, camera_id, camera_name, created_at, state, note, acknowledged_by, acknowledged_at, closed_by, closed_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter !== "all") query = query.eq("state", filter);

  const countBy = (s: AlertState) =>
    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("state", s);

  const [{ data: alerts }, { count: newCount }, { count: ackCount }, { count: closedCount }] =
    await Promise.all([query, countBy("new"), countBy("acknowledged"), countBy("closed")]);

  const stateCounts: Record<StateFilter, number> = {
    new: newCount ?? 0,
    acknowledged: ackCount ?? 0,
    closed: closedCount ?? 0,
    all: (newCount ?? 0) + (ackCount ?? 0) + (closedCount ?? 0),
  };

  // Resolve who acknowledged / closed each row for the badge tooltip. One
  // lookup for the whole page; admins can read every profile under RLS.
  const actorIds = new Set<string>();
  for (const a of alerts ?? []) {
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

  const total = alerts?.length ?? 0;
  const high = alerts?.filter((a) => (a.similarity ?? 0) >= 0.7).length ?? 0;
  const today = alerts?.filter((a) => {
    const d = new Date(a.created_at);
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    return d >= t0;
  }).length ?? 0;

  const tabs: Array<{ value: StateFilter; label: string; href: string }> = [
    { value: "all", label: t("al_tab_all"), href: "/alerts" },
    ...ALERT_STATES.map((s) => ({
      value: s as StateFilter,
      label: t(alertStateLabelKey(s)),
      href: `/alerts?state=${s}`,
    })),
  ];

  return (
    <>
      <PageHeader
        title={t("alert_history")}
        subtitle={t("alert_history_subtitle") || `${total.toLocaleString()} ${t("col_total") || "total"}`}
        icon={<Bell className="w-5 h-5" />}
        actions={
          <Link href="/api/alerts/csv" className="btn-secondary btn-sm">
            <Download className="w-3.5 h-3.5" />
            {t("export_csv")}
          </Link>
        }
      />

      {/* Quick summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryPill label={t("col_total") || "Total"} value={total} variant="muted" />
        <SummaryPill
          label={t("alerts_high") || "High severity"}
          value={high}
          variant="danger"
        />
        <SummaryPill label={t("today_alerts") || "Today"} value={today} variant="warning" />
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
              <Badge variant={active ? "accent" : "muted"}>{stateCounts[tab.value].toLocaleString()}</Badge>
            </Link>
          );
        })}
      </nav>

      {!alerts?.length ? (
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
              {alerts.map((a) => {
                const state = asAlertState(a.state);
                const stateTitle = stateTooltip(state, {
                  ackBy: a.acknowledged_by ? actorEmail.get(a.acknowledged_by) ?? a.acknowledged_by.slice(0, 8) : null,
                  ackAt: a.acknowledged_at,
                  closedBy: a.closed_by ? actorEmail.get(a.closed_by) ?? a.closed_by.slice(0, 8) : null,
                  closedAt: a.closed_at,
                  ackLabel: t("al_ack"),
                  closeLabel: t("al_close"),
                });
                return (
                  <tr key={a.id}>
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
                    </td>
                    <td>
                      <AlertStateActions id={a.id} state={state} note={a.note} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
  value,
  variant,
}: {
  label: string;
  value: number;
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
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

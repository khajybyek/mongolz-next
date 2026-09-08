"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Eye,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useT } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";

type Kind =
  | "alert_match"
  | "alert_anomaly"
  | "login"
  | "login_failed"
  | "logout"
  | "reveal"
  | "audit_other";

export type ActivityItem = {
  id: string;
  kind: Kind;
  label: string;
  detail?: string | null;
  actor?: string | null;
  ts: string;
};

export interface AlertRow {
  id: string;
  created_at: string;
  type: "match" | "anomaly" | null;
  suspect_name: string | null;
  similarity: number | null;
  camera_name: string | null;
  anomaly_z: number | null;
}

export interface AuditRow {
  id: number;
  action: string;
  detail: string | null;
  user_email: string | null;
  created_at: string;
}

const MAX_ITEMS = 30;

function alertToItem(a: AlertRow): ActivityItem {
  if ((a.type ?? "match") === "anomaly") {
    const z = a.anomaly_z != null ? `z=${a.anomaly_z.toFixed(2)}` : "";
    return {
      id: `alert:${a.id}`,
      kind: "alert_anomaly",
      label: `Anomaly · ${a.camera_name ?? "Camera"}`,
      detail: z,
      ts: a.created_at,
    };
  }
  const score = a.similarity != null ? `${Math.round(a.similarity * 100)}%` : "—";
  return {
    id: `alert:${a.id}`,
    kind: "alert_match",
    label: a.suspect_name ?? "Unknown suspect",
    detail: `${a.camera_name ?? "—"} · ${score}`,
    ts: a.created_at,
  };
}

function auditToItem(r: AuditRow): ActivityItem | null {
  const id = `audit:${r.id}`;
  switch (r.action) {
    case "LOGIN":
      return { id, kind: "login", label: "Login", actor: r.user_email, detail: stripHostFromDetail(r.detail), ts: r.created_at };
    case "LOGIN_FAILED":
    case "LOGIN_BLOCKED":
      return { id, kind: "login_failed", label: r.action === "LOGIN_BLOCKED" ? "Login blocked" : "Login failed", actor: r.user_email, detail: stripHostFromDetail(r.detail), ts: r.created_at };
    case "LOGOUT":
      return { id, kind: "logout", label: "Logout", actor: r.user_email, ts: r.created_at };
    case "REVEAL_REQUESTED":
    case "REVEAL_APPROVED":
    case "REVEAL_REJECTED":
    case "REVEAL_COMPLETED":
      return { id, kind: "reveal", label: r.action.replace("_", " ").toLowerCase(), actor: r.user_email, detail: r.detail, ts: r.created_at };
    default:
      return null;
  }
}

function stripHostFromDetail(detail: string | null): string | null {
  // Audit `detail` ends with " · host=… · ua=…" — too long for a single
  // feed line. Surface only the first part (the human action summary).
  if (!detail) return null;
  return detail.split(" · ")[0];
}

function dedupe(items: ActivityItem[]): ActivityItem[] {
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

export function LiveActivityFeed({
  initial,
  state = "ok",
  mfaOk = true,
}: {
  initial: ActivityItem[];
  /** "denied" = RLS withheld the rows; "error" = the read failed. */
  state?: "ok" | "denied" | "error";
  /** false = the session never proved the second factor (see private.mfa_ok). */
  mfaOk?: boolean;
}) {
  const { t } = useT();
  const [items, setItems] = useState<ActivityItem[]>(() => dedupe(initial).slice(0, MAX_ITEMS));
  const [connections, setConnections] = useState<{ alerts: ConnectionState; audit: ConnectionState }>({ alerts: "connecting", audit: "connecting" });

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const updateConnection = (channel: "alerts" | "audit", status: string) => {
      if (!active) return;
      const next = status === "SUBSCRIBED" ? "connected" : ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) ? "offline" : "connecting";
      setConnections((previous) => ({ ...previous, [channel]: next }));
    };

    const alertChan = supabase
      .channel("dashboard-live-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const row = payload.new as AlertRow;
          const item = alertToItem(row);
          setItems((prev) => dedupe([item, ...prev]).slice(0, MAX_ITEMS));
        },
      )
      .subscribe((status) => updateConnection("alerts", status));

    const auditChan = supabase
      .channel("dashboard-live-audit")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        (payload) => {
          const row = payload.new as AuditRow;
          const item = auditToItem(row);
          if (!item) return;
          setItems((prev) => dedupe([item, ...prev]).slice(0, MAX_ITEMS));
        },
      )
      .subscribe((status) => updateConnection("audit", status));

    return () => {
      active = false;
      void supabase.removeChannel(alertChan);
      void supabase.removeChannel(auditChan);
    };
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_ITEMS),
    [items],
  );

  const connection: ConnectionState = Object.values(connections).every((state) => state === "connected")
    ? "connected"
    : Object.values(connections).some((state) => state === "offline") ? "offline" : "connecting";

  return (
    <section className="card min-w-0 overflow-hidden p-0" aria-labelledby="dashboard-activity-title">
      <div className="flex min-h-[76px] items-start gap-2.5 border-b border-border px-5 py-4">
        <Activity className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <h2 id="dashboard-activity-title" className="text-sm font-semibold text-text">{t("dash_live_activity")}</h2>
          <p className="mt-1 text-xs text-text-muted">{t("dash_activity_description")}</p>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-elevated"><Activity className="h-5 w-5 text-text-muted" /></span>
          <p className="max-w-56 text-sm leading-relaxed text-text-muted">
            {state === "error"
              ? t("metric_error_desc")
              : state === "denied"
                ? mfaOk
                  ? t("metric_denied_desc")
                  : t("metric_mfa_desc")
                : t("dash_live_empty")}
          </p>
        </div>
      ) : (
        <ul className="max-h-[448px] divide-y divide-border overflow-y-auto overscroll-contain" tabIndex={0} aria-label={t("dash_live_activity")}>
          {sorted.map((it) => <Row key={it.id} item={it} />)}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-elevated/40 px-5 py-3">
        <span className="inline-flex items-center gap-2 text-xs text-text-muted" role="status">
          <span className={cn("h-1.5 w-1.5 rounded-full", connection === "connected" ? "bg-success" : connection === "offline" ? "bg-warning" : "bg-text-muted")} aria-hidden />
          {t(connection === "connected" ? "dash_realtime_connected" : connection === "offline" ? "dash_realtime_offline" : "dash_realtime_connecting")}
        </span>
        <span className="font-mono text-xs tabular-nums text-text-muted" aria-hidden>{sorted.length.toString().padStart(2, "0")}</span>
      </div>
    </section>
  );
}

type ConnectionState = "connecting" | "connected" | "offline";

const LABEL_KEYS: Record<string, TranslationKey> = {
  Login: "login_title",
  Logout: "logout",
  "Login failed": "dash_login_failed",
  "Login blocked": "dash_login_blocked",
  "reveal requested": "dash_reveal_requested",
  "reveal approved": "dash_reveal_approved",
  "reveal rejected": "dash_reveal_rejected",
  "reveal completed": "dash_reveal_completed",
};

function Row({ item }: { item: ActivityItem }) {
  const { t } = useT();
  const { tone, Icon } = ICONS[item.kind] ?? ICONS.audit_other;
  const label = item.kind === "alert_anomaly"
    ? `${t("ai_mode_anomaly")} · ${item.label.slice("Anomaly · ".length) === "Camera" ? t("anomaly_camera") : item.label.slice("Anomaly · ".length)}`
    : item.kind === "alert_match"
      ? item.label === "Unknown suspect" ? t("label_unknown") : item.label
      : LABEL_KEYS[item.label] ? t(LABEL_KEYS[item.label]) : item.label;
  return (
    <li className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-elevated">
      <span className={cn("mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", tone)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text" title={label}>{label}</p>
        {item.detail && <p className="mt-0.5 truncate text-xs text-text-soft" title={item.detail}>{item.detail}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
          {item.actor && <span className="max-w-full truncate" title={item.actor}>{item.actor}</span>}
          <time dateTime={item.ts} className="tabular-nums">{formatDate(item.ts)}</time>
        </div>
      </div>
    </li>
  );
}

const ICONS: Record<Kind, { tone: string; Icon: typeof Activity }> = {
  alert_match: {
    tone: "bg-danger-soft border-danger/20 text-danger",
    Icon: ShieldAlert,
  },
  alert_anomaly: {
    tone: "bg-warning-soft border-warning/20 text-warning",
    Icon: TrendingUp,
  },
  login: {
    tone: "bg-success-soft border-success/20 text-success",
    Icon: LogIn,
  },
  login_failed: {
    tone: "bg-danger-soft border-danger/20 text-danger",
    Icon: XCircle,
  },
  logout: {
    tone: "bg-text-muted/10 border-border text-text-muted",
    Icon: LogOut,
  },
  reveal: {
    tone: "bg-accent/10 border-accent/20 text-accent",
    Icon: Eye,
  },
  audit_other: {
    tone: "bg-text-muted/10 border-border text-text-muted",
    Icon: UserPlus,
  },
};

export const ACTIVITY_KINDS = {
  ICONS,
  alertToItem,
  auditToItem,
  // Mostly exported so tests/other consumers reuse the predicates.
  ShieldCheck,
  Bell,
};

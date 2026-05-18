"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useT } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";

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

interface AlertRow {
  id: string;
  created_at: string;
  type: "match" | "anomaly" | null;
  suspect_name: string | null;
  similarity: number | null;
  camera_name: string | null;
  anomaly_z: number | null;
}

interface AuditRow {
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

export function LiveActivityFeed({ initial }: { initial: ActivityItem[] }) {
  const { t } = useT();
  const [items, setItems] = useState<ActivityItem[]>(initial);
  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    const supabase = createClient();

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
      .subscribe();

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
      .subscribe();

    channelsRef.current = [alertChan, auditChan];
    return () => {
      for (const ch of channelsRef.current) supabase.removeChannel(ch);
      channelsRef.current = [];
    };
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_ITEMS),
    [items],
  );

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-soft" />
          <h2 className="text-sm font-semibold tracking-tight">
            {t("dash_live_activity") || "Live activity"}
          </h2>
          <span
            className="ml-1 w-1.5 h-1.5 rounded-full bg-success animate-pulse"
            aria-hidden
            title="realtime"
          />
        </div>
        <span className="text-2xs text-text-faint">{sorted.length}</span>
      </div>

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-xs text-text-muted">
          {t("dash_live_empty") || "Waiting for the next event…"}
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-[480px] overflow-y-auto">
          {sorted.map((it) => (
            <Row key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item }: { item: ActivityItem }) {
  const { tone, Icon } = ICONS[item.kind] ?? ICONS.audit_other;
  return (
    <li className="px-5 py-2.5 flex items-center gap-3 text-sm">
      <div
        className={
          "w-7 h-7 rounded-full border inline-flex items-center justify-center shrink-0 " +
          tone
        }
      >
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-text truncate text-xs">
          <span className="font-medium">{item.label}</span>
          {item.detail && (
            <>
              <span className="opacity-40 mx-1.5">·</span>
              <span className="text-text-soft">{item.detail}</span>
            </>
          )}
        </div>
        <div className="text-2xs text-text-faint mt-0.5 flex items-center gap-1.5">
          {item.actor && (
            <>
              <span className="truncate max-w-[180px]">{item.actor}</span>
              <span className="opacity-40">·</span>
            </>
          )}
          <time>{formatDate(item.ts)}</time>
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

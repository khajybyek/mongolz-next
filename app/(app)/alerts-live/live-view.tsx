"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useT } from "@/lib/i18n/client";
import { useChartColors } from "@/lib/theme/chart-colors";

interface Alert {
  id: string;
  suspect_name: string;
  similarity: number;
  camera_name: string | null;
  created_at: string;
}

interface LiveAlertsLabels {
  channel: string;
  connected: string;
  connecting: string;
  totalIn60m: string;
  topSuspects: string;
  topCameras: string;
  recentTitle: string;
}

interface Props {
  seed: Alert[];
  labels: LiveAlertsLabels;
}

export function LiveAlertsView({ seed, labels }: Props) {
  const { t, lang } = useT();
  const chartColors = useChartColors();
  const [alerts, setAlerts] = useState<Alert[]>(seed);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const supabase = createBrowserClient(url, key);
    const channel = supabase
      .channel("alerts-live-dashboard")
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload: { new: Alert }) => {
          setAlerts((prev) => [payload.new, ...prev].slice(0, 200));
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Drop entries older than 60 min on a tick so the chart slides forward.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - 60 * 60 * 1000;
      setAlerts((prev) =>
        prev.filter((a) => new Date(a.created_at).getTime() >= cutoff),
      );
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Buckets: last 60 minutes by 5-min slot
  const histogram = useMemo(() => {
    const buckets = new Map<number, number>();
    for (let i = 11; i >= 0; i--) buckets.set(i * 5, 0);
    const now = Date.now();
    for (const a of alerts) {
      const minsAgo = Math.floor((now - new Date(a.created_at).getTime()) / 60_000);
      const slot = Math.min(55, Math.floor(minsAgo / 5) * 5);
      buckets.set(slot, (buckets.get(slot) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([min, count]) => ({ label: `-${min}m`, count }))
      .reverse();
  }, [alerts]);

  const bySuspect = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts) m.set(a.suspect_name, (m.get(a.suspect_name) ?? 0) + 1);
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [alerts]);

  const byCamera = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts) {
      const k = a.camera_name ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [alerts]);

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-muted">
          {labels.channel}:{" "}
          <span className={connected ? "text-success" : "text-warning"}>
            {connected ? `● ${labels.connected}` : `○ ${labels.connecting}`}
          </span>
        </div>
        <div className="text-xs text-text-muted">
          {labels.totalIn60m}: <b className="text-text">{alerts.length}</b>
        </div>
      </div>

      {/* Histogram chart */}
      <div className="card">
        <h3 className="text-sm font-semibold mb-3">{t("al_live_chart_title")}</h3>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={histogram} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="label" stroke={chartColors.axis} tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} stroke={chartColors.axis} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: chartColors.tooltipBg,
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: chartColors.tooltipText,
                }}
              />
              <Bar dataKey="count" fill="#00d4ff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two-column summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold mb-3">{labels.topSuspects}</h3>
          {bySuspect.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">{t("no_activity")}</p>
          ) : (
            <ul className="space-y-1.5">
              {bySuspect.map(([name, count]) => (
                <li key={name} className="flex items-center justify-between text-sm">
                  <span className="truncate">{name}</span>
                  <span className="badge bg-accent/15 text-accent">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold mb-3">{labels.topCameras}</h3>
          {byCamera.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">{t("no_activity")}</p>
          ) : (
            <ul className="space-y-1.5">
              {byCamera.map(([name, count]) => (
                <li key={name} className="flex items-center justify-between text-sm">
                  <span className="truncate">{name}</span>
                  <span className="badge bg-warning/15 text-warning">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent stream */}
      <div className="card p-0">
        <div className="px-4 py-2.5 border-b border-white/5 text-sm font-semibold">
          {labels.recentTitle}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="text-xs text-text-muted py-8 text-center">
              {t("al_live_empty")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {alerts.slice(0, 50).map((a) => (
                  <tr key={a.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2 font-medium truncate max-w-[200px]">
                      {a.suspect_name}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted truncate max-w-[150px]">
                      {a.camera_name ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`badge ${
                          a.similarity >= 0.7
                            ? "bg-danger/15 text-danger"
                            : a.similarity >= 0.55
                            ? "bg-warning/15 text-warning"
                            : "bg-text-muted/15 text-text-muted"
                        }`}
                      >
                        {(a.similarity * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted whitespace-nowrap">
                      {new Date(a.created_at).toLocaleTimeString(
                        lang === "kr" ? "ko-KR" : lang === "en" ? "en-US" : "mn-MN"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

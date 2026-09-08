"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { RotateCw } from "lucide-react";
import { useChartColors } from "@/lib/theme/chart-colors";

/**
 * A chart either has real rows, is closed to this caller, or failed to load.
 * The three must look different: an empty axis is a claim about the world,
 * and it must not stand in for "you cannot see this" or "the query broke".
 */
export type ChartSeries<T> = { state: "ok"; rows: T[] } | { state: "denied" } | { state: "error" };

interface Props {
  byHour: ChartSeries<{ h: number; c: number }>;
  byDate: ChartSeries<{ d: string; c: number }>;
  alertsByDate: ChartSeries<{ d: string; c: number }>;
  topSuspects: ChartSeries<{ suspect_name: string; c: number }>;
  labels: { hourly: string; daily: string; alert: string; top: string };
  /** Window + time zone the buckets were cut on, shown under every title. */
  note: string;
  messages: {
    denied: string;
    deniedDesc: string;
    error: string;
    errorDesc: string;
    retry: string;
    retryHref: string;
  };
}

export function AnalyticsCharts({
  byHour,
  byDate,
  alertsByDate,
  topSuspects,
  labels,
  note,
  messages,
}: Props) {
  const c = useChartColors();
  const tooltipStyle = {
    contentStyle: {
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      borderRadius: 10,
      backdropFilter: "blur(8px)",
      fontSize: 12,
      color: c.tooltipText,
    },
    cursor: { fill: "rgba(0, 212, 255, 0.06)" },
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title={labels.hourly} note={note} series={byHour} messages={messages}>
        {(rows) => (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="h" stroke={c.axis} fontSize={11} />
            <YAxis stroke={c.axis} fontSize={11} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="c" fill="url(#accentGrad)" radius={[6, 6, 0, 0]} />
            <defs>
              <linearGradient id="accentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00d4ff" stopOpacity={1} />
                <stop offset="100%" stopColor="#0099cc" stopOpacity={0.6} />
              </linearGradient>
            </defs>
          </BarChart>
        )}
      </ChartCard>

      <ChartCard title={labels.daily} note={note} series={byDate} messages={messages}>
        {(rows) => (
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="d" stroke={c.axis} fontSize={11} />
            <YAxis stroke={c.axis} fontSize={11} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Line
              type="monotone"
              dataKey="c"
              stroke="#00d4ff"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "#00d4ff", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#33dfff" }}
            />
          </LineChart>
        )}
      </ChartCard>

      <ChartCard title={labels.alert} note={note} series={alertsByDate} messages={messages}>
        {(rows) => (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="d" stroke={c.axis} fontSize={11} />
            <YAxis stroke={c.axis} fontSize={11} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="c" fill="url(#dangerGrad)" radius={[6, 6, 0, 0]} />
            <defs>
              <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={1} />
                <stop offset="100%" stopColor="#be123c" stopOpacity={0.6} />
              </linearGradient>
            </defs>
          </BarChart>
        )}
      </ChartCard>

      <ChartCard title={labels.top} note={note} series={topSuspects} messages={messages}>
        {(rows) => (
          <BarChart data={rows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis type="number" stroke={c.axis} fontSize={11} allowDecimals={false} />
            <YAxis
              dataKey="suspect_name"
              type="category"
              stroke={c.axis}
              fontSize={11}
              width={110}
            />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="c" fill="url(#warnGrad)" radius={[0, 6, 6, 0]} />
            <defs>
              <linearGradient id="warnGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity={1} />
              </linearGradient>
            </defs>
          </BarChart>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard<T>({
  title,
  note,
  series,
  messages,
  children,
}: {
  title: string;
  note: string;
  series: ChartSeries<T>;
  messages: Props["messages"];
  children: (rows: T[]) => React.ReactElement;
}) {
  return (
    <div className="card">
      <h3 className="section-title mb-0.5">{title}</h3>
      <p className="text-2xs text-text-muted mb-3">{series.state === "ok" ? note : " "}</p>
      <div className="h-64">
        {series.state === "ok" ? (
          <ResponsiveContainer width="100%" height="100%">
            {children(series.rows)}
          </ResponsiveContainer>
        ) : series.state === "denied" ? (
          <div className="h-full rounded-xl border border-dashed border-border bg-surface/40 flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-medium text-text-soft">{messages.denied}</p>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed max-w-xs">{messages.deniedDesc}</p>
          </div>
        ) : (
          <div className="h-full rounded-xl border border-warning/30 bg-warning-soft flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-medium text-warning">{messages.error}</p>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed max-w-xs">{messages.errorDesc}</p>
            <a href={messages.retryHref} className="btn-secondary btn-sm mt-4 inline-flex">
              <RotateCw className="w-3.5 h-3.5" />
              {messages.retry}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

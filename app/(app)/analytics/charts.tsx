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

interface Props {
  byHour: { h: number; c: number }[];
  byDate: { d: string; c: number }[];
  alertsByDate: { d: string; c: number }[];
  topSuspects: { suspect_name: string; c: number }[];
  labels: { hourly: string; daily: string; alert: string; top: string };
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "rgba(15,16,22,0.95)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    backdropFilter: "blur(8px)",
    fontSize: 12,
    color: "#f4f4f5",
  },
  cursor: { fill: "rgba(0, 212, 255, 0.06)" },
};

export function AnalyticsCharts({
  byHour,
  byDate,
  alertsByDate,
  topSuspects,
  labels,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title={labels.hourly}>
        <BarChart data={byHour}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="h" stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="url(#accentGrad)" radius={[6, 6, 0, 0]} />
          <defs>
            <linearGradient id="accentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity={1} />
              <stop offset="100%" stopColor="#0099cc" stopOpacity={0.6} />
            </linearGradient>
          </defs>
        </BarChart>
      </ChartCard>

      <ChartCard title={labels.daily}>
        <LineChart data={byDate}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="d" stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Line
            type="monotone"
            dataKey="c"
            stroke="#00d4ff"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#00d4ff", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#33dfff" }}
          />
        </LineChart>
      </ChartCard>

      <ChartCard title={labels.alert}>
        <BarChart data={alertsByDate}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="d" stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="url(#dangerGrad)" radius={[6, 6, 0, 0]} />
          <defs>
            <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={1} />
              <stop offset="100%" stopColor="#be123c" stopOpacity={0.6} />
            </linearGradient>
          </defs>
        </BarChart>
      </ChartCard>

      <ChartCard title={labels.top}>
        <BarChart data={topSuspects} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis type="number" stroke="#71717a" fontSize={11} />
          <YAxis
            dataKey="suspect_name"
            type="category"
            stroke="#71717a"
            fontSize={11}
            width={110}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="url(#warnGrad)" radius={[0, 6, 6, 0]} />
          <defs>
            <linearGradient id="warnGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={1} />
            </linearGradient>
          </defs>
        </BarChart>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactElement;
}) {
  return (
    <div className="card">
      <h3 className="section-title mb-3">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

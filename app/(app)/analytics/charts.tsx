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
  contentStyle: { background: "#12122a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 },
  cursor: { fill: "rgba(0, 212, 255, 0.05)" },
};

export function AnalyticsCharts({ byHour, byDate, alertsByDate, topSuspects, labels }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title={labels.hourly}>
        <BarChart data={byHour}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis dataKey="h" stroke="#888" fontSize={11} />
          <YAxis stroke="#888" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="#00d4ff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title={labels.daily}>
        <LineChart data={byDate}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis dataKey="d" stroke="#888" fontSize={11} />
          <YAxis stroke="#888" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Line type="monotone" dataKey="c" stroke="#00d4ff" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title={labels.alert}>
        <BarChart data={alertsByDate}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis dataKey="d" stroke="#888" fontSize={11} />
          <YAxis stroke="#888" fontSize={11} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="#ff3860" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title={labels.top}>
        <BarChart data={topSuspects} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis type="number" stroke="#888" fontSize={11} />
          <YAxis dataKey="suspect_name" type="category" stroke="#888" fontSize={11} width={100} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="c" fill="#ffdd57" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="card">
      <h3 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

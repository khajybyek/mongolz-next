import { PageHeader } from "@/components/ui/page-header";
import { Activity } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { Empty } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

// Web Vitals "good" thresholds (Google CWV 2024) — used for budget compare.
const BUDGETS: Record<string, { good: number; poor: number; unit: "ms" | "score" }> = {
  LCP: { good: 2500, poor: 4000, unit: "ms" },
  INP: { good: 200, poor: 500, unit: "ms" },
  CLS: { good: 0.1, poor: 0.25, unit: "score" },
  FCP: { good: 1800, poor: 3000, unit: "ms" },
  TTFB: { good: 800, poor: 1800, unit: "ms" },
};

type AggRow = {
  metric: string;
  page: string;
  day: string;
  p50: number;
  p75: number;
  p95: number;
  samples: number;
};

export default async function PerfBudgetPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("web_vitals_p75")
    .select("metric, page, day, p50, p75, p95, samples")
    .gte("day", since)
    .order("day", { ascending: false });

  const rows = (data ?? []) as AggRow[];

  // Aggregate further: collapse to "latest day" per (metric, page) for the table.
  const byKey = new Map<string, AggRow>();
  for (const r of rows) {
    const k = `${r.metric}::${r.page}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  const latest = Array.from(byKey.values());

  // Overall totals per metric across all pages (sum-weighted p75 approximation by sample count)
  const totals = new Map<string, { num: number; den: number; samples: number }>();
  for (const r of rows) {
    const tot = totals.get(r.metric) ?? { num: 0, den: 0, samples: 0 };
    tot.num += r.p75 * r.samples;
    tot.den += r.samples;
    tot.samples += r.samples;
    totals.set(r.metric, tot);
  }
  const overall = Array.from(totals.entries()).map(([metric, t]) => ({
    metric,
    p75: t.den ? t.num / t.den : 0,
    samples: t.samples,
  }));

  // Per-metric 7-day sparkline: sample-weighted daily p75 across all pages.
  const sparkBuckets = new Map<string, Map<string, { num: number; den: number }>>();
  for (const r of rows) {
    const inner = sparkBuckets.get(r.metric) ?? new Map();
    const day = r.day.slice(0, 10);
    const cur = inner.get(day) ?? { num: 0, den: 0 };
    cur.num += r.p75 * r.samples;
    cur.den += r.samples;
    inner.set(day, cur);
    sparkBuckets.set(r.metric, inner);
  }
  const sparkCollapsed = new Map<string, number[]>();
  for (const [metric, inner] of sparkBuckets.entries()) {
    const series = Array.from(inner.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => (v.den ? v.num / v.den : 0));
    if (series.length > 0) sparkCollapsed.set(metric, series);
  }

  return (
    <>
      <PageHeader
        title={t("perf_title")}
        subtitle={t("perf_subtitle")}
        icon={<Activity className="w-5 h-5" />}
      />

      {overall.length === 0 ? (
        <Empty message={t("perf_empty")} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {["LCP", "INP", "CLS", "FCP", "TTFB"].map((metric) => {
              const o = overall.find((x) => x.metric === metric);
              const budget = BUDGETS[metric];
              const series = sparkCollapsed.get(metric);
              return (
                <MetricSummary
                  key={metric}
                  metric={metric}
                  p75={o?.p75 ?? null}
                  samples={o?.samples ?? 0}
                  budget={budget}
                  spark={series}
                />
              );
            })}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary border-b border-border">
                <tr className="text-left text-xs text-text-soft">
                  <th className="px-3 py-2">{t("perf_metric")}</th>
                  <th className="px-3 py-2">{t("perf_page")}</th>
                  <th className="px-3 py-2 text-right">{t("perf_p75")}</th>
                  <th className="px-3 py-2 text-right">{t("perf_p95")}</th>
                  <th className="px-3 py-2 text-right">{t("perf_budget")}</th>
                  <th className="px-3 py-2 text-right">{t("perf_samples")}</th>
                </tr>
              </thead>
              <tbody>
                {latest
                  .sort((a, b) => a.metric.localeCompare(b.metric) || a.page.localeCompare(b.page))
                  .map((r) => {
                    const b = BUDGETS[r.metric];
                    const status = !b ? "—" : r.p75 <= b.good ? "good" : r.p75 <= b.poor ? "warn" : "poor";
                    return (
                      <tr key={`${r.metric}-${r.page}-${r.day}`} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{r.metric}</td>
                        <td className="px-3 py-2 truncate max-w-[280px]">{r.page}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatVal(r.metric, r.p75)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-soft">{formatVal(r.metric, r.p95)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span
                            className={
                              "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold " +
                              (status === "good"
                                ? "bg-success-soft text-success-ring"
                                : status === "warn"
                                  ? "bg-warning-soft text-warning-ring"
                                  : status === "poor"
                                    ? "bg-danger-soft text-danger-ring"
                                    : "bg-bg-tertiary text-text-muted")
                            }
                          >
                            {b ? formatVal(r.metric, b.good) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-soft">{r.samples}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function MetricSummary({
  metric,
  p75,
  samples,
  budget,
  spark,
}: {
  metric: string;
  p75: number | null;
  samples: number;
  budget: { good: number; poor: number; unit: "ms" | "score" } | undefined;
  spark?: number[];
}) {
  const status = p75 == null || !budget ? "none" : p75 <= budget.good ? "good" : p75 <= budget.poor ? "warn" : "poor";
  const ring =
    status === "good"
      ? "border-success/40 bg-success-soft"
      : status === "warn"
        ? "border-warning/40 bg-warning-soft"
        : status === "poor"
          ? "border-danger/40 bg-danger-soft"
          : "border-border";
  const sparkStroke =
    status === "good"
      ? "rgb(34,197,94)"
      : status === "warn"
        ? "rgb(245,158,11)"
        : status === "poor"
          ? "rgb(244,63,94)"
          : "rgb(113,113,122)";
  return (
    <div className={"card border " + ring}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-soft">{metric}</span>
        {spark && spark.length >= 2 && <Sparkline points={spark} stroke={sparkStroke} />}
      </div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">
        {p75 == null ? "—" : formatVal(metric, p75)}
      </div>
      <div className="text-[10px] text-text-muted mt-1">
        {budget ? `≤ ${formatVal(metric, budget.good)} good` : "no budget"}
        {samples > 0 && ` · ${samples} samples`}
      </div>
    </div>
  );
}

function Sparkline({ points, stroke }: { points: number[]; stroke: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const W = 56;
  const H = 18;
  const step = points.length === 1 ? W : W / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = H - ((p - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatVal(metric: string, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

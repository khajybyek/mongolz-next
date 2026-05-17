import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface SlowQuery {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  rows_avg: number;
}

export default async function DbMonitorPage() {
  await requireAdmin();
  const { t } = await getT();
  const svc = createServiceClient();
  const { data } = await svc.rpc("top_slow_queries", { p_limit: 30 });
  const rows = (data ?? []) as SlowQuery[];

  return (
    <>
      <PageHeader title={t("db_monitor_title")} subtitle={t("db_monitor_subtitle")} />

      <div className="card p-0 mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary/50">
            <tr className="text-xs uppercase tracking-wide text-text-soft">
              <th className="px-4 py-2.5 text-left">Query (240 char preview)</th>
              <th className="px-4 py-2.5 text-right">Calls</th>
              <th className="px-4 py-2.5 text-right">Mean (ms)</th>
              <th className="px-4 py-2.5 text-right">Total (s)</th>
              <th className="px-4 py-2.5 text-right">Rows avg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-text-muted/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-text-muted">
                  pg_stat_statements is empty (just enabled) — wait a minute and reload.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="hover:bg-text-muted/[0.02]">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-text-soft max-w-[600px] break-all">
                    {r.query}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">{r.calls}</td>
                  <td
                    className={`px-4 py-2.5 text-right text-xs font-medium ${
                      r.mean_ms > 100
                        ? "text-danger"
                        : r.mean_ms > 20
                        ? "text-warning"
                        : "text-success"
                    }`}
                  >
                    {r.mean_ms.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-text-soft">
                    {(r.total_ms / 1000).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-text-soft">
                    {r.rows_avg}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card mt-4 text-xs text-text-soft leading-relaxed">
        💡 <b className="text-text">Optimization tips</b>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>Mean &gt; 100ms — index хайх / EXPLAIN ANALYZE дуудах</li>
          <li>Mean 20-100ms — Calls олон бол кэш / materialised view</li>
          <li>Эхний 3 хамгийн удаан query-ийг сар бүр шалгах</li>
          <li>
            Reset: <code className="px-1 bg-bg-tertiary rounded">SELECT pg_stat_statements_reset();</code>
          </li>
        </ul>
      </div>
    </>
  );
}

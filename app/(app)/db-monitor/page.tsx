import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
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

      {rows.length === 0 ? (
        <Empty
          message={t("empty")}
          description={t("db_empty_hint")}
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("db_col_query")}</th>
                <th className="num">{t("db_col_calls")}</th>
                <th className="num">{t("db_col_mean")}</th>
                <th className="num">{t("db_col_total")}</th>
                <th className="num">{t("db_col_rows_avg")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="font-mono text-[11px] max-w-[600px] break-all">
                    {r.query}
                  </td>
                  <td className="num text-xs">{r.calls}</td>
                  <td className="num text-xs font-medium">
                    <span
                      className={
                        r.mean_ms > 100
                          ? "text-danger"
                          : r.mean_ms > 20
                          ? "text-warning"
                          : "text-success"
                      }
                    >
                      {r.mean_ms.toFixed(2)}
                    </span>
                  </td>
                  <td className="num text-xs">
                    {(r.total_ms / 1000).toFixed(2)}
                  </td>
                  <td className="num text-xs">
                    {r.rows_avg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card mt-4 text-xs text-text-soft leading-relaxed">
        💡 <b className="text-text">{t("db_tips_title")}</b>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>{t("db_tip_slow")}</li>
          <li>{t("db_tip_mid")}</li>
          <li>{t("db_tip_monthly")}</li>
          <li>
            {t("db_tip_reset")}:{" "}
            <code className="px-1 bg-bg-tertiary rounded">SELECT pg_stat_statements_reset();</code>
          </li>
        </ul>
      </div>
    </>
  );
}

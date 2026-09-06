import { Download } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdminOrAuditor } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { AuditFilters } from "./audit-filters";

export const dynamic = "force-dynamic";

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "bg-success/15 text-success",
  LOGOUT: "bg-text-muted/15 text-text-soft",
  LOGIN_FAILED: "bg-danger/15 text-danger",
  ALERT: "bg-danger/15 text-danger",
  SUSPECT_ADD: "bg-accent/15 text-accent",
  SUSPECT_DELETE: "bg-warning/15 text-warning",
  CAMERA_ADD: "bg-accent/15 text-accent",
  CAMERA_DELETE: "bg-warning/15 text-warning",
  AI_ANALYSIS: "bg-purple-500/15 text-purple-400",
  REAUTH_OK: "bg-success/15 text-success",
  REAUTH_FAILED: "bg-danger/15 text-danger",
  REVEAL_REQUEST: "bg-warning/15 text-warning",
};

interface SearchParams {
  action?: string;
  q?: string;
  user?: string;
  from?: string;
  to?: string;
  limit?: string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdminOrAuditor();
  const { t } = await getT();
  const params = await searchParams;
  const supabase = await createClient();

  const limit = Math.min(2000, Math.max(50, Number(params.limit) || 500));

  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.action) query = query.eq("action", params.action);
  if (params.user) query = query.ilike("user_email", `%${params.user}%`);
  if (params.q) query = query.ilike("detail", `%${params.q}%`);
  // <input type="datetime-local"> yields a zone-less wall-clock string; the
  // operator reads every timestamp in KST (formatDate), so interpret the
  // filter bounds in KST too instead of letting Postgres assume UTC.
  const fromIso = toKstIso(params.from);
  const toIso = toKstIso(params.to);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lte("created_at", toIso);

  const { data: logs, count } = await query;

  // Distinct action names via the audit_actions view (RLS-invoking) — the
  // previous full-table select was capped by PostgREST's max-rows.
  const { data: actions } = await supabase.from("audit_actions").select("action").order("action");
  const actionList = (actions ?? []).map((a) => a.action).filter((a): a is string => Boolean(a));

  const csvHref = "/api/audit/export?" + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>,
  ).toString();

  return (
    <>
      <PageHeader
        title={t("audit_log")}
        subtitle={`${count ?? logs?.length ?? 0} ${t("audit_desc")}`}
        actions={
          <Link href={csvHref as never} className="btn-ghost text-xs">
            <Download className="w-3.5 h-3.5" />
            CSV
          </Link>
        }
      />

      <AuditFilters
        actions={actionList}
        currentAction={params.action ?? ""}
        currentQ={params.q ?? ""}
        currentUser={params.user ?? ""}
        currentFrom={params.from ?? ""}
        currentTo={params.to ?? ""}
        currentLimit={String(limit)}
        labels={{
          q: t("audit_filter_q"),
          user: t("audit_filter_user") + " (email)",
          allActions: "— " + t("audit_filter_action") + " —",
          rows: t("col_actions") === "Actions" ? "rows" : (t("col_actions") === "작업" ? "행" : "ширхэг"),
          from: t("audit_filter_from"),
          to: t("audit_filter_to"),
          filter: t("filter"),
          clear: t("reset"),
        }}
      />

      {!logs?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("audit_col_action")}</th>
                <th>{t("audit_col_detail")}</th>
                <th>{t("audit_col_user")}</th>
                <th>{t("audit_col_ip")}</th>
                <th>{t("audit_col_when")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span
                      className={`badge ${
                        ACTION_COLORS[log.action] ?? "bg-text-muted/5 text-text-soft"
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="text-xs max-w-md truncate" title={log.detail ?? ""}>
                    {log.detail ?? "—"}
                  </td>
                  <td className="text-xs">
                    {log.user_email ?? "—"}
                  </td>
                  <td className="text-xs font-mono">
                    <span className="text-text-muted">{typeof log.ip === "string" ? log.ip : "—"}</span>
                  </td>
                  <td className="text-xs">
                    <span className="text-text-muted">{formatDate(log.created_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** "YYYY-MM-DDTHH:mm" (KST wall-clock) → ISO instant; null when absent/invalid. */
function toKstIso(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const d = new Date(`${v}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

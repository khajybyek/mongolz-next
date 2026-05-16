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
  LOGOUT: "bg-neutral-500/15 text-neutral-400",
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
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", params.to);

  const { data: logs, count } = await query;

  const { data: actions } = await supabase
    .from("audit_log")
    .select("action")
    .order("action");
  const actionList = [...new Set((actions ?? []).map((a) => a.action))];

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
      />

      {!logs?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary/50">
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 text-left">Үйлдэл</th>
                <th className="px-4 py-2.5 text-left">Дэлгэрэнгүй</th>
                <th className="px-4 py-2.5 text-left">Хэрэглэгч</th>
                <th className="px-4 py-2.5 text-left">IP</th>
                <th className="px-4 py-2.5 text-left">Цаг</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge ${
                        ACTION_COLORS[log.action] ?? "bg-white/5 text-neutral-300"
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400 text-xs max-w-md truncate" title={log.detail ?? ""}>
                    {log.detail ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400 text-xs">
                    {log.user_email ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500 text-xs font-mono">
                    {log.ip ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500 text-xs">
                    {formatDate(log.created_at)}
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

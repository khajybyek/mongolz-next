import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "bg-success/15 text-success",
  LOGOUT: "bg-neutral-500/15 text-neutral-400",
  ALERT: "bg-danger/15 text-danger",
  SUSPECT_ADD: "bg-accent/15 text-accent",
  SUSPECT_DELETE: "bg-warning/15 text-warning",
  CAMERA_ADD: "bg-accent/15 text-accent",
  CAMERA_DELETE: "bg-warning/15 text-warning",
  AI_ANALYSIS: "bg-purple-500/15 text-purple-400",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireAdmin();
  const { t } = await getT();
  const { action } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (action) query = query.eq("action", action);

  const { data: logs } = await query;

  const { data: actions } = await supabase
    .from("audit_log")
    .select("action")
    .order("action");
  const actionList = [...new Set((actions ?? []).map((a) => a.action))];

  return (
    <>
      <PageHeader title={t("audit_log")} subtitle={t("audit_desc")} />

      <div className="card mb-4 flex items-center gap-2 flex-wrap">
        <a
          href="/audit"
          className={`btn text-xs ${!action ? "bg-accent/15 text-accent" : "btn-ghost"}`}
        >
          {t("all")}
        </a>
        {actionList.map((a) => (
          <a
            key={a}
            href={`/audit?action=${a}`}
            className={`btn text-xs ${
              action === a ? "bg-accent/15 text-accent" : "btn-ghost"
            }`}
          >
            {a}
          </a>
        ))}
      </div>

      {!logs?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary/50">
              <tr className="text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 text-left">Үйлдэл</th>
                <th className="px-4 py-2.5 text-left">Дэлгэрэнгүй</th>
                <th className="px-4 py-2.5 text-left">Хэрэглэгч</th>
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
                  <td className="px-4 py-2.5 text-neutral-400 text-xs">
                    {log.detail ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-400 text-xs">
                    {log.user_email ?? "—"}
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

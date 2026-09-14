import { workflowCopy } from "@/lib/workflow-copy";
import { pageHref } from "@/lib/workflow-query";
import type { Lang } from "@/lib/i18n/translations";

export function WorkflowPagination({ path, params = {}, page, total, pageSize, lang, pageKey = "page" }: {
  path: string; params?: Record<string, string | number | undefined>; page: number;
  total: number; pageSize: number; lang: Lang;
  pageKey?: string;
}) {
  const c = workflowCopy(lang);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label={c.page} className="flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-text-muted">
      <span>{c.page} {page} / {pages} · {total.toLocaleString()}</span>
      <div className="flex gap-2">
        {page > 1 && <a className="btn-secondary btn-sm" href={pageHref(path, params, page - 1, pageKey)}>{c.previous}</a>}
        {page < pages && <a className="btn-secondary btn-sm" href={pageHref(path, params, page + 1, pageKey)}>{c.next}</a>}
      </div>
    </nav>
  );
}

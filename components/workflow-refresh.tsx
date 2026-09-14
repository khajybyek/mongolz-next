"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { workflowCopy } from "@/lib/workflow-copy";

export function WorkflowRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const { lang } = useT();
  const c = workflowCopy(lang);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (!document.hidden) startTransition(() => router.refresh()); };
    const timer = setInterval(refresh, 5_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [active, router]);
  return <div className="flex flex-wrap gap-3 items-center text-xs text-text-muted mb-4"><button className="btn-secondary btn-sm" onClick={() => startTransition(() => router.refresh())} disabled={pending}>{c.refresh}</button>{active && <span>{c.autoRefresh}</span>}</div>;
}

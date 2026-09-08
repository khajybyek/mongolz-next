"use client";

import { useEffect, useState } from "react";
import { t as translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";

type Uptime = {
  status: "ok" | "degraded";
  ts: string;
  checks: {
    ml: { ok: boolean; latency: string };
    db: { ok: boolean; latency: string };
  };
};

export function LiveStatus({ lang = "mn" }: { lang?: Lang }) {
  const t = (key: TranslationKey) => translate(key, lang);
  const [data, setData] = useState<Uptime | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/uptime", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const json = (await res.json()) as Uptime;
        if ((!res.ok && res.status !== 503) || !["ok", "degraded"].includes(json?.status) ||
            typeof json?.checks?.ml?.ok !== "boolean" || typeof json?.checks?.db?.ok !== "boolean") {
          throw new Error("Invalid status response");
        }
        if (!cancelled) {
          setData(json);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setFailed(true);
        }
      }
    }

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!data && !failed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50" aria-hidden />
        {t("live_status_loading")}
      </span>
    );
  }

  if (failed || !data) {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-danger">
        <span className="w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />
        {t("live_status_failed")}
      </span>
    );
  }

  const allOk = data.status === "ok";
  const dotClass = allOk ? "bg-success" : "bg-warning";
  const textClass = allOk ? "text-text-muted" : "text-warning";

  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs ${textClass}`} role="status">
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span>
        {t(allOk ? "status_all_ok" : "status_degraded")}
      </span>
    </span>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";

/** Probe targets. Names are translated at render, never inside the fetch loop. */
const CHECKS: { nameKey: TranslationKey; url: string }[] = [
  { nameKey: "health_svc_ml", url: "/api/health/ml" },
  { nameKey: "health_svc_db", url: "/api/health/db" },
  { nameKey: "health_svc_auth", url: "/api/health/auth" },
  { nameKey: "health_svc_storage", url: "/api/health/storage" },
  // Latest scheduled-check alarms (login spike, backup verify, key rotation).
  { nameKey: "health_svc_ops", url: "/api/health/ops" },
];

interface ServiceStatus {
  nameKey: TranslationKey;
  url: string;
  /** degraded = the service answers but cannot do its job (ML tunnel down). */
  status: "ok" | "degraded" | "error" | "loading";
  latency_ms: number | null;
  /** Server-supplied text, shown verbatim when present. */
  detail: string | null;
  /** Locale-resolved fallback used when the probe said nothing useful. */
  detailKey: TranslationKey;
}

export function HealthDashboard() {
  const { t } = useT();
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [checking, setChecking] = useState(false);

  // No translation lookups inside this callback: useT() hands back a fresh
  // `t` on every render, so depending on it here would re-run the effect
  // (and re-probe every service) on each state update.
  const check = useCallback(async () => {
    setChecking(true);
    const results: ServiceStatus[] = [];

    for (const c of CHECKS) {
      const t0 = Date.now();
      try {
        const res = await fetch(c.url);
        const data = await res.json();
        // /api/health/auth answers 200 with config.ok=false when a production
        // signing secret is missing — that must not read as a green service.
        const configBroken = data?.config?.ok === false;
        const degraded = res.ok && data?.status === "degraded";
        const status: ServiceStatus["status"] = !res.ok || configBroken ? "error" : degraded ? "degraded" : "ok";
        results.push({
          nameKey: c.nameKey,
          url: c.url,
          status,
          latency_ms: Date.now() - t0,
          detail: data.detail ?? data.error ?? null,
          detailKey: status === "ok" ? "health_detail_ok" : status === "degraded" ? "health_detail_degraded" : "health_detail_error",
        });
      } catch {
        results.push({
          nameKey: c.nameKey,
          url: c.url,
          status: "error",
          latency_ms: Date.now() - t0,
          detail: null,
          detailKey: "health_detail_unreachable",
        });
      }
    }

    setServices(results);
    setChecking(false);
  }, []);

  useEffect(() => { check(); }, [check]);

  const allOk = services.length > 0 && services.every((s) => s.status === "ok");
  const anyError = services.some((s) => s.status === "error");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${allOk ? "bg-success" : services.length === 0 ? "bg-text-muted" : anyError ? "bg-danger" : "bg-warning"} animate-pulse`} />
        <span className="text-sm font-semibold">
          {allOk ? t("health_all_ok") : services.length === 0 ? t("health_checking") : t("health_issues")}
        </span>
        <button onClick={check} disabled={checking} className="btn-ghost btn-sm ml-auto">
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {t("health_refresh")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((s) => (
          <div key={s.url} className="card flex items-center gap-3">
            {s.status === "ok" ? (
              <CheckCircle className="w-5 h-5 text-success shrink-0" />
            ) : s.status === "degraded" ? (
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" aria-label={t("health_detail_degraded")} />
            ) : s.status === "loading" ? (
              <Loader2 className="w-5 h-5 text-text-muted animate-spin shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-danger shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t(s.nameKey)}</div>
              <div className="text-xs text-text-muted">{s.detail ?? t(s.detailKey)}</div>
            </div>
            {s.latency_ms !== null && (
              <span className="text-xs font-mono text-text-soft">{s.latency_ms}ms</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

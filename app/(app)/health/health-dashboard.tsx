"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface ServiceStatus {
  name: string;
  url: string;
  status: "ok" | "error" | "loading";
  latency_ms: number | null;
  detail: string;
}

export function HealthDashboard() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const results: ServiceStatus[] = [];

    const checks = [
      { name: "ML Service", url: "/api/health/ml" },
      { name: "Supabase DB", url: "/api/health/db" },
      { name: "Supabase Auth", url: "/api/health/auth" },
      { name: "Supabase Storage", url: "/api/health/storage" },
    ];

    for (const c of checks) {
      const t0 = Date.now();
      try {
        const res = await fetch(c.url);
        const data = await res.json();
        results.push({
          name: c.name,
          url: c.url,
          status: res.ok ? "ok" : "error",
          latency_ms: Date.now() - t0,
          detail: data.detail ?? (res.ok ? "Healthy" : data.error ?? "Error"),
        });
      } catch {
        results.push({
          name: c.name,
          url: c.url,
          status: "error",
          latency_ms: Date.now() - t0,
          detail: "Unreachable",
        });
      }
    }

    setServices(results);
    setChecking(false);
  }, []);

  useEffect(() => { check(); }, [check]);

  const allOk = services.length > 0 && services.every((s) => s.status === "ok");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${allOk ? "bg-success" : services.length === 0 ? "bg-text-muted" : "bg-danger"} animate-pulse`} />
        <span className="text-sm font-semibold">
          {allOk ? "All systems operational" : services.length === 0 ? "Checking..." : "Issues detected"}
        </span>
        <button onClick={check} disabled={checking} className="btn-ghost btn-sm ml-auto">
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((s) => (
          <div key={s.name} className="card flex items-center gap-3">
            {s.status === "ok" ? (
              <CheckCircle className="w-5 h-5 text-success shrink-0" />
            ) : s.status === "loading" ? (
              <Loader2 className="w-5 h-5 text-text-muted animate-spin shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-danger shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{s.name}</div>
              <div className="text-xs text-text-muted">{s.detail}</div>
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

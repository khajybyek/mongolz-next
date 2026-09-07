import { ShieldAlert, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { isProductionRuntime, missingProductionSecrets } from "@/lib/env-check";
import { HealthDashboard } from "./health-dashboard";

export default async function HealthPage() {
  await requireAdmin();
  const { t } = await getT();

  // Server component: read the env directly (names only) rather than
  // round-tripping through /api/health/auth. Same source of truth.
  const missing = missingProductionSecrets();
  const configOk = missing.length === 0;
  // Outside production the cookie helpers still fall back (lib/auth/hmac-secret.ts),
  // so an unset secret is a note, not an outage — the API reports the same flag.
  const severe = !configOk && isProductionRuntime();

  return (
    <>
      <PageHeader title="System Health" subtitle="Service status & connectivity" />
      <div className="space-y-4">
        <HealthDashboard />

        <div className={`card flex items-start gap-3 ${severe ? "border border-danger/30" : ""}`}>
          {configOk ? (
            <ShieldCheck className="w-5 h-5 text-success shrink-0" />
          ) : (
            <ShieldAlert className={`w-5 h-5 shrink-0 ${severe ? "text-danger" : "text-warning"}`} />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t("health_config")}</div>
            <div className={`text-xs ${configOk ? "text-text-muted" : severe ? "text-danger" : "text-warning"}`}>
              {configOk ? t("health_config_ok") : t("health_config_missing")}
            </div>
            {!configOk && !severe && <div className="text-2xs text-text-muted mt-1">{t("health_config_dev")}</div>}
            {!configOk && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {missing.map((name) => (
                  <Badge key={name} variant={severe ? "danger" : "warning"} className="font-mono">
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

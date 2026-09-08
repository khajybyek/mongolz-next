import { Bug, BugOff, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { isProductionRuntime, missingProductionSecrets } from "@/lib/env-check";
import { errorReportingEnabled, serverErrorReportingDsn } from "@/lib/error-reporting";
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

  // Is anything actually listening for crashes? The browser SDK only starts
  // when NEXT_PUBLIC_SENTRY_DSN is set at build time (instrumentation-client.ts),
  // and the error screens read the same flag before promising a report.
  const browserReporting = errorReportingEnabled();
  const serverReporting = serverErrorReportingDsn() !== undefined;
  const reportingOk = browserReporting && serverReporting;

  return (
    <>
      <PageHeader title={t("nav_health")} subtitle={t("health_subtitle")} />
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

        <div className={`card flex items-start gap-3 ${reportingOk ? "" : "border border-warning/30"}`}>
          {reportingOk ? (
            <Bug className="w-5 h-5 text-success shrink-0" />
          ) : (
            <BugOff className="w-5 h-5 text-warning shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t("health_reporting")}</div>
            <div className={`text-xs ${reportingOk ? "text-text-muted" : "text-warning"}`}>
              {reportingOk ? t("health_reporting_on") : t("health_reporting_off")}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge variant={browserReporting ? "success" : "warning"} dot>
                {t("health_reporting_browser")}
              </Badge>
              <Badge variant={serverReporting ? "success" : "warning"} dot>
                {t("health_reporting_server")}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

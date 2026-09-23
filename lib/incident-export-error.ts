import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Map a failed POST /api/incidents/[id]/evidence-package response to a
 * translation key, so the operator never sees the route's raw English
 * `error` strings. Unknown failures return null → the caller shows its
 * generic "export failed" copy. REAUTH_REQUIRED is handled by the caller
 * (TotpPrompt retry) before this is consulted.
 */
export function evidenceExportErrorKey(status: number, error: unknown): TranslationKey | null {
  const message = typeof error === "string" ? error : "";
  if (status === 409) return "incident_export_err_no_evidence";
  if (status === 413) return "incident_export_err_too_large";
  if (status === 502) return "incident_export_err_packaging";
  if (status === 503) {
    if (message.includes("renderer")) return "incident_export_err_renderer";
    if (message.includes("audit")) return "incident_export_err_audit";
  }
  return null;
}

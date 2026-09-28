import { ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { PrivacyEnforcement } from "@/lib/health-probes";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Whether the running ML build actually enforces privacy schedules
 * (ADR 0012). The web app deploys on push and the ML service by hand, so the
 * schedule page must not present a schedule as enforced when the ML service
 * is an older build that ignores it. Server component: the caller probes
 * (lib/health-probes.ts) and passes the state plus its translator.
 */
export function PrivacyEnforcementNotice({
  state,
  t,
  showWhenEnforced = false,
}: {
  state: PrivacyEnforcement;
  t: (key: TranslationKey) => string;
  /** /health lists every state; the schedule page only the problems. */
  showWhenEnforced?: boolean;
}) {
  if (state === "enforced" && !showWhenEnforced) return null;
  const tone =
    state === "enforced"
      ? "border-success/30"
      : state === "not_enforced"
        ? "border-danger/40 bg-danger/5"
        : "border-warning/30 bg-warning/5";
  const Icon = state === "enforced" ? ShieldCheck : state === "not_enforced" ? ShieldAlert : WifiOff;
  const iconTone = state === "enforced" ? "text-success" : state === "not_enforced" ? "text-danger" : "text-warning";
  const body: TranslationKey =
    state === "enforced"
      ? "privacy_enforcement_ok"
      : state === "not_enforced"
        ? "privacy_enforcement_missing"
        : "privacy_enforcement_unreachable";
  return (
    <div className={`card border flex items-start gap-3 ${tone}`} role={state === "not_enforced" ? "alert" : undefined}>
      <Icon className={`w-5 h-5 shrink-0 ${iconTone}`} aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-medium">{t("privacy_enforcement_title")}</div>
        <div className="text-xs text-text-soft leading-relaxed">{t(body)}</div>
      </div>
    </div>
  );
}

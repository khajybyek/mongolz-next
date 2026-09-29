/**
 * The /health headline, from the client-side service probes plus the
 * server-side privacy-enforcement probe (ADR 0012). Pure and client-safe.
 */

import type { PrivacyEnforcement } from "@/lib/health-probes";

export type ProbeStatus = "ok" | "degraded" | "error" | "loading";
export type HealthLevel = "checking" | "ok" | "degraded" | "error";

/**
 *   error    → a probe failed, or the ML build does not enforce privacy
 *              schedules (recognition and alerts run inside private windows —
 *              the state ADR 0012 treats as a compliance problem, so it must
 *              never sit under "All systems operational")
 *   checking → probes have not answered yet (and nothing is known to be wrong)
 *   degraded → a probe answered degraded, or enforcement could not be read
 *   ok       → every probe ok and enforcement confirmed (or not supplied)
 */
export function healthLevel(statuses: readonly ProbeStatus[], privacy?: PrivacyEnforcement): HealthLevel {
  if (privacy === "not_enforced") return "error";
  if (statuses.length === 0) return "checking";
  if (statuses.includes("error")) return "error";
  if (statuses.every((s) => s === "ok") && (privacy === undefined || privacy === "enforced")) return "ok";
  return "degraded";
}

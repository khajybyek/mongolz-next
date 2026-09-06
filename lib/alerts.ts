/**
 * Alert workflow state machine (alerts.state).
 *
 * Kept free of React / Supabase imports so the API route, the server pages
 * and the jest suite all share one source of truth for which transitions are
 * legal and how each one is recorded in the audit log. The TP/FP `label`
 * column is a separate concept (active learning) and is not touched here.
 */
import type { AlertState } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/translations";

export const ALERT_STATES = ["new", "acknowledged", "closed"] as const satisfies readonly AlertState[];

export type AlertStateAuditAction = "ALERT_ACKNOWLEDGED" | "ALERT_CLOSED" | "ALERT_REOPENED";

/** Badge variants understood by `components/ui/badge.tsx`. */
export type AlertStateBadgeVariant = "accent" | "success" | "warning" | "danger" | "info" | "muted";

// Reopen is allowed from both handled states so an operator who closed (or
// merely acknowledged) the wrong row can put it back in the queue; every
// other edge is the forward flow.
const TRANSITIONS: Record<AlertState, readonly AlertState[]> = {
  new: ["acknowledged", "closed"],
  acknowledged: ["closed", "new"],
  closed: ["new"],
};

export function isAlertState(v: unknown): v is AlertState {
  return typeof v === "string" && (ALERT_STATES as readonly string[]).includes(v);
}

/**
 * Narrow a raw `alerts.state` string from the DB. The CHECK constraint
 * guarantees one of the three values; anything else (e.g. a future value
 * read by an older deploy) is treated as still needing attention.
 */
export function asAlertState(v: string | null | undefined): AlertState {
  return isAlertState(v) ? v : "new";
}

export function canTransition(from: AlertState, to: AlertState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Audit action recorded for a legal transition; `null` when there is none. */
export function auditActionFor(from: AlertState, to: AlertState): AlertStateAuditAction | null {
  if (!canTransition(from, to)) return null;
  switch (to) {
    case "acknowledged":
      return "ALERT_ACKNOWLEDGED";
    case "closed":
      return "ALERT_CLOSED";
    case "new":
      return "ALERT_REOPENED";
  }
}

// `new` deliberately avoids danger so it does not double up with the red
// severity badge that sits next to it in every list.
export function stateBadgeVariant(state: AlertState): AlertStateBadgeVariant {
  switch (state) {
    case "new":
      return "accent";
    case "acknowledged":
      return "warning";
    case "closed":
      return "muted";
  }
}

export function alertStateLabelKey(state: AlertState): TranslationKey {
  switch (state) {
    case "new":
      return "al_state_new";
    case "acknowledged":
      return "al_state_acknowledged";
    case "closed":
      return "al_state_closed";
  }
}

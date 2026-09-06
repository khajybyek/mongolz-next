/**
 * Reveal-workflow notifications (server-only — pulls in the service-role
 * client through lib/webhooks and lib/push).
 *
 * A reveal request sits in `pending_approval` until a SECOND admin decides
 * (4-eyes, ADR 0009). Nobody used to be told a request was waiting, so jobs
 * stalled until someone happened to open /reveal-approvals. These helpers fan
 * one event out to every channel the project already has:
 *
 *   webhooks  — admin-configured Slack / Discord / generic (lib/webhooks)
 *   web push  — admins' browsers (lib/push)
 *   Telegram  — the telegram-alerts edge function (same bot as suspect alerts)
 *
 * Every channel is best-effort: a failure is logged and swallowed, never
 * thrown, so a broken integration can never block the request or decision
 * that triggered it. Callers should still schedule these via `after()` so
 * the HTTP response is not delayed by outbound I/O.
 *
 * The `build*` functions are pure so the wire formats are unit-testable
 * without any network or Supabase access.
 */

import { dispatchEvent, type RevealEventPayload, type RevealRequestedEventPayload } from "@/lib/webhooks";
import { sendPushToAdminsExcept, sendPushToUser, type PushPayload } from "@/lib/push";

const APP_URL = "https://aicctv.dev";
export const APPROVALS_PATH = "/reveal-approvals";
export const JOBS_PATH = "/jobs";
const TELEGRAM_TIMEOUT_MS = 5000;

export interface RevealRequestedInput {
  jobId: string;
  recordingId: string;
  requesterId: string;
  requesterEmail: string | null | undefined;
  method: string;
  threshold?: number | null;
}

export interface RevealDecisionInput {
  jobId: string;
  requesterId: string | null | undefined;
  requesterEmail: string | null | undefined;
  approved: boolean;
  deciderEmail: string | null | undefined;
  reason?: string | null;
}

/** Wire format posted to the telegram-alerts edge function (kind-discriminated). */
export interface TelegramRevealRequested {
  kind: "reveal_requested";
  job_id: string;
  recording_id: string;
  requester_email: string | null;
  method: string;
  threshold: number | null;
  created_at: string;
}

export interface TelegramRevealDecided {
  kind: "reveal_decided";
  job_id: string;
  approved: boolean;
  requester_email: string | null;
  decider_email: string | null;
  reason: string | null;
  decided_at: string;
}

/** Recording ids are UUIDs; the first 8 chars are enough to find one in /jobs. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── pure builders ───────────────────────────────────────────────────────────

export function buildRevealRequestedWebhookPayload(
  input: RevealRequestedInput,
  now: Date = new Date(),
): RevealRequestedEventPayload {
  return {
    type: "reveal_requested",
    job_id: input.jobId,
    recording_id: input.recordingId,
    method: input.method,
    threshold: input.threshold ?? null,
    requested_email: input.requesterEmail ?? null,
    created_at: now.toISOString(),
    url: `${APP_URL}${APPROVALS_PATH}`,
  };
}

export function buildRevealRequestedPush(input: RevealRequestedInput): PushPayload {
  return {
    title: `Reveal request · ${input.requesterEmail ?? "unknown"}`,
    body: `${input.method} · rec ${shortId(input.recordingId)} — awaiting your 4-eyes approval`,
    url: APPROVALS_PATH,
    // One tag per job: a re-notification replaces rather than stacks.
    tag: `mongolz-reveal-request-${input.jobId}`,
  };
}

export function buildRevealRequestedTelegramPayload(
  input: RevealRequestedInput,
  now: Date = new Date(),
): TelegramRevealRequested {
  return {
    kind: "reveal_requested",
    job_id: input.jobId,
    recording_id: input.recordingId,
    requester_email: input.requesterEmail ?? null,
    method: input.method,
    threshold: input.threshold ?? null,
    created_at: now.toISOString(),
  };
}

export function buildRevealDecisionWebhookPayload(
  input: RevealDecisionInput & { recordingId: string },
): RevealEventPayload {
  return {
    type: "reveal_completed",
    job_id: input.jobId,
    recording_id: input.recordingId,
    status: input.approved ? "approved" : "rejected",
    duration_sec: null,
    requested_email: input.requesterEmail ?? null,
    decided_email: input.deciderEmail ?? null,
    reason: input.reason ?? null,
    url: `${APP_URL}${JOBS_PATH}`,
  };
}

export function buildRevealDecisionPush(input: RevealDecisionInput): PushPayload {
  const who = input.deciderEmail ?? "an admin";
  return {
    title: input.approved ? "Reveal approved" : "Reveal rejected",
    body: input.approved
      ? `${who} approved job ${shortId(input.jobId)} — decrypt is running`
      : `${who} rejected job ${shortId(input.jobId)}${input.reason ? `: ${input.reason}` : ""}`,
    url: JOBS_PATH,
    tag: `mongolz-reveal-decision-${input.jobId}`,
  };
}

export function buildRevealDecisionTelegramPayload(
  input: RevealDecisionInput,
  now: Date = new Date(),
): TelegramRevealDecided {
  return {
    kind: "reveal_decided",
    job_id: input.jobId,
    approved: input.approved,
    requester_email: input.requesterEmail ?? null,
    decider_email: input.deciderEmail ?? null,
    reason: input.reason ?? null,
    decided_at: now.toISOString(),
  };
}

// ── delivery ────────────────────────────────────────────────────────────────

/**
 * Posts to the telegram-alerts edge function with the service-role JWT (the
 * function accepts a gateway-verified service_role bearer). Missing env is
 * treated like any other delivery failure — logged, not thrown.
 */
export async function postTelegram(body: TelegramRevealRequested | TelegramRevealDecided): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    console.warn("[notify] telegram skipped: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset");
    return false;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/functions/v1/telegram-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[notify] telegram ${body.kind} → HTTP ${res.status}`);
    return res.ok;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one channel; converts any rejection into a warning so fan-out never throws. */
async function attempt(channel: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.warn(`[notify] ${channel} failed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * A reveal job was created and needs a second admin. Pushes go to every
 * admin EXCEPT the requester (they cannot approve their own job).
 */
export async function notifyRevealRequested(input: RevealRequestedInput): Promise<void> {
  const now = new Date();
  await Promise.all([
    attempt("webhook", () => dispatchEvent("reveal_requested", buildRevealRequestedWebhookPayload(input, now))),
    attempt("push", () => sendPushToAdminsExcept(input.requesterId, buildRevealRequestedPush(input))),
    attempt("telegram", () => postTelegram(buildRevealRequestedTelegramPayload(input, now))),
  ]);
}

/**
 * A second admin approved or rejected the job. Only the requester is pushed;
 * webhooks + Telegram carry the decision for the audit trail.
 */
export async function notifyRevealDecision(input: RevealDecisionInput & { recordingId?: string | null }): Promise<void> {
  const now = new Date();
  const tasks: Array<Promise<void>> = [
    attempt("webhook", () =>
      dispatchEvent(
        "reveal_completed",
        buildRevealDecisionWebhookPayload({ ...input, recordingId: input.recordingId ?? "" }),
      ),
    ),
    attempt("telegram", () => postTelegram(buildRevealDecisionTelegramPayload(input, now))),
  ];
  // Legacy rows may lack requested_by; nothing to push to in that case.
  if (input.requesterId) {
    const requesterId = input.requesterId;
    tasks.push(attempt("push", () => sendPushToUser(requesterId, buildRevealDecisionPush(input))));
  }
  await Promise.all(tasks);
}

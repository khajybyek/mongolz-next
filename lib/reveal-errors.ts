/**
 * Reveal job failures → translated messages.
 *
 * The ML reveal job writes `reveal_jobs.error_message`; the privacy refusals
 * start with a stable code in brackets (ml-service/reveal_job.py), e.g.
 * "[privacy_whole_recording] Бичлэг … / captured entirely in privacy mode".
 * The UI maps known codes to its own mn/en/kr copy and falls back to the raw
 * text for anything else (older jobs, other failures).
 */
import type { TranslationKey } from "@/lib/i18n/translations";

const CODE_RE = /^\[([a-z_]+)\]\s*/;

const KEYS: Record<string, TranslationKey> = {
  privacy_unavailable: "reveal_err_privacy_unavailable",
  privacy_rules_unavailable: "reveal_err_privacy_rules_unavailable",
  privacy_whole_recording: "reveal_err_privacy_whole_recording",
  privacy_whole_range: "reveal_err_privacy_whole_range",
  privacy_schedule_whole_recording: "reveal_err_privacy_schedule_whole_recording",
  privacy_schedule_whole_range: "reveal_err_privacy_schedule_whole_range",
  // Face-encrypted recordings (ADR 0013): the selected identity has no sealed
  // face blob the job may open (no linked track, outside the reveal level, or
  // every blob inside a protected span / never_reveal zone). Nothing was
  // decrypted. Not a privacy-POLICY refusal: another target may succeed.
  face_envelope_empty: "reveal_err_face_envelope_empty",
  // The envelope or the masked video could not be downloaded / decrypted
  // (a retry may succeed), or the envelope failed authentication / geometry
  // checks (damaged or tampered — final). Neither is a privacy refusal.
  face_envelope_unavailable: "reveal_err_face_envelope_unavailable",
  face_envelope_invalid: "reveal_err_face_envelope_invalid",
};

/**
 * Refusals by privacy POLICY (ADR 0012): the footage is protected, so the
 * same request can never succeed — a final answer, not a failure to retry.
 * `privacy_unavailable` / `privacy_rules_unavailable` are left out on
 * purpose: a read failed, and a retry may well succeed.
 */
const POLICY_CODES: ReadonlySet<string> = new Set([
  "privacy_whole_recording",
  "privacy_whole_range",
  "privacy_schedule_whole_recording",
  "privacy_schedule_whole_range",
]);

/** The bracketed code at the start of an ML error message, if any. */
export function revealErrorCode(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  return CODE_RE.exec(message)?.[1] ?? null;
}

/**
 * Translated text for a reveal job's `error_message`; the raw message when
 * its code is unknown; null for no message.
 */
export function revealErrorText(
  message: string | null | undefined,
  t: (key: TranslationKey) => string,
): string | null {
  if (typeof message !== "string" || !message) return null;
  const key = KEYS[revealErrorCode(message) ?? ""];
  return key ? t(key) : message;
}

/**
 * True when a reveal job's `error_message` is a privacy-policy refusal —
 * the UI shows it as "withheld", not as a failure that invites a retry.
 * Presentation only: the job has already refused, whatever this returns.
 */
export function revealWithheldByPrivacy(message: string | null | undefined): boolean {
  const code = revealErrorCode(message);
  return code !== null && POLICY_CODES.has(code);
}

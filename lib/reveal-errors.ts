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

// ── POST /api/reveal/start refusals (the reveal modal) ───────────────────

/** Stable refusal codes from POST /api/reveal/start → translation keys. */
export const REVEAL_START_ERROR_KEYS: Readonly<Record<string, TranslationKey>> = {
  RATE_LIMITED: "pb_reveal_err_rate",
  REVEAL_REASON_REQUIRED: "pb_reveal_err_reason",
  INVALID_PARAMS: "pb_reveal_start_failed",
  INVALID_WINDOW: "pb_reveal_err_window",
  WINDOW_EXCEEDS_DURATION: "pb_reveal_err_window",
  DURATION_UNKNOWN: "pb_reveal_err_duration",
  RECORDING_NOT_FOUND: "pb_reveal_err_not_found",
  TARGET_NOT_FOUND: "pb_reveal_err_not_found",
  NO_ORIGINAL: "pb_reveal_err_no_original",
  NO_FACE_ENVELOPE: "pb_reveal_err_no_envelope",
  BAD_PHOTO: "pb_reveal_err_photo",
  ML_UNAVAILABLE: "pb_reveal_err_ml",
  REFERENCE_SEAL_FAILED: "pb_reveal_start_failed",
  START_FAILED: "pb_reveal_start_failed",
  AUDIT_UNAVAILABLE: "pb_reveal_start_failed",
  // The super admin's self-approved job may exist and run although the start
  // request failed (ADR 0003 amendment): say so, never "could not start".
  START_UNCONFIRMED: "pb_reveal_err_unconfirmed",
};

export type RevealStartRefusal = {
  /** "reauth" = step 2 asks for the step-up again; "method" = step 1, where the request can be changed. */
  step: "reauth" | "method";
  errorKey: TranslationKey;
};

/**
 * Where a refused reveal request leaves the reveal modal, and what it says.
 * REAUTH_REQUIRED means the step-up lapsed between the check and the request,
 * so step 2 asks for it again. Every other refusal is about the request itself
 * (target, window, reason, rate, the recording) and returns to step 1, which
 * shows the message. No code (network failure, unparseable body) reads as
 * "could not start" — never the raw server text.
 */
export function revealStartRefusal(code: string | null | undefined): RevealStartRefusal {
  if (code === "REAUTH_REQUIRED") return { step: "reauth", errorKey: "pb_reveal_err_reauth" };
  // The super admin's self-approved reveal (ADR 0003 amendment) needs the
  // authenticator code: a password step-up only files a request for a second
  // admin. Step 2 then offers the code.
  if (code === "REAUTH_TOTP_REQUIRED") return { step: "reauth", errorKey: "pb_reveal_err_reauth_totp" };
  // Own keys only: a code such as "constructor" must not reach Object.prototype.
  const key = typeof code === "string" && Object.prototype.hasOwnProperty.call(REVEAL_START_ERROR_KEYS, code)
    ? REVEAL_START_ERROR_KEYS[code]
    : undefined;
  return { step: "method", errorKey: key ?? "pb_reveal_start_failed" };
}

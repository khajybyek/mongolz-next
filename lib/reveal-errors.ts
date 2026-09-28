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
};

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

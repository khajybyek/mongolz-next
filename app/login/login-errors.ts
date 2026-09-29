import type { TranslationKey } from "@/lib/i18n/translations";

/** Only known error codes are rendered. Never echo untrusted query text. */
export const LOGIN_ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_credentials: "login_error",
  too_many_attempts: "login_err_too_many",
  code_format: "login_err_code_format",
  code_invalid: "login_err_code_invalid",
  code_used: "login_err_code_used",
  code_expired: "login_err_code_expired",
  signin_failed: "login_err_signin_failed",
  no_profile: "login_err_no_profile",
  session_pin: "login_err_session_pin",
  session_rebind: "login_err_session_rebind",
  totp_enrolled: "login_err_totp_enrolled",
  callback_failed: "login_err_callback",
  server_config: "login_err_server_config",
};

/**
 * The copy for a `?error=` code; unknown codes get the generic line. Own keys
 * only — the code is query text, and `constructor` / `__proto__` must not
 * resolve through the prototype chain.
 */
export function loginErrorKey(code: string): TranslationKey {
  return Object.hasOwn(LOGIN_ERROR_KEYS, code) ? LOGIN_ERROR_KEYS[code] : "login_err_generic";
}

export type LoginNoticeVariant = "info" | "warning" | "danger";

/**
 * Not every `?error=` is the operator's fault. A forced re-login after a
 * deploy (session_rebind — every unbound TOTP session sees it once) or after
 * turning TOTP on is routine: an info notice, not a red error. A session
 * closed because the device fingerprint changed is worth a second look
 * (warning). Everything else — wrong password, bad code, lockout, server
 * config — stays danger.
 */
const NOTICE_VARIANT: Record<string, LoginNoticeVariant> = {
  session_rebind: "info",
  totp_enrolled: "info",
  session_pin: "warning",
};

export function loginNoticeVariant(code: string | null | undefined): LoginNoticeVariant {
  return code && Object.hasOwn(NOTICE_VARIANT, code) ? NOTICE_VARIANT[code] : "danger";
}

/**
 * Browser side of the step-up routes, shared by the TOTP prompt and the
 * reveal modal so the same refusal always reads the same way.
 *
 *   POST /api/auth/reauth/totp  { code }      → factor=totp cookie (every gate)
 *   POST /api/auth/reauth       { password }  → factor=password cookie (only the
 *                                               reveal request accepts it)
 *   GET  /api/auth/reauth                     → { valid, factor } for this user
 *
 * Nothing here decides access: the routes set an HMAC-signed cookie and every
 * gate verifies it again server-side (lib/auth/step-up.ts).
 */
import type { TranslationKey } from "@/lib/i18n/translations";

type Translate = (key: TranslationKey) => string;

/**
 * /api/auth/reauth/totp checks a 6-digit TOTP code only (lib/totp.ts
 * verifyTOTP). Recovery codes are accepted at the login step, not here, so no
 * step-up input may offer them.
 */
export const TOTP_CODE_LENGTH = 6;

/**
 * The TOTP input's maxLength. The browser clips a paste to maxLength BEFORE
 * onChange runs, so a field capped at 6 turned a pasted "123 456" into
 * "123 45" — five digits, and the code could never be sent (the route strips
 * whitespace itself). The field therefore takes a few more characters and
 * normalizeTotpInput keeps the six digits.
 */
export const TOTP_INPUT_MAX_LENGTH = 12;

/** What a TOTP input keeps: digits only, at most one code long. */
export function normalizeTotpInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);
}

export type TotpStepUpBody = {
  ok?: true;
  error?: string;
  code?: string;
  retry_after_sec?: number;
} | null;

/** Operator-facing copy for a refusal from POST /api/auth/reauth/totp. */
export function totpStepUpErrorText(status: number, data: TotpStepUpBody, t: Translate): string {
  // `totp_required` is what requireAdminApi answers for an admin who has not
  // enrolled TOTP yet — same meaning, same copy.
  if (data?.error === "TOTP_NOT_ENABLED" || data?.error === "totp_required") {
    return t("totp_prompt_not_enabled");
  }
  if (data?.error === "server_config") return t("totp_prompt_server_config");
  if (status === 429) {
    // Locked out: every further code is refused until the window ends, so
    // "invalid code" would send the operator round in circles.
    const wait = Number(data?.retry_after_sec);
    return `${t("rl_too_many_attempts")}${Number.isFinite(wait) && wait > 0 ? ` (${Math.ceil(wait)} s)` : ""}`;
  }
  if (status === 401 && data?.code !== "invalid" && data?.code !== "replayed") {
    // No `code` = the session itself was refused (middleware 401,
    // session_invalid from a pin mismatch), not the TOTP code.
    return t("totp_prompt_session_expired");
  }
  // Never render a raw server code; the remaining refusals (bad code, replay)
  // all mean "try another code".
  return t("totp_prompt_invalid");
}

export type StepUpResult = { ok: true } | { ok: false; error: string };

/** POST /api/auth/reauth/totp. Never throws: a network failure is a refusal too. */
export async function submitTotpStepUp(code: string, t: Translate): Promise<StepUpResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/reauth/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    return { ok: false, error: t("totp_prompt_network_err") };
  }
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => null)) as TotpStepUpBody;
  return { ok: false, error: totpStepUpErrorText(res.status, data, t) };
}

/**
 * POST /api/auth/reauth — the reveal request's password step-up, exactly as the
 * modal always sent it. A network failure throws, as it always did.
 */
export async function submitPasswordStepUp(password: string, t: Translate): Promise<StepUpResult> {
  const res = await fetch("/api/auth/reauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return {
    ok: false,
    error: j.error === "server_config" ? t("totp_prompt_server_config") : (j.error ?? t("pb_reauth_failed")),
  };
}

// ── Reveal request (the only gate that also takes the password) ──────────
export type RevealStepUpFactor = "totp" | "password";

/**
 * The factors the reveal modal offers. An operator who signs in with a passkey
 * may not remember the account password, so an enrolled authenticator comes
 * first; the password stays available because the reveal request still takes
 * it (a second admin must approve with TOTP before anything is decrypted).
 */
export function revealStepUpFactors(totpEnabled: boolean): RevealStepUpFactor[] {
  return totpEnabled ? ["totp", "password"] : ["password"];
}

export function defaultRevealStepUpFactor(totpEnabled: boolean): RevealStepUpFactor {
  return revealStepUpFactors(totpEnabled)[0]!;
}

/** Step 2 of the reveal modal: verify with the chosen factor. */
export function submitRevealStepUp(
  factor: RevealStepUpFactor,
  input: { code: string; password: string },
  t: Translate,
): Promise<StepUpResult> {
  return factor === "totp" ? submitTotpStepUp(input.code, t) : submitPasswordStepUp(input.password, t);
}

/** Is the chosen factor's input complete enough to send? */
export function revealStepUpReady(factor: RevealStepUpFactor, input: { code: string; password: string }): boolean {
  return factor === "totp" ? input.code.length === TOTP_CODE_LENGTH : input.password.length > 0;
}

/**
 * Step 2 of the reveal modal has two shapes. After a step-up from the last 15
 * minutes it only confirms — no code, no password — so "Continue" on step 1
 * never sends a reveal request by itself: the operator still presses Confirm.
 * Otherwise the operator verifies. Resuming an existing job always verifies:
 * the modal returns there only after the server refused the step-up.
 */
export type RevealStep2Mode = "confirm" | "verify";

export function revealStep2Mode(stepUpFresh: boolean, hasJob: boolean): RevealStep2Mode {
  return stepUpFresh && !hasJob ? "confirm" : "verify";
}

/**
 * Does a step-up from the last 15 minutes still open a reveal request? Both
 * factors do. Any failure — an abort included — answers false; the modal then
 * simply asks.
 */
export async function revealStepUpIsFresh(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/reauth", { cache: "no-store", signal });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { valid?: boolean; factor?: string | null } | null;
    return data?.valid === true && (data.factor === "totp" || data.factor === "password");
  } catch {
    return false;
  }
}

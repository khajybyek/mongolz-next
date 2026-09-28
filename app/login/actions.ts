"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  startLoginAttempt,
  checkRateLimit,
  releaseRateLimit,
  checkTotpCode,
  TOTP_LOGIN_LIMIT,
} from "@/lib/rate-limit";
import { hashCode } from "@/lib/totp-recovery";
import { sanitizeNextPath } from "@/lib/auth/safe-next";
import { bindSessionPin } from "@/lib/auth/session-pin";
import { bindMintedSession } from "@/lib/auth/mfa-session";
import {
  setPreTotpCookie,
  readPreTotpCookie,
  clearPreTotpCookie,
} from "@/lib/auth/pre-totp";

/**
 * Login error codes. Only codes travel in the URL; app/login/page.tsx maps
 * them to translated copy, so attacker-supplied text can never be rendered
 * on the login page.
 */
type LoginErrorCode =
  | "invalid_credentials"
  | "too_many_attempts"
  | "code_format"
  | "code_invalid"
  | "code_used"
  | "code_expired"
  | "signin_failed"
  /** A signing secret is unset on the server (fail-closed in production). */
  | "server_config";

function loginUrl(error: LoginErrorCode, extra: Record<string, string> = {}): Route {
  return `/login?${new URLSearchParams({ error, ...extra }).toString()}` as Route;
}

function totpStepUrl(error: string, next: string): Route {
  return `/login?step=totp&${new URLSearchParams({ error, next }).toString()}` as Route;
}

/** Хэрэглэгчийн IP-ийг (Vercel-аас ирсэн x-forwarded-for header)-аас авах */
async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}

/** Хэрэглэгч аль host-аар орсон — audit log-д кадрлахад хэрэглэнэ. */
async function getClientHost(): Promise<string | null> {
  try {
    const h = await headers();
    return (h.get("x-forwarded-host") ?? h.get("host"))?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** User-Agent string — audit detail-д device/browser fingerprint болгож хадгална. */
async function getClientUa(): Promise<string | null> {
  try {
    const h = await headers();
    const ua = h.get("user-agent");
    return ua ? ua.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function requestContext() {
  const [ip, host, ua] = await Promise.all([getClientIp(), getClientHost(), getClientUa()]);
  const ctx = [host ? `host=${host}` : null, ua ? `ua=${ua}` : null].filter(Boolean).join(" · ");
  return { ip, ctx };
}

const RECOVERY_RE = /^[A-Z2-9]{10}$/;
const TOTP_RE = /^\d{6}$/;

/**
 * STEP 1 — Validate email + password.
 *
 * If TOTP is enabled for the user, signs them OUT immediately, sets a 2-minute
 * pre-TOTP cookie and redirects to `/login?step=totp`. The TOTP step needs no
 * password re-entry because the cookie carries the user_id under HMAC.
 *
 * If TOTP is NOT enabled, login completes here.
 */
export async function signInAction(formData: FormData) {
  const rawIdentifier = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));

  if (!rawIdentifier || !password) {
    return redirect(loginUrl("invalid_credentials"));
  }

  // Username support: if the input has no '@', resolve it to the underlying
  // email via public.email_for_username (service-role only RPC).
  let email = rawIdentifier;
  if (!rawIdentifier.includes("@")) {
    try {
      const lookupSvc = createServiceClient();
      const { data: resolved } = await lookupSvc.rpc("email_for_username", {
        p_username: rawIdentifier,
      });
      if (typeof resolved === "string" && resolved.length > 0) {
        email = resolved.toLowerCase();
      } else {
        // Username not found — fail same as bad password (no enumeration)
        return redirect(loginUrl("invalid_credentials"));
      }
    } catch {
      return redirect(loginUrl("invalid_credentials"));
    }
  }

  const { ip, ctx } = await requestContext();

  // Rate limit (5 fail/email/15min, 10 fail/IP/15min). The attempt is charged
  // to both buckets up-front — atomically, so a burst of parallel guesses
  // cannot all read "under the limit" — and refunded the moment the password
  // verifies, so honest sign-ins never consume the budget.
  const attempt = await startLoginAttempt({ ip, email });
  if (!attempt.ok) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `${attempt.reason}: ${attempt.message}${ctx ? ` · ${ctx}` : ""}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect(loginUrl("too_many_attempts"));
  }

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_FAILED",
        detail: `Reason: ${error.message}${ctx ? ` · ${ctx}` : ""}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect(loginUrl("invalid_credentials"));
  }

  // The password was right — give the budget back. Everything after this point
  // is a second factor or a server-side problem, not a guess.
  await attempt.release();

  const svc = createServiceClient();
  const user = signInData.user;
  if (!user) {
    await supabase.auth.signOut({ scope: "local" });
    return redirect(loginUrl("invalid_credentials"));
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("id, role, totp_enabled, totp_secret")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut({ scope: "local" });
    return redirect(loginUrl("invalid_credentials"));
  }

  // ─── If TOTP is enabled, force step 2 ───
  if (profile.totp_enabled) {
    // Sign THIS half-finished session out so it cannot navigate the app until
    // TOTP is verified. Scope matters: the default is global, which revoked
    // every session of the account — an operator watching a camera wall was
    // signed out whenever anyone submitted their password anywhere, and an
    // attacker holding only the password had an unlimited, unlogged way to
    // keep them out.
    await supabase.auth.signOut({ scope: "local" });

    // The pre-TOTP cookie is HMAC-signed with REAUTH_COOKIE_SECRET, which is
    // fail-closed in production (lib/auth/hmac-secret.ts). If it is unset the
    // signer throws — surface that as a clear, translated login error instead
    // of the raw global error page. redirect() throws NEXT_REDIRECT, so it
    // must stay OUTSIDE this try/catch.
    let configError = false;
    try {
      await setPreTotpCookie(user.id);
    } catch (err) {
      configError = true;
      Sentry.captureException(err);
      try {
        await svc.from("audit_log").insert({
          action: "LOGIN_CONFIG_ERROR",
          detail: `pre-TOTP cookie could not be signed — REAUTH_COOKIE_SECRET missing?${ctx ? ` · ${ctx}` : ""}`,
          user_email: email,
          user_id: user.id,
          ip,
        });
      } catch {}
    }
    if (configError) return redirect(loginUrl("server_config"));
    return redirect(`/login?step=totp&next=${encodeURIComponent(next)}` as Route);
  }

  // ─── No TOTP — finish login here ───
  try {
    await svc.from("audit_log").insert({
      action: "LOGIN",
      detail: `Email: ${email} (no TOTP)${ctx ? ` · ${ctx}` : ""}`,
      user_email: email,
      user_id: user.id,
      ip,
    });
  } catch {}

  try {
    await bindSessionPin(user.id);
  } catch {}

  revalidatePath("/", "layout");
  redirect(next as never);
}

/**
 * STEP 2 — Verify the second factor: a 6-digit TOTP code or a one-time
 * recovery code (XXXXX-XXXXX). Uses the pre-TOTP cookie to know which user
 * is mid-flow, then signs them in via Supabase service-role admin →
 * magiclink exchange and binds that session for the data tier
 * (lib/auth/mfa-session.ts). Cookie is cleared on success, on expiry, and
 * once the user is rate-limited.
 *
 * Brute-force posture: per-user (5 wrong codes / 15 min) AND the per-email /
 * per-IP login lock, so a password holder cannot grind the 6-digit space.
 * Both budgets are spent atomically BEFORE the code is checked and refunded
 * when it verifies — concurrent guesses can no longer all read the same
 * pre-attempt count and walk through together (2026-09-08 audit, 5.10).
 */
export async function verifyTotpAction(formData: FormData) {
  const raw = String(formData.get("totp_code") ?? "").trim();
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const { ip, ctx } = await requestContext();

  const isTotp = TOTP_RE.test(raw);
  const recoveryNormalized = raw.replace(/[\s-]/g, "").toUpperCase();
  const isRecovery = !isTotp && RECOVERY_RE.test(recoveryNormalized);
  if (!isTotp && !isRecovery) {
    return redirect(totpStepUrl("code_format", next));
  }

  const pre = await readPreTotpCookie();
  if (!pre.ok) {
    await clearPreTotpCookie();
    return redirect(
      loginUrl(
        pre.reason === "expired"
          ? "code_expired"
          : pre.reason === "no-secret"
            ? "server_config"
            : "signin_failed",
      ),
    );
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id, email, totp_enabled, totp_secret, totp_recovery_codes")
    .eq("id", pre.userId)
    .single();

  if (!profile || !profile.totp_enabled || !profile.totp_secret) {
    await clearPreTotpCookie();
    return redirect(loginUrl("invalid_credentials"));
  }

  // Rate limits — both dimensions, both charged up-front and atomic. On
  // lockout the pre-TOTP cookie is burnt so a fresh step 1 (itself
  // rate-limited) is required to try again.
  const attempt = await startLoginAttempt({ ip, email: profile.email });
  if (!attempt.ok) {
    try {
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `totp step: email/ip lock (${attempt.reason})${ctx ? ` · ${ctx}` : ""}`,
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
    await clearPreTotpCookie();
    return redirect(loginUrl("too_many_attempts"));
  }

  const userId = profile.id;
  const userEmail = profile.email;

  async function blockedAtTotpStep(reason: string): Promise<never> {
    try {
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `totp step: ${reason}${ctx ? ` · ${ctx}` : ""}`,
        user_id: userId,
        user_email: userEmail,
        ip,
      });
    } catch {}
    await clearPreTotpCookie();
    return redirect(loginUrl("too_many_attempts"));
  }

  if (isTotp) {
    // One shared helper for every TOTP check: spends the per-user budget
    // before verifying, writes the failure row itself, refunds on success.
    const check = await checkTotpCode({
      userId: profile.id,
      userEmail: profile.email,
      secret: profile.totp_secret,
      code: raw,
      limit: TOTP_LOGIN_LIMIT,
      failAction: "TOTP_LOGIN_FAILED",
      replayAction: "TOTP_LOGIN_REPLAY_BLOCKED",
      detail: `2FA code invalid${ctx ? ` · ${ctx}` : ""}`,
      ip,
    });
    if (!check.ok) {
      if (check.reason === "rate_limited") return blockedAtTotpStep("too many wrong codes");
      return redirect(totpStepUrl(check.reason === "replayed" ? "code_used" : "code_invalid", next));
    }
  } else {
    // Recovery code: same per-user budget, spent before the lookup so the
    // 10-character space cannot be ground down either.
    const perUser = await checkRateLimit(profile.id, TOTP_LOGIN_LIMIT);
    if (!perUser.ok) return blockedAtTotpStep("too many wrong codes");

    // Atomic single-use consumption (public.consume_recovery_code).
    const { data: consumed } = await svc.rpc("consume_recovery_code", {
      p_user_id: profile.id,
      p_code_hash: hashCode(recoveryNormalized),
    });

    if (consumed !== true) {
      try {
        await svc.from("audit_log").insert({
          action: "TOTP_RECOVERY_FAILED",
          detail: `Recovery code invalid${ctx ? ` · ${ctx}` : ""}`,
          user_id: profile.id,
          user_email: profile.email,
          ip,
        });
      } catch {}
      return redirect(totpStepUrl("code_invalid", next));
    }
    await releaseRateLimit(profile.id, TOTP_LOGIN_LIMIT);
  }

  // Second factor accepted — the login buckets get their unit back.
  await attempt.release();

  if (isRecovery) {
    try {
      const remaining = Math.max(0, (profile.totp_recovery_codes?.length ?? 1) - 1);
      await svc.from("audit_log").insert({
        action: "TOTP_RECOVERY_USED",
        detail: `Login via recovery code · remaining: ${remaining}${ctx ? ` · ${ctx}` : ""}`,
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
  }

  // ─── Second factor good — mint a real Supabase session via magiclink exchange ───
  const linkRes = await svc.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email!,
  });

  if (linkRes.error || !linkRes.data.properties?.hashed_token) {
    await clearPreTotpCookie();
    return redirect(loginUrl("signin_failed"));
  }

  const supabase = await createClient();
  const verify = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkRes.data.properties.hashed_token,
  });

  if (verify.error) {
    await clearPreTotpCookie();
    return redirect(loginUrl("signin_failed"));
  }

  // Tell the data tier this session passed the second factor. A mailbox
  // holder can mint a session of exactly this shape straight from GoTrue;
  // private.mfa_ok() refuses the ones that are not bound (migration
  // 20260928120000). If the bind fails, bindMintedSession has already ended
  // the new session — an unbound one would only render an empty console.
  const bound = await bindMintedSession({
    svc,
    userClient: supabase,
    accessToken: verify.data?.session?.access_token,
    userId: profile.id,
    userEmail: profile.email,
    method: isRecovery ? "recovery_code" : "totp",
    ip,
  });
  if (!bound) {
    await clearPreTotpCookie();
    return redirect(loginUrl("signin_failed"));
  }

  await clearPreTotpCookie();

  try {
    await svc.from("audit_log").insert({
      action: "LOGIN",
      detail: `Email: ${profile.email} (${isRecovery ? "recovery code" : "TOTP"} verified)${ctx ? ` · ${ctx}` : ""}`,
      user_id: profile.id,
      user_email: profile.email,
      ip,
    });
  } catch {}

  try {
    await bindSessionPin(profile.id);
  } catch {}

  revalidatePath("/", "layout");
  redirect(next as never);
}

/** Abort the TOTP step and go back to email/password. */
export async function cancelTotpAction() {
  await clearPreTotpCookie();
  redirect("/login");
}

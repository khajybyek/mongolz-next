"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkLoginRateLimit, checkRateLimit, TOTP_LOGIN_LIMIT } from "@/lib/rate-limit";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import { hashCode } from "@/lib/totp-recovery";
import { sanitizeNextPath } from "@/lib/auth/safe-next";
import { bindSessionPin } from "@/lib/auth/session-pin";
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

  // Rate limit шалгах (5 fail/email/15min, 10 fail/IP/15min)
  const rl = await checkLoginRateLimit({ ip, email });
  if (!rl.ok) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `${rl.reason}: ${rl.message}${ctx ? ` · ${ctx}` : ""}`,
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

  const svc = createServiceClient();
  const user = signInData.user;
  if (!user) {
    await supabase.auth.signOut();
    return redirect(loginUrl("invalid_credentials"));
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("id, role, totp_enabled, totp_secret")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return redirect(loginUrl("invalid_credentials"));
  }

  // ─── If TOTP is enabled, force step 2 ───
  if (profile.totp_enabled) {
    // Sign user out so they cannot navigate the app until TOTP is verified.
    await supabase.auth.signOut();

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
 * magiclink exchange. Cookie is cleared on success, on expiry, and once the
 * user is rate-limited.
 *
 * Brute-force posture: per-user (5 wrong codes / 15 min, counted from the
 * audit log) AND the per-email / per-IP login lock, so a password holder
 * cannot grind the 6-digit space.
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

  // Rate limits — both dimensions. On lockout the pre-TOTP cookie is burnt
  // so a fresh step 1 (itself rate-limited) is required to try again.
  const perUser = await checkRateLimit(profile.id, TOTP_LOGIN_LIMIT);
  const perLogin = perUser.ok ? await checkLoginRateLimit({ ip, email: profile.email }) : { ok: false };
  if (!perUser.ok || !perLogin.ok) {
    try {
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `totp step: ${perUser.ok ? "email/ip lock" : "too many wrong codes"}${ctx ? ` · ${ctx}` : ""}`,
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
    await clearPreTotpCookie();
    return redirect(loginUrl("too_many_attempts"));
  }

  let outcome: "ok" | "invalid" | "replayed";
  if (isTotp) {
    outcome = await verifyTOTPWithReplayCheck(profile.id, profile.totp_secret, raw);
  } else {
    // Atomic single-use consumption (public.consume_recovery_code).
    const { data: consumed } = await svc.rpc("consume_recovery_code", {
      p_user_id: profile.id,
      p_code_hash: hashCode(recoveryNormalized),
    });
    outcome = consumed === true ? "ok" : "invalid";
  }

  if (outcome !== "ok") {
    try {
      await svc.from("audit_log").insert({
        action: isRecovery
          ? "TOTP_RECOVERY_FAILED"
          : outcome === "replayed"
            ? "TOTP_LOGIN_REPLAY_BLOCKED"
            : "TOTP_LOGIN_FAILED",
        detail:
          (isRecovery ? "Recovery code invalid" : outcome === "replayed" ? "Code reused" : "2FA code invalid") +
          (ctx ? ` · ${ctx}` : ""),
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
    return redirect(totpStepUrl(outcome === "replayed" ? "code_used" : "code_invalid", next));
  }

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

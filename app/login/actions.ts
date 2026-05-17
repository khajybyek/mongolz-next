"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import { verifyTOTPWithReplayCheck } from "@/lib/totp";
import {
  setPreTotpCookie,
  readPreTotpCookie,
  clearPreTotpCookie,
} from "@/lib/auth/pre-totp";

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

function sanitizeNextPath(raw: string): string {
  if (!raw) return "/dashboard";
  try {
    const decoded = decodeURIComponent(raw);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.startsWith("/\\") ||
      decoded.includes("://")
    ) {
      return "/dashboard";
    }
    return decoded;
  } catch {
    return "/dashboard";
  }
}

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
  const next = String(formData.get("next") ?? "/dashboard");

  if (!rawIdentifier || !password) {
    return redirect("/login?error=Invalid+credentials");
  }

  // Username support: if the input has no '@', resolve it to the underlying
  // email via public.email_for_username (SECURITY DEFINER RPC, anon-callable).
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
        return redirect("/login?error=Invalid+credentials");
      }
    } catch {
      return redirect("/login?error=Invalid+credentials");
    }
  }

  const ip = await getClientIp();

  // Rate limit шалгах (5 fail/email/15min, 10 fail/IP/15min)
  const rl = await checkLoginRateLimit({ ip, email });
  if (!rl.ok) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_BLOCKED",
        detail: `${rl.reason}: ${rl.message}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect(`/login?error=${encodeURIComponent(rl.message ?? "Too many attempts")}`);
  }

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGIN_FAILED",
        detail: `Reason: ${error.message}`,
        user_email: email,
        ip,
      });
    } catch {}
    return redirect("/login?error=Invalid+credentials");
  }

  const svc = createServiceClient();
  const user = signInData.user;
  if (!user) {
    await supabase.auth.signOut();
    return redirect("/login?error=Invalid+credentials");
  }

  const { data: profile } = await svc
    .from("profiles")
    .select("id, role, totp_enabled, totp_secret")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return redirect("/login?error=Invalid+credentials");
  }

  // ─── If TOTP is enabled, force step 2 ───
  if (profile.totp_enabled) {
    // Sign user out so they cannot navigate the app until TOTP is verified.
    await supabase.auth.signOut();
    await setPreTotpCookie(user.id);
    const safeNext = sanitizeNextPath(next);
    return redirect(`/login?step=totp&next=${encodeURIComponent(safeNext)}`);
  }

  // ─── No TOTP — finish login here ───
  try {
    await svc.from("audit_log").insert({
      action: "LOGIN",
      detail: `Email: ${email} (no TOTP)`,
      user_email: email,
      ip,
    });
  } catch {}

  try {
    const { bindSessionPin } = await import("@/lib/auth/session-pin");
    await bindSessionPin(user.id);
  } catch {}

  revalidatePath("/", "layout");
  redirect(sanitizeNextPath(next) as never);
}

/**
 * STEP 2 — Verify TOTP. Uses the pre-TOTP cookie to know which user is
 * mid-flow, then signs them in via Supabase service-role admin → magiclink
 * exchange. Cookie is cleared on success or expiry.
 *
 * Implementation note: we don't have the password at step 2. Instead of
 * re-validating it, we trust the pre-TOTP cookie (HMAC-signed, 2-min TTL)
 * and use generateLink + verifyOtp to mint a Supabase session.
 */
export async function verifyTotpAction(formData: FormData) {
  const totpCode = String(formData.get("totp_code") ?? "").trim();
  const next = String(formData.get("next") ?? "/dashboard");
  const ip = await getClientIp();

  if (!/^\d{6}$/.test(totpCode)) {
    return redirect(`/login?step=totp&error=Invalid+code+format&next=${encodeURIComponent(next)}`);
  }

  const pre = await readPreTotpCookie();
  if (!pre.ok) {
    await clearPreTotpCookie();
    const reasonMsg = pre.reason === "expired"
      ? "Code session expired — sign in again"
      : "Sign in again";
    return redirect(`/login?error=${encodeURIComponent(reasonMsg)}`);
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id, email, totp_enabled, totp_secret")
    .eq("id", pre.userId)
    .single();

  if (!profile || !profile.totp_enabled || !profile.totp_secret) {
    await clearPreTotpCookie();
    return redirect("/login?error=Invalid+credentials");
  }

  const result = await verifyTOTPWithReplayCheck(profile.id, profile.totp_secret, totpCode);
  if (result !== "ok") {
    try {
      await svc.from("audit_log").insert({
        action:
          result === "replayed" ? "TOTP_LOGIN_REPLAY_BLOCKED" : "TOTP_LOGIN_FAILED",
        detail: result === "replayed" ? "Code reused" : "2FA code invalid",
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
    const msg = result === "replayed" ? "Code+already+used" : "Invalid+2FA+code";
    return redirect(`/login?step=totp&error=${msg}&next=${encodeURIComponent(next)}`);
  }

  // ─── TOTP good — mint a real Supabase session via magiclink exchange ───
  const linkRes = await svc.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email!,
  });

  if (linkRes.error || !linkRes.data.properties?.hashed_token) {
    await clearPreTotpCookie();
    return redirect("/login?error=Could+not+complete+sign-in");
  }

  const supabase = await createClient();
  const verify = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkRes.data.properties.hashed_token,
  });

  if (verify.error) {
    await clearPreTotpCookie();
    return redirect("/login?error=Could+not+complete+sign-in");
  }

  await clearPreTotpCookie();

  try {
    await svc.from("audit_log").insert({
      action: "LOGIN",
      detail: `Email: ${profile.email} (TOTP verified)`,
      user_email: profile.email,
      ip,
    });
  } catch {}

  try {
    const { bindSessionPin } = await import("@/lib/auth/session-pin");
    await bindSessionPin(profile.id);
  } catch {}

  revalidatePath("/", "layout");
  redirect(sanitizeNextPath(next) as never);
}

/** Abort the TOTP step and go back to email/password. */
export async function cancelTotpAction() {
  await clearPreTotpCookie();
  redirect("/login");
}

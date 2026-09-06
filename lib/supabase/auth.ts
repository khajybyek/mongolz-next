import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createClient } from "./server";
import {
  PUBLIC_PROFILE_COLUMNS as PUBLIC_PROFILE_COLUMN_LIST,
  type PublicProfile,
} from "@/lib/database.types";
import { checkSessionPin, type PinResult } from "@/lib/auth/session-pin";
import { flag } from "@/lib/flags";

// Single source of truth with the PublicProfile type (lib/database.types.ts).
const PUBLIC_PROFILE_COLUMNS = PUBLIC_PROFILE_COLUMN_LIST.join(", ");

export type AuthCtx = { user: { id: string; email: string }; profile: PublicProfile };
type ApiAuthErr = { error: NextResponse };
export type ApiAuthResult = AuthCtx | ApiAuthErr;

export type ApiAuthOptions = {
  /**
   * Let the audit-log-only role call this endpoint. Only own-account routes
   * (2FA / passkey management, GDPR export & erase) opt in; everything else
   * — streams, uploads, push, playback — is operator (admin | viewer) scope.
   */
  allowAuditor?: boolean;
};

export type AdminOptions = {
  /** The TOTP-setup page itself must be reachable by an admin without TOTP. */
  allowNoTotp?: boolean;
};

export function isAuthErr(r: ApiAuthResult): r is ApiAuthErr {
  return "error" in r;
}

type SessionState =
  | { kind: "none" }
  | { kind: "no-profile" }
  | { kind: "pin-rejected"; ctx: AuthCtx; reason: string }
  | { kind: "ok"; ctx: AuthCtx };

/**
 * Session-pin policy.
 *
 * Every session our login flows mint (password + TOTP, passkey) carries a
 * pin cookie. A Supabase session obtained any other way — e.g. straight from
 * the public password grant with a phished password — has none, so for users
 * with TOTP enabled the cookie is *mandatory*: it is the proof the session
 * went through the second factor. Users without TOTP (viewer/auditor) keep
 * back-compat for cookie-less legacy sessions. A pin that exists but does
 * not match (other network/UA, tampered, expired) is always rejected.
 *
 * `no-secret` means the deploy is misconfigured; signing already fails closed
 * (lib/auth/hmac-secret.ts) so we do not additionally lock everyone out.
 * MONGOLZ_FF_SESSION_PIN=0 is the operator kill switch.
 */
async function pinVerdict(
  userId: string,
  profile: PublicProfile,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!flag("session_pin_enforce")) return { ok: true };
  let pin: PinResult;
  try {
    pin = await checkSessionPin(userId);
  } catch {
    return { ok: true }; // never lock legitimate users out on an internal error
  }
  if (pin.ok) return { ok: true };
  switch (pin.reason) {
    case "no-secret":
      return { ok: true };
    case "no-cookie":
      return profile.totp_enabled ? { ok: false, reason: "no-cookie" } : { ok: true };
    default:
      return { ok: false, reason: pin.reason };
  }
}

async function loadSession(): Promise<SessionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", user.id)
    .single<PublicProfile>();
  if (error || !profile) return { kind: "no-profile" };

  const ctx: AuthCtx = { user: { id: user.id, email: user.email ?? profile.email }, profile };

  const pin = await pinVerdict(user.id, profile);
  if (!pin.ok) {
    // Revoke the session server-side as well (global): a replayed cookie
    // must stop working everywhere, and the middleware's getUser() then
    // sees no session, so /login does not bounce back to /dashboard.
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // cookie writes are not possible from a Server Component — fine, the
      // server-side revocation is what matters.
    }
    return { kind: "pin-rejected", ctx, reason: pin.reason };
  }
  return { kind: "ok", ctx };
}

// ── Page / Server Action helpers (redirect) ───────────────────────────
export async function requireUser(): Promise<AuthCtx> {
  const s = await loadSession();
  if (s.kind === "none") redirect("/login");
  if (s.kind === "no-profile") redirect("/login?error=no_profile");
  if (s.kind === "pin-rejected") redirect("/login?error=session_pin");
  return s.ctx;
}

export async function requireAdmin(opts: AdminOptions = {}): Promise<AuthCtx> {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin") redirect("/dashboard?error=admin-only");
  // Admin TOTP is mandatory. The middleware only forces page navigations to
  // /settings; server actions and API routes enforce it here so an admin
  // without a second factor cannot act at all.
  if (!ctx.profile.totp_enabled && !opts.allowNoTotp) redirect("/settings?force_totp=1");
  return ctx;
}

export async function requireAdminOrAuditor(): Promise<AuthCtx> {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin" && ctx.profile.role !== "auditor") {
    redirect("/dashboard?error=forbidden");
  }
  if (ctx.profile.role === "admin" && !ctx.profile.totp_enabled) redirect("/settings?force_totp=1");
  return ctx;
}

// ── API Route Handler helpers (401/403 JSON, no redirect) ─────────────
function unauthorized(): ApiAuthErr {
  return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}

async function apiSession(opts: ApiAuthOptions): Promise<ApiAuthResult> {
  const s = await loadSession();
  if (s.kind === "none" || s.kind === "no-profile") return unauthorized();
  if (s.kind === "pin-rejected") {
    return { error: NextResponse.json({ error: "session_invalid" }, { status: 401 }) };
  }
  if (s.ctx.profile.role === "auditor" && !opts.allowAuditor) {
    return {
      error: NextResponse.json({ error: "forbidden: auditor scope is /audit only" }, { status: 403 }),
    };
  }
  return s.ctx;
}

export async function requireUserApi(opts: ApiAuthOptions = {}): Promise<ApiAuthResult> {
  return apiSession(opts);
}

export async function requireAdminApi(): Promise<ApiAuthResult> {
  const r = await apiSession({ allowAuditor: true });
  if (isAuthErr(r)) return r;
  if (r.profile.role !== "admin") {
    return { error: NextResponse.json({ error: "forbidden: admin only" }, { status: 403 }) };
  }
  if (!r.profile.totp_enabled) {
    return { error: NextResponse.json({ error: "totp_required" }, { status: 403 }) };
  }
  return r;
}

export async function requireAdminOrAuditorApi(): Promise<ApiAuthResult> {
  const r = await apiSession({ allowAuditor: true });
  if (isAuthErr(r)) return r;
  if (r.profile.role !== "admin" && r.profile.role !== "auditor") {
    return { error: NextResponse.json({ error: "forbidden: admin or auditor only" }, { status: 403 }) };
  }
  if (r.profile.role === "admin" && !r.profile.totp_enabled) {
    return { error: NextResponse.json({ error: "totp_required" }, { status: 403 }) };
  }
  return r;
}

export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

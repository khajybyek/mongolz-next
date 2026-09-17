import { redirect } from "next/navigation";
import { schOrganiserVerdict } from "@/lib/sch/access";
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
  | { kind: "unavailable" }
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
 * Missing signing configuration or an internal verification error blocks the
 * request without revoking otherwise valid sessions. Once verification is
 * available again, those sessions can be checked normally.
 * MONGOLZ_FF_SESSION_PIN=0 is the operator kill switch.
 */
async function pinVerdict(
  userId: string,
  profile: PublicProfile,
): Promise<PinResult | { ok: false; reason: "internal-error" }> {
  if (!flag("session_pin_enforce")) return { ok: true };
  let pin: PinResult;
  try {
    pin = await checkSessionPin(userId);
  } catch {
    return { ok: false, reason: "internal-error" };
  }
  if (pin.ok) return { ok: true };
  switch (pin.reason) {
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
  if (error || !profile) {
    // Self-heal rather than loop: without a profile every gate refuses, so a
    // session that cannot read one is useless. Drop it locally (the account
    // itself may be fine — a transient read error should not revoke the user's
    // other devices) so the next request is simply unauthenticated.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Cookie writes are impossible from a Server Component; the middleware
      // exemption for ?error=no_profile keeps the page reachable either way.
    }
    return { kind: "no-profile" };
  }

  const ctx: AuthCtx = { user: { id: user.id, email: user.email ?? profile.email }, profile };

  const pin = await pinVerdict(user.id, profile);
  if (!pin.ok) {
    if (pin.reason === "no-secret" || pin.reason === "internal-error") {
      return { kind: "unavailable" };
    }
    // Revoke the session server-side as well (global): a replayed cookie
    // must stop working everywhere, and the middleware's getUser() then
    // sees no session, so /login does not bounce back to /dashboard.
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // cookie writes are not possible from a Server Component — fine, the
      // server-side revocation is what matters.
    }
    // Leave a trace. A pin rejection signs the user out everywhere with no
    // other signal, so without this row an operator being bounced by a
    // changing IP looks identical to one who simply logged out. The next
    // request has no session, so this cannot loop.
    try {
      const { createServiceClient } = await import("./server");
      await createServiceClient().from("audit_log").insert({
        action: "SESSION_PIN_REJECTED",
        detail: `reason: ${pin.reason}`,
        user_id: user.id,
        user_email: ctx.user.email,
      });
    } catch {}
    return { kind: "pin-rejected", ctx, reason: pin.reason };
  }
  return { kind: "ok", ctx };
}

// ── Page / Server Action helpers (redirect) ───────────────────────────
export async function requireUser(): Promise<AuthCtx> {
  const s = await loadSession();
  if (s.kind === "none") redirect("/login");
  if (s.kind === "no-profile") redirect("/login?error=no_profile");
  if (s.kind === "unavailable") redirect("/login?error=server_config");
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

/**
 * SCH Esports console: admin (second factor required) or the organiser role
 * (tournament-only, no TOTP requirement). See lib/sch/access.ts.
 */
export async function requireSchOrganiser(): Promise<AuthCtx> {
  const ctx = await requireUser();
  const verdict = schOrganiserVerdict(ctx.profile);
  if (verdict === "forbidden") redirect("/dashboard?error=forbidden");
  if (verdict === "totp_required") redirect("/settings?force_totp=1");
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
  if (s.kind === "unavailable") {
    return { error: NextResponse.json({ error: "server_config" }, { status: 503 }) };
  }
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

export async function requireSchOrganiserApi(): Promise<ApiAuthResult> {
  const r = await apiSession({ allowAuditor: true });
  if (isAuthErr(r)) return r;
  const verdict = schOrganiserVerdict(r.profile);
  if (verdict === "forbidden") {
    return { error: NextResponse.json({ error: "forbidden: organiser or admin only" }, { status: 403 }) };
  }
  if (verdict === "totp_required") {
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

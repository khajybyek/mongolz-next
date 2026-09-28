/**
 * Session binding — the data tier's proof that a session went through the
 * second factor (migration 20260928120000, ADR 0011 "Session binding").
 *
 * The app mints the real session of a TOTP user only after the second factor
 * (TOTP code, recovery code or passkey) verified, with admin.generateLink +
 * verifyOtp. Anyone controlling the admin's mailbox can get a session of the
 * same shape from GoTrue directly (/auth/v1/otp, /auth/v1/recover), so the
 * `amr` claim cannot tell the two apart. The app therefore records every
 * session it mints in private.mfa_sessions (public.bind_mfa_session, service
 * role only) and private.mfa_ok() refuses a TOTP profile's session that is
 * not listed there.
 *
 * Two rules the callers follow:
 *   - After a mint: a bind that fails for any reason other than "the RPC is
 *     not deployed yet" ends the new session (local sign-out) and fails the
 *     login. An unbound session would only render an empty console.
 *   - In the session loader: an unbound TOTP session is signed out and sent
 *     back to /login; anything the loader cannot determine (RPC missing, RPC
 *     error, unreadable token) signs nobody out — the database still enforces.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";

export type MfaMethod = "totp" | "recovery_code" | "passkey";

type ServiceClient = ReturnType<typeof createServiceClient>;
type PgError = { code?: string | null; message?: string | null } | null;
type RpcResponse = { data: unknown; error: PgError };

/**
 * `bind_mfa_session` / `mfa_session_bound` only appear in
 * lib/database.generated.ts after `npm run gen:types` runs against a database
 * that has the migration applied, so the calls go through this narrow
 * structural type (same approach as lib/rate-limit.ts).
 */
type RpcCapableClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResponse>;
};

function rpcOf(svc: ServiceClient): RpcCapableClient {
  return svc as unknown as RpcCapableClient;
}

/** The part of a Supabase client the post-mint rollback needs. */
export type SignOutCapable = {
  auth: { signOut: (options: { scope: "local" }) => Promise<unknown> };
};

/** The part of a Supabase client the loader needs to read its access token. */
export type SessionReader = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token?: string | null } | null } }>;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Decode a JWT payload WITHOUT verifying the signature. Only ever called on
 * tokens this server did not take from the client unchecked: the one GoTrue
 * returned to us over TLS from verifyOtp, or the one `getUser()` has just
 * validated with GoTrue. The database re-reads the same claim from the
 * signed token on every statement; this copy only decides what to bind.
 */
export function accessTokenClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(base64UrlDecode(parts[1]));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The GoTrue session id (`session_id` claim) of an access token, lower-cased,
 * or null when the token is unreadable, has no uuid-shaped session_id, or —
 * when `expectedUserId` is given — belongs to someone else.
 */
export function sessionIdFromAccessToken(token: unknown, expectedUserId?: string): string | null {
  const claims = accessTokenClaims(token);
  if (!claims) return null;
  if (expectedUserId !== undefined && claims.sub !== expectedUserId) return null;
  const sid = claims.session_id;
  return typeof sid === "string" && UUID_RE.test(sid) ? sid.toLowerCase() : null;
}

/**
 * "The function is not deployed yet" — the web ships before the migration
 * (deploy order in 20260928120000). PostgREST answers PGRST202 when its
 * schema cache has no such function; Postgres says 42883. Every other error
 * is a real failure.
 */
export function isMissingBindingRpc(error: PgError): boolean {
  const code = error?.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  return (error?.message ?? "").toLowerCase().includes("could not find the function");
}

export type BindOutcome =
  | { state: "bound" }
  /** bind_mfa_session is not deployed yet: the login continues unbound. */
  | { state: "unavailable" }
  | { state: "failed"; reason: string };

/** Call public.bind_mfa_session. Never throws. */
export async function bindMfaSession(
  svc: ServiceClient,
  args: { sessionId: string; userId: string; method: MfaMethod },
): Promise<BindOutcome> {
  try {
    const { error } = await rpcOf(svc).rpc("bind_mfa_session", {
      p_session_id: args.sessionId,
      p_user_id: args.userId,
      p_method: args.method,
    });
    if (!error) return { state: "bound" };
    if (isMissingBindingRpc(error)) return { state: "unavailable" };
    return { state: "failed", reason: error.code ? `rpc ${error.code}` : "rpc error" };
  } catch {
    return { state: "failed", reason: "rpc threw" };
  }
}

/**
 * Bind the session a login flow has just minted, or undo the mint.
 *
 * Returns true when the caller may finish the login (bound, or the RPC is
 * not deployed yet). On false the new session has already been signed out
 * LOCALLY — only this session, the account's other devices are untouched —
 * and a MFA_SESSION_BIND_FAILED audit row written; the caller answers with
 * its usual "sign-in could not be completed" error.
 */
export async function bindMintedSession(opts: {
  svc: ServiceClient;
  userClient: SignOutCapable;
  accessToken: string | null | undefined;
  userId: string;
  userEmail?: string | null;
  method: MfaMethod;
  ip?: string | null;
}): Promise<boolean> {
  const sessionId = sessionIdFromAccessToken(opts.accessToken, opts.userId);
  const outcome: BindOutcome = sessionId
    ? await bindMfaSession(opts.svc, { sessionId, userId: opts.userId, method: opts.method })
    : { state: "failed", reason: "no session_id claim" };

  if (outcome.state === "bound") return true;
  if (outcome.state === "unavailable") {
    log.warn("mfa session binding unavailable: migration 20260928120000 not applied yet, login continues unbound", {
      method: opts.method,
    });
    return true;
  }

  log.error("mfa session binding failed, ending the new session", {
    method: opts.method,
    reason: outcome.reason,
  });
  try {
    await opts.userClient.auth.signOut({ scope: "local" });
  } catch {
    /* best effort: the login still fails, and the database refuses the unbound session */
  }
  try {
    await opts.svc.from("audit_log").insert({
      action: "MFA_SESSION_BIND_FAILED",
      detail: `method: ${opts.method} · ${outcome.reason}`,
      user_id: opts.userId,
      user_email: opts.userEmail ?? null,
      ip: opts.ip ?? null,
    });
  } catch {}
  return false;
}

export type BindingVerdict = "bound" | "unbound" | "unknown";

/**
 * Ask the database whether it would accept this session
 * (public.mfa_session_bound: true when bound or when binding is switched
 * off). Missing RPC, errors and non-boolean answers are "unknown" — the
 * loader never signs anyone out on those.
 */
export async function mfaSessionBound(svc: ServiceClient, sessionId: string): Promise<BindingVerdict> {
  try {
    const { data, error } = await rpcOf(svc).rpc("mfa_session_bound", { p_session_id: sessionId });
    if (error) {
      if (!isMissingBindingRpc(error)) {
        log.warn("mfa_session_bound failed; not forcing a re-login", { code: error.code ?? null });
      }
      return "unknown";
    }
    if (data === true) return "bound";
    if (data === false) return "unbound";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Binding verdict for the session a request carries (see mfaSessionBound). */
export async function currentSessionBinding(
  userClient: SessionReader,
  svc: ServiceClient,
  userId: string,
): Promise<BindingVerdict> {
  try {
    const { data } = await userClient.auth.getSession();
    const sessionId = sessionIdFromAccessToken(data.session?.access_token, userId);
    if (!sessionId) return "unknown";
    return await mfaSessionBound(svc, sessionId);
  } catch {
    return "unknown";
  }
}

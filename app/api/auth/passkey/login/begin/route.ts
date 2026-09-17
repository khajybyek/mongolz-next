import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { buildAuthenticationOptions, getRpConfig } from "@/lib/auth/webauthn";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { checkLoginRateLimit, checkRateLimit, rateLimitResponse, type RateLimitOptions } from "@/lib/rate-limit";
import { pickHmacSecret } from "@/lib/auth/hmac-secret";
import { hmacSign } from "@/lib/auth/hmac";

/**
 * `begin` is anonymous and used to be free (the login buckets are only
 * PEEKED here, by design — charging them would let anyone lock an account).
 * A dedicated per-IP budget bounds challenge floods without touching the
 * victim's login budget.
 */
const PASSKEY_BEGIN_LIMIT: RateLimitOptions = {
  name: "passkey_begin_ip",
  action: "PASSKEY_BEGIN",
  windowSec: 15 * 60,
  max: 30,
};

/**
 * Same 200 shape for "unknown e-mail" and "no passkeys" as for a real
 * account, so the route is not an oracle for which admins are worth
 * attacking. The decoy is deterministic per identifier (HMAC), nothing is
 * stored, and /finish can never succeed for it.
 */
async function decoyOptions(identifier: string, host: string | null) {
  const secret = pickHmacSecret("REAUTH_COOKIE_SECRET", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return null;
  const hex = hmacSign(secret, "mongolz-passkey-decoy:v1", identifier, "hex");
  const userHandle = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const credentialId = hmacSign(secret, "mongolz-passkey-decoy-cred:v1", identifier, "base64url").slice(0, 27);
  const rpID = getRpConfig(host).rpId;
  const opts = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: [{ id: credentialId, transports: ["internal", "hybrid"] }],
  });
  return { ...opts, user_handle: userHandle };
}

async function unavailable(identifier: string, host: string | null) {
  try {
    const decoy = await decoyOptions(identifier, host);
    if (decoy) return NextResponse.json(decoy);
  } catch {
    /* fall through to the generic refusal */
  }
  return NextResponse.json({ error: "passkey login unavailable" }, { status: 400 });
}

/**
 * Step 1 of passkey login. Caller is anonymous (not yet logged in).
 *
 * Body: { email: string } — supports the same email-or-username syntax as
 * password login. Unknown accounts and accounts without passkeys get decoy
 * options in the same 200 shape, so the route does not reveal which accounts
 * have a passkey.
 *
 * Returns `PublicKeyCredentialRequestOptions` for `navigator.credentials.get()`
 * plus a `user_handle` (the user's id) that the client passes back to
 * /login/finish so the server doesn't have to re-resolve from email.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rawIdentifier = String(body?.email ?? "").trim().toLowerCase();
  if (!rawIdentifier) {
    return NextResponse.json({ error: "missing identifier" }, { status: 400 });
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? null;

  // Charged (never refunded): every call mints and stores a challenge.
  const beginRl = await checkRateLimit(ip ?? "unknown", PASSKEY_BEGIN_LIMIT);
  if (!beginRl.ok) return rateLimitResponse(beginRl);

  const svc = createServiceClient();
  // Resolve username → email first, so the throttle counts the canonical
  // address the password flow uses rather than whatever was typed.
  let email = rawIdentifier;
  if (!email.includes("@")) {
    const { data: resolved } = await svc.rpc("email_for_username", {
      p_username: rawIdentifier,
    });
    if (typeof resolved !== "string" || !resolved) {
      return unavailable(rawIdentifier, host);
    }
    email = resolved.toLowerCase();
  }

  // Rate limit — passkey login still counts as a login attempt, but only
  // against the per-IP lock. lib/rate-limit.ts documents that a phishing
  // resistant factor must not be lockable by failed passwords; the scope was
  // never passed, so five wrong passwords locked an admin out of the escape
  // hatch built for exactly that situation.
  const rl = await checkLoginRateLimit({ ip, email, scope: "passkey" });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Too many attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } },
    );
  }

  // Look up the user id (profiles.email is the same as auth.users.email).
  const { data: profile } = await svc
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (!profile) {
    // Don't leak whether the email exists.
    return unavailable(rawIdentifier, host);
  }

  try {
    const opts = await buildAuthenticationOptions({
      user_id: profile.id,
      host,
    });
    // Return options + the user_handle so /finish doesn't have to re-resolve.
    return NextResponse.json({ ...opts, user_handle: profile.id });
  } catch {
    // No passkeys enrolled (or options could not be built) — same decoy.
    return unavailable(rawIdentifier, host);
  }
}

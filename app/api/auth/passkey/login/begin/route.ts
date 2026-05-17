import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { buildAuthenticationOptions } from "@/lib/auth/webauthn";
import { checkLoginRateLimit } from "@/lib/rate-limit";

/**
 * Step 1 of passkey login. Caller is anonymous (not yet logged in).
 *
 * Body: { email: string } — supports the same email-or-username syntax as
 * password login. If the user has no enrolled passkeys we return a generic
 * 400 to avoid leaking which accounts have passkey-only login.
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

  // Rate limit — passkey login still counts as a login attempt.
  const rl = await checkLoginRateLimit({ ip, email: rawIdentifier });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.message ?? "Too many attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } },
    );
  }

  const svc = createServiceClient();
  // Resolve username → email if needed.
  let email = rawIdentifier;
  if (!email.includes("@")) {
    const { data: resolved } = await svc.rpc("email_for_username", {
      p_username: rawIdentifier,
    });
    if (typeof resolved !== "string" || !resolved) {
      return NextResponse.json({ error: "passkey login unavailable" }, { status: 400 });
    }
    email = resolved.toLowerCase();
  }

  // Look up the user id (profiles.email is the same as auth.users.email).
  const { data: profile } = await svc
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (!profile) {
    // Generic error — don't leak whether the email exists.
    return NextResponse.json({ error: "passkey login unavailable" }, { status: 400 });
  }

  try {
    const opts = await buildAuthenticationOptions({
      user_id: profile.id,
      host,
    });
    // Return options + the user_handle so /finish doesn't have to re-resolve.
    return NextResponse.json({ ...opts, user_handle: profile.id });
  } catch {
    return NextResponse.json({ error: "passkey login unavailable" }, { status: 400 });
  }
}

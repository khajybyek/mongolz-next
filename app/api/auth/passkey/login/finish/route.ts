import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { finishAuthentication } from "@/lib/auth/webauthn";
import { bindSessionPin } from "@/lib/auth/session-pin";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

/**
 * Step 2 of passkey login. Verifies the WebAuthn assertion the browser
 * produced, then mints a real Supabase session via the admin magic-link
 * trick (generateLink + verifyOtp).
 *
 * Body: { user_handle: uuid, response: AuthenticationResponseJSON }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const user_handle = String(body.user_handle ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_handle)) {
    return NextResponse.json({ error: "invalid user_handle" }, { status: 400 });
  }
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response) {
    return NextResponse.json({ error: "missing assertion response" }, { status: 400 });
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? null;

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id, email")
    .eq("id", user_handle)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "passkey login failed" }, { status: 401 });
  }

  // 1. Verify WebAuthn assertion.
  try {
    await finishAuthentication({
      user_id: profile.id,
      host,
      response,
    });
  } catch (e) {
    // Audit the failure but don't leak details.
    try {
      await svc.from("audit_log").insert({
        action: "PASSKEY_LOGIN_FAILED",
        detail: e instanceof Error ? e.message : "assertion failed",
        user_id: profile.id,
        user_email: profile.email,
        ip,
      });
    } catch {}
    return NextResponse.json({ error: "passkey login failed" }, { status: 401 });
  }

  // 2. Mint a Supabase session via admin magic-link → verifyOtp.
  const linkRes = await svc.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (linkRes.error || !linkRes.data.properties?.hashed_token) {
    return NextResponse.json({ error: "could not mint session" }, { status: 500 });
  }

  const supabase = await createClient();
  const verify = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkRes.data.properties.hashed_token,
  });
  if (verify.error) {
    return NextResponse.json({ error: "could not mint session" }, { status: 500 });
  }

  // 3. Audit + session pin (best-effort).
  try {
    await svc.from("audit_log").insert({
      action: "PASSKEY_LOGIN",
      detail: `Passkey verified`,
      user_id: profile.id,
      user_email: profile.email,
      ip,
    });
  } catch {}
  try {
    await bindSessionPin(profile.id);
  } catch {}

  return NextResponse.json({ ok: true });
}

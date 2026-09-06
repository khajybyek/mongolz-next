import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildRegistrationOptions } from "@/lib/auth/webauthn";
import { hasFreshReauth } from "@/lib/auth/step-up";

/**
 * Step 1 of passkey enrollment — returns PublicKeyCredentialCreationOptions
 * for `navigator.credentials.create()`. Caller must be authenticated.
 */
export async function POST() {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  // Enrolling a passkey creates a durable password-less, TOTP-less login for
  // this account, so it needs fresh step-up (a hijacked session alone must
  // not be able to plant one).
  if (!(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 403 });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? null;

  // Avoid re-enrolling the same authenticator — pass existing credential
  // IDs into excludeCredentials.
  const svc = createServiceClient();
  const { data: existing } = await svc
    .from("webauthn_credentials")
    .select("credential_id")
    .eq("user_id", auth.user.id);

  try {
    const opts = await buildRegistrationOptions({
      user_id: auth.user.id,
      user_email: auth.user.email,
      host,
      existingCredentialIds: (existing ?? []).map((r) => r.credential_id),
    });
    return NextResponse.json(opts);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build options" },
      { status: 500 },
    );
  }
}

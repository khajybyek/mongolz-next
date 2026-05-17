import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { finishRegistration } from "@/lib/auth/webauthn";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

/**
 * Step 2 of passkey enrollment — receives the attestation response from
 * `navigator.credentials.create()` and verifies / stores it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.response) {
    return NextResponse.json({ error: "missing attestation response" }, { status: 400 });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? null;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const result = await finishRegistration({
      user_id: auth.user.id,
      host,
      response: body.response as RegistrationResponseJSON,
      device_name: typeof body.device_name === "string" ? body.device_name : null,
    });

    // Audit
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "PASSKEY_ENROLL",
        detail: `Device: ${body.device_name ?? "unknown"} · cred_id: ${result.credential_id.slice(0, 12)}…`,
        user_id: auth.user.id,
        user_email: auth.user.email,
        ip,
      });
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "verification failed" },
      { status: 400 },
    );
  }
}

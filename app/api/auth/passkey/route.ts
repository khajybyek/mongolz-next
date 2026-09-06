import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";

/**
 * GET /api/auth/passkey
 * List the caller's enrolled passkeys (id + device label + timestamps).
 *
 * DELETE /api/auth/passkey?id=<uuid>
 * Remove an enrolled passkey by id. The RLS policy plus the user_id filter
 * mean a user can never delete someone else's credential, but we still
 * check explicitly server-side to give a clean error response.
 */
export async function GET() {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("webauthn_credentials")
    .select("id, credential_id, device_name, created_at, last_used_at, transports")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ credentials: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserApi({ allowAuditor: true });
  if (isAuthErr(auth)) return auth.error;
  // Removing a passkey is an account-recovery-relevant change → step-up.
  if (!(await hasFreshReauth(auth.user.id))) {
    return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: cred, error: fetchErr } = await svc
    .from("webauthn_credentials")
    .select("id, device_name")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .single();
  if (fetchErr || !cred) {
    return NextResponse.json({ error: "passkey not found" }, { status: 404 });
  }

  const { error } = await svc
    .from("webauthn_credentials")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await svc.from("audit_log").insert({
      action: "PASSKEY_DELETE",
      detail: `Device: ${cred.device_name ?? "unknown"}`,
      user_id: auth.user.id,
      user_email: auth.user.email,
      ip,
    });
  } catch {}

  return NextResponse.json({ ok: true });
}

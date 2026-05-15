import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const svc = createServiceClient();

  const { data, error } = await svc.rpc("verify_audit_chain");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    integrity: (data?.length ?? 0) === 0 ? "valid" : "tampered",
    tampered_rows: data ?? [],
    checked_at: new Date().toISOString(),
  });
}

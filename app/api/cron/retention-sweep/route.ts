import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/auth/cron";

/**
 * Daily retention sweep (04:00 UTC ≈ 13:00 KST).
 * Calls public.sweep_retention() which honors retention_policies rows.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("sweep_retention");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "ok", swept: data ?? {} });
}

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Daily retention sweep (04:00 UTC ≈ 13:00 KST).
 * Calls public.sweep_retention() which honors retention_policies rows.
 */
function authorized(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET ?? process.env.MONITORING_CRON_SECRET;
  if (!sec) return true; // dev/staging
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return got === sec;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("sweep_retention");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "ok", swept: data ?? {} });
}

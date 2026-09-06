import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/auth/cron";
import { runRetentionSweep } from "@/lib/retention";

/**
 * Daily retention sweep (04:00 UTC ≈ 13:00 KST).
 * Deletes expired rows via public.sweep_retention() and then removes the
 * storage objects the RPC reported (lib/retention.ts).
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const swept = await runRetentionSweep(createServiceClient());
    return NextResponse.json({ status: "ok", swept });
  } catch (e) {
    console.error("[retention-sweep]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}

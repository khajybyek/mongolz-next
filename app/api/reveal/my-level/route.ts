import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

/**
 * Returns the calling user's hierarchical reveal authority level (ADR 0009).
 *
 *   { reveal_level: 0 }   → director (can reveal every face)
 *   { reveal_level: 3 }   → restricted (only faces with chain_index >= 3)
 *
 * Used by the reveal modal to show the operator their scope before they
 * submit a request. Purely informational — the real gate is enforced
 * server-side in reveal_job.py.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("reveal_level")
    .eq("id", auth.user.id)
    .single();

  const reveal_level = (data as { reveal_level?: number } | null)?.reveal_level ?? 0;
  return NextResponse.json({ reveal_level });
}

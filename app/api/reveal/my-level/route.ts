import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { readRevealAuthority } from "@/lib/reveal-authority";

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

  const authority = await readRevealAuthority(auth.user.id);
  if ("error" in authority) return authority.error;
  return NextResponse.json({ reveal_level: authority.level }, { headers: { "Cache-Control": "private, no-store" } });
}

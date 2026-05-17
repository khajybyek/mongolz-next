import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { allFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";

/** Admin-only snapshot of all feature flags. The UI on `/settings`
 *  reads this to render the read-only flag table. Flips require an env
 *  var change in Vercel + redeploy (no hot-flip yet — see lib/flags.ts
 *  for the upgrade path). */
export async function GET() {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  return NextResponse.json({ flags: allFlags() });
}

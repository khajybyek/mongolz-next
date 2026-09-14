import { NextRequest, NextResponse } from "next/server";
import { authorizeRevealJob, REVEAL_PRIVATE_HEADERS } from "@/lib/reveal-job-access";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { openRevealReference, revealReferenceMatchesScope } from "@/lib/reveal-reference";
import { recordAccess, READ_ACTIONS, ACCESS_THROTTLE_MS } from "@/lib/audit";

export async function GET(request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const access = await authorizeRevealJob(jobId);
  if ("error" in access) return access.error;
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const { data, error } = await access.svc.from("reveal_jobs").select("reference_sealed, request_scope").eq("id", jobId).maybeSingle();
  if (error || !data?.reference_sealed) return NextResponse.json({ error: "Reference unavailable" }, { status: 404, headers: REVEAL_PRIVATE_HEADERS });
  try {
    const reference = openRevealReference(jobId, data.reference_sealed);
    if (!revealReferenceMatchesScope(data.request_scope, reference.bytes)) {
      throw new Error("Reference integrity check failed");
    }
    await recordAccess({ action: READ_ACTIONS.REVEAL_REFERENCE_VIEWED, detail: `job=${jobId}`,
      userId: auth.user.id, userEmail: auth.user.email, request, throttleMs: ACCESS_THROTTLE_MS });
    return new NextResponse(new Uint8Array(reference.bytes), { headers: {
      ...REVEAL_PRIVATE_HEADERS, "Content-Type": reference.mime,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch {
    return NextResponse.json({ error: "Reference unavailable" }, { status: 503, headers: REVEAL_PRIVATE_HEADERS });
  }
}

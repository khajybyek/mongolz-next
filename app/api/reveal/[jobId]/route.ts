import { NextResponse, type NextRequest } from "next/server";
import { authorizeRevealJob, REVEAL_PRIVATE_HEADERS } from "@/lib/reveal-job-access";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const access = await authorizeRevealJob(jobId);
  if ("error" in access) return access.error;
  const { output_path, ...job } = access.job;
  // Preserve the client contract without exposing a reusable Storage bearer URL.
  const signed_url = job.status === "completed" && output_path ? `/api/reveal/${job.id}/output` : null;
  return NextResponse.json({ ...job, signed_url }, { headers: REVEAL_PRIVATE_HEADERS });
}

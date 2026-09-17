import { NextResponse } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { hasFreshReauth } from "@/lib/auth/step-up";
import { canReadRevealOutput, readRevealAuthority } from "@/lib/reveal-authority";

export const REVEAL_PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

/** Shared by status and media routes, including every browser Range request. */
export async function authorizeRevealJob(jobId: string) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return { error: auth.error };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return { error: NextResponse.json({ error: "invalid job id" }, { status: 400 }) };
  }
  const authority = await readRevealAuthority(auth.user.id);
  if ("error" in authority) return authority;

  const svc = createServiceClient();
  const { data: job, error } = await svc
    .from("reveal_jobs")
    .select("id, status, progress, reveal_level, output_path, output_duration_sec, error_message, method, created_at, started_at, completed_at, approved_email, rejected_email, rejected_reason")
    .eq("id", jobId)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: "job unavailable" }, { status: 503 }) };
  if (!job) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (!canReadRevealOutput(authority.level, job.reveal_level)) {
    return { error: NextResponse.json({ error: "REVEAL_FORBIDDEN" }, { status: 403 }) };
  }
  if (job.status === "completed" && job.output_path && !(await hasFreshReauth(auth.user.id, { allowPassword: true }))) {
    return { error: NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401, headers: REVEAL_PRIVATE_HEADERS }) };
  }
  return { job, svc };
}

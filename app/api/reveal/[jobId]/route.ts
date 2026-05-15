import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;
  const { jobId } = await ctx.params;

  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("reveal_jobs")
    .select(
      "id, status, progress, output_path, output_duration_sec, error_message, method, created_at, started_at, completed_at"
    )
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let signedUrl: string | null = null;
  if (job.status === "completed" && job.output_path) {
    const { data: signed } = await supabase.storage
      .from("revealed")
      .createSignedUrl(job.output_path, 60 * 15); // 15 мин TTL
    signedUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({ ...job, signed_url: signedUrl });
}

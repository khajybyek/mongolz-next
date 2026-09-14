import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";
import { canCancelUpload } from "@/lib/recording-upload";

const HEADERS = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
const COLUMNS = "id, recording_id, requested_by, camera_name, status, progress, attempts, error_message, created_at, updated_at, completed_at";

async function access(id: string) {
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return { ok: false as const, error: auth.error };
  if (!UUID_RE.test(id)) return { ok: false as const, error: NextResponse.json({ error: "invalid job id" }, { status: 400, headers: HEADERS }) };
  // The caller JWT applies MFA + owner/admin RLS before the privileged ML hop.
  const client = await createClient();
  const { data: job, error } = await client.from("upload_jobs").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false as const, error: NextResponse.json({ error: "job unavailable" }, { status: 503, headers: HEADERS }) };
  if (!job || (job.requested_by !== auth.user.id && auth.profile.role !== "admin")) return { ok: false as const, error: NextResponse.json({ error: "not found" }, { status: 404, headers: HEADERS }) };
  return { ok: true as const, job, auth };
}

export async function GET(_request: NextRequest, context: Context) {
  const result = await access((await context.params).id);
  if (!result.ok) return result.error;
  const { requested_by: _owner, ...job } = result.job;
  return NextResponse.json({ job }, { headers: HEADERS });
}

export async function POST(request: NextRequest, context: Context) {
  const id = (await context.params).id;
  const result = await access(id);
  if (!result.ok) return result.error;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "retry" && action !== "cancel") return NextResponse.json({ error: "invalid action" }, { status: 400, headers: HEADERS });
  if ((action === "retry" && result.job.status !== "failed") || (action === "cancel" && !canCancelUpload(result.job.status))) {
    return NextResponse.json({ error: "job state changed; refresh" }, { status: 409, headers: HEADERS });
  }
  const url = process.env.NEXT_PUBLIC_ML_SERVICE_URL;
  const token = process.env.ML_SERVICE_TOKEN;
  if (!url || !token) return NextResponse.json({ error: "processing service unavailable" }, { status: 503, headers: HEADERS });
  try {
    const upstream = await fetch(`${url}/upload-jobs/${id}/${action}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requested_by: result.auth.user.id, is_admin: result.auth.profile.role === "admin" }),
    });
    // Raw worker exception strings and storage paths are never relayed.
    if (!upstream.ok) return NextResponse.json({ error: upstream.status === 409 ? "job state changed or input unavailable; refresh" : "processing action unavailable" }, { status: upstream.status === 409 ? 409 : 502, headers: HEADERS });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "processing service unavailable" }, { status: 502, headers: HEADERS });
  }
}

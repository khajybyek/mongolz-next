import { NextResponse, type NextRequest } from "next/server";
import { authorizeRevealJob, REVEAL_PRIVATE_HEADERS } from "@/lib/reveal-job-access";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { recordAccess, READ_ACTIONS, ACCESS_THROTTLE_MS } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const access = await authorizeRevealJob(jobId);
  if ("error" in access) return access.error;
  const { job, svc } = access;
  if (job.status !== "completed" || !job.output_path) {
    return NextResponse.json({ error: "output unavailable" }, { status: 404 });
  }
  try {
    const { data, error } = await svc.storage.from("revealed").createSignedUrl(job.output_path, 60);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: "output unavailable" }, { status: 502 });
    }
    const headers = new Headers();
    const range = req.headers.get("range");
    if (range) headers.set("Range", range);
    const upstream = await fetch(data.signedUrl, {
      headers, cache: "no-store", redirect: "error", signal: req.signal,
    });
    if (!upstream.ok && upstream.status !== 416) {
      await upstream.body?.cancel();
      return NextResponse.json({ error: "output unavailable" }, { status: 502 });
    }
    await logOutputRead(jobId, req);
    const responseHeaders = new Headers(REVEAL_PRIVATE_HEADERS);
    responseHeaders.set("Content-Type", "video/mp4");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "output unavailable" }, { status: 502 });
  }
}

/**
 * Reveal output is the only un-masked footage the product ever hands out, so
 * a download has to be on the record — and until the 2026-09-08 audit it was
 * the one reveal step that wrote nothing (request, approval and rejection all
 * did). Written after the object actually resolved; every refusal above
 * (403 authority, 401 stale step-up, 404, 502) returns before this point.
 *
 * Every served request is recorded. An earlier version logged only requests
 * whose Range started at byte zero, which meant `Range: bytes=1-` fetched the
 * whole file with no row at all — a one-header hole through the ledger the
 * compliance documents point at. Volume is bounded by the per-operator,
 * per-job throttle instead (a `<video>` seeking through evidence writes one
 * row), and `probeDb` keeps that bound across serverless instances.
 * Identity is re-read here rather than inside `authorizeRevealJob` so the
 * extra session lookup is paid once per throttle window, not once per seek.
 */
async function logOutputRead(
  jobId: string,
  request: NextRequest,
): Promise<void> {
  // Best effort in both directions: a ledger problem must not turn playable
  // evidence into a 502 (the caller's catch would swallow it as one).
  try {
    const auth = await requireAdminApi();
    if (isAuthErr(auth)) return;
    await recordAccess({
      action: READ_ACTIONS.REVEAL_OUTPUT_DOWNLOADED,
      detail: `reveal job=${jobId} · unmasked output`,
      userId: auth.user.id,
      userEmail: auth.user.email,
      request,
      throttleMs: ACCESS_THROTTLE_MS,
      probeDb: true,
    });
  } catch {
    // recordAccess already logs; nothing further to do here.
  }
}

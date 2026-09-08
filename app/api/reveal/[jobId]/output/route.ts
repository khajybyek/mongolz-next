import { NextResponse, type NextRequest } from "next/server";
import { authorizeRevealJob, REVEAL_PRIVATE_HEADERS } from "@/lib/reveal-job-access";

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

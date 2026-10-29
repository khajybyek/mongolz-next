/**
 * On-demand blurred-view proxy.
 *
 * Architecture (#3): for recordings stored with `blur_strategy='on_demand'`,
 * no plaintext "blurred MP4" exists — only the AES-encrypted original. This
 * route asks the ML service to derive the blurred view (decrypt → cubist
 * mask every face → re-encode) and streams the result back to the browser.
 *
 * The ML side caches the rendered MP4 at `/tmp/mongolz-views/{id}.mp4`, so
 * the first hit pays the render cost (~5–30s depending on clip length) and
 * every subsequent hit is zero-cost until the Railway container restarts.
 *
 * Permissive on purpose: any recording with `has_original=true` is render-
 * able through this route, regardless of `blur_strategy`. The playback page
 * picks the right route based on the column; this is the robustness fallback.
 *
 * Auth: admin + viewer can stream. Auditor is locked to /audit* by both
 * middleware AND this route's explicit role check.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { recordAccess, READ_ACTIONS, ACCESS_THROTTLE_MS } from "@/lib/audit";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid recording id" }, { status: 400 });
  }

  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  // Auditor is /audit*-only — recording playback is not in their scope.
  if (auth.profile.role === "auditor") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Verify recording exists + has an original to derive from. RLS on the
  // user-scoped client also enforces the viewer can actually see this row.
  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("recordings")
    .select("id, has_original")
    .eq("id", id)
    .maybeSingle();

  if (!rec) {
    return NextResponse.json({ error: "recording not found" }, { status: 404 });
  }
  if (!rec.has_original) {
    return NextResponse.json(
      { error: "no encrypted original — cannot derive view" },
      { status: 404 },
    );
  }

  if (!ML_URL) {
    return NextResponse.json({ error: "ML service unavailable" }, { status: 502 });
  }

  const headers: Record<string, string> = {};
  if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;
  // Forward byte-range requests. Safari/iOS will not play an MP4 whose server
  // answers its `Range: bytes=0-1` probe with a plain 200, and seeking in every
  // browser relies on 206 answers. The ML side (Starlette FileResponse) serves
  // ranges from its render cache; a cold render may still answer 200 once.
  const range = request.headers.get("range");
  if (range) {
    headers.Range = range;
    const ifRange = request.headers.get("if-range");
    if (ifRange) headers["If-Range"] = ifRange;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ML_URL}/recording/${encodeURIComponent(id)}/view`,
      { headers, cache: "no-store", signal: request.signal },
    );
  } catch {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
  }

  // 416 = the requested range lies outside the file. Pass it through with its
  // Content-Range so the player can recover. It is not a viewing: no audit row.
  if (upstream.status === 416) {
    await upstream.body?.cancel().catch(() => {});
    const refused = new Headers({ "Cache-Control": "private, no-store", "Accept-Ranges": "bytes" });
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) refused.set("Content-Range", contentRange);
    return new NextResponse(null, { status: 416, headers: refused });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: `ML render failed (${upstream.status})`,
        detail: detail.slice(0, 200),
      },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  // The masked view of a recording is still personal data: record who watched
  // which recording. Written only after the ML service accepted the render —
  // the 404/502 branches above are refusals, not viewings. Collapsed to one
  // row per operator per recording per window; range requests and re-watches
  // may reach this route repeatedly because privacy changes disable browser
  // caching of the derived view.
  await recordAccess({
    action: READ_ACTIONS.RECORDING_VIEWED,
    detail: `recording=${id} · on-demand masked view`,
    userId: auth.user.id,
    userEmail: auth.user.email,
    request,
    throttleMs: ACCESS_THROTTLE_MS,
  });

  // Stream the MP4 body straight through, keeping the upstream status (200 or
  // 206) and the headers a media element needs to seek. The camera's consent
  // and privacy policy can tighten while this page is open, so the browser
  // must revalidate every request against the ML service's current policy.
  const responseHeaders = new Headers({
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers: responseHeaders,
  });
}

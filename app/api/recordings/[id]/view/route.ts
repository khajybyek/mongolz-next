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

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(
  _request: NextRequest,
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

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ML_URL}/recording/${encodeURIComponent(id)}/view`,
      { headers, cache: "no-store" },
    );
  } catch {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
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

  // Stream the MP4 body straight through. Cache hint = "private" (per-user)
  // because the URL is auth-gated; "max-age=300" gives the browser 5 min of
  // local caching so seeking back/forward within the player doesn't re-hit.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "private, max-age=300",
    },
  });
}

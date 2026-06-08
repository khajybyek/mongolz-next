import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUserApi, isAuthErr } from "@/lib/supabase/auth";
import { verifyStreamTicket } from "@/lib/stream-ticket";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

function validSegment(segment: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) return false;
  return segment === "index.m3u8" || segment.endsWith(".ts");
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ cameraId: string; segment: string }> }
) {
  const { cameraId: camIdParam } = await ctx.params;
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const ticket = _request.nextUrl.searchParams.get("ticket");
  if (ticket) {
    const check = verifyStreamTicket(ticket, camIdParam);
    if (!check.valid || check.userId !== auth.user.id) {
      return NextResponse.json({ error: "invalid or expired stream ticket" }, { status: 403 });
    }
  }

  const { cameraId, segment } = await ctx.params;
  if (!ML_URL || !validSegment(segment)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: camera } = await supabase
    .from("cameras")
    .select("id")
    .eq("id", cameraId)
    .eq("enabled", true)
    .maybeSingle();

  if (!camera) {
    return NextResponse.json({ error: "camera not found" }, { status: 404 });
  }

  // Per-camera authorization (Phase 2 allow-list). user_can_see_camera runs as
  // the calling user (auth.uid()): admins always pass; a camera with no
  // permission rows is unrestricted; otherwise only listed users may stream.
  // This is the real gate — the optional ?ticket above is defence-in-depth and
  // hls.js segment requests can't carry it, so authorization must not depend
  // on the ticket. Enforced on BOTH playlist and segment requests.
  const { data: canSee, error: permErr } = await supabase.rpc("user_can_see_camera", {
    p_camera_id: cameraId,
  });
  if (permErr || canSee === false) {
    return NextResponse.json(
      { error: "forbidden: no access to this camera" },
      { status: 403 },
    );
  }

  const headers: Record<string, string> = {};
  if (ML_TOKEN) headers.Authorization = `Bearer ${ML_TOKEN}`;

  const upstream = await fetch(
    `${ML_URL}/stream/${encodeURIComponent(cameraId)}/${encodeURIComponent(segment)}`,
    { headers, cache: "no-store" }
  );

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "stream not active" }, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        segment === "index.m3u8" ? "application/vnd.apple.mpegurl" : "video/MP2T",
      "Cache-Control": "no-store",
    },
  });
}

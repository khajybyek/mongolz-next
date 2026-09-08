/**
 * Live HLS gateway (playlist + segments).
 *
 * The live path is the *fast* path: no masking is applied to it (the pipeline
 * writes raw frames to the HLS writer by design), so it is also the path that
 * needs the strictest authorization and a trace. Both were missing before the
 * 2026-09-08 audit — `camera_permissions` is empty in production and
 * `user_can_see_camera` treats "no rows" as unrestricted, so any authenticated
 * non-admin could watch any enabled camera un-masked, silently.
 *
 * Rules enforced here:
 *   • The camera must exist and be enabled — a disabled camera whose capture
 *     session is still running (auto-resume) must not be watchable.
 *   • Admins pass (they can grant themselves anything anyway; the ledger is
 *     the control for them).
 *   • A non-admin needs an explicit `camera_permissions` row for that camera.
 *     "No rows anywhere" is *not* consent to watch faces live. This is
 *     deliberately stricter than the RLS helper, which stays as it is because
 *     changing it would change row visibility across the whole database.
 *   • Watching is recorded (STREAM_VIEWED) and so is being turned away
 *     (STREAM_DENIED), throttled so a polling player cannot flood the ledger.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUserApi, isAuthErr, type AuthCtx } from "@/lib/supabase/auth";
import { verifyStreamTicket } from "@/lib/stream-ticket";
import { recordAccess, READ_ACTIONS, ACCESS_THROTTLE_MS } from "@/lib/audit";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL ?? "";
const ML_TOKEN = process.env.ML_SERVICE_TOKEN ?? "";

function validSegment(segment: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) return false;
  return segment === "index.m3u8" || segment.endsWith(".ts");
}

/** Refusal codes the player/tile can map to a reason instead of a black box. */
type DenyCode = "camera_disabled" | "camera_not_authorized" | "permission_check_failed";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ cameraId: string; segment: string }> }
) {
  const { cameraId: camIdParam } = await ctx.params;
  const auth = await requireUserApi();
  if (isAuthErr(auth)) return auth.error;

  const ticket = request.nextUrl.searchParams.get("ticket");
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
    .select("id, enabled")
    .eq("id", cameraId)
    .maybeSingle();

  if (!camera) {
    return NextResponse.json({ error: "camera not found" }, { status: 404 });
  }
  if (!camera.enabled) {
    // A disabled camera can still have a live capture session on the ML side
    // (supervisor auto-resume); the operator turned it off, so refuse.
    return deny(cameraId, "camera_disabled", auth, request);
  }

  // Per-camera authorization. user_can_see_camera runs as the calling user
  // (auth.uid()) and mirrors the RLS policies: admins always pass; a camera
  // with no permission rows is unrestricted; otherwise only listed users pass.
  // This is defence-in-depth for the RLS view of the world — the live rule
  // below is stricter. The optional ?ticket above is a third layer, and
  // authorization must never depend on it (hls.js can drop the query param).
  // Enforced on BOTH playlist and segment requests.
  const { data: canSee, error: permErr } = await supabase.rpc("user_can_see_camera", {
    p_camera_id: cameraId,
  });
  if (permErr) return deny(cameraId, "permission_check_failed", auth, request);
  if (canSee === false) return deny(cameraId, "camera_not_authorized", auth, request);

  // Live video is un-masked. An implicit "nobody restricted this camera yet"
  // is not a grant: a non-admin needs a row naming them on this camera.
  // (RLS on camera_permissions exposes only the caller's own rows, so this
  // read is safe on the user-scoped client.)
  if (auth.profile.role !== "admin") {
    const { data: grant, error: grantErr } = await supabase
      .from("camera_permissions")
      .select("id")
      .eq("camera_id", cameraId)
      .eq("user_id", auth.user.id)
      .limit(1)
      .maybeSingle();
    if (grantErr) return deny(cameraId, "permission_check_failed", auth, request);
    if (!grant) return deny(cameraId, "camera_not_authorized", auth, request);
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

  // Ledger: one row per operator per camera per window, for the playlist AND
  // the segments. Logging only the playlist left a trace-free path — segment
  // names are deterministic (index0.ts, index1.ts, … from ffmpeg's writer), so
  // anyone who knew them could watch the un-masked live feed without ever
  // requesting index.m3u8. Both request kinds share one detail string, so the
  // throttle collapses a whole viewing session into a single row and the
  // hash-chain lock is touched once per window rather than once per segment.
  await recordAccess({
    action: READ_ACTIONS.STREAM_VIEWED,
    detail: `camera=${cameraId} · live`,
    userId: auth.user.id,
    userEmail: auth.user.email,
    request,
    throttleMs: ACCESS_THROTTLE_MS,
    // Cross-instance guarantee: a viewer's poll loop can be spread over
    // several serverless instances, each with its own in-process map.
    probeDb: true,
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        segment === "index.m3u8" ? "application/vnd.apple.mpegurl" : "video/MP2T",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Refuse a live request and record the attempt under its own action, so the
 * ledger never shows a refusal as a viewing. Same throttle key shape as
 * STREAM_VIEWED: a retrying player writes one row, while a walk across many
 * cameras writes one row per camera — which is exactly the signal worth
 * seeing.
 */
async function deny(
  cameraId: string,
  code: DenyCode,
  auth: AuthCtx,
  request: NextRequest,
): Promise<NextResponse> {
  await recordAccess({
    action: READ_ACTIONS.STREAM_DENIED,
    detail: `camera=${cameraId} · reason=${code}`,
    userId: auth.user.id,
    userEmail: auth.user.email,
    request,
    throttleMs: ACCESS_THROTTLE_MS,
    probeDb: true,
  });
  return NextResponse.json(
    { error: "forbidden: no access to this camera", code },
    { status: 403 },
  );
}

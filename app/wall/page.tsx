import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { mlActiveCameras } from "@/lib/ml-client";
import type { CameraLivenessStatus } from "@/lib/database.types";
import { WallView } from "./wall-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * `status` is liveness — "is this camera sending frames" — derived by
 * camera_health() from camera_sessions.last_heartbeat_at, which the ML
 * capture loop stamps every 30 s. It used to be derived from the newest face
 * detection, so a camera watching an empty corridor went stale after five
 * minutes and offline after thirty while it was happily streaming.
 * `last_seen` / `faces_*` remain the detection side, shown on the same tile.
 */
type WallCamera = {
  camera_id: string;
  name: string;
  enabled: boolean;
  status: CameraLivenessStatus;
  last_seen: string | null;
  faces_24h: number;
  faces_1h: number;
  /** Last detected face id per camera. Client renders the crop via
   *  <FaceThumb faceId> through the unified endpoint (ADR 0009 / Tier 2).
   *  Null when no face has been detected on that camera yet. */
  latest_face_id: string | null;
};

export default async function WallPage() {
  const { profile } = await requireUser();
  const isAdmin = profile.role === "admin";
  // camera_health() is operator-aware: admins get every camera, viewers
  // only those user_can_see_camera() allows; auditors get 42501 (and the
  // middleware keeps them on /audit anyway — no page-level redirect here,
  // the kiosk host rewrites every path to /wall and would loop).
  const isOperator = isAdmin || profile.role === "viewer";
  const supabase = await createClient();

  const STATUSES: ReadonlySet<string> = new Set(["healthy", "stale", "offline", "unknown"]);
  let cameras: WallCamera[] = [];

  const health = isOperator ? await supabase.rpc("camera_health") : null;
  if (health && !health.error) {
    // Enabled cameras only — same set as the fallback branch below and as
    // /grid, so the wall does not change shape depending on whether the RPC
    // happened to succeed (camera_health returns disabled cameras too).
    cameras = (health.data ?? []).filter((r) => r.enabled).map((r) => ({
      camera_id: r.camera_id,
      name: r.name,
      enabled: r.enabled,
      status: (STATUSES.has(r.status) ? r.status : "unknown") as WallCamera["status"],
      last_seen: r.last_seen ?? null,
      faces_24h: Number(r.faces_24h),
      faces_1h: Number(r.faces_1h),
      latest_face_id: null,
    }));
  } else {
    // RPC unavailable (error or non-operator) → plain enabled-camera list
    // with status='unknown' so the wall still renders.
    const { data } = await supabase
      .from("cameras")
      .select("id, name, enabled")
      .eq("enabled", true)
      .order("name");
    cameras = (data ?? []).map((c) => ({
      camera_id: c.id,
      name: c.name,
      enabled: c.enabled,
      status: "unknown" as const,
      last_seen: null,
      faces_24h: 0,
      faces_1h: 0,
      latest_face_id: null,
    }));
  }

  // For each camera, pick the latest detected face id (admin only — face
  // metadata is RLS-protected). The wall renders a generic placeholder
  // for non-admin users so they get the camera-grid effect without
  // leaking face data. The actual crop is fetched client-side through
  // /api/faces/[id]/secure-crop, so this server query never touches the
  // storage layer (encrypt-only safe).
  if (isAdmin && cameras.length > 0) {
    // One newest-face query per camera. A single shared
    // `.in(cameras).limit(cameras * 3)` let one busy camera fill every slot,
    // so quieter cameras showed "no face yet" although they had detections.
    // The wall lists enabled cameras only, so N stays small; faces_camera_id_idx
    // narrows each query to one camera's rows.
    const latestFaces = await Promise.all(
      cameras.map((c) =>
        supabase
          .from("faces")
          .select("id")
          .eq("camera_id", c.camera_id)
          .order("detected_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    );
    const faceIdByCam = new Map<string, string>();
    latestFaces.forEach((res, i) => {
      if (res.data?.id) faceIdByCam.set(cameras[i].camera_id, res.data.id);
    });
    cameras = cameras.map((c) => ({
      ...c,
      latest_face_id: faceIdByCam.get(c.camera_id) ?? null,
    }));
  }

  // Which cameras the ML service is streaming right now (HLS). The wall
  // attaches to those in "live video" mode; null = ML unreachable.
  const active = await mlActiveCameras();
  const enabledIds = new Set(cameras.map((c) => c.camera_id));
  const activeIds = (active ?? []).map((a) => a.camera_id).filter((id) => enabledIds.has(id));

  return (
    <WallView cameras={cameras} isAdmin={isAdmin} activeIds={activeIds} mlReachable={active !== null} />
  );
}

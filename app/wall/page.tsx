import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { mlActiveCameras } from "@/lib/ml-client";
import { WallView } from "./wall-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WallCamera = {
  camera_id: string;
  name: string;
  enabled: boolean;
  status: "healthy" | "stale" | "offline" | "unknown";
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
  const supabase = await createClient();

  // Health rows are admin-only via the RPC's is_admin() gate; for
  // non-admin viewers we fall back to a plain enabled-camera list with
  // status='unknown'.
  const STATUSES: ReadonlySet<string> = new Set(["healthy", "stale", "offline", "unknown"]);
  let cameras: WallCamera[] = [];

  if (isAdmin) {
    const { data } = await supabase.rpc("camera_health");
    cameras = (data ?? []).map((r) => ({
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
    const cameraIds = cameras.map((c) => c.camera_id);
    const { data: latestFaces } = await supabase
      .from("faces")
      .select("id, camera_id, detected_at")
      .in("camera_id", cameraIds)
      .order("detected_at", { ascending: false })
      .limit(cameraIds.length * 3);
    const seenCam = new Set<string>();
    const faceIdByCam = new Map<string, string>();
    for (const f of (latestFaces ?? []) as Array<{
      id: string;
      camera_id: string;
      detected_at: string;
    }>) {
      if (seenCam.has(f.camera_id)) continue;
      seenCam.add(f.camera_id);
      faceIdByCam.set(f.camera_id, f.id);
    }
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

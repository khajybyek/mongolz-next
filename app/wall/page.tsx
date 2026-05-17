import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
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
  latest_face_url: string | null;
};

export default async function WallPage() {
  const { profile } = await requireUser();
  const isAdmin = profile.role === "admin";
  const supabase = await createClient();

  // Health rows are admin-only via the RPC's is_admin() gate; for
  // non-admin viewers we fall back to a plain enabled-camera list with
  // status='unknown'.
  type HealthRow = WallCamera;
  let cameras: WallCamera[] = [];

  if (isAdmin) {
    const { data } = await supabase.rpc("camera_health");
    cameras = ((data ?? []) as HealthRow[]).map((r) => ({
      ...r,
      faces_24h: Number(r.faces_24h),
      faces_1h: Number(r.faces_1h),
      latest_face_url: null,
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
      latest_face_url: null,
    }));
  }

  // For each camera, fetch the latest face thumbnail (admin only — face
  // images are RLS-protected). The wall renders a generic placeholder
  // for non-admin users so they get the camera-grid effect without
  // leaking face data.
  if (isAdmin && cameras.length > 0) {
    const cameraIds = cameras.map((c) => c.camera_id);
    const { data: latestFaces } = await supabase
      .from("faces")
      .select("id, image_path, camera_id, detected_at")
      .in("camera_id", cameraIds)
      .order("detected_at", { ascending: false })
      .limit(cameraIds.length * 3);
    const seenCam = new Set<string>();
    const pathByCam = new Map<string, string>();
    for (const f of (latestFaces ?? []) as Array<{
      id: string;
      image_path: string;
      camera_id: string;
      detected_at: string;
    }>) {
      if (seenCam.has(f.camera_id)) continue;
      seenCam.add(f.camera_id);
      pathByCam.set(f.camera_id, f.image_path);
    }
    const paths = Array.from(pathByCam.values());
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("faces")
        .createSignedUrls(paths, 60 * 10);
      const urlByPath = new Map<string, string>();
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
      cameras = cameras.map((c) => {
        const p = pathByCam.get(c.camera_id);
        return p ? { ...c, latest_face_url: urlByPath.get(p) ?? null } : c;
      });
    }
  }

  return <WallView cameras={cameras} isAdmin={isAdmin} />;
}

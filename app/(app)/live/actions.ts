"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin, requireUser } from "@/lib/supabase/auth";
import { mlActiveCameras, mlStartCamera, mlStopCamera } from "@/lib/ml-client";
import { unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";
import { issueStreamTicket } from "@/lib/stream-ticket";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  try {
    await createServiceClient().from("audit_log").insert({ action, detail, user_id: userId, user_email: userEmail });
  } catch {}
}

export async function startCameraAction(cameraId: string) {
  const { user } = await requireAdmin();
  if (!UUID_RE.test(cameraId)) throw new Error("invalid camera id");
  const supabase = await createClient();
  const { data: cam } = await supabase
    .from("cameras")
    .select("id, url, name")
    .eq("id", cameraId)
    .single();

  if (!cam) throw new Error("Камер олдсонгүй");
  const plainUrl = unwrapCameraUrlForRuntime(cam.url);
  await mlStartCamera(cam.id, plainUrl, cam.name);
  await audit("CAMERA_START", `camera ${cam.id}`, user.id, user.email);
}

export async function stopCameraAction(cameraId: string) {
  const { user } = await requireAdmin();
  if (!UUID_RE.test(cameraId)) throw new Error("invalid camera id");
  await mlStopCamera(cameraId);
  await audit("CAMERA_STOP", `camera ${cameraId}`, user.id, user.email);
}

export async function getStreamTicketAction(cameraId: string): Promise<string> {
  const { user } = await requireUser();
  return issueStreamTicket(user.id, cameraId);
}

export interface ActiveCamerasResult {
  /** false when the ML service could not be reached (streams unavailable). */
  reachable: boolean;
  /** Ids of cameras currently streaming that the caller may see (RLS). */
  ids: string[];
}

/**
 * Which cameras the ML service is capturing right now. Used by the grid and
 * the live wall to attach to streams started elsewhere and to keep their
 * LIVE badges honest. Filtered through the cameras table so viewers only
 * learn about cameras they can already list.
 */
export async function getActiveCamerasAction(): Promise<ActiveCamerasResult> {
  await requireUser();
  const active = await mlActiveCameras();
  if (active === null) return { reachable: false, ids: [] };
  const ids = active.map((c) => c.camera_id).filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return { reachable: true, ids: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("cameras").select("id").in("id", ids).eq("enabled", true);
  return { reachable: true, ids: (data ?? []).map((c) => c.id) };
}

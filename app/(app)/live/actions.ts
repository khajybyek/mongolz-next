"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin, requireUser } from "@/lib/supabase/auth";
import { mlStartCamera, mlStopCamera } from "@/lib/ml-client";
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
    .select("id, url")
    .eq("id", cameraId)
    .single();

  if (!cam) throw new Error("Камер олдсонгүй");
  const plainUrl = unwrapCameraUrlForRuntime(cam.url);
  await mlStartCamera(cam.id, plainUrl);
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

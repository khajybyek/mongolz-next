"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireUser } from "@/lib/supabase/auth";
import { mlStartCamera, mlStopCamera } from "@/lib/ml-client";
import { decryptCameraUrl } from "@/lib/camera-crypto";
import { issueStreamTicket } from "@/lib/stream-ticket";

export async function startCameraAction(cameraId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: cam } = await supabase
    .from("cameras")
    .select("id, url")
    .eq("id", cameraId)
    .single();

  if (!cam) throw new Error("Камер олдсонгүй");
  const plainUrl = process.env.CAMERA_URL_KEY ? decryptCameraUrl(cam.url) : cam.url;
  await mlStartCamera(cam.id, plainUrl);
}

export async function stopCameraAction(cameraId: string) {
  await requireAdmin();
  await mlStopCamera(cameraId);
}

export async function getStreamTicketAction(cameraId: string): Promise<string> {
  const { user } = await requireUser();
  return issueStreamTicket(user.id, cameraId);
}

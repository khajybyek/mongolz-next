"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { protectCameraUrlForStorage } from "@/lib/camera-crypto";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { mlTestCamera, type CameraTestResult } from "@/lib/ml-client";

const ALLOWED_CAM_TYPES = ["rtsp", "http", "usb", "webcam"] as const;
type CamType = (typeof ALLOWED_CAM_TYPES)[number];

function isCamType(value: string): value is CamType {
  return (ALLOWED_CAM_TYPES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Network cameras must be rtsp(s)/http(s) URLs; usb/webcam are a device
 * index ("0", "1", …) or a local device path. Anything else (file://,
 * concat:, a bare filesystem path) would make the ML side open arbitrary
 * paths with cv2.VideoCapture.
 */
function validCameraUrl(url: string, camType: CamType): boolean {
  if (camType === "usb" || camType === "webcam") {
    return /^\d{1,2}$/.test(url) || /^\/dev\/video\d+$/.test(url);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const ok = camType === "rtsp" ? ["rtsp:", "rtsps:"] : ["http:", "https:"];
  return ok.includes(u.protocol) && Boolean(u.hostname);
}

export async function addCameraAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const camType = String(formData.get("cam_type") ?? "rtsp").trim();

  if (!name || !url) return { error: "Нэр болон URL заавал" };
  if (!isCamType(camType)) return { error: "Төрөл буруу" };
  if (!validCameraUrl(url, camType)) return { error: "URL төрөлдөө тохирохгүй (rtsp:// / http(s):// эсвэл төхөөрөмжийн дугаар)" };

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: "CAMERA_URL_KEY env тохируулагдаагүй" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cameras")
    .insert({ name, url: encryptedUrl, cam_type: camType, created_by: user.id });

  if (error) return { error: error.message };

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_ADD",
      detail: `Name: ${name} type: ${camType}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
  return { ok: true };
}

export async function deleteCameraAction(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;
  if (!UUID_RE.test(id)) return { error: "missing id" };

  const supabase = await createClient();
  const { error } = await supabase.from("cameras").delete().eq("id", id);
  if (error) return { error: error.message };

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_DELETE",
      detail: `id: ${id}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
  return { ok: true };
}

export async function toggleCameraAction(formData: FormData) {
  const { user } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "false") === "true";

  if (!UUID_RE.test(id)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("cameras").update({ enabled }).eq("id", id);
  if (error) return;

  try {
    await createServiceClient().from("audit_log").insert({
      action: "CAMERA_TOGGLE",
      detail: `camera ${id} → enabled=${enabled}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
}

export async function updateCameraAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const camType = String(formData.get("cam_type") ?? "").trim();

  if (!UUID_RE.test(id)) return { error: "missing id" };
  if (!name || !url) return { error: "missing fields" };
  if (!isCamType(camType)) return { error: "invalid cam_type" };
  if (!validCameraUrl(url, camType)) return { error: "URL төрөлдөө тохирохгүй (rtsp:// / http(s):// эсвэл төхөөрөмжийн дугаар)" };

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: "CAMERA_URL_KEY required" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cameras")
    .update({ name, url: encryptedUrl, cam_type: camType })
    .eq("id", id);
  if (error) return { error: error.message };

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_UPDATE",
      detail: `id: ${id} name: ${name} type: ${camType}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
  return { ok: true };
}

/**
 * Test reachability of a camera URL before it gets persisted. Admin-only,
 * NO reauth required — read-only probe with no DB write. The ML service
 * handles the actual cv2.VideoCapture call with its own 8s timeout.
 */
export async function testCameraAction(
  url: string,
  camType: string,
): Promise<CameraTestResult> {
  await requireAdmin();
  const u = (url ?? "").trim();
  if (!u) return { ok: false, error: "URL хоосон" };
  if (!isCamType(camType)) return { ok: false, error: "invalid cam_type" };
  if (!validCameraUrl(u, camType)) return { ok: false, error: "URL төрөлдөө тохирохгүй" };
  return mlTestCamera(u, camType);
}

export async function toggleConsentAction(formData: FormData) {
  const { user } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const required = String(formData.get("required") ?? "false") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("cameras").update({ consent_required: required }).eq("id", id);

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_CONSENT_TOGGLE",
      detail: `camera ${id} → consent_required=${required}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { protectCameraUrlForStorage } from "@/lib/camera-crypto";

export async function addCameraAction(formData: FormData) {
  const { user } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const cam_type = String(formData.get("cam_type") ?? "rtsp");

  if (!name || !url) return redirect("/cameras?error=missing-fields");

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return redirect("/cameras?error=CAMERA_URL_KEY-required");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cameras")
    .insert({ name, url: encryptedUrl, cam_type, created_by: user.id });

  if (error) return redirect(`/cameras?error=${encodeURIComponent(error.message)}`);

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_ADD",
      detail: `Name: ${name}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
}

export async function deleteCameraAction(formData: FormData) {
  const { user } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("cameras").delete().eq("id", id);

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
}

export async function toggleCameraAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "false") === "true";

  if (!id) return;

  const supabase = await createClient();
  await supabase.from("cameras").update({ enabled }).eq("id", id);

  revalidatePath("/cameras");
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

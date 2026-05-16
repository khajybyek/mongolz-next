"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

const addSchema = z.object({
  camera_id: z.string().uuid(),
  user_id: z.string().uuid(),
  permission: z.enum(["view", "operate"]).default("view"),
});

async function audit(action: string, detail: string, userId: string, userEmail: string) {
  const svc = createServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await svc.from("audit_log").insert({
    action,
    detail,
    user_id: userId,
    user_email: userEmail,
    ip,
  });
}

export async function grantCameraPermissionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = addSchema.safeParse({
    camera_id: formData.get("camera_id"),
    user_id: formData.get("user_id"),
    permission: formData.get("permission") || "view",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const svc = createServiceClient();
  const { error } = await svc
    .from("camera_permissions")
    .upsert(
      { ...parsed.data, created_by: ctx.user.id },
      { onConflict: "camera_id,user_id,permission" },
    );
  if (error) throw new Error(error.message);

  await audit(
    "CAM_PERM_GRANT",
    `camera=${parsed.data.camera_id} user=${parsed.data.user_id} perm=${parsed.data.permission}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath(`/cameras/${parsed.data.camera_id}/permissions`);
}

export async function revokeCameraPermissionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const cameraId = z.string().uuid().safeParse(formData.get("camera_id"));
  if (!id.success || !cameraId.success) throw new Error("Invalid id");

  const svc = createServiceClient();
  const { error } = await svc.from("camera_permissions").delete().eq("id", id.data);
  if (error) throw new Error(error.message);

  await audit("CAM_PERM_REVOKE", `perm row ${id.data}`, ctx.user.id, ctx.user.email);
  revalidatePath(`/cameras/${cameraId.data}/permissions`);
}

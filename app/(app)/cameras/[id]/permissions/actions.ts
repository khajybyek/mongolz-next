"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";

type ActionResult = { error: string } | { ok: true };

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

/**
 * A camera_permissions row is what lets a non-admin stream the UNMASKED live
 * feed (since 2026-09-08), so granting one is a disclosure decision: it needs
 * the second factor, not just a (possibly stolen) session. Revoking only ever
 * narrows access and stays one click, so a defender is never slowed down.
 */
export async function grantCameraPermissionAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;
  const parsed = addSchema.safeParse({
    camera_id: formData.get("camera_id"),
    user_id: formData.get("user_id"),
    permission: formData.get("permission") || "view",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const svc = createServiceClient();
  const { error } = await svc
    .from("camera_permissions")
    .upsert(
      { ...parsed.data, created_by: ctx.user.id },
      { onConflict: "camera_id,user_id,permission" },
    );
  if (error) return { error: "grant failed" };

  const detail = `camera=${parsed.data.camera_id} user=${parsed.data.user_id} perm=${parsed.data.permission}`;
  await audit("CAM_PERM_GRANT", detail, ctx.user.id, ctx.user.email);
  scheduleSecurityEvent({ action: "CAM_PERM_GRANT", actorId: ctx.user.id, actorEmail: ctx.user.email, detail });
  revalidatePath(`/cameras/${parsed.data.camera_id}/permissions`);
  return { ok: true };
}

export async function revokeCameraPermissionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const cameraId = z.string().uuid().safeParse(formData.get("camera_id"));
  if (!id.success || !cameraId.success) throw new Error("Invalid id");

  const svc = createServiceClient();
  // Delete and read back in one statement: once the row is gone nothing else
  // can say WHO lost access to WHICH camera, and the ledger has to.
  const { data: removed, error } = await svc
    .from("camera_permissions")
    .delete()
    .eq("id", id.data)
    .select("camera_id, user_id, permission");
  if (error) throw new Error(error.message);

  const row = removed?.[0];
  const detail = row
    ? `camera=${row.camera_id} user=${row.user_id} perm=${row.permission} (row ${id.data})`
    : `perm row ${id.data} (already gone)`;
  await audit("CAM_PERM_REVOKE", detail, ctx.user.id, ctx.user.email);
  if (row) {
    scheduleSecurityEvent({ action: "CAM_PERM_REVOKE", actorId: ctx.user.id, actorEmail: ctx.user.email, detail });
  }
  revalidatePath(`/cameras/${cameraId.data}/permissions`);
}

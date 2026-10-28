"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";
import { getT } from "@/lib/i18n/server";

type ActionResult = { error: string } | { ok: true };

const addSchema = z.object({
  camera_id: z.guid(),
  user_id: z.guid(),
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
 * A camera_permissions row is what lets a non-admin stream the live feed
 * (since 2026-09-08). Live frames are masked since 2026-09-20, but only as
 * well as the detector finds faces, so granting one is still a disclosure
 * decision: it needs
 * the second factor, not just a (possibly stolen) session. Revoking only ever
 * narrows live access and needs no step-up, so a defender is never slowed
 * down by a second factor (the page asks one plain confirmation).
 *
 * One person holds at most one row per camera. Both kinds grant the same
 * access today, so a second row only made the list show the user twice and
 * let a revoke of one row leave the other one granting live video. A grant
 * therefore REPLACES whatever kind the user held: the new row is written
 * first (access is never interrupted) and the user's other rows go after.
 */
export async function grantCameraPermissionAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (reauth) return reauth;
  const { t } = await getT();
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
  if (error) return { error: t("perm_err_grant") };

  // Replace, don't add: drop the user's rows of the other kind. A failure
  // here leaves a duplicate that grants nothing extra (both kinds are the
  // same access), so the grant itself still stands.
  const { data: replaced } = await svc
    .from("camera_permissions")
    .delete()
    .eq("camera_id", parsed.data.camera_id)
    .eq("user_id", parsed.data.user_id)
    .neq("permission", parsed.data.permission)
    .select("permission");
  const replacedKinds = [...new Set((replaced ?? []).map((r) => r.permission))];

  const detail =
    `camera=${parsed.data.camera_id} user=${parsed.data.user_id} perm=${parsed.data.permission}` +
    (replacedKinds.length ? ` (replaced ${replacedKinds.join(",")})` : "");
  await audit("CAM_PERM_GRANT", detail, ctx.user.id, ctx.user.email);
  scheduleSecurityEvent({ action: "CAM_PERM_GRANT", actorId: ctx.user.id, actorEmail: ctx.user.email, detail });
  revalidatePath(`/cameras/${parsed.data.camera_id}/permissions`);
  return { ok: true };
}

/**
 * Removes EVERY row the user holds for the camera — the page lists people,
 * not rows, and a leftover row of the other kind would keep live access.
 * The page binds the camera: `revokeCameraPermissionAction.bind(null, id)`.
 */
export async function revokeCameraPermissionAction(cameraId: string, userId: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const camera = z.guid().safeParse(cameraId);
  const user = z.guid().safeParse(userId);
  if (!camera.success || !user.success) return { error: t("perm_err_revoke") };

  const svc = createServiceClient();
  // Delete and read back in one statement: once the rows are gone nothing
  // else can say WHO lost access to WHICH camera, and the ledger has to.
  const { data: removed, error } = await svc
    .from("camera_permissions")
    .delete()
    .eq("camera_id", camera.data)
    .eq("user_id", user.data)
    .select("id, camera_id, user_id, permission");
  if (error) return { error: t("perm_err_revoke") };

  const rows = removed ?? [];
  const kinds = [...new Set(rows.map((r) => r.permission))].join(",");
  const detail = rows.length
    ? `camera=${camera.data} user=${user.data} perm=${kinds} (rows ${rows.map((r) => r.id).join(",")})`
    : `camera=${camera.data} user=${user.data} (already gone)`;
  await audit("CAM_PERM_REVOKE", detail, ctx.user.id, ctx.user.email);
  if (rows.length) {
    scheduleSecurityEvent({ action: "CAM_PERM_REVOKE", actorId: ctx.user.id, actorEmail: ctx.user.email, detail });
  }
  revalidatePath(`/cameras/${camera.data}/permissions`);
  revalidatePath("/cameras");
  return { ok: true };
}

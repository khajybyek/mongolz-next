"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

// 00:00-23:59, plus 24:00 (valid end-of-day for Postgres `time`). The old
// /^[0-2][0-9]:[0-5][0-9]$/ accepted "29:00", which made effective_mask_mode()
// raise 22008 for the camera (migration 20260923180000 tightens the CHECK).
const TIME_RE = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

const scheduleSchema = z.object({
  camera_id: z.string().uuid(),
  window_mode: z.enum(["masked", "revealed"]),
  starts_at: z.string().regex(TIME_RE, "HH:MM"),
  ends_at: z.string().regex(TIME_RE, "HH:MM"),
  weekdays: z.coerce.number().int().min(1).max(127),
  note: z.string().max(200).optional(),
});

const defaultSchema = z.object({
  camera_id: z.string().uuid(),
  mask_default: z.enum(["masked", "revealed"]),
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

export async function addScheduleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = scheduleSchema.safeParse({
    camera_id: formData.get("camera_id"),
    window_mode: formData.get("window_mode"),
    starts_at: formData.get("starts_at"),
    ends_at: formData.get("ends_at"),
    weekdays: formData.get("weekdays"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Validation failed");
  }
  const svc = createServiceClient();
  const { error } = await svc
    .from("masking_schedules")
    .insert({ ...parsed.data, created_by: ctx.user.id });
  if (error) throw new Error(error.message);

  await audit(
    "MASK_SCHEDULE_ADD",
    `camera ${parsed.data.camera_id}: ${parsed.data.window_mode} ${parsed.data.starts_at}-${parsed.data.ends_at} weekdays=${parsed.data.weekdays}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath(`/cameras/${parsed.data.camera_id}/schedule`);
}

export async function deleteScheduleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const cameraId = z.string().uuid().safeParse(formData.get("camera_id"));
  if (!id.success || !cameraId.success) throw new Error("Invalid id");

  const svc = createServiceClient();
  const { error } = await svc.from("masking_schedules").delete().eq("id", id.data);
  if (error) throw new Error(error.message);

  await audit("MASK_SCHEDULE_DELETE", `schedule ${id.data}`, ctx.user.id, ctx.user.email);
  revalidatePath(`/cameras/${cameraId.data}/schedule`);
}

export async function setMaskDefaultAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = defaultSchema.safeParse({
    camera_id: formData.get("camera_id"),
    mask_default: formData.get("mask_default"),
  });
  if (!parsed.success) throw new Error("Validation failed");

  const svc = createServiceClient();
  const { error } = await svc
    .from("cameras")
    .update({ mask_default: parsed.data.mask_default })
    .eq("id", parsed.data.camera_id);
  if (error) throw new Error(error.message);

  await audit(
    "MASK_DEFAULT_CHANGE",
    `camera ${parsed.data.camera_id} default = ${parsed.data.mask_default}`,
    ctx.user.id,
    ctx.user.email,
  );
  revalidatePath(`/cameras/${parsed.data.camera_id}/schedule`);
}

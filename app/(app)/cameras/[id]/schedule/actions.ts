"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";
import { getT } from "@/lib/i18n/server";
import {
  buildPrivacySchedule,
  classifyScheduleChange,
  isPrivacyMode,
  removesPrivateTime,
  type PrivacyMode,
  type ScheduleChange,
  type ScheduleWindowRow,
} from "@/lib/privacy-schedule";
import { weekdaysFromForm } from "./weekdays";

/**
 * Privacy schedules are ENFORCED by the ML service (ADR 0012): a "private"
 * window switches off face recognition, face rows, alerts and edge inference,
 * and blocks reveal of the footage captured then. Video stays masked in both
 * modes; un-masking is only ever the 4-eyes reveal.
 *
 * So the direction of a change matters. LOOSENING (adding a standard window,
 * deleting a private one, default private → standard) can turn recognition
 * back on and needs a fresh TOTP step-up — a stolen session alone must not be
 * able to switch identification on for a camera — plus a real-time notice to
 * the other admins. TIGHTENING stays one click. The direction is always
 * decided from the database, never from what the form claims.
 *
 * masking_schedules and cameras are service-role-write only, so every write
 * goes through createServiceClient().
 */

type ActionResult = { error: string } | { ok: true };

// 00:00-23:59, plus 24:00 (valid end-of-day for Postgres `time`). The old
// /^[0-2][0-9]:[0-5][0-9]$/ accepted "29:00", which made the schedule
// evaluator raise 22008 for the camera (migration 20260923180000 tightens the
// CHECK). 24:00 is an END only: a window cannot start at the end of the day.
const TIME_RE = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

const modeSchema = z.enum(["standard", "private"]);

type Messages = {
  timeFormat: string;
  sameTime: string;
  start24: string;
  weekdays: string;
};

function scheduleSchema(msg: Messages) {
  return z
    .object({
      camera_id: z.guid(),
      window_mode: modeSchema,
      starts_at: z.string().regex(TIME_RE, msg.timeFormat),
      ends_at: z.string().regex(TIME_RE, msg.timeFormat),
      weekdays: z.coerce
        .number({ error: msg.weekdays })
        .int(msg.weekdays)
        .min(1, msg.weekdays)
        .max(127, msg.weekdays),
      note: z.string().max(200).optional(),
    })
    .refine((v) => v.starts_at !== "24:00", { message: msg.start24, path: ["starts_at"] })
    .refine((v) => v.starts_at !== v.ends_at, { message: msg.sameTime, path: ["ends_at"] });
}

const defaultSchema = z.object({
  camera_id: z.guid(),
  privacy_default: modeSchema,
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

type Ctx = { user: { id: string; email: string } };

/**
 * Loosening needs the second factor itself (not a password step-up). The
 * refusal is audited like the retention gate; the StepUpForm on the page
 * opens the TOTP prompt and resubmits the same form.
 */
async function stepUpForLoosening(ctx: Ctx, what: string): Promise<{ error: "REAUTH_REQUIRED" } | null> {
  const reauth = await ensureFreshReauth(ctx.user.id);
  if (!reauth) return null;
  try {
    await audit("PRIVACY_SCHEDULE_STEP_UP_REQUIRED", what, ctx.user.id, ctx.user.email);
  } catch {
    /* the refusal stands either way */
  }
  return reauth;
}

type Svc = ReturnType<typeof createServiceClient>;

/**
 * Record WHEN the schedule was loosened (cameras.privacy_loosened_at): an edge
 * frame captured before this instant but delivered after it may have been
 * covered by the private time being removed, and the ML service keeps such
 * frames private (the current schedule no longer shows it). Stamped BEFORE the
 * loosening write — refused when it cannot be recorded — and again AFTER it
 * (restampLoosened), so the stamp is never earlier than the change itself.
 */
async function markLoosened(svc: Svc, cameraId: string): Promise<boolean> {
  const { error } = await svc
    .from("cameras")
    .update({ privacy_loosened_at: new Date().toISOString() })
    .eq("id", cameraId);
  return !error;
}

/**
 * The second stamp, after the loosening write succeeded: a frame captured
 * between the first stamp and the write was still covered by the old
 * schedule. Best effort — the change is already made; a failure is noted in
 * the audit line (the first stamp stands).
 */
async function restampLoosened(svc: Svc, cameraId: string): Promise<string> {
  return (await markLoosened(svc, cameraId)) ? "" : " (privacy_loosened_at re-stamp after the write failed)";
}

type ScheduleState = { privacyDefault: unknown; rows: ScheduleWindowRow[] };
type StoredScheduleState = { privacyDefault: unknown; rows: Array<ScheduleWindowRow & { id: string }> };

/**
 * Whether a change classified as loosening (by kind — that decides the step-up)
 * actually takes private time away from the camera, comparing its schedule
 * before and after over a week. Only then is privacy_loosened_at stamped: a
 * standard window on a camera whose default is standard, for example, removes
 * nothing, and a needless stamp keeps every frame of an edge agent whose clock
 * is far behind private for good. Unreadable → true (stamp).
 */
async function takesPrivateTime(
  svc: Svc,
  cameraId: string,
  edit: (current: StoredScheduleState) => ScheduleState,
): Promise<boolean> {
  const [camera, windows] = await Promise.all([
    svc.from("cameras").select("privacy_default").eq("id", cameraId).maybeSingle(),
    svc.from("masking_schedules").select("id, window_mode, starts_at, ends_at, weekdays").eq("camera_id", cameraId),
  ]);
  if (camera.error || windows.error || !camera.data) return true;
  const current: StoredScheduleState = { privacyDefault: camera.data.privacy_default, rows: windows.data ?? [] };
  const next = edit(current);
  return removesPrivateTime(
    buildPrivacySchedule(current.privacyDefault, current.rows),
    buildPrivacySchedule(next.privacyDefault, next.rows),
  );
}

/** Postgres `time` comes back as "HH:MM:SS"; the UI and the ledger use HH:MM. */
function hhmm(value: string): string {
  return value.slice(0, 5);
}

async function afterChange(
  ctx: Ctx,
  action: "PRIVACY_SCHEDULE_ADD" | "PRIVACY_SCHEDULE_DELETE" | "PRIVACY_DEFAULT_CHANGE",
  change: ScheduleChange,
  detail: string,
  cameraId: string,
) {
  const direction = classifyScheduleChange(change);
  const line = `${detail} [${direction}]`;
  await audit(action, line, ctx.user.id, ctx.user.email);
  if (direction === "loosen") {
    scheduleSecurityEvent({ action, actorId: ctx.user.id, actorEmail: ctx.user.email, detail: line });
  }
  revalidatePath(`/cameras/${cameraId}/schedule`);
}

export async function addScheduleAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const parsed = scheduleSchema({
    timeFormat: t("schedule_err_time_format"),
    sameTime: t("schedule_err_same_time"),
    start24: t("schedule_err_start_24"),
    weekdays: t("schedule_err_weekdays"),
  }).safeParse({
    camera_id: formData.get("camera_id"),
    window_mode: formData.get("window_mode"),
    starts_at: formData.get("starts_at"),
    ends_at: formData.get("ends_at"),
    weekdays: weekdaysFromForm(formData),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("schedule_err_invalid") };
  }
  const row = parsed.data;
  const change: ScheduleChange = { kind: "add", mode: row.window_mode };
  const detail = `camera ${row.camera_id}: ${row.window_mode} ${row.starts_at}-${row.ends_at} weekdays=${row.weekdays}`;

  const svc = createServiceClient();
  let stamp = false;
  if (classifyScheduleChange(change) === "loosen") {
    const reauth = await stepUpForLoosening(ctx, `add ${detail}`);
    if (reauth) return reauth;
    stamp = await takesPrivateTime(svc, row.camera_id, (cur) => ({ ...cur, rows: [...cur.rows, row] }));
    if (stamp && !(await markLoosened(svc, row.camera_id))) return { error: t("schedule_err_save_failed") };
  }

  const { error } = await svc
    .from("masking_schedules")
    .insert({ ...row, created_by: ctx.user.id });
  if (error) return { error: t("schedule_err_save_failed") };

  const note = stamp ? await restampLoosened(svc, row.camera_id) : "";
  await afterChange(ctx, "PRIVACY_SCHEDULE_ADD", change, detail + note, row.camera_id);
  return { ok: true };
}

export async function deleteScheduleAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const id = z.guid().safeParse(formData.get("id"));
  if (!id.success) return { error: t("schedule_err_invalid") };

  // The window's mode comes from the database, never from the form: a
  // tampered "window_mode=standard" field must not turn the deletion of a
  // private window (loosening) into a one-click action.
  const svc = createServiceClient();
  const { data: existing, error: readError } = await svc
    .from("masking_schedules")
    .select("id, camera_id, window_mode, starts_at, ends_at, weekdays")
    .eq("id", id.data)
    .maybeSingle();
  if (readError) return { error: t("schedule_err_save_failed") };
  if (!existing) return { error: t("schedule_err_not_found") };

  // An unrecognised stored mode is treated as private, so deleting it is
  // loosening and needs the step-up (fail towards more protection).
  const mode: PrivacyMode = isPrivacyMode(existing.window_mode) ? existing.window_mode : "private";
  const change: ScheduleChange = { kind: "delete", mode };
  const detail = `camera ${existing.camera_id}: ${existing.window_mode} ${hhmm(existing.starts_at)}-${hhmm(existing.ends_at)} weekdays=${existing.weekdays} (schedule ${existing.id})`;

  let stamp = false;
  if (classifyScheduleChange(change) === "loosen") {
    const reauth = await stepUpForLoosening(ctx, `delete ${detail}`);
    if (reauth) return reauth;
    stamp = await takesPrivateTime(svc, existing.camera_id, (cur) => ({
      ...cur,
      rows: cur.rows.filter((r) => r.id !== existing.id),
    }));
    if (stamp && !(await markLoosened(svc, existing.camera_id))) return { error: t("schedule_err_save_failed") };
  }

  // Conditional on the mode that was classified; rows are never updated in
  // place, so this only guards against the row being replaced meanwhile.
  const { data: removed, error } = await svc
    .from("masking_schedules")
    .delete()
    .eq("id", existing.id)
    .eq("window_mode", existing.window_mode)
    .select("id");
  if (error) return { error: t("schedule_err_save_failed") };
  if (!removed || removed.length === 0) return { error: t("schedule_err_not_found") };

  const note = stamp ? await restampLoosened(svc, existing.camera_id) : "";
  await afterChange(ctx, "PRIVACY_SCHEDULE_DELETE", change, detail + note, existing.camera_id);
  return { ok: true };
}

export async function setPrivacyDefaultAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const parsed = defaultSchema.safeParse({
    camera_id: formData.get("camera_id"),
    privacy_default: formData.get("privacy_default"),
  });
  if (!parsed.success) return { error: t("schedule_err_invalid") };
  const { camera_id: cameraId, privacy_default: to } = parsed.data;

  const svc = createServiceClient();
  const { data: camera, error: readError } = await svc
    .from("cameras")
    .select("id, privacy_default")
    .eq("id", cameraId)
    .maybeSingle();
  if (readError) return { error: t("schedule_err_save_failed") };
  if (!camera) return { error: t("schedule_err_camera_not_found") };

  // Unknown stored value → assume the opposite of the target, so a switch to
  // standard is still treated as loosening and a switch to private is written.
  const known = isPrivacyMode(camera.privacy_default);
  const from: PrivacyMode = known ? (camera.privacy_default as PrivacyMode) : to === "standard" ? "private" : "standard";
  const change: ScheduleChange = { kind: "default", from, to };
  const direction = classifyScheduleChange(change);
  if (direction === "noop") return { ok: true };

  const detail = `camera ${cameraId} default: ${known ? from : String(camera.privacy_default)} → ${to}`;
  let stamp = false;
  if (direction === "loosen") {
    const reauth = await stepUpForLoosening(ctx, detail);
    if (reauth) return reauth;
    stamp = await takesPrivateTime(svc, cameraId, (cur) => ({ ...cur, privacyDefault: to }));
  }

  // A loosening that takes private time away records WHEN in the same write
  // (see markLoosened), and again after it.
  const fields = stamp
    ? { privacy_default: to, privacy_loosened_at: new Date().toISOString() }
    : { privacy_default: to };
  let update = svc.from("cameras").update(fields).eq("id", cameraId);
  // Compare-and-set on the value the direction was decided from.
  if (known) update = update.eq("privacy_default", from);
  const { data: updated, error } = await update.select("id");
  if (error) return { error: t("schedule_err_save_failed") };
  if (!updated || updated.length === 0) return { error: t("schedule_err_conflict") };

  const note = stamp ? await restampLoosened(svc, cameraId) : "";
  await afterChange(ctx, "PRIVACY_DEFAULT_CHANGE", change, detail + note, cameraId);
  return { ok: true };
}

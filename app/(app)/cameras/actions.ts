"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { protectCameraUrlForStorage , unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";
import { mlTestCamera, type CameraTestResult, mlStopCamera } from "@/lib/ml-client";
import type { CameraType } from "@/lib/database.types";
import {
  classifyRecordingModeChange,
  isRecordingMode,
  storedRecordingMode,
  type RecordingMode,
  type RecordingModeDirection,
} from "@/lib/recording-mode";

/**
 * Every write to public.cameras goes through the service role, AFTER
 * requireAdmin() and (where the change widens capture or drops a privacy
 * control) the TOTP step-up above it. Migration 20260917150000 revokes
 * INSERT/UPDATE/DELETE on the table from `authenticated`: otherwise a stolen
 * admin session could PATCH /rest/v1/cameras with its own token and skip the
 * step-up, the audit row and the ML stop these actions perform.
 */
function cameraWriter() {
  return createServiceClient();
}

const ALLOWED_CAM_TYPES = ["rtsp", "http", "usb", "webcam", "demo"] as const satisfies readonly CameraType[];
type CamType = (typeof ALLOWED_CAM_TYPES)[number];

function isCamType(value: string): value is CamType {
  return (ALLOWED_CAM_TYPES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function disableCameraAutoResume(id: string, message: string): Promise<void> {
  try {
    await createServiceClient()
      .from("camera_sessions")
      .update({ auto_resume: false, last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("camera_id", id);
  } catch {
    // The action still returns the ML error; this best-effort write is only a
    // second line of defence for the next ML-service restart.
  }
}

/**
 * The optional `recording_mode` form field: absent / empty → null (leave the
 * column alone), a known mode, or `false` for anything else.
 */
function recordingModeField(formData: FormData): RecordingMode | null | false {
  const raw = formData.get("recording_mode");
  if (raw === null || String(raw).trim() === "") return null;
  const value = String(raw).trim();
  return isRecordingMode(value) ? value : false;
}

async function writeCameraAudit(action: string, detail: string, user: { id: string; email: string }): Promise<void> {
  try {
    await createServiceClient().from("audit_log").insert({
      action,
      detail,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {
    // Best effort, like every camera audit row: the change itself stands.
  }
}

/**
 * Audit (+ notify on loosening) a recording-mode change that was written.
 * Loosening (face_encrypted → standard) makes the ML service store raw
 * originals again, so the other admins hear about it in real time — the same
 * treatment as loosening a privacy schedule (ADR 0012).
 */
async function afterRecordingModeChange(
  user: { id: string; email: string },
  detail: string,
  direction: RecordingModeDirection,
): Promise<void> {
  const line = `${detail} [${direction}]`;
  await writeCameraAudit("CAMERA_RECORDING_MODE_CHANGE", line, user);
  if (direction === "loosen") {
    scheduleSecurityEvent({
      action: "CAMERA_RECORDING_MODE_CHANGE",
      actorId: user.id,
      actorEmail: user.email,
      detail: line,
    });
  }
}

/**
 * Built-in ML sample sources: demo://lobby | demo://gate | demo://parking.
 * The name is a short slug so the ML side can map it to a bundled clip and
 * never treat it as a path.
 */
const DEMO_URL_RE = /^demo:\/\/[a-z0-9_-]{1,32}$/;

/**
 * Network cameras must be rtsp(s)/http(s) URLs; usb/webcam are a device
 * index ("0", "1", …) or a local device path; demo sources are demo://<name>
 * and ONLY valid for cam_type "demo" (a demo:// URL on any other type is
 * rejected by the scheme allow-list below). Anything else (file://, concat:,
 * a bare filesystem path) would make the ML side open arbitrary paths with
 * cv2.VideoCapture.
 */
function validCameraUrl(url: string, camType: CamType): boolean {
  if (camType === "demo") return DEMO_URL_RE.test(url);
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

/**
 * Adding a camera widens what is captured AND starts from the column defaults
 * (enabled, privacy_default = standard, no schedule windows). Without the
 * second factor a stolen admin session could register a second row for a feed
 * whose camera is `private` (the source URL is visible on /cameras) and get
 * full recognition on it — defeating the TOTP step-up that loosening a
 * schedule requires (ADR 0012). So adding needs the step-up too, and the
 * other admins are told.
 */
export async function addCameraAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;
  const { t } = await getT();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const camType = String(formData.get("cam_type") ?? "rtsp").trim();

  if (!name || !url) return { error: t("camd_err_required") };
  if (!isCamType(camType)) return { error: t("camd_err_type") };
  if (!validCameraUrl(url, camType)) return { error: t("camd_err_url") };
  const recordingMode = recordingModeField(formData);
  if (recordingMode === false) return { error: t("cam_rec_mode_err_invalid") };

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: t("cam_err_key_missing") };
  }

  // `standard` is the column default, so it is only written when the operator
  // chose face-encrypted recording (ADR 0013).
  const mode: RecordingMode = recordingMode ?? "standard";
  const supabase = cameraWriter();
  const { error } = await supabase
    .from("cameras")
    .insert({
      name,
      url: encryptedUrl,
      cam_type: camType,
      created_by: user.id,
      ...(mode === "face_encrypted" ? { recording_mode: mode } : {}),
    });

  if (error) return { error: error.message };

  const addDetail = `Name: ${name} type: ${camType}${mode === "face_encrypted" ? " recording_mode: face_encrypted" : ""}`;
  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_ADD",
      detail: addDetail,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}
  scheduleSecurityEvent({
    action: "CAMERA_ADD",
    actorId: user.id,
    actorEmail: user.email,
    detail: addDetail,
  });

  revalidatePath("/cameras");
  return { ok: true };
}

export async function deleteCameraAction(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const { t } = await getT();
  const reauth = await ensureFreshReauth(user.id);
  if (reauth) return reauth;
  if (!UUID_RE.test(id)) return { error: "missing id" };

  try {
    await mlStopCamera(id);
  } catch {
    await disableCameraAutoResume(id, "ML stop failed during camera deletion");
    return { error: t("cam_stop_pending") };
  }

  const supabase = cameraWriter();
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

export async function toggleCameraAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const { t } = await getT();
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "false") === "true";

  // StepUpForm treats anything that is not `{ error }` as saved, so every
  // refusal below must be an explicit error — never a bare return / throw
  // (Next redacts thrown messages from server actions in production).
  if (!UUID_RE.test(id)) return { error: "missing id" };

  // Turning a camera ON widens what is captured and streamed, so it needs the
  // second factor like updateCameraAction. Turning one OFF only narrows it and
  // stays one click.
  if (enabled) {
    const reauth = await ensureFreshReauth(user.id);
    if (reauth) return reauth;
  }

  const supabase = cameraWriter();
  const { error } = await supabase.from("cameras").update({ enabled }).eq("id", id);
  if (error) return { error: error.message };
  let stopPending = false;
  if (!enabled) {
    try {
      await mlStopCamera(id);
    } catch {
      await disableCameraAutoResume(id, "ML stop failed after camera disabled");
      stopPending = true;
    }
  }

  // The row is already written, so audit + revalidate even when the ML stop
  // is still pending — otherwise the disable is never audited.
  try {
    await createServiceClient().from("audit_log").insert({
      action: "CAMERA_TOGGLE",
      detail: `camera ${id} → enabled=${enabled}${stopPending ? " (ml stop pending)" : ""}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  revalidatePath("/cameras");
  if (stopPending) return { error: t("cam_stop_pending") };
  return { ok: true };
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

  const { t } = await getT();
  if (!UUID_RE.test(id)) return { error: "missing id" };
  if (!name || !url) return { error: t("camd_err_required") };
  if (!isCamType(camType)) return { error: t("camd_err_type") };
  if (!validCameraUrl(url, camType)) return { error: t("camd_err_url") };
  const recordingMode = recordingModeField(formData);
  if (recordingMode === false) return { error: t("cam_rec_mode_err_invalid") };

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: t("cam_err_key_missing") };
  }

  const supabase = cameraWriter();
  const { data: before } = await supabase
    .from("cameras")
    .select("url, cam_type, recording_mode")
    .eq("id", id)
    .maybeSingle();
  // The dialog may carry a recording-mode change with the edit. The TOTP
  // step-up above already covers loosening, so the mode rides in the same
  // row write; its direction (from the stored row) only decides the audit
  // line and whether the other admins are told.
  let modeChange: { to: RecordingMode; direction: RecordingModeDirection; detail: string } | null = null;
  if (recordingMode) {
    const { mode: from, known } = storedRecordingMode(before?.recording_mode, recordingMode);
    const direction = classifyRecordingModeChange(from, recordingMode);
    if (direction !== "noop") {
      modeChange = {
        to: recordingMode,
        direction,
        detail: `camera ${id} recording_mode: ${known ? from : String(before?.recording_mode)} → ${recordingMode}`,
      };
    }
  }
  const { error } = await supabase
    .from("cameras")
    .update({
      name,
      url: encryptedUrl,
      cam_type: camType,
      ...(modeChange ? { recording_mode: modeChange.to } : {}),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  if (modeChange) await afterRecordingModeChange(user, modeChange.detail, modeChange.direction);
  // The ML registry holds the URL captured at start time; a changed source
  // must not be resumed with stale credentials — stop it, the operator
  // restarts from /grid.
  let sourceChanged = true;
  try {
    sourceChanged = !before || before.cam_type !== camType || unwrapCameraUrlForRuntime(before.url) !== url;
  } catch {
    sourceChanged = true;
  }
  if (sourceChanged) {
    try {
      await mlStopCamera(id);
    } catch {
      await disableCameraAutoResume(id, "ML stop failed after camera source update");
      return { error: t("cam_stop_pending") };
    }
  }

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
 * Per-camera recording mode (ADR 0013). standard → face_encrypted stores LESS
 * (no raw original from the next segment on) and is one click;
 * face_encrypted → standard stores raw originals again, so it needs the TOTP
 * step-up, is audited and tells the other admins. The direction is decided
 * from the stored row, never from the form, and the write is a compare-and-set
 * on that value. The ML service picks the mode up for NEW segments within
 * ~30 s; a running segment finishes in its current mode.
 */
export async function setRecordingModeAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const { t } = await getT();
  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "missing id" };
  const to = recordingModeField(formData);
  if (!to) return { error: t("cam_rec_mode_err_invalid") };

  const svc = cameraWriter();
  const { data: camera, error: readError } = await svc
    .from("cameras")
    .select("id, recording_mode")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: t("cam_rec_mode_err_save") };
  if (!camera) return { error: t("cam_rec_mode_err_not_found") };

  // Unknown stored value → judged as the opposite of the target, so a switch
  // to standard is still loosening (lib/recording-mode.ts).
  const { mode: from, known } = storedRecordingMode(camera.recording_mode, to);
  const direction = classifyRecordingModeChange(from, to);
  if (direction === "noop") return { ok: true };
  const detail = `camera ${id} recording_mode: ${known ? from : String(camera.recording_mode)} → ${to}`;

  if (direction === "loosen") {
    const reauth = await ensureFreshReauth(user.id);
    if (reauth) {
      await writeCameraAudit("CAMERA_RECORDING_MODE_STEP_UP_REQUIRED", detail, user);
      return reauth;
    }
  }

  let update = svc.from("cameras").update({ recording_mode: to }).eq("id", id);
  if (known) update = update.eq("recording_mode", from);
  const { data: updated, error } = await update.select("id");
  if (error) return { error: t("cam_rec_mode_err_save") };
  if (!updated || updated.length === 0) return { error: t("cam_rec_mode_err_conflict") };

  await afterRecordingModeChange(user, detail, direction);
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
  const { t } = await getT();
  const u = (url ?? "").trim();
  if (!u) return { ok: false, error: t("cam_err_url_empty") };
  if (!isCamType(camType)) return { ok: false, error: t("camd_err_type") };
  if (!validCameraUrl(u, camType)) return { ok: false, error: t("camd_err_url") };
  return mlTestCamera(u, camType);
}

export async function toggleConsentAction(
  formData: FormData,
): Promise<{ error: string } | { ok: true }> {
  const { user } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const required = String(formData.get("required") ?? "false") === "true";
  if (!UUID_RE.test(id)) return { error: "missing id" };

  // Dropping the consent requirement removes a privacy control — second
  // factor first. Switching it ON is the safe direction and needs none.
  if (!required) {
    const reauth = await ensureFreshReauth(user.id);
    if (reauth) return reauth;
  }

  const supabase = cameraWriter();
  const { error: updateError } = await supabase
    .from("cameras")
    .update({ consent_required: required })
    .eq("id", id);
  if (updateError) return { error: updateError.message };

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
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { protectCameraUrlForStorage , unwrapCameraUrlForRuntime } from "@/lib/camera-crypto";
import { ensureFreshReauth } from "@/lib/auth/step-up";
import { scheduleSecurityEvent } from "@/lib/notify";
import { mlTestCamera, type CameraTestResult, mlStopCamera, mlHoldCameraPrivacy, mlRefreshCameraPrivacy } from "@/lib/ml-client";
import type { CameraType } from "@/lib/database.types";

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

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: t("cam_err_key_missing") };
  }

  const supabase = cameraWriter();
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
  scheduleSecurityEvent({
    action: "CAMERA_ADD",
    actorId: user.id,
    actorEmail: user.email,
    detail: `Name: ${name} type: ${camType}`,
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

  let encryptedUrl: string;
  try {
    encryptedUrl = protectCameraUrlForStorage(url);
  } catch {
    return { error: t("cam_err_key_missing") };
  }

  const supabase = cameraWriter();
  const { data: before } = await supabase.from("cameras").select("url, cam_type").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("cameras")
    .update({ name, url: encryptedUrl, cam_type: camType })
    .eq("id", id);
  if (error) return { error: error.message };
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

  const supabase = cameraWriter();
  const { data: camera, error: readError } = await supabase
    .from("cameras")
    .select("consent_required")
    .eq("id", id)
    .maybeSingle();
  if (readError || !camera) return { error: "Camera unavailable" };
  if (camera.consent_required === required) {
    if (!required) return { ok: true };
    try {
      const confirmed = await mlRefreshCameraPrivacy(id);
      return confirmed.consent_confirmed ? { ok: true } : { error: "Consent gate is saved, but ML enforcement is not confirmed." };
    } catch {
      return { error: "Consent gate is saved, but ML enforcement is not confirmed." };
    }
  }

  // Dropping the consent requirement removes a privacy control — second
  // factor first. Switching it ON is the safe direction and needs none.
  if (!required) {
    const reauth = await ensureFreshReauth(user.id);
    if (reauth) return reauth;
  }

  // A DB-first update would leave the ML cache using its old permissive
  // answer until refresh. Acknowledge an in-process private hold only after
  // the current capture (including in-flight ArcFace work) has drained.
  // If the hold fails (ML down or erroring) the stricter setting is still
  // saved: ML reads it on its next policy refresh or restart, whereas
  // refusing would leave recognition allowed once ML is back.
  let held = false;
  if (required) {
    try {
      await mlHoldCameraPrivacy(id);
      held = true;
    } catch {
      held = false;
    }
  }

  // Removing this gate can resume recognition. The timestamp makes delayed
  // edge frames from before the change stay private even after the cache
  // refreshes to the loosened policy.
  const fields = required
    ? { consent_required: true }
    : { consent_required: false, privacy_loosened_at: new Date().toISOString() };
  const { data: updated, error: updateError } = await supabase
    .from("cameras")
    .update(fields)
    .eq("id", id)
    .eq("consent_required", camera.consent_required)
    .select("id");
  const pausedNote = held ? " Recognition remains paused until ML restarts." : "";
  if (updateError) return { error: required
    ? `Camera setting was not confirmed: ${updateError.message}.${pausedNote}`
    : updateError.message };
  if (!updated?.length) return { error: required
    ? `Camera setting changed; reload and try again.${pausedNote}`
    : "Camera setting changed; reload and try again." };

  let enforcementError = false;
  // The pre-write hold stays private if this refresh fails. The DB flag is
  // still saved, so report the unconfirmed read without issuing a user-stop
  // that would disable the camera's auto-resume registry.
  try {
    const confirmed = await mlRefreshCameraPrivacy(id);
    if (required && !confirmed.consent_confirmed) {
      throw new Error("ML policy refresh did not confirm the consent gate");
    }
  } catch {
    enforcementError = true;
  }

  try {
    const svc = createServiceClient();
    await svc.from("audit_log").insert({
      action: "CAMERA_CONSENT_TOGGLE",
      detail: `camera ${id} → consent_required=${required}`,
      user_id: user.id,
      user_email: user.email,
    });
  } catch {}

  if (!required) {
    scheduleSecurityEvent({
      action: "CAMERA_CONSENT_TOGGLE", actorId: user.id, actorEmail: user.email,
      detail: `camera ${id}: consent gate removed; recognition may resume`,
    });
  }

  revalidatePath("/cameras");
  if (enforcementError) {
    return { error: "Setting saved, but ML enforcement could not be confirmed. Check or stop the active camera." };
  }
  return { ok: true };
}

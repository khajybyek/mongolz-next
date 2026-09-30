"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  Save,
  X,
  KeyRound,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CameraType } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import {
  RECORDING_MODES,
  classifyRecordingModeChange,
  displayRecordingMode,
  type RecordingMode,
} from "@/lib/recording-mode";
import {
  addCameraAction,
  updateCameraAction,
  setRecordingModeAction,
  testCameraAction,
} from "@/app/(app)/cameras/actions";

type CamType = CameraType;

interface AddProps {
  mode: "add";
}
interface EditProps {
  mode: "edit";
  camera: {
    id: string;
    name: string;
    /** plaintext display URL (already unwrapped server-side) */
    url: string;
    cam_type: string;
    /** cameras.recording_mode (ADR 0013); missing/unknown shows as standard. */
    recording_mode?: string | null;
  };
}

type Props = AddProps | EditProps;

/** Default demo source — the ML service ships lobby / gate / parking. */
const DEMO_DEFAULT_URL = "demo://lobby";

const TYPE_HINTS: Record<CamType, { placeholder: TranslationKey; help: TranslationKey }> = {
  rtsp: { placeholder: "camd_ph_rtsp", help: "camd_hint_rtsp" },
  http: { placeholder: "camd_ph_http", help: "camd_hint_http" },
  usb: { placeholder: "camd_ph_usb", help: "camd_hint_usb" },
  webcam: { placeholder: "camd_ph_webcam", help: "camd_hint_webcam" },
  demo: { placeholder: "camd_ph_demo", help: "camd_hint_demo" },
};

const TYPE_LABELS: Record<CamType, TranslationKey> = {
  rtsp: "camd_type_rtsp",
  http: "camd_type_http",
  usb: "camd_type_usb",
  webcam: "camd_type_webcam",
  demo: "camd_type_demo",
};

const TYPE_ORDER: CamType[] = ["rtsp", "http", "usb", "webcam", "demo"];

const MODE_COPY: Record<RecordingMode, { label: TranslationKey; desc: TranslationKey }> = {
  standard: { label: "cam_rec_mode_standard", desc: "cam_rec_mode_standard_desc" },
  face_encrypted: { label: "cam_rec_mode_face_encrypted", desc: "cam_rec_mode_face_encrypted_desc" },
};

/** usb / webcam are opened by the browser or the ML host itself — nothing to probe. */
function localOnly(camType: CamType): boolean {
  return camType === "usb" || camType === "webcam";
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; width: number; height: number; fps: number }
  | { kind: "err"; message: string };

export function CameraDialog(props: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useT();
  const isEdit = props.mode === "edit";
  const camera = isEdit ? props.camera : null;
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(camera?.name ?? "");
  const [url, setUrl] = useState(camera?.url ?? "");
  const [camType, setCamType] = useState<CamType>(
    (camera?.cam_type as CamType) ?? "rtsp",
  );
  const initialMode = displayRecordingMode(camera?.recording_mode);
  const [mode, setMode] = useState<RecordingMode>(initialMode);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName(camera?.name ?? "");
    setUrl(camera?.url ?? "");
    setCamType((camera?.cam_type as CamType) ?? "rtsp");
    setMode(initialMode);
    setTest({ kind: "idle" });
    setSaveErr(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  async function runTest() {
    setTest({ kind: "running" });
    const res = await testCameraAction(url, camType);
    if (res.ok && res.info) {
      setTest({
        kind: "ok",
        width: res.info.width,
        height: res.info.height,
        fps: res.info.fps,
      });
    } else {
      setTest({ kind: "err", message: res.error ?? t("camd_err_unknown") });
    }
  }

  // Adds and edits answer REAUTH_REQUIRED when no TOTP step-up is fresh. The
  // built submission is parked here, the TOTP prompt opens on top of this
  // dialog, and the SAME submission is retried after a correct code.
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingEdit = useRef<FormData | null>(null);

  function finishOk() {
    toast({
      title: isEdit ? t("toast_camera_saved") : t("toast_camera_added"),
      description: name.trim(),
      tone: "success",
    });
    setOpen(false);
    reset();
    router.refresh();
  }

  function fail(message: string) {
    setSaveErr(message);
    toast({ title: t("toast_failed"), description: message, tone: "danger" });
  }

  function submitEdit(fd: FormData) {
    startTransition(async () => {
      // A mode-only edit goes through the recording-mode action, so switching
      // to face-encrypted (tightening) stays one click; every other edit
      // needs the step-up anyway and carries the mode along.
      const res = fd.get("op") === "recording_mode"
        ? await setRecordingModeAction(fd)
        : fd.has("id") ? await updateCameraAction(fd) : await addCameraAction(fd);
      if ("error" in res) {
        if (res.error === "REAUTH_REQUIRED") {
          pendingEdit.current = fd;
          setNeedsTotp(true);
          return;
        }
        fail(res.error);
        return;
      }
      pendingEdit.current = null;
      finishOk();
    });
  }

  const modeChanged = mode !== initialMode;
  // Switching back to standard stores raw originals again (ADR 0013).
  const modeLoosens = isEdit && classifyRecordingModeChange(initialMode, mode) === "loosen";

  function save() {
    setSaveErr(null);
    const fd = new FormData();
    if (
      isEdit && camera && modeChanged &&
      name.trim() === camera.name && url.trim() === camera.url && camType === camera.cam_type
    ) {
      fd.append("op", "recording_mode");
      fd.append("id", camera.id);
      fd.append("recording_mode", mode);
      submitEdit(fd);
      return;
    }
    fd.append("name", name);
    fd.append("url", url);
    fd.append("cam_type", camType);
    // An edit only sends the mode when it changed, so a stale dialog never
    // writes back a mode someone else set meanwhile.
    if (!isEdit || modeChanged) fd.append("recording_mode", mode);

    if (isEdit && camera) fd.append("id", camera.id);
    submitEdit(fd);
  }

  const hint = TYPE_HINTS[camType];
  const title = isEdit ? t("camd_title_edit") : t("camd_title_add");
  const description = isEdit ? t("camd_desc_edit") : t("camd_desc_add");

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-icon"
          title={t("camd_title_edit")}
          aria-label={t("camd_title_edit")}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t("camd_title_add")}
        </button>
      )}

      <Dialog
        open={open}
        onClose={close}
        size="lg"
        title={title}
        description={description}
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="btn-ghost"
            >
              <X className="w-4 h-4" />
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !name.trim() || !url.trim()}
              className="btn-primary"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isEdit ? t("save") : t("add")}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor={`${fieldId}-name`}>{t("camera_name")}</label>
            <input
              id={`${fieldId}-name`}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("camd_name_placeholder")}
              disabled={pending}
            />
          </div>

          <div>
            <label className="label" htmlFor={`${fieldId}-type`}>{t("camera_type")}</label>
            <select
              id={`${fieldId}-type`}
              className="select"
              value={camType}
              onChange={(e) => {
                const next = e.target.value as CamType;
                setCamType(next);
                // A demo source has a fixed vocabulary, so an empty URL is
                // prefilled with the first sample instead of leaving the
                // operator to guess the scheme.
                if (next === "demo" && !url.trim()) setUrl(DEMO_DEFAULT_URL);
                setTest({ kind: "idle" });
              }}
              disabled={pending}
            >
              {TYPE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {t(TYPE_LABELS[value])}
                </option>
              ))}
            </select>
            <p className="helper">{t(hint.help)}</p>
          </div>

          <div>
            <label className="label" htmlFor={`${fieldId}-url`}>{t("camd_url")}</label>
            <input
              id={`${fieldId}-url`}
              className="input font-mono text-xs"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTest({ kind: "idle" });
              }}
              placeholder={t(hint.placeholder)}
              disabled={pending}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Recording mode (ADR 0013) — what is stored for new segments. */}
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="label">{t("cam_rec_mode")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {RECORDING_MODES.map((value) => (
                <label
                  key={value}
                  className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-surface-elevated px-3 py-2.5 leading-snug cursor-pointer has-[:checked]:border-accent/50 has-[:checked]:bg-accent/10"
                >
                  <input
                    type="radio"
                    name={`${fieldId}-recording-mode`}
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-text">
                      {value === "face_encrypted" && <KeyRound className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden />}
                      {t(MODE_COPY[value].label)}
                    </span>
                    <span className="block text-2xs text-text-muted leading-relaxed">
                      {t(MODE_COPY[value].desc)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {mode === "face_encrypted" && (
              <p className="helper flex items-start gap-1.5 text-warning">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                <span>{t("cam_rec_mode_tradeoff")}</span>
              </p>
            )}
            <p className="helper">
              {t("cam_rec_mode_applies_new")}
              {modeLoosens && <> {t("cam_rec_mode_loosen_note")}</>}
            </p>
          </fieldset>

          {/* Test connection block */}
          <div className="card-glass p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="section-title">{t("camd_test_title")}</h3>
              <button
                type="button"
                onClick={runTest}
                disabled={
                  test.kind === "running" ||
                  pending ||
                  !url.trim() ||
                  localOnly(camType)
                }
                className="btn-secondary btn-sm"
              >
                {test.kind === "running" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                {t("camd_test_btn")}
              </button>
            </div>

            {test.kind === "idle" && (
              <p className="text-2xs text-text-muted">
                {localOnly(camType)
                  ? t("camd_test_idle_local")
                  : camType === "demo"
                    ? t("camd_test_idle_demo")
                    : t("camd_test_idle_net")}
              </p>
            )}

            {test.kind === "running" && (
              <p className="text-2xs text-text-soft inline-flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t("camd_test_running")}
              </p>
            )}

            {test.kind === "ok" && (
              <div
                className={cn(
                  "rounded-lg border border-success/30 bg-success/5 px-3 py-2",
                  "flex items-center gap-2 text-xs",
                )}
              >
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-success font-medium">{t("camd_test_ok")}</span>
                <span className="text-text-soft font-mono">
                  · {test.width}×{test.height}
                  {test.fps > 0 && ` @ ${test.fps} fps`}
                </span>
              </div>
            )}

            {test.kind === "err" && (
              <div
                className={cn(
                  "rounded-lg border border-danger/30 bg-danger/5 px-3 py-2",
                  "flex items-start gap-2 text-xs",
                )}
              >
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-danger font-medium">{t("camd_test_fail")}</div>
                  <div className="text-text-soft mt-0.5 break-words">
                    {test.message}
                  </div>
                </div>
              </div>
            )}
          </div>

          {saveErr && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {saveErr}
            </div>
          )}
        </div>
      </Dialog>

      <TotpPrompt
        open={needsTotp}
        description={modeLoosens ? t("cam_rec_mode_stepup_reason") : undefined}
        onClose={() => {
          setNeedsTotp(false);
          pendingEdit.current = null;
          setSaveErr(t("step_up_required"));
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          const fd = pendingEdit.current;
          if (fd) submitEdit(fd);
        }}
      />
    </>
  );
}

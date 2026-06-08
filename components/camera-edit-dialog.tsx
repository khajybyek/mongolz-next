"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  addCameraAction,
  updateCameraAction,
  testCameraAction,
} from "@/app/(app)/cameras/actions";

type CamType = "rtsp" | "http" | "usb" | "webcam";

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
  };
}

type Props = AddProps | EditProps;

const TYPE_HINTS: Record<CamType, { placeholder: string; help: string }> = {
  rtsp: {
    placeholder: "rtsp://user:pass@192.168.1.10:554/cam/realmonitor",
    help: "RTSP — Dahua/Hikvision гэх мэт IP CCTV. user:pass URL дотор.",
  },
  http: {
    placeholder: "http://192.168.1.10/cgi-bin/snapshot.cgi",
    help: "MJPEG / snapshot URL — Hikvision ISAPI, IP Webcam app г.м.",
  },
  usb: {
    placeholder: "/dev/video0 эсвэл 0",
    help: "ML host-ын локал USB камер. Энэ төрлийг ML-аас шалгахгүй.",
  },
  webcam: {
    placeholder: "browser",
    help: "Browser getUserMedia. Энэ төрөл нь /live page-аас л ажиллана.",
  },
};

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; width: number; height: number; fps: number }
  | { kind: "err"; message: string };

export function CameraDialog(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const camera = isEdit ? props.camera : null;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(camera?.name ?? "");
  const [url, setUrl] = useState(camera?.url ?? "");
  const [camType, setCamType] = useState<CamType>(
    (camera?.cam_type as CamType) ?? "rtsp",
  );
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName(camera?.name ?? "");
    setUrl(camera?.url ?? "");
    setCamType((camera?.cam_type as CamType) ?? "rtsp");
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
      setTest({ kind: "err", message: res.error ?? "Тодорхойгүй алдаа" });
    }
  }

  function save() {
    setSaveErr(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("url", url);
      fd.append("cam_type", camType);

      if (isEdit && camera) {
        fd.append("id", camera.id);
        const res = await updateCameraAction(fd);
        if ("error" in res) {
          setSaveErr(res.error);
          return;
        }
      } else {
        const res = await addCameraAction(fd);
        if ("error" in res) {
          setSaveErr(res.error);
          return;
        }
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const hint = TYPE_HINTS[camType];
  const title = isEdit ? "Камер засах" : "Камер нэмэх";
  const description = isEdit
    ? "Нэр, URL, төрөл солих. Хадгалахад нууц үгээ дахин асууж магадгүй."
    : "Шинэ камер нэмэхийн өмнө URL-ийг шалгаж болно.";

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost text-xs p-2"
          title="Засах"
          aria-label="Edit camera"
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
          Камер нэмэх
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
              Болих
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
              {isEdit ? "Хадгалах" : "Нэмэх"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Нэр</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="жишээ: Үүдний камер"
              disabled={pending}
            />
          </div>

          <div>
            <label className="label">Төрөл</label>
            <select
              className="input"
              value={camType}
              onChange={(e) => {
                setCamType(e.target.value as CamType);
                setTest({ kind: "idle" });
              }}
              disabled={pending}
            >
              <option value="rtsp">RTSP</option>
              <option value="http">HTTP / MJPEG</option>
              <option value="usb">USB (ML host-ын локал)</option>
              <option value="webcam">Webcam (browser)</option>
            </select>
            <p className="helper">{hint.help}</p>
          </div>

          <div>
            <label className="label">URL</label>
            <input
              className="input font-mono text-xs"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTest({ kind: "idle" });
              }}
              placeholder={hint.placeholder}
              disabled={pending}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Test connection block */}
          <div className="card-glass p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xs uppercase tracking-wider text-text-soft font-semibold">
                Холболт шалгах
              </div>
              <button
                type="button"
                onClick={runTest}
                disabled={
                  test.kind === "running" ||
                  pending ||
                  !url.trim() ||
                  camType === "usb" ||
                  camType === "webcam"
                }
                className="btn-secondary text-xs"
              >
                {test.kind === "running" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                Шалгах
              </button>
            </div>

            {test.kind === "idle" && (
              <p className="text-2xs text-text-muted">
                {camType === "usb" || camType === "webcam"
                  ? "Энэ төрлийг ML-аас шалгах боломжгүй (browser/локал төхөөрөмж)."
                  : "URL хүрэх эсэх + frame унших боломжтой эсэхийг ML 8 сек-ийн дотор шалгана."}
              </p>
            )}

            {test.kind === "running" && (
              <p className="text-2xs text-text-soft inline-flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Холбогдож байна… (≤8s)
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
                <span className="text-success font-medium">Амжилттай</span>
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
                  <div className="text-danger font-medium">Амжилтгүй</div>
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
    </>
  );
}

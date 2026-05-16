"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Laptop,
  Smartphone,
  Cctv,
  Play,
  Square,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { HlsPlayer } from "@/components/hls-player";
import { startCameraAction, stopCameraAction, getStreamTicketAction } from "./actions";
import { cn } from "@/lib/utils";

interface Camera {
  id: string;
  name: string;
  url: string | null;
  cam_type: string;
}

type Mode = "device" | "phone" | "cctv";

export function LiveCameraView({ cameras }: { cameras: Camera[] }) {
  const [mode, setMode] = useState<Mode>("device");

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-2 p-2 w-fit">
        <ModeBtn current={mode} value="device" onClick={setMode} icon={Laptop}>
          Тухайн төхөөрөмж
        </ModeBtn>
        <ModeBtn current={mode} value="phone" onClick={setMode} icon={Smartphone}>
          Гар утас
        </ModeBtn>
        <ModeBtn current={mode} value="cctv" onClick={setMode} icon={Cctv}>
          IP CCTV
        </ModeBtn>
      </div>

      {mode === "device" && <DeviceCameraView />}
      {mode === "phone" && <PhoneIpWebcamView />}
      {mode === "cctv" && <CctvView cameras={cameras} />}
    </div>
  );
}

function ModeBtn({
  current,
  value,
  onClick,
  icon: Icon,
  children,
}: {
  current: Mode;
  value: Mode;
  onClick: (v: Mode) => void;
  icon: typeof Laptop;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition",
        active ? "bg-accent/15 text-accent" : "text-neutral-400 hover:bg-white/5"
      )}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────
// 1. Device Webcam — навигатор getUserMedia + MediaRecorder
// ────────────────────────────────────────────────────
function pickMimeType(): string {
  if (typeof window === "undefined" || !window.MediaRecorder) return "video/webm";
  const candidates = [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

function DeviceCameraView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRafRef = useRef<number | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorBackend, setDetectorBackend] = useState<"webgpu" | "wasm" | "off">("off");
  const [faceCount, setFaceCount] = useState(0);

  // Recording state
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const uploadStartRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Боломжит камерууд
  useEffect(() => {
    (async () => {
      try {
        // Permission авахын тулд эхлээд getUserMedia дуудаад зогсооно
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all.filter((d) => d.kind === "videoinput");
        setDevices(cams);
        if (cams[0]) setDeviceId(cams[0].deviceId);
      } catch (e) {
        setError(
          e instanceof Error
            ? `Камер хандах эрх олгогдсонгүй: ${e.message}`
            : "Камер хандах эрх олгогдсонгүй"
        );
      }
    })();
  }, []);

  async function start() {
    setError(null);
    setSavedMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = s;
      setStream(s);
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Камер нээгдсэнгүй");
    }
  }

  function stop() {
    if (recording) {
      stopRecording();
    }
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setActive(false);
  }

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  // ───────── Live face detection loop ─────────
  // Loads UltraFace-RFB-320 on demand, then ~5fps detection draws bbox overlay
  // on a transparent canvas above the video element. Pure client-side.
  useEffect(() => {
    if (!active || !videoRef.current || !overlayRef.current) return;
    let cancelled = false;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const ctx2d = overlay.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;

    async function loop() {
      let detectFaces: typeof import("@/lib/edge-inference/face-detector").detectFaces;
      try {
        const mod = await import("@/lib/edge-inference/face-detector");
        const backend = await mod.initDetector("/models/face_detect.onnx", "webgpu");
        if (cancelled) return;
        detectFaces = mod.detectFaces;
        setDetectorReady(true);
        setDetectorBackend(backend);
      } catch {
        // detector unavailable — silently fall back to no overlay
        setDetectorBackend("off");
        return;
      }
      let lastDetect = 0;

      const tick = async (now: number) => {
        if (cancelled || !video.videoWidth || !video.videoHeight) {
          detectorRafRef.current = requestAnimationFrame(tick);
          return;
        }
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;

        if (now - lastDetect > 200) {
          // ~5 fps inference
          lastDetect = now;
          if (!sampleCanvasRef.current) {
            sampleCanvasRef.current = document.createElement("canvas");
          }
          const sample = sampleCanvasRef.current;
          sample.width = video.videoWidth;
          sample.height = video.videoHeight;
          const sctx = sample.getContext("2d", { willReadFrequently: true });
          if (!sctx) return;
          sctx.drawImage(video, 0, 0);
          let imageData: ImageData;
          try {
            imageData = sctx.getImageData(0, 0, sample.width, sample.height);
          } catch {
            // canvas tainted — skip
            detectorRafRef.current = requestAnimationFrame(tick);
            return;
          }

          let faces: { bbox: [number, number, number, number]; confidence: number }[] = [];
          try {
            faces = await detectFaces(imageData, 0.45);
          } catch {
            // single frame failure — keep loop alive
          }
          if (cancelled) return;

          ctx.clearRect(0, 0, overlay.width, overlay.height);
          ctx.lineWidth = Math.max(2, Math.round(overlay.width / 320));
          ctx.strokeStyle = "#00d4ff";
          ctx.fillStyle = "#00d4ffcc";
          ctx.font = `${Math.max(12, Math.round(overlay.width / 60))}px ui-sans-serif`;
          faces.forEach((f, i) => {
            const [x, y, w, h] = f.bbox;
            ctx.strokeRect(x, y, w, h);
            const label = `#${i + 1} ${(f.confidence * 100).toFixed(0)}%`;
            const m = ctx.measureText(label);
            const pad = 4;
            ctx.fillRect(x, y - 18, m.width + pad * 2, 18);
            ctx.fillStyle = "#0a0a1e";
            ctx.fillText(label, x + pad, y - 5);
            ctx.fillStyle = "#00d4ffcc";
          });
          setFaceCount(faces.length);
        }

        detectorRafRef.current = requestAnimationFrame(tick);
      };

      detectorRafRef.current = requestAnimationFrame(tick);
    }

    loop();

    return () => {
      cancelled = true;
      if (detectorRafRef.current !== null) cancelAnimationFrame(detectorRafRef.current);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    };
  }, [active]);

  // Recording timer
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Upload elapsed timer
  useEffect(() => {
    if (!uploading) return;
    const id = setInterval(() => {
      setUploadElapsed(Math.floor((Date.now() - uploadStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [uploading]);

  function startRecording() {
    if (!stream) return;
    setError(null);
    setSavedMsg(null);

    const mime = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "MediaRecorder дэмжигдээгүй");
      return;
    }

    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      await uploadRecording(blob, duration, mime);
    };

    rec.start(1000); // 1s timeslice — periodic ondataavailable
    recorderRef.current = rec;
    startTimeRef.current = Date.now();
    setRecording(true);
    setElapsed(0);
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }

  async function uploadRecording(blob: Blob, durationSec: number, mime: string) {
    setUploading(true);
    setUploadElapsed(0);
    uploadStartRef.current = Date.now();
    try {
      const sizeMB = blob.size / 1024 / 1024;

      if (blob.size > 4 * 1024 * 1024) {
        throw new Error(
          `Бичлэг хэтэрхий том (${sizeMB.toFixed(1)}MB). Vercel 4MB-аас дээш зөвшөөрдөггүй. ` +
          `Урт бичлэг бол IP CCTV (RTSP) ашиглана уу.`
        );
      }

      const fd = new FormData();
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      fd.append("file", blob, `recording.${ext}`);
      fd.append("duration_sec", String(durationSec));
      fd.append("camera_name", "Browser camera");

      const res = await fetch("/api/recording/upload", { method: "POST", body: fd });
      const contentType = res.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        const text = await res.text();
        if (res.status === 413 || /request entity too large/i.test(text)) {
          throw new Error(
            `Файл хэтэрхий том (${sizeMB.toFixed(1)}MB). Vercel 4MB limit-тэй. Богино бичлэг хийнэ үү.`
          );
        }
        throw new Error(`Сервер алдаа (${res.status}): ${text.slice(0, 100)}`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Хадгалах амжилтгүй");

      setSavedMsg(
        `✓ Илгээгдсэн (${sizeMB.toFixed(1)}MB) · ${durationSec}s · ` +
        `Боловсруулалт ажиллаж байна (~1-2 мин). Playback дээр харагдана.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Хадгалах алдаа");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="card p-0 overflow-hidden bg-black aspect-video relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain"
        />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
        {!active && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm pointer-events-none">
            &quot;Эхлүүлэх&quot; товчийг дар
          </div>
        )}
        {recording && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-danger/90 text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
            <span className="w-2 h-2 rounded-full bg-white" />
            REC {Math.floor(elapsed / 60).toString().padStart(2, "0")}:
            {(elapsed % 60).toString().padStart(2, "0")}
          </div>
        )}
        {active && detectorBackend !== "off" && (
          <div className="absolute top-3 right-3 text-[10px] font-medium px-2.5 py-1 rounded-full bg-bg-secondary/80 backdrop-blur border border-white/10 flex items-center gap-1.5">
            <span className={detectorReady ? "text-accent" : "text-neutral-500"}>●</span>
            <span className="text-neutral-300">
              {detectorReady ? `${faceCount} нүүр` : "loading…"}
            </span>
            <span className="text-neutral-500 uppercase">{detectorBackend}</span>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
            Камер сонгох
          </label>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={active || !devices.length}
            className="input"
          >
            {devices.length === 0 && <option>— Илрээгүй —</option>}
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Камер ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {savedMsg && (
          <div className="bg-success/10 border border-success/30 rounded-lg p-2.5 text-xs text-success">
            {savedMsg}{" "}
            <Link href="/playback" className="underline hover:text-success/80">
              Playback хуудаст харах →
            </Link>
          </div>
        )}

        {/* Camera on/off */}
        {active ? (
          <button onClick={stop} className="btn-ghost w-full" disabled={uploading}>
            <Square className="w-4 h-4" />
            Камер унтраах
          </button>
        ) : (
          <button onClick={start} className="btn-primary w-full" disabled={uploading}>
            <Play className="w-4 h-4" />
            Эхлүүлэх
          </button>
        )}

        {/* Recording control — зөвхөн камер асаалттай үед */}
        {active && (
          <>
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={uploading}
                className="btn-primary w-full bg-danger hover:bg-danger/90"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                Бичлэг эхлүүлэх
              </button>
            ) : (
              <button onClick={stopRecording} className="btn-ghost w-full">
                <Square className="w-4 h-4" />
                Бичлэг зогсоох
              </button>
            )}
          </>
        )}

        {uploading && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 text-xs text-accent space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span className="font-medium">Боловсруулж байна...</span>
              <span className="ml-auto font-mono">
                {Math.floor(uploadElapsed / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(uploadElapsed % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <div className="text-[10px] text-neutral-400 leading-relaxed">
              Face detection (InsightFace), mosaic anonymization, AES-256
              encrypt — бичлэгийн уртаас хамаарч{" "}
              <span className="text-accent">~30-90 секунд</span> хүлээгээрэй.
              Хуудсыг хаахгүй.
            </div>
          </div>
        )}

        <p className="text-[11px] text-neutral-500 leading-relaxed">
          💡 Бичлэг {`<`} 100MB. Face detection, mosaic, encrypted original
          бүгд автомат — multi-ID reveal боломжтой.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 2. Phone — IP Webcam app (HTTP MJPEG/MP4 stream)
// ────────────────────────────────────────────────────
function PhoneIpWebcamView() {
  const [url, setUrl] = useState("http://192.168.1.5:8080/video");
  const [active, setActive] = useState(false);
  const [streamType, setStreamType] = useState<"mjpeg" | "mp4">("mjpeg");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="card p-0 overflow-hidden bg-black aspect-video relative flex items-center justify-center">
        {!active ? (
          <div className="text-neutral-500 text-sm">
            URL оруулаад "Холбогдох" дар
          </div>
        ) : streamType === "mjpeg" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="phone stream"
            className="w-full h-full object-contain"
            onError={() => setActive(false)}
          />
        ) : (
          <video
            src={url}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain"
          />
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
            Stream төрөл
          </label>
          <select
            value={streamType}
            onChange={(e) => setStreamType(e.target.value as "mjpeg" | "mp4")}
            disabled={active}
            className="input"
          >
            <option value="mjpeg">MJPEG (IP Webcam app default)</option>
            <option value="mp4">MP4 / WebM stream</option>
          </select>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
            Утасны Stream URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={active}
            placeholder="http://192.168.x.y:8080/video"
            className="input text-xs"
          />
        </div>

        {active ? (
          <button onClick={() => setActive(false)} className="btn-danger w-full">
            <Square className="w-4 h-4" />
            Тасрах
          </button>
        ) : (
          <button onClick={() => setActive(true)} className="btn-primary w-full">
            <Play className="w-4 h-4" />
            Холбогдох
          </button>
        )}

        <details className="text-[11px] text-neutral-500 leading-relaxed">
          <summary className="cursor-pointer hover:text-neutral-300">
            💡 Утасны IP Webcam яаж тохируулах вэ?
          </summary>
          <ul className="mt-2 space-y-1 pl-3 list-disc">
            <li>
              <strong>Android:</strong> "IP Webcam" app (Pavel Khlebovich) суулгаж "Start
              server" дар → http://phone-ip:8080/video
            </li>
            <li>
              <strong>iPhone:</strong> "EpocCam" эсвэл "iVCam" app
            </li>
            <li>Утас болон компьютер нэг WiFi-д байх ёстой</li>
            <li>App-аас гарч буй URL-ийг яг тэр хэлбэрээр оруулна</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 3. IP CCTV — RTSP Python ML service-аар HLS-руу хөрвүүлэх
// ────────────────────────────────────────────────────
function CctvView({ cameras }: { cameras: Camera[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(c: Camera) {
    setError(null);
    setBusy(true);
    try {
      await startCameraAction(c.id);
      const t = await getStreamTicketAction(c.id);
      setTicket(t);
      setActive(c.id);
    } catch {
      setError(
        "Python ML service хариулсангүй. ml-service folder-аас " +
          "`uvicorn main:app --port 8000` ажиллуулна уу."
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop(c: Camera) {
    setBusy(true);
    try {
      await stopCameraAction(c.id);
      if (active === c.id) setActive(null);
    } catch {}
    setBusy(false);
  }

  const activeCam = cameras.find((c) => c.id === active);
  const streamUrl = activeCam && ticket
    ? `/api/ml/stream/${encodeURIComponent(activeCam.id)}/index.m3u8?ticket=${encodeURIComponent(ticket)}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      <div className="card p-0 overflow-hidden bg-black aspect-video relative flex items-center justify-center">
        {streamUrl ? (
          <HlsPlayer src={streamUrl} className="w-full h-full" />
        ) : (
          <div className="text-neutral-500 text-sm text-center px-4">
            Камер сонгож "Эхлүүлэх" дар
            <br />
            <span className="text-[11px] text-neutral-600">
              (RTSP → HLS — Python ML service шаардана)
            </span>
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-2 flex items-center justify-between">
          Бүртгэлтэй CCTV
          <a
            href="/cameras"
            className="text-[10px] text-accent hover:underline normal-case"
          >
            Удирдах →
          </a>
        </h2>

        {cameras.length === 0 && (
          <p className="text-xs text-neutral-500 py-4 text-center">
            Камер бүртгэгдээгүй.
            <br />
            <a href="/cameras" className="text-accent hover:underline">
              "Камер удирдах"
            </a>{" "}
            хуудаснаас нэмнэ үү.
          </p>
        )}

        {cameras.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 py-2 border-b border-white/5 last:border-0"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{c.name}</div>
              <div className="text-[10px] text-neutral-500 uppercase">{c.cam_type}</div>
            </div>
            {active === c.id ? (
              <button
                onClick={() => stop(c)}
                disabled={busy}
                className="btn-danger text-xs p-1.5"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <button
                onClick={() => start(c)}
                disabled={busy}
                className="btn-primary text-xs p-1.5"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        ))}

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger flex gap-2 mt-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

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
  Upload,
} from "lucide-react";
import { HlsPlayer } from "@/components/hls-player";
import { startCameraAction, stopCameraAction, getStreamTicketAction } from "./actions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface Camera {
  id: string;
  name: string;
  url: string | null;
  cam_type: string;
}

type Mode = "device" | "phone" | "cctv" | "file";

export function LiveCameraView({ cameras }: { cameras: Camera[] }) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("device");

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-2 p-2 w-fit">
        <ModeBtn current={mode} value="device" onClick={setMode} icon={Laptop}>
          {t("live_mode_device")}
        </ModeBtn>
        <ModeBtn current={mode} value="phone" onClick={setMode} icon={Smartphone}>
          {t("live_mode_phone")}
        </ModeBtn>
        <ModeBtn current={mode} value="cctv" onClick={setMode} icon={Cctv}>
          IP CCTV
        </ModeBtn>
        <ModeBtn current={mode} value="file" onClick={setMode} icon={Upload}>
          {t("live_mode_file") || "Файл upload"}
        </ModeBtn>
      </div>

      {mode === "device" && <DeviceCameraView />}
      {mode === "phone" && <PhoneIpWebcamView />}
      {mode === "cctv" && <CctvView cameras={cameras} />}
      {mode === "file" && <FileUploadView />}
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
        active ? "bg-accent/15 text-accent" : "text-text-soft hover:bg-text-muted/5"
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
  const { t } = useT();
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
        const prefix = t("live_perm_error");
        setError(e instanceof Error ? `${prefix}: ${e.message}` : prefix);
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
      setError(e instanceof Error ? e.message : t("live_camera_not_opened"));
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

    // ── Chunked session for long recordings ──
    // Vercel API routes have a 4.5MB body limit, so we split the stream into
    // ~3MB chunks. Each chunk is uploaded as part of the same session_id; the
    // server stitches them post-processing.
    const sessionId = crypto.randomUUID();
    const MAX_CHUNK_BYTES = 3 * 1024 * 1024; // 3MB target per chunk
    chunksRef.current = [];
    let chunkBuf: BlobPart[] = [];
    let chunkBytes = 0;
    let chunkIndex = 0;

    const flushChunk = async (isFinal: boolean) => {
      if (chunkBuf.length === 0 && !isFinal) return;
      if (chunkBuf.length === 0 && isFinal) return;
      const blob = new Blob(chunkBuf, { type: mime });
      chunkBuf = [];
      chunkBytes = 0;
      const idx = chunkIndex++;
      try {
        await uploadChunk(blob, mime, sessionId, idx, isFinal);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chunk upload алдаа");
      }
    };

    rec.ondataavailable = async (e) => {
      if (e.data.size === 0) return;
      chunkBuf.push(e.data);
      chunkBytes += e.data.size;
      if (chunkBytes >= MAX_CHUNK_BYTES) {
        // Async fire-and-forget so we don't block the recorder
        flushChunk(false);
      }
    };
    rec.onstop = async () => {
      const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      // flush any remaining bytes as the final chunk
      uploadStartRef.current = Date.now();
      setUploadElapsed(0);
      setUploading(true);
      try {
        await flushChunk(true);
        setSavedMsg(
          `✓ Session ${sessionId.slice(0, 8)} — ${chunkIndex} chunk · ${duration}s. ` +
          `Боловсруулалт ажиллаж байна.`,
        );
      } finally {
        setUploading(false);
      }
    };

    rec.start(1000); // 1s timeslice — periodic ondataavailable
    recorderRef.current = rec;
    startTimeRef.current = Date.now();
    setRecording(true);
    setElapsed(0);
  }

  async function uploadChunk(
    blob: Blob,
    mime: string,
    sessionId: string,
    chunkIndex: number,
    isFinal: boolean,
  ) {
    const sizeMB = blob.size / 1024 / 1024;
    if (blob.size > 4 * 1024 * 1024) {
      throw new Error(
        `Chunk хэт том (${sizeMB.toFixed(1)}MB). Vercel 4MB лимит.`,
      );
    }
    const fd = new FormData();
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    fd.append("file", blob, `chunk-${chunkIndex}.${ext}`);
    fd.append("session_id", sessionId);
    fd.append("chunk_index", String(chunkIndex));
    fd.append("is_final", String(isFinal));
    fd.append("camera_name", "Browser camera");
    const res = await fetch("/api/recording/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      let msg: string;
      if (ct.includes("json")) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        msg = body?.error ?? `HTTP ${res.status}`;
      } else {
        const text = await res.text().catch(() => "");
        // Vercel timeout / Next.js runtime crash returns a hefty HTML page.
        // Detect the common signatures and translate to something a human
        // can act on, instead of dumping <!DOCTYPE html…> at the user.
        if (text.includes("FUNCTION_INVOCATION_TIMEOUT") || text.includes("__next_error__")) {
          msg =
            res.status === 504
              ? "ML боловсруулалт хэт удсан (Vercel function timeout). Chunk-ийн size-ыг багасгах эсвэл Pro tier шилжих хэрэгтэй."
              : `Server алдаа (HTTP ${res.status})`;
        } else {
          msg = `HTTP ${res.status}`;
        }
      }
      throw new Error(`Chunk ${chunkIndex} failed: ${msg}`);
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }

  // Legacy single-blob upload has been replaced by chunked session uploads.
  // Kept here as a fallback for cases where chunking isn't desired in future.

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
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm pointer-events-none">
            {t("live_press_start")}
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
          <div className="absolute top-3 right-3 text-2xs font-medium px-2.5 py-1 rounded-full bg-surface/80 backdrop-blur border border-border-strong flex items-center gap-1.5">
            <span className={detectorReady ? "text-accent" : "text-text-muted"}>●</span>
            <span className="text-text-soft">
              {detectorReady ? `${faceCount} ${t("faces_count_label")}` : "loading…"}
            </span>
            <span className="text-text-muted uppercase">{detectorBackend}</span>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <label className="label">{t("live_select_cam")}</label>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={active || !devices.length}
            className="input"
          >
            {devices.length === 0 && <option>{t("live_no_devices")}</option>}
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${t("nav_cameras")} ${d.deviceId.slice(0, 6)}`}
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
              {t("live_view_playback")}
            </Link>
          </div>
        )}

        {/* Camera on/off */}
        {active ? (
          <button onClick={stop} className="btn-ghost w-full" disabled={uploading}>
            <Square className="w-4 h-4" />
            {t("live_camera_off_btn")}
          </button>
        ) : (
          <button onClick={start} className="btn-primary w-full" disabled={uploading}>
            <Play className="w-4 h-4" />
            {t("live_start_btn")}
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
                {t("live_rec_start_btn")}
              </button>
            ) : (
              <button onClick={stopRecording} className="btn-ghost w-full">
                <Square className="w-4 h-4" />
                {t("live_rec_stop_btn")}
              </button>
            )}
          </>
        )}

        {uploading && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 text-xs text-accent space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span className="font-medium">{t("live_processing")}</span>
              <span className="ml-auto font-mono">
                {Math.floor(uploadElapsed / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(uploadElapsed % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <div className="text-2xs text-text-soft leading-relaxed">
              {t("live_processing_hint")} {t("live_keep_page")}
            </div>
          </div>
        )}

        <p className="text-2xs text-text-muted leading-relaxed">💡 {t("live_recording_hint")}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 2. Phone — IP Webcam app (HTTP MJPEG/MP4 stream)
// ────────────────────────────────────────────────────
function PhoneIpWebcamView() {
  const { t } = useT();
  const [url, setUrl] = useState("http://192.168.1.5:8080/video");
  const [active, setActive] = useState(false);
  const [streamType, setStreamType] = useState<"mjpeg" | "mp4">("mjpeg");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="card p-0 overflow-hidden bg-black aspect-video relative flex items-center justify-center">
        {!active ? (
          <div className="text-text-muted text-sm">{t("live_phone_press_connect")}</div>
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
          <label className="label">{t("live_stream_type")}</label>
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
          <label className="label">{t("live_phone_url")}</label>
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
            {t("live_disconnect_btn")}
          </button>
        ) : (
          <button onClick={() => setActive(true)} className="btn-primary w-full">
            <Play className="w-4 h-4" />
            {t("live_connect_btn")}
          </button>
        )}

        <details className="text-2xs text-text-muted leading-relaxed">
          <summary className="cursor-pointer hover:text-text-soft">
            {t("live_phone_hint_title")}
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
  const { t } = useT();
  const [active, setActive] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(c: Camera) {
    setError(null);
    setBusy(true);
    try {
      await startCameraAction(c.id);
      const ticketStr = await getStreamTicketAction(c.id);
      setTicket(ticketStr);
      setActive(c.id);
    } catch {
      setError(t("live_ml_unreachable"));
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
          <div className="text-text-muted text-sm text-center px-4">
            {t("live_cctv_press_start")}
            <br />
            <span className="text-2xs text-text-faint">{t("live_cctv_hint")}</span>
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="text-2xs uppercase tracking-wide text-text-muted mb-2 flex items-center justify-between">
          {t("live_registered_cctv")}
          <a href="/cameras" className="text-2xs text-accent hover:underline normal-case">
            {t("manage_btn")}
          </a>
        </h2>

        {cameras.length === 0 && (
          <p className="text-xs text-text-muted py-4 text-center">
            {t("live_no_cameras_msg")}
            <br />
            <a href="/cameras" className="text-accent hover:underline">
              {t("live_manage_cameras_link")}
            </a>{" "}
            {t("live_add_from_page")}
          </p>
        )}

        {cameras.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 py-2 border-b border-text-muted/5 last:border-0"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{c.name}</div>
              <div className="text-[10px] text-text-muted uppercase">{c.cam_type}</div>
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

// ────────────────────────────────────────────────────
// 4. File Upload — өмнө бичсэн MP4-ийг chunked upload-аар production-д явуулна
//    (жишээ нь Dahua/RTSP-аас ffmpeg-ээр бичсэн файл, эсвэл утасны бичлэг)
// ────────────────────────────────────────────────────
function FileUploadView() {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload() {
    if (!file) return;
    setError(null);
    setSavedMsg(null);
    setUploading(true);
    setProgress(0);

    const MAX_CHUNK_BYTES = 3 * 1024 * 1024;
    const sessionId = crypto.randomUUID();
    const mime = file.type || "video/mp4";
    const total = Math.max(1, Math.ceil(file.size / MAX_CHUNK_BYTES));
    setChunksTotal(total);
    setChunksDone(0);

    try {
      for (let i = 0; i < total; i++) {
        const start = i * MAX_CHUNK_BYTES;
        const end = Math.min(start + MAX_CHUNK_BYTES, file.size);
        const blob = file.slice(start, end, mime);
        const isFinal = i === total - 1;

        const fd = new FormData();
        const ext = mime.includes("mp4")
          ? "mp4"
          : mime.includes("webm")
            ? "webm"
            : "mp4";
        fd.append("file", blob, `chunk-${i}.${ext}`);
        fd.append("session_id", sessionId);
        fd.append("chunk_index", String(i));
        fd.append("is_final", String(isFinal));
        fd.append("camera_name", file.name.replace(/\.[^.]+$/, "").slice(0, 60));

        const res = await fetch("/api/recording/upload", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const ct = res.headers.get("content-type") ?? "";
          let msg: string;
          if (ct.includes("json")) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            msg = body?.error ?? `HTTP ${res.status}`;
          } else {
            const text = await res.text().catch(() => "");
            if (
              text.includes("FUNCTION_INVOCATION_TIMEOUT") ||
              text.includes("__next_error__")
            ) {
              msg =
                res.status === 504
                  ? "ML боловсруулалт хэт удсан (Vercel function timeout)"
                  : `Server алдаа (HTTP ${res.status})`;
            } else {
              msg = `HTTP ${res.status}`;
            }
          }
          throw new Error(`Chunk ${i + 1}/${total}: ${msg}`);
        }
        setChunksDone(i + 1);
        setProgress(Math.round(((i + 1) / total) * 100));
      }

      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      setSavedMsg(
        `✓ ${file.name} (${sizeMB} MB · ${total} chunks) upload амжилттай. ` +
          `Server ML processing эхэлсэн — /playback дотроос ~30-60 сек дараа харагдана.`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload алдаа");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card p-6 space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold text-base flex items-center gap-2">
          <Upload className="w-4 h-4 text-accent" />
          {t("file_upload_title") || "MP4 / WebM upload"}
        </h3>
        <p className="text-sm text-text-soft mt-1">
          {t("file_upload_desc") ||
            "Өмнө бичсэн MP4-ийг сонгож upload хийнэ. Жишээ нь RTSP / IP камераас ffmpeg-ээр авсан файл. Chunked upload (3MB) ашиглаж Vercel 4.5MB лимитийг тойрно. Server ML processing автоматаар эхэлнэ — Cubist mosaic blur + ArcFace embedding + AES-256-GCM encryption."}
        </p>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-text-soft mb-2">
          {t("file_upload_pick") || "Файл сонгох (MP4 / WebM / MOV)"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setError(null);
            setSavedMsg(null);
          }}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md
                     file:border-0 file:bg-accent/15 file:text-accent file:font-medium
                     hover:file:bg-accent/25 file:cursor-pointer
                     disabled:opacity-50"
        />
      </label>

      {file && (
        <div className="rounded-md bg-text-muted/5 border border-border p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-text-soft">Файл:</span>
            <span className="font-mono text-xs truncate ml-2 max-w-[280px]">
              {file.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-soft">Хэмжээ:</span>
            <span className="font-mono">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-soft">Chunks:</span>
            <span className="font-mono">
              {Math.max(1, Math.ceil(file.size / (3 * 1024 * 1024)))} × 3MB
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-soft">MIME:</span>
            <span className="font-mono text-xs">{file.type || "—"}</span>
          </div>
        </div>
      )}

      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-text-soft">
            <span>
              Uploading chunk {chunksDone}/{chunksTotal}…
            </span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="h-2 bg-text-muted/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!file || uploading}
        onClick={upload}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t("file_upload_btn") || "Upload + ML process"}
          </>
        )}
      </button>

      {savedMsg && (
        <div className="rounded-md bg-success-soft border border-success/30 text-success text-sm p-3">
          {savedMsg}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-danger-soft border border-danger/30 text-danger text-sm p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="text-xs text-text-faint border-t border-border pt-3 mt-2">
        <strong>Tips:</strong> Vercel Hobby tier-ийн function timeout нь 60
        секунд. 100MB-аас том файл upload хийвэл chunked процесс илүү
        найдвартай. RTSP / IP cam-аас ffmpeg-ээр бичих нь тестлэхэд хялбар:
        <code className="block bg-text-muted/5 rounded px-2 py-1 mt-1 font-mono text-2xs">
          ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip/path -t 30 -c:v copy
          out.mp4
        </code>
      </div>
    </div>
  );
}

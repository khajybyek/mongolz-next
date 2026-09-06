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
          {t("live_mode_file")}
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
      type="button"
      onClick={() => onClick(value)}
      aria-pressed={active}
      className={cn("btn-sm", active ? "btn-secondary text-accent" : "btn-ghost text-text-soft")}
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
      setError(e instanceof Error ? e.message : t("live_recorder_unsupported"));
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
    // Uploads are chained so chunks arrive in order and the final marker is
    // always last — the ML side assembles by index and only starts
    // processing once every chunk up to the final one is present.
    let uploadQueue: Promise<void> = Promise.resolve();

    const flushChunk = (isFinal: boolean): Promise<void> => {
      const hasData = chunkBuf.length > 0;
      if (!hasData && !isFinal) return uploadQueue;
      const blob = new Blob(hasData ? chunkBuf : [], { type: mime });
      chunkBuf = [];
      chunkBytes = 0;
      // An empty final marker carries index = number of data chunks.
      const idx = chunkIndex++;
      uploadQueue = uploadQueue
        .then(() => uploadChunk(blob, mime, sessionId, idx, isFinal))
        .catch((e) => {
          setError(e instanceof Error ? e.message : t("live_chunk_upload_failed"));
        });
      return uploadQueue;
    };

    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      chunkBuf.push(e.data);
      chunkBytes += e.data.size;
      if (chunkBytes >= MAX_CHUNK_BYTES) {
        void flushChunk(false);
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
          t("live_processing_started"),
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
      throw new Error(`${t("live_chunk_too_big")} (${sizeMB.toFixed(1)}MB)`);
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
              ? t("live_ml_timeout_long")
              : `${t("live_server_error")} (HTTP ${res.status})`;
        } else {
          msg = `HTTP ${res.status}`;
        }
      }
      throw new Error(`Chunk ${chunkIndex} ${t("live_chunk_failed")}: ${msg}`);
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
              {detectorReady ? `${faceCount} ${t("faces_count_label")}` : t("loading_label")}
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
            className="select"
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
                className="btn-danger w-full"
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
            className="select"
          >
            <option value="mjpeg">{t("live_opt_mjpeg")}</option>
            <option value="mp4">{t("live_opt_mp4")}</option>
          </select>
        </div>

        <div>
          <label className="label">{t("live_phone_url")}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={active}
            placeholder="http://192.168.x.y:8080/video"
            className="input"
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
              <strong>Android:</strong> {t("live_hint_android")}
            </li>
            <li>
              <strong>iPhone:</strong> {t("live_hint_iphone")}
            </li>
            <li>{t("live_hint_same_wifi")}</li>
            <li>{t("live_hint_exact_url")}</li>
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
        <h3 className="section-title mb-2 flex items-center justify-between">
          {t("live_registered_cctv")}
          <a href="/cameras" className="link text-2xs normal-case">
            {t("manage_btn")}
          </a>
        </h3>

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
                type="button"
                onClick={() => stop(c)}
                disabled={busy}
                className="btn-icon text-danger"
                aria-label={t("stop")}
                title={t("stop")}
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(c)}
                disabled={busy}
                className="btn-icon text-accent"
                aria-label={t("start")}
                title={t("start")}
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
                  ? t("live_ml_timeout")
                  : `${t("live_server_error")} (HTTP ${res.status})`;
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
        `✓ ${file.name} (${sizeMB} MB · ${total} chunks) — ${t("live_upload_done")} ${t("live_upload_done_hint")}`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : t("live_upload_failed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card p-6 space-y-4 max-w-2xl">
      <div>
        <h3 className="section-title flex items-center gap-2">
          <Upload className="w-4 h-4 text-accent" />
          {t("file_upload_title")}
        </h3>
        <p className="text-sm text-text-soft mt-1">
          {t("file_upload_desc")}
        </p>
      </div>

      <label className="block">
        <span className="label">
          {t("file_upload_pick")}
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
          className="input file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-accent/15 file:text-accent file:font-medium hover:file:bg-accent/25 file:cursor-pointer"
        />
      </label>

      {file && (
        <div className="rounded-md bg-text-muted/5 border border-border p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-text-soft">{t("live_file_label")}:</span>
            <span className="font-mono text-xs truncate ml-2 max-w-[280px]">
              {file.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-soft">{t("live_size_label")}:</span>
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
              {t("live_uploading_chunk")} {chunksDone}/{chunksTotal}…
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
        className="btn-primary w-full"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("live_uploading")}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t("file_upload_btn")}
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
        <strong>{t("live_tips_label")}</strong> {t("live_tips_text")}
        <code className="block bg-text-muted/5 rounded px-2 py-1 mt-1 font-mono text-2xs">
          ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip/path -t 30 -c:v copy
          out.mp4
        </code>
      </div>
    </div>
  );
}

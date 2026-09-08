"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Cctv,
  ImageOff,
  Loader2,
  LogOut,
  Maximize2,
  Minimize2,
  Play,
  Power,
  Square,
} from "lucide-react";
import { FaceThumb } from "@/components/face-thumb";
import { HlsPlayer } from "@/components/hls-player";
import { useT } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import {
  getStreamTicketAction,
  startCameraAction,
  stopCameraAction,
} from "@/app/(app)/live/actions";

type WallCamera = {
  camera_id: string;
  name: string;
  enabled: boolean;
  status: "healthy" | "stale" | "offline" | "unknown";
  last_seen: string | null;
  faces_24h: number;
  faces_1h: number;
  latest_face_id: string | null;
};

type Mode = "status" | "live";

/** Health enum → translation key (the badge is shown to every operator). */
const STATUS_LABEL = {
  healthy: "cam_status_healthy",
  stale: "cam_status_stale",
  offline: "cam_status_offline",
  unknown: "cam_status_unknown",
} as const;

const REFRESH_MS = 10_000;
const MODE_KEY = "mongolz-wall-mode";

function streamUrlFor(id: string, ticket: string): string {
  return `/api/ml/stream/${encodeURIComponent(id)}/index.m3u8?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Control-room wall. "Status" mode shows health + the latest face crop per
 * camera (the original wall); "Live video" mode attaches HLS players to every
 * camera the ML service is currently streaming. The page re-renders every
 * 10 s from the server, which refreshes health rollups and the active list.
 *
 * Viewers get the same tiles (status, last seen, face counts, running
 * streams) read-only; starting / stopping a camera stays admin-only.
 */
export function WallView({
  cameras,
  isAdmin,
  activeIds,
  mlReachable,
}: {
  cameras: WallCamera[];
  isAdmin: boolean;
  activeIds: string[];
  mlReachable: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [isFull, setIsFull] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("status");
  const [streams, setStreams] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const streamsRef = useRef(streams);
  streamsRef.current = streams;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODE_KEY);
      if (raw === "live" || raw === "status") setMode(raw);
    } catch {
      /* ignore */
    }
  }, []);

  function chooseMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // Auto-refresh server data — fresh thumbnails, health rollups, active ids.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    function onFsChange() {
      setIsFull(!!document.fullscreenElement);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFocused(null);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const attach = useCallback(async (id: string) => {
    const ticket = await getStreamTicketAction(id);
    setStreams((prev) => new Map(prev).set(id, streamUrlFor(id, ticket)));
  }, []);

  // Keep the stream map aligned with what the ML service reports as active.
  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    const wanted = new Set(activeIds);
    (async () => {
      for (const id of wanted) {
        if (cancelled) return;
        if (!streamsRef.current.has(id)) {
          try {
            await attach(id);
          } catch {
            /* ticket failure — tile shows "not streaming" */
          }
        }
      }
      setStreams((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const id of prev.keys()) {
          if (!wanted.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeIds, attach, mode]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen?.();
    } catch {
      /* unsupported */
    }
  }

  async function startCam(id: string) {
    if (!isAdmin) return; // defence in depth — the server action rejects non-admins too
    setBusy((prev) => new Set(prev).add(id));
    try {
      // A refusal (disabled camera, unreadable URL, ML down) comes back in the
      // result, not as a throw — attaching anyway would fake a live tile.
      const res = await startCameraAction(id);
      if (res.ok) await attach(id);
    } catch {
      /* the tile keeps its "not streaming" state */
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    }
  }

  async function stopCam(id: string) {
    if (!isAdmin) return; // defence in depth — the server action rejects non-admins too
    setBusy((prev) => new Set(prev).add(id));
    try {
      await stopCameraAction(id);
    } catch {
      /* ignore */
    } finally {
      setStreams((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    }
  }

  if (cameras.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 text-text-muted">
        <Power className="w-16 h-16" />
        <div className="text-lg">{t("wall_no_cameras")}</div>
      </div>
    );
  }

  // Grid sizing — 1, 2, 4, 9, 16 layouts based on camera count.
  const n = cameras.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const display = focused ? cameras.filter((c) => c.camera_id === focused) : cameras;
  const liveCount = activeIds.length;

  return (
    <div ref={rootRef} className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-surface/40 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Cctv className="w-5 h-5 text-accent shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight">{t("wall_title")}</div>
            <div className="text-[10px] text-text-muted truncate">
              {n} {t("wall_cameras")} · {liveCount} {t("grid_streaming")} · auto-refresh 10s
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div
            role="group"
            aria-label={t("wall_mode_live")}
            className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/60 p-0.5"
          >
            {(["status", "live"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => chooseMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "h-8 px-2.5 rounded-md font-medium transition",
                  mode === m ? "bg-accent/15 text-accent" : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
                )}
              >
                {m === "live" ? t("wall_mode_live") : t("wall_mode_status")}
              </button>
            ))}
          </div>
          <a href="/dashboard" className="btn-ghost btn-sm hidden sm:inline-flex">
            ← {t("wall_back")}
          </a>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="btn-icon"
            aria-label={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
            title={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
          >
            {isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <form action="/auth/logout" method="post">
            <button type="submit" className="btn-icon" aria-label={t("logout")} title={t("logout")}>
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </header>

      {mode === "live" && !mlReachable && (
        <div className="px-4 py-2 text-xs text-warning bg-warning-soft border-b border-warning/30">{t("grid_ml_down")}</div>
      )}

      <main
        className="flex-1 grid gap-1 p-1"
        style={focused ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {display.map((c) => (
          <CameraTile
            key={c.camera_id}
            cam={c}
            focused={focused === c.camera_id}
            mode={mode}
            streamUrl={streams.get(c.camera_id)}
            isActive={activeIds.includes(c.camera_id)}
            busy={busy.has(c.camera_id)}
            canControl={isAdmin && mlReachable}
            onToggleFocus={() => setFocused((cur) => (cur === c.camera_id ? null : c.camera_id))}
            onStart={() => startCam(c.camera_id)}
            onStop={() => stopCam(c.camera_id)}
          />
        ))}
      </main>
    </div>
  );
}

function CameraTile({
  cam,
  focused,
  mode,
  streamUrl,
  isActive,
  busy,
  canControl,
  onToggleFocus,
  onStart,
  onStop,
}: {
  cam: WallCamera;
  focused: boolean;
  mode: Mode;
  streamUrl: string | undefined;
  isActive: boolean;
  busy: boolean;
  /** Admin with the ML service reachable — the only case that renders start / stop. */
  canControl: boolean;
  onToggleFocus: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useT();
  const statusColor =
    cam.status === "healthy"
      ? "bg-success animate-pulse"
      : cam.status === "stale"
        ? "bg-warning"
        : cam.status === "offline"
          ? "bg-danger"
          : "bg-text-muted";
  const statusTone =
    cam.status === "healthy"
      ? "text-success"
      : cam.status === "stale"
        ? "text-warning"
        : cam.status === "offline"
          ? "text-danger"
          : "text-text-muted";

  const showVideo = mode === "live" && Boolean(streamUrl);

  return (
    <div
      className={cn(
        "relative bg-black rounded overflow-hidden group border transition",
        showVideo ? "border-danger/40" : "border-border hover:border-accent/40",
        focused && "min-h-[calc(100vh-100px)]",
      )}
    >
      {showVideo ? (
        <HlsPlayer src={streamUrl!} controls={false} className="absolute inset-0 w-full h-full object-contain bg-black" />
      ) : mode === "live" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-faint">
          <Cctv className="w-10 h-10 opacity-40" />
          <span className="text-xs">{isActive ? t("grid_starting") : t("wall_not_streaming")}</span>
        </div>
      ) : cam.latest_face_id ? (
        <FaceThumb faceId={cam.latest_face_id} alt={cam.name} className="absolute inset-0 opacity-90" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-text-faint">
          <ImageOff className="w-12 h-12 opacity-40" />
        </div>
      )}

      {/* Click-to-focus layer (under the overlays) */}
      <button
        type="button"
        onClick={onToggleFocus}
        className="absolute inset-0 z-[1] w-full h-full cursor-pointer focus-visible:outline-none"
        aria-label={cam.name}
      />

      {/* Top-left: camera name + status dot */}
      <div className="absolute top-2 left-2 z-[2] flex items-center gap-2 bg-bg/70 backdrop-blur rounded px-2 py-1 text-xs pointer-events-none">
        <span className={"w-2 h-2 rounded-full " + statusColor} />
        <span className="font-semibold truncate max-w-[200px]">{cam.name}</span>
      </div>

      {/* Top-right: LIVE badge or status text */}
      <div className="absolute top-2 right-2 z-[2] pointer-events-none">
        {showVideo ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-danger text-white text-[10px] font-bold tracking-wider px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />
            {t("grid_live")}
          </span>
        ) : (
          <span
            className="bg-bg/70 backdrop-blur rounded px-2 py-1 text-[10px] uppercase tracking-wider"
            // The status now means liveness (frames arriving), while the strip
            // below reports detections — two different facts that both used to
            // read "Unknown".
            title={`${t("cam_health_liveness")}: ${t(STATUS_LABEL[cam.status])}`}
          >
            <span className={statusTone}>{t(STATUS_LABEL[cam.status])}</span>
          </span>
        )}
      </div>

      {/* Bottom strip: last seen + face counts for every operator; start /
          stop only when canControl (admin + ML reachable). */}
      <div className="absolute bottom-0 inset-x-0 z-[2] flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white/90 px-2 py-1.5">
        <span className="truncate pointer-events-none">
          {cam.last_seen ? `${t("wall_last")}: ${formatDate(cam.last_seen)}` : t("wall_no_detection")}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="font-mono pointer-events-none">
            {cam.faces_1h} / 1h · {cam.faces_24h} / 24h
          </span>
          {mode === "live" && canControl && (
            isActive || streamUrl ? (
              <button
                type="button"
                onClick={onStop}
                disabled={busy}
                className="btn-icon w-7 h-7 min-w-0 bg-bg/70 text-danger hover:bg-danger/20"
                aria-label={`${t("grid_stop")}: ${cam.name}`}
                title={t("grid_stop")}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                disabled={busy}
                className="btn-icon w-7 h-7 min-w-0 bg-bg/70 text-accent hover:bg-accent/20"
                aria-label={`${t("grid_play")}: ${cam.name}`}
                title={t("grid_play")}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              </button>
            )
          )}
        </span>
      </div>
    </div>
  );
}

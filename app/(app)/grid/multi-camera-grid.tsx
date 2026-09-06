"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Cctv,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Scan,
  Square,
  X,
} from "lucide-react";
import { HlsPlayer } from "@/components/hls-player";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import {
  getActiveCamerasAction,
  getStreamTicketAction,
  startCameraAction,
  stopCameraAction,
} from "../live/actions";

export interface GridCamera {
  id: string;
  name: string;
  cam_type: string;
  status: "healthy" | "stale" | "offline" | "unknown";
  last_seen: string | null;
  faces_1h: number;
}

type Tiles = 1 | 4 | 9 | 16;
type Layout = "auto" | Tiles;

const LAYOUT_KEY = "mongolz-grid-layout";
const POLL_MS = 15_000;

function autoTiles(n: number): Tiles {
  if (n <= 1) return 1;
  if (n <= 4) return 4;
  if (n <= 9) return 9;
  return 16;
}

function streamUrlFor(id: string, ticket: string): string {
  return `/api/ml/stream/${encodeURIComponent(id)}/index.m3u8?ticket=${encodeURIComponent(ticket)}`;
}

const STATUS_DOT: Record<GridCamera["status"], string> = {
  healthy: "bg-success",
  stale: "bg-warning",
  offline: "bg-danger",
  unknown: "bg-text-muted",
};

/**
 * NVR-style multi-camera live view. Streams are HLS playlists proxied through
 * /api/ml/stream (per-camera authz + ticket). Starting a camera asks the ML
 * service to capture it, which also records + detects faces — the note under
 * the toolbar says so. The grid polls the ML service so streams started from
 * another tab / the wall show up, and streams stopped elsewhere disappear.
 */
export function MultiCameraGrid({
  cameras,
  initialActive,
  mlReachable,
  initialFocus = null,
}: {
  cameras: GridCamera[];
  initialActive: string[];
  mlReachable: boolean;
  /** Camera id from `?focus=` — focused on mount (starting stays an explicit click). */
  initialFocus?: string | null;
}) {
  const { t } = useT();
  const { toast } = useToast();

  const [layout, setLayout] = useState<Layout>("auto");
  const [page, setPage] = useState(0);
  const [streams, setStreams] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Map<string, "start" | "stop">>(new Map());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [reachable, setReachable] = useState(mlReachable);
  const [bulk, setBulk] = useState<"start" | "stop" | null>(null);
  // Phones cap the grid at two columns so tiles stay legible; 3×3 / 4×4
  // layouts simply wrap into more rows there.
  const [narrow, setNarrow] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  // Remember the operator's preferred layout.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw === "auto") setLayout("auto");
      else if (raw && ["1", "4", "9", "16"].includes(raw)) setLayout(Number(raw) as Tiles);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function chooseLayout(next: Layout) {
    setLayout(next);
    setPage(0);
    try {
      localStorage.setItem(LAYOUT_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  const tiles: Tiles = layout === "auto" ? autoTiles(cameras.length) : layout;
  const cols = narrow ? Math.min(2, Math.sqrt(tiles)) : Math.sqrt(tiles);
  const pageCount = Math.max(1, Math.ceil(cameras.length / tiles));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => cameras.slice(safePage * tiles, safePage * tiles + tiles),
    [cameras, safePage, tiles],
  );

  const attach = useCallback(async (id: string) => {
    const ticket = await getStreamTicketAction(id);
    setStreams((prev) => new Map(prev).set(id, streamUrlFor(id, ticket)));
    setFailed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const detach = useCallback((id: string) => {
    setStreams((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setPlaying((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Attach to streams that are already running and keep in sync with the ML
  // service (streams started / stopped from the wall or another tab).
  useEffect(() => {
    let cancelled = false;
    const known = new Set(cameras.map((c) => c.id));

    async function sync(ids: string[], ok: boolean) {
      if (cancelled) return;
      setReachable(ok);
      if (!ok) return;
      const wanted = new Set(ids.filter((id) => known.has(id)));
      for (const id of wanted) {
        if (!streamsRef.current.has(id)) {
          try {
            await attach(id);
          } catch {
            /* ticket failure — tile stays idle */
          }
        }
      }
      for (const id of streamsRef.current.keys()) {
        if (!wanted.has(id) && !busyRef.current.has(id)) detach(id);
      }
    }

    void sync(initialActive, mlReachable);
    const timer = window.setInterval(async () => {
      try {
        const r = await getActiveCamerasAction();
        await sync(r.ids, r.reachable);
      } catch {
        /* transient — try again next tick */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attach, detach, cameras, initialActive, mlReachable]);

  const start = useCallback(
    async (cam: GridCamera) => {
      if (streamsRef.current.has(cam.id) || busyRef.current.has(cam.id)) return;
      setBusy((prev) => new Map(prev).set(cam.id, "start"));
      try {
        await startCameraAction(cam.id);
        await attach(cam.id);
        setReachable(true);
        toast({ title: t("grid_started"), description: cam.name, tone: "success", duration: 2000 });
      } catch {
        setFailed((prev) => new Set(prev).add(cam.id));
        toast({ title: t("grid_start_failed"), description: cam.name, tone: "danger" });
      } finally {
        setBusy((prev) => {
          const next = new Map(prev);
          next.delete(cam.id);
          return next;
        });
      }
    },
    [attach, t, toast],
  );

  const stop = useCallback(
    async (cam: GridCamera) => {
      if (busyRef.current.has(cam.id)) return;
      setBusy((prev) => new Map(prev).set(cam.id, "stop"));
      try {
        await stopCameraAction(cam.id);
        toast({ title: t("grid_stopped"), description: cam.name, tone: "info", duration: 2000 });
      } catch {
        toast({ title: t("toast_failed"), description: cam.name, tone: "danger" });
      } finally {
        detach(cam.id);
        setBusy((prev) => {
          const next = new Map(prev);
          next.delete(cam.id);
          return next;
        });
      }
    },
    [detach, t, toast],
  );

  // Leaving focus lands on the page that holds that camera, so a deep-linked
  // tile on page 3 does not vanish behind page 1 when the operator backs out.
  const leaveFocus = useCallback(() => {
    const cur = focusedRef.current;
    if (cur) {
      const idx = cameras.findIndex((c) => c.id === cur);
      if (idx >= 0) setPage(Math.floor(idx / tiles));
    }
    setFocused(null);
  }, [cameras, tiles]);
  const leaveFocusRef = useRef(leaveFocus);
  leaveFocusRef.current = leaveFocus;

  // `?focus=` deep link: focus the tile on mount and start it once if it is
  // idle. The ref guards the double effect run (strict mode) and re-renders,
  // so the ML service is never asked to start the same capture twice.
  const autoFocusRef = useRef(false);
  useEffect(() => {
    if (!initialFocus || autoFocusRef.current) return;
    const cam = cameras.find((c) => c.id === initialFocus);
    if (!cam) return;
    autoFocusRef.current = true;
    setFocused(cam.id);
  }, [initialFocus, cameras]);

  async function startAll() {
    setBulk("start");
    for (const cam of visible) {
      if (!streamsRef.current.has(cam.id)) await start(cam);
    }
    setBulk(null);
  }

  async function stopAll() {
    setBulk("stop");
    for (const cam of cameras) {
      if (streamsRef.current.has(cam.id)) await stop(cam);
    }
    setBulk(null);
  }

  // Fullscreen + Esc handling.
  useEffect(() => {
    function onFs() {
      setIsFull(Boolean(document.fullscreenElement));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") leaveFocusRef.current();
    }
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen?.();
    } catch {
      /* unsupported */
    }
  }

  const focusedCam = focused ? cameras.find((c) => c.id === focused) ?? null : null;
  const fill = isFull || Boolean(focusedCam);
  const streamingCount = streams.size;

  const layoutOptions: Array<{ value: Layout; label: string }> = [
    { value: "auto", label: t("grid_auto") },
    { value: 1, label: "1" },
    { value: 4, label: "2×2" },
    { value: 9, label: "3×3" },
    { value: 16, label: "4×4" },
  ];

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-3", isFull && "bg-bg p-3 h-screen")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("grid_layout")}
          className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/60 p-0.5 text-xs"
        >
          {layoutOptions.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => chooseLayout(o.value)}
              aria-pressed={layout === o.value}
              className={cn(
                "h-8 min-w-[40px] px-2.5 rounded-md font-medium transition",
                layout === o.value
                  ? "bg-accent/15 text-accent"
                  : "text-text-soft hover:bg-text-muted/[0.06] hover:text-text",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {pageCount > 1 && (
          <div className="inline-flex items-center gap-1 text-xs text-text-soft">
            <button
              type="button"
              className="btn-icon"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label={t("grid_prev")}
              title={t("grid_prev")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="tabular-nums px-1">
              {t("grid_page")} {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn-icon"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              aria-label={t("grid_next")}
              title={t("grid_next")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-muted tabular-nums">
          <span
            className={cn("w-1.5 h-1.5 rounded-full", streamingCount > 0 ? "bg-danger animate-pulse" : "bg-text-faint")}
            aria-hidden
          />
          {streamingCount} / {cameras.length} {t("grid_streaming")}
        </span>

        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={startAll}
          disabled={!reachable || bulk !== null || visible.every((c) => streams.has(c.id))}
        >
          {bulk === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {t("grid_start_all")}
        </button>
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={stopAll}
          disabled={bulk !== null || streamingCount === 0}
        >
          {bulk === "stop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
          {t("grid_stop_all")}
        </button>
        <button
          type="button"
          className="btn-icon"
          onClick={toggleFullscreen}
          aria-label={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
          title={isFull ? t("wall_exit_fs") : t("wall_enter_fs")}
        >
          {isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {!reachable ? (
        <Alert variant="warning">{t("grid_ml_down")}</Alert>
      ) : (
        !isFull && <p className="helper mt-0">{t("grid_recording_note")}</p>
      )}

      {/* Focused single view */}
      {focusedCam ? (
        <div className={cn("flex flex-col gap-2", fill && "flex-1 min-h-0")}>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={leaveFocus}>
              <X className="w-3.5 h-3.5" />
              {t("grid_back_grid")}
            </button>
          </div>
          <div className={cn(isFull ? "flex-1 min-h-0" : "h-[60vh] min-h-[320px]")}>
            <GridTile
              cam={focusedCam}
              streamUrl={streams.get(focusedCam.id)}
              busy={busy.get(focusedCam.id) ?? null}
              failed={failed.has(focusedCam.id)}
              playing={playing.has(focusedCam.id)}
              fill
              focused
              onStart={() => start(focusedCam)}
              onStop={() => stop(focusedCam)}
              onFocus={leaveFocus}
              onPlaying={() => setPlaying((p) => new Set(p).add(focusedCam.id))}
              onError={() => setFailed((p) => new Set(p).add(focusedCam.id))}
              onRetry={() => void attach(focusedCam.id)}
              reachable={reachable}
            />
          </div>
        </div>
      ) : (
        <div
          className={cn("grid gap-2", fill && "flex-1 min-h-0 auto-rows-fr")}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {visible.map((cam) => (
            <GridTile
              key={cam.id}
              cam={cam}
              streamUrl={streams.get(cam.id)}
              busy={busy.get(cam.id) ?? null}
              failed={failed.has(cam.id)}
              playing={playing.has(cam.id)}
              fill={fill}
              focused={false}
              onStart={() => start(cam)}
              onStop={() => stop(cam)}
              onFocus={() => setFocused(cam.id)}
              onPlaying={() => setPlaying((p) => new Set(p).add(cam.id))}
              onError={() => setFailed((p) => new Set(p).add(cam.id))}
              onRetry={() => void attach(cam.id)}
              reachable={reachable}
            />
          ))}
          {/* Keep the grid shape when the last page is short */}
          {Array.from({ length: Math.max(0, tiles - visible.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className={cn(
                "rounded-xl border border-dashed border-border/60 bg-surface/30",
                fill ? "h-full" : "aspect-video",
              )}
              aria-hidden
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GridTile({
  cam,
  streamUrl,
  busy,
  failed,
  playing,
  fill,
  focused,
  onStart,
  onStop,
  onFocus,
  onPlaying,
  onError,
  onRetry,
  reachable,
}: {
  cam: GridCamera;
  streamUrl: string | undefined;
  busy: "start" | "stop" | null;
  failed: boolean;
  playing: boolean;
  fill: boolean;
  focused: boolean;
  onStart: () => void;
  onStop: () => void;
  onFocus: () => void;
  onPlaying: () => void;
  onError: () => void;
  onRetry: () => void;
  reachable: boolean;
}) {
  const { t } = useT();
  const live = Boolean(streamUrl) && playing && !failed;
  const loading = busy !== null || (Boolean(streamUrl) && !playing && !failed);

  return (
    <div
      className={cn(
        "group relative bg-black rounded-xl overflow-hidden border transition-colors",
        live ? "border-danger/40" : "border-border hover:border-border-strong",
        fill ? "h-full min-h-[160px]" : "aspect-video",
      )}
    >
      {streamUrl && !failed ? (
        <HlsPlayer
          src={streamUrl}
          controls={false}
          className="absolute inset-0 w-full h-full object-contain bg-black"
          onPlaying={onPlaying}
          onError={onError}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-faint">
          <Cctv className="w-8 h-8 opacity-40" />
          <span className="text-xs">{failed ? t("grid_stream_failed") : t("grid_idle")}</span>
        </div>
      )}

      {/* Click-to-focus layer (below the controls) */}
      <button
        type="button"
        onClick={onFocus}
        className="absolute inset-0 z-[1] w-full h-full cursor-zoom-in focus-visible:outline-none"
        aria-label={focused ? t("grid_back_grid") : `${t("grid_focus")}: ${cam.name}`}
      />

      {loading && (
        <div className="absolute inset-0 z-[2] flex items-center justify-center bg-black/40 pointer-events-none">
          <span className="inline-flex items-center gap-2 text-xs text-white/90 bg-bg/70 rounded-lg px-3 py-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {busy === "stop" ? t("grid_stopping") : t("grid_starting")}
          </span>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-black/60">
          <AlertTriangle className="w-6 h-6 text-warning" />
          <span className="text-xs text-white/90">{t("grid_stream_failed")}</span>
          <button type="button" onClick={onRetry} className="btn-secondary btn-sm relative z-[4]">
            <RefreshCw className="w-3.5 h-3.5" />
            {t("grid_retry")}
          </button>
        </div>
      )}

      {/* Top-left: status + name */}
      <div className="absolute top-2 left-2 z-[3] flex items-center gap-2 bg-bg/70 backdrop-blur rounded-md px-2 py-1 text-xs pointer-events-none max-w-[70%]">
        <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[cam.status], cam.status === "healthy" && "animate-pulse")} />
        <span className="font-semibold truncate text-text">{cam.name}</span>
      </div>

      {/* Top-right: LIVE / type */}
      <div className="absolute top-2 right-2 z-[3] pointer-events-none">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-danger text-white text-[10px] font-bold tracking-wider px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />
            {t("grid_live")}
          </span>
        ) : (
          <span className="rounded-md bg-bg/70 backdrop-blur text-[10px] font-mono uppercase text-text-soft px-2 py-1">
            {cam.cam_type}
          </span>
        )}
      </div>

      {/* Bottom bar: meta + controls */}
      <div className="absolute bottom-0 inset-x-0 z-[3] flex items-center justify-between gap-2 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white/85">
        <span className="truncate pointer-events-none">
          {cam.last_seen ? `${t("wall_last")}: ${formatDate(cam.last_seen)}` : t("cam_status_unknown")}
          {" · "}
          <span className="font-mono">{cam.faces_1h}/1h</span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {streamUrl ? (
            <button
              type="button"
              onClick={onStop}
              disabled={busy !== null}
              className="btn-icon w-8 h-8 min-w-0 bg-bg/70 text-danger hover:bg-danger/20"
              aria-label={`${t("grid_stop")}: ${cam.name}`}
              title={t("grid_stop")}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={busy !== null || !reachable}
              className="btn-icon w-8 h-8 min-w-0 bg-bg/70 text-accent hover:bg-accent/20"
              aria-label={`${t("grid_play")}: ${cam.name}`}
              title={t("grid_play")}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {!focused && (
            <button
              type="button"
              onClick={onFocus}
              className="btn-icon w-8 h-8 min-w-0 bg-bg/70 text-text-soft hover:text-text"
              aria-label={`${t("grid_focus")}: ${cam.name}`}
              title={t("grid_focus")}
            >
              <Scan className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

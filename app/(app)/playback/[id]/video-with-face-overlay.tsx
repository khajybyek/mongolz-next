"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Eye, MousePointerClick, Check, Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export interface FaceBox {
  id: string;
  /** UI-д харуулах sequential дугаар (1..N) — playback болон reveal modal-д ижил */
  display_no: number;
  filename: string;
  time_in_video_sec: number;       // recording start-аас хойш секунд
  bbox: { x: number; y: number; w: number; h: number } | null; // 0-1 ratios
}

const VISIBLE_WINDOW_SEC = 1.5;   // ±1.5s within currentTime

/**
 * Blurred бичлэгийг тоглуулна. `currentTime` болон `detected_at` хооронд
 * тохирох faces-уудыг overlay-р харуулна.
 *
 *   • single-mode: box click → `onFaceClick(face)` (шууд reveal modal)
 *   • select-mode: box click → toggle сонголт; "Reveal сонгосон" товч идэвхжинэ
 */
export function VideoWithFaceOverlay({
  src,
  faces,
  selectMode,
  selectedIds,
  onFaceClick,
  onToggleSelect,
  videoElementRef,
  onTimeChange,
}: {
  src: string;
  faces: FaceBox[];
  /** Multi-select горим идэвхтэй эсэх */
  selectMode: boolean;
  /** Сонгогдсон face id-ийн set (select-mode-д л харгалзана) */
  selectedIds: Set<string>;
  /** single-mode-д face дээр click → шууд reveal */
  onFaceClick: (face: FaceBox) => void;
  /** select-mode-д face дээр click → toggle */
  onToggleSelect: (face: FaceBox) => void;
  /** Optional shared ref so a parent (e.g. FaceTimeline owner) can call .currentTime = X */
  videoElementRef?: MutableRefObject<HTMLVideoElement | null>;
  /** Notifies the parent when currentTime / duration change. */
  onTimeChange?: (currentTime: number, duration: number) => void;
}) {
  const { t } = useT();
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = videoElementRef ?? internalRef;
  const [currentTime, setCurrentTime] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Load status — surfaces the on_demand cold-render wait + failures instead
  // of a silent black box. For blur_strategy='on_demand' the src is
  // /api/recordings/[id]/view, which on the first hit decrypts + renders the
  // blurred view (5–30s) and on error returns a non-media JSON body. Without
  // this, the <video> would just sit black with no feedback.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Bumping this re-mounts the <video> with a cache-busting query so "Retry"
  // re-requests the view (served instantly from the ML cache once it renders).
  const [reloadNonce, setReloadNonce] = useState(0);
  const effectiveSrc =
    reloadNonce > 0
      ? `${src}${src.includes("?") ? "&" : "?"}retry=${reloadNonce}`
      : src;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      onTimeChange?.(v.currentTime, isFinite(v.duration) ? v.duration : 0);
    };
    const onMeta = () =>
      onTimeChange?.(v.currentTime, isFinite(v.duration) ? v.duration : 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
    // `effectiveSrc` is a dep because the <video> is keyed on it (key={effectiveSrc})
    // — a Retry remounts the element to a NEW DOM node, so the listeners must
    // rebind or the timeline/overlay would silently stop updating after Retry.
  }, [videoRef, onTimeChange, effectiveSrc]);

  // Reset to loading whenever the source (or retry nonce) changes.
  useEffect(() => {
    setStatus("loading");
  }, [effectiveSrc]);

  const visible = faces.filter(
    (f) =>
      f.bbox &&
      Math.abs(f.time_in_video_sec - currentTime) <= VISIBLE_WINDOW_SEC
  );

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden group">
      <video
        key={effectiveSrc}
        ref={videoRef}
        src={effectiveSrc}
        controls
        playsInline
        className="absolute inset-0 w-full h-full object-contain"
        onLoadStart={() => setStatus("loading")}
        onLoadedData={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />

      {/* Loading overlay — covers the cold-render wait for on_demand views.
          Disappears on first frame (onLoadedData). Harmless brief flash for
          fast (baked / cached) loads. */}
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/40 backdrop-blur-sm pointer-events-none">
          <Loader2 className="w-7 h-7 text-accent animate-spin" />
          <p className="text-xs text-text-soft">{t("pb_preparing")}</p>
        </div>
      )}

      {/* Error overlay — on_demand render failed / ML down / no original.
          Without this the user would see a silent black box. */}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
          <AlertTriangle className="w-8 h-8 text-warning" />
          <div className="text-center px-4">
            <p className="text-sm font-medium text-text">{t("pb_play_failed")}</p>
            <p className="text-xs text-text-muted mt-1">
              {t("pb_play_failed_desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="btn-secondary btn-sm"
          >
            <RotateCw className="w-3.5 h-3.5" />
            {t("ui_retry")}
          </button>
        </div>
      )}

      {/* Overlay layer — pointer-events: none гэхдээ box-уудад өгнө */}
      <div className="absolute inset-0 pointer-events-none">
        {visible.map((f) => {
          if (!f.bbox) return null;
          // Хүрээг бага зэрэг томруулъя — click-ийг хялбар болгох
          const pad = 0.02;
          const left = Math.max(0, f.bbox.x - pad) * 100;
          const top = Math.max(0, f.bbox.y - pad) * 100;
          const width = Math.min(1, f.bbox.w + 2 * pad) * 100;
          const height = Math.min(1, f.bbox.h + 2 * pad) * 100;

          const dist = Math.abs(f.time_in_video_sec - currentTime);
          const opacity = Math.max(0.3, 1 - dist / VISIBLE_WINDOW_SEC);
          const isHovered = hoveredId === f.id;
          const isSelected = selectedIds.has(f.id);

          return (
            <button
              key={f.id}
              type="button"
              onClick={() => (selectMode ? onToggleSelect(f) : onFaceClick(f))}
              onMouseEnter={() => setHoveredId(f.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "absolute pointer-events-auto rounded-md transition-all",
                "border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]",
                isSelected
                  ? "border-success bg-success/15 hover:border-success"
                  : "border-accent/80 hover:border-accent hover:shadow-[0_0_0_2px_#00d4ff80]",
                isHovered && "scale-105"
              )}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                opacity,
              }}
              title={
                selectMode
                  ? isSelected
                    ? `#${f.display_no} — ${t("pb_deselect")}`
                    : `#${f.display_no} — ${t("pb_select")}`
                  : `#${f.display_no} — ${t("pb_reveal_this_face")}`
              }
            >
              {/* Дугаар (зүүн дээд буланд) */}
              <span
                className={cn(
                  "absolute -top-2 -left-2 min-w-[20px] h-5 px-1 rounded-md",
                  "text-[10px] font-bold leading-5 text-center",
                  isSelected
                    ? "bg-success text-bg"
                    : "bg-accent text-bg"
                )}
              >
                #{f.display_no}
              </span>

              {/* Songogdson icon */}
              {isSelected && (
                <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-success flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-bg" strokeWidth={3} />
                </span>
              )}

              {/* Tooltip / label */}
              <span
                className={cn(
                  "absolute -bottom-7 left-0 text-[10px] font-medium px-1.5 py-0.5 rounded",
                  "bg-accent text-bg whitespace-nowrap",
                  "transition-opacity",
                  isHovered ? "opacity-100" : "opacity-0"
                )}
              >
                <Eye className="w-3 h-3 inline mr-0.5" />
                {selectMode
                  ? isSelected
                    ? t("pb_deselect")
                    : t("pb_select")
                  : t("pb_reveal_btn")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hint banner (face нэг ч байхгүй үед нуухгүй — зөвхөн зааварчилгаа) */}
      {faces.length > 0 && (
        <div
          className={cn(
            "absolute top-3 right-3 px-2.5 py-1.5 rounded-md bg-black/60 backdrop-blur",
            "text-[11px] text-text-soft flex items-center gap-1.5",
            "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          )}
        >
          <MousePointerClick className="w-3.5 h-3.5 text-accent" />
          {selectMode
            ? t("pb_select_many_title")
            : t("pb_click_face_hint")}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, MousePointerClick, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FaceBox {
  id: string;
  /** UI-д харуулах sequential дугаар (1..N) — playback болон reveal modal-д ижил */
  display_no: number;
  filename: string;
  signed: string | null;          // crop preview URL
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
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
    };
  }, []);

  const visible = faces.filter(
    (f) =>
      f.bbox &&
      Math.abs(f.time_in_video_sec - currentTime) <= VISIBLE_WINDOW_SEC
  );

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden group">
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="absolute inset-0 w-full h-full object-contain"
      />

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
                    ? `#${f.display_no} — сонголтоос хасах`
                    : `#${f.display_no} — сонгох`
                  : `#${f.display_no} — энэ хүнийг reveal хийх`
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
                    ? "Хасах"
                    : "Сонгох"
                  : "Reveal"}
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
            ? "Олон нүүр сонгож reveal хийх"
            : "Нүүр дээр click → reveal"}
        </div>
      )}
    </div>
  );
}

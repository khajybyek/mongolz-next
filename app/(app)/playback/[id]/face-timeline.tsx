"use client";

import { useMemo, useRef } from "react";
import { Eye, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { FaceThumb } from "@/components/face-thumb";

export interface TimelineFace {
  id: string;
  display_no: number;
  filename: string;
  time_in_video_sec: number | null;
}

interface Props {
  /** Recording duration in seconds. Falls back to max face time + 5s. */
  duration: number | null;
  /** Current playback time in seconds — used to highlight the closest face. */
  currentTime: number;
  /** All faces detected in the recording, with their time-in-video. */
  faces: TimelineFace[];
  /** Seek the video to a given second. */
  onSeek: (sec: number) => void;
  /** Optional caption above the scrubber. */
  title?: string;
  /** When set, an Eye button appears on each thumbnail; click → open reveal
   *  modal pre-selected with that face_id. */
  onRevealFace?: (face: TimelineFace) => void;
  /** When set, a "Reveal range" button appears in the header; click → open
   *  reveal modal pre-seeded with the time window covering all detected faces. */
  onRevealRange?: (startSec: number, endSec: number, faceIds: string[]) => void;
}

/**
 * Visual face index for a recording — appears under the player on /playback/[id].
 *
 *   • Top: clickable scrubber bar with a playhead and one tick per face.
 *   • Bottom: horizontally scrollable rail of face crops, sorted by time.
 *     Click a crop → seek video to that face's appearance.
 *     The crop closest to currentTime is highlighted (ring + glow).
 *
 * Forensic / panel-friendly: lets the operator jump to a specific person's
 * frame without scrubbing the raw timeline.
 */
export function FaceTimeline({
  duration,
  currentTime,
  faces,
  onSeek,
  title,
  onRevealFace,
  onRevealRange,
}: Props) {
  const { t } = useT();
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Only faces with a real time-in-video; sorted ascending.
  const sortedFaces = useMemo(
    () =>
      faces
        .filter((f): f is TimelineFace & { time_in_video_sec: number } =>
          typeof f.time_in_video_sec === "number" && f.time_in_video_sec >= 0,
        )
        .sort((a, b) => a.time_in_video_sec - b.time_in_video_sec),
    [faces],
  );

  const effectiveDuration =
    duration && duration > 0
      ? duration
      : sortedFaces.length > 0
      ? sortedFaces[sortedFaces.length - 1]!.time_in_video_sec + 5
      : 0;

  // Closest face to currentTime (so we can highlight it in the rail).
  const activeFaceId = useMemo(() => {
    if (sortedFaces.length === 0) return null;
    let bestId = sortedFaces[0]!.id;
    let bestDist = Math.abs(sortedFaces[0]!.time_in_video_sec - currentTime);
    for (const f of sortedFaces) {
      const d = Math.abs(f.time_in_video_sec - currentTime);
      if (d < bestDist) {
        bestDist = d;
        bestId = f.id;
      }
    }
    // Only highlight when the playhead is reasonably close.
    return bestDist <= 2.5 ? bestId : null;
  }, [sortedFaces, currentTime]);

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track || effectiveDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * effectiveDuration);
  }

  if (sortedFaces.length === 0 || effectiveDuration <= 0) {
    return null;
  }

  const playheadPct =
    Math.max(0, Math.min(1, currentTime / effectiveDuration)) * 100;

  return (
    <div className="card mt-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-xs uppercase tracking-wide text-text-soft">
          {title ?? "Face timeline"}
        </h3>
        <div className="flex items-center gap-2">
          {onRevealRange && sortedFaces.length >= 1 && (
            <button
              type="button"
              onClick={() => {
                const first = sortedFaces[0]!.time_in_video_sec;
                const last = sortedFaces[sortedFaces.length - 1]!.time_in_video_sec;
                const start = Math.max(0, first - 1);
                const end = Math.min(effectiveDuration, last + 1);
                onRevealRange(
                  start,
                  end,
                  sortedFaces.map((f) => f.id),
                );
              }}
              title={t("pb_reveal_range_hint")}
              className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition"
            >
              <Scissors className="w-3 h-3" />
              {t("pb_reveal_range_btn")}
            </button>
          )}
          <span className="text-2xs text-text-muted font-mono">
            {fmt(currentTime)} / {fmt(effectiveDuration)}
          </span>
        </div>
      </div>

      {/* Scrubber track */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        role="slider"
        tabIndex={0}
        aria-label="Seek timeline"
        aria-valuemin={0}
        aria-valuemax={effectiveDuration}
        aria-valuenow={currentTime}
        className="relative h-6 rounded-full bg-bg-tertiary border border-border cursor-pointer group"
      >
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent/15 pointer-events-none"
          style={{ width: `${playheadPct}%` }}
          aria-hidden
        />

        {/* One tick per face */}
        {sortedFaces.map((f) => {
          const pct = (f.time_in_video_sec / effectiveDuration) * 100;
          return (
            <button
              key={f.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(f.time_in_video_sec);
              }}
              title={`#${f.display_no} · ${fmt(f.time_in_video_sec)}`}
              aria-label={`Jump to face ${f.display_no} at ${fmt(f.time_in_video_sec)}`}
              className={cn(
                "absolute top-0.5 bottom-0.5 w-1 rounded-full transition",
                activeFaceId === f.id
                  ? "bg-accent shadow-[0_0_8px_rgba(0,212,255,0.7)]"
                  : "bg-accent/50 hover:bg-accent",
              )}
              style={{ left: `calc(${pct}% - 2px)` }}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent border-2 border-bg shadow-overlay pointer-events-none"
          style={{ left: `calc(${playheadPct}% - 6px)` }}
          aria-hidden
        />
      </div>

      {/* Thumbnail rail */}
      <div className="relative -mx-1 overflow-x-auto pb-1">
        <ul className="flex items-stretch gap-2 px-1 min-w-max">
          {sortedFaces.map((f) => {
            const isActive = activeFaceId === f.id;
            return (
              <li key={f.id} className="shrink-0">
                <div
                  className={cn(
                    "relative w-16 h-16 rounded-md overflow-hidden border-2 transition group/face",
                    isActive
                      ? "border-accent ring-2 ring-accent/40 shadow-[0_0_12px_rgba(0,212,255,0.4)]"
                      : "border-transparent hover:border-accent/60",
                  )}
                >
                  <FaceThumb
                    faceId={f.id}
                    alt={`Face ${f.display_no}`}
                    className="absolute inset-0"
                  />
                  <button
                    type="button"
                    onClick={() => onSeek(f.time_in_video_sec)}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={`#${f.display_no} · ${fmt(f.time_in_video_sec)} · seek`}
                    aria-current={isActive ? "true" : undefined}
                  />
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 text-[10px] font-bold leading-none px-1 py-0.5 rounded pointer-events-none",
                      isActive ? "bg-accent text-bg" : "bg-black/70 text-accent",
                    )}
                  >
                    #{f.display_no}
                  </span>
                  <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-1 py-0.5 text-[9px] font-mono text-white text-right pointer-events-none">
                    {fmt(f.time_in_video_sec)}
                  </span>
                  {onRevealFace && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRevealFace(f);
                      }}
                      title={`Энэ хүний нүүрийг reveal хийх — #${f.display_no}`}
                      aria-label={`Reveal face ${f.display_no}`}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-accent text-bg inline-flex items-center justify-center opacity-0 group-hover/face:opacity-100 focus:opacity-100 transition shadow-overlay"
                    >
                      <Eye className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

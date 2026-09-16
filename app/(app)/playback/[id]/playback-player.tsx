"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, MousePointerClick, ListChecks, X } from "lucide-react";
import { VideoWithFaceOverlay, type FaceBox } from "./video-with-face-overlay";
import { FaceTimeline } from "./face-timeline";
import { RevealModal } from "./reveal-modal";
import { FaceThumb } from "@/components/face-thumb";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface Suspect {
  id: string;
  name: string;
  image_path: string;
}

interface DetectedFace {
  id: string;
  display_no: number;
  filename: string;
  detected_at: string;
  /** Seconds from recording start. Null when no started_at on the recording. */
  time_in_video_sec: number | null;
  /** Crop is encrypt-only at rest (ADR 0009) — FaceThumb shows a shield. */
  crop_sealed?: boolean;
}

/**
 * Blurred бичлэг + face overlay + reveal modal-ыг нэгтгэсэн client root.
 *
 * 3 янзаар reveal эхлүүлж болно:
 *   1. Видео доторх blurred face дээр шууд click → modal шууд reauth-руу (1 хүн)
 *   2. "Сонгох горим" → олон нүүр сонгож "Reveal сонгосон" товч (N хүн)
 *   3. "Reveal хийх" → method picker (upload/suspect/detected_face)
 */
export function PlaybackPlayer({
  recordingId,
  videoUrl,
  faces,
  suspects,
  detectedFaces,
  isAdmin,
  durationSec,
  initialFaceId,
}: {
  recordingId: string;
  videoUrl: string;
  faces: FaceBox[];
  suspects: Suspect[];
  detectedFaces: DetectedFace[];
  isAdmin: boolean;
  /** Server-side hint for total duration. Overridden once <video> loads metadata. */
  durationSec: number | null;
  /** From ?face=… — if set, seek the player there on metadata load. */
  initialFaceId?: string | null;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [initialFaceIds, setInitialFaceIds] = useState<string[]>([]);
  const [initialTimeWindow, setInitialTimeWindow] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Multi-select горим
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Video element + time state — shared with FaceTimeline so the rail can
  // highlight the closest face and the scrubber can seek the player.
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [liveDuration, setLiveDuration] = useState<number | null>(durationSec);

  function seekTo(sec: number) {
    const v = videoElementRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.duration || sec, sec));
    try {
      v.currentTime = t;
      // If paused, give a quick visual hint by attempting play().
      if (v.paused) {
        void v.play().catch(() => undefined);
      }
    } catch {
      // Ignore — some browsers throw if not yet seekable.
    }
  }

  // Deep-link from /faces (or anywhere with ?face={id}) → seek to the
  // matching face's time once. Wait for loadedmetadata so v.duration is
  // valid (otherwise the clamp inside seekTo wipes the request).
  const seekConsumed = useRef(false);
  useEffect(() => {
    if (!initialFaceId || seekConsumed.current) return;
    const target = detectedFaces.find((f) => f.id === initialFaceId);
    if (!target || target.time_in_video_sec == null) return;
    const v = videoElementRef.current;
    if (!v) return;
    const sec = target.time_in_video_sec;
    const apply = () => {
      seekConsumed.current = true;
      seekTo(sec);
    };
    if (v.readyState >= 1 && (v.duration || 0) > 0) {
      apply();
    } else {
      const handler = () => {
        apply();
        v.removeEventListener("loadedmetadata", handler);
      };
      v.addEventListener("loadedmetadata", handler);
      return () => v.removeEventListener("loadedmetadata", handler);
    }
  }, [initialFaceId, detectedFaces]);

  // Сонгогдсон нүүр (preview-нд харуулах)
  const selectedFaces = useMemo(
    () => detectedFaces.filter((f) => selectedIds.has(f.id)),
    [detectedFaces, selectedIds]
  );

  function onFaceClick(box: FaceBox) {
    if (!isAdmin) return;
    // Single-mode: шууд тэр нэг хүнийг reveal
    setInitialFaceIds([box.id]);
    setOpen(true);
  }

  function toggleSelect(box: FaceBox) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(box.id)) next.delete(box.id);
      else next.add(box.id);
      return next;
    });
  }

  function toggleFromCard(faceId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(faceId)) next.delete(faceId);
      else next.add(faceId);
      return next;
    });
  }

  function openManual() {
    setInitialFaceIds([]);
    setOpen(true);
  }

  function openSelected() {
    if (selectedIds.size === 0) return;
    setInitialFaceIds(Array.from(selectedIds));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setInitialFaceIds([]);
    setInitialTimeWindow(null);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  return (
    <>
      <VideoWithFaceOverlay
        src={videoUrl}
        faces={faces}
        selectMode={selectMode && isAdmin}
        selectedIds={selectedIds}
        onFaceClick={onFaceClick}
        onToggleSelect={toggleSelect}
        videoElementRef={videoElementRef}
        onTimeChange={(t, d) => {
          setCurrentTime(t);
          if (d > 0 && d !== liveDuration) setLiveDuration(d);
        }}
      />

      {isAdmin && (
        <FaceTimeline
          duration={liveDuration}
          currentTime={currentTime}
          faces={detectedFaces}
          onSeek={seekTo}
          onRevealFace={(f) => {
            // Тухайн нүүрний хугацаа руу seek хийгээд reveal modal-ыг pre-selected face_id-тай нээнэ
            if (f.time_in_video_sec !== null) seekTo(f.time_in_video_sec);
            setInitialFaceIds([f.id]);
            setInitialTimeWindow(null);
            setOpen(true);
          }}
          onRevealRange={(startSec, endSec, faceIds) => {
            // FaceTimeline-аас "Хүрээгээр reveal" товч даравал бүх face_ids +
            // time window-той RevealModal нээгдэнэ.
            setInitialFaceIds(faceIds);
            setInitialTimeWindow({ start: startSec, end: endSec });
            setOpen(true);
          }}
        />
      )}

      {isAdmin && (
        <>
          {/* Action bar */}
          <div data-playback-actions className="card mt-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
              <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-accent sm:mt-0" />
              <div className="min-w-0 flex-1 text-xs leading-relaxed text-text-soft">
                {selectMode ? (
                  <>
                    <span className="text-success font-medium">{t("pb_select_mode_active")}</span>{" "}
                    {t("pb_select_mode_hint")}{" "}
                    <span className="text-accent font-bold">{selectedIds.size}</span>{" "}
                    {t("pb_people")}
                  </>
                ) : (
                  <>{t("pb_idle_hint")}</>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              {!selectMode ? (
                <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="btn-ghost btn-sm min-w-0 justify-center sm:shrink-0"
                  disabled={detectedFaces.length === 0}
                  title={detectedFaces.length === 0 ? t("pb_no_faces") : t("pb_select_many_title")}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  {t("pb_select_mode_btn")}
                </button>
                <button onClick={openManual} className="btn-primary btn-sm min-w-0 justify-center sm:shrink-0">
                  <Eye className="w-3.5 h-3.5" />
                  {t("pb_reveal_btn")}
                </button>
                </>
              ) : (
                <>
                <button
                  onClick={exitSelectMode}
                  className="btn-ghost btn-sm min-w-0 justify-center sm:shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  {t("pb_cancel_btn")}
                </button>
                <button
                  onClick={openSelected}
                  disabled={selectedIds.size === 0}
                  className="btn-primary btn-sm min-w-0 justify-center sm:shrink-0"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {t("pb_reveal_btn")} {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </button>
                </>
              )}
            </div>
          </div>

          {/* Сонгох горим идэвхтэй үед бүх нүүрний жагсаалт картан хэлбэрээр */}
          {selectMode && detectedFaces.length > 0 && (
            <div className="card mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="section-title">
                  {t("pb_all_faces_title")} ({detectedFaces.length}) — {t("pb_click_to_select")}
                </h3>
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    {t("pb_clear_selection")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5">
                {detectedFaces.map((f) => {
                  const isSel = selectedIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFromCard(f.id)}
                      className={cn(
                        "relative aspect-square rounded overflow-hidden border-2 transition",
                        isSel
                          ? "border-success ring-2 ring-success/40"
                          : "border-transparent hover:border-accent/60"
                      )}
                      title={`#${f.display_no}`}
                    >
                      <FaceThumb
                        faceId={f.id}
                        alt={f.filename}
                        className="absolute inset-0"
                        sealed={f.crop_sealed}
                      />
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 text-[10px] font-bold px-1 py-0.5 rounded leading-none",
                          isSel ? "bg-success text-bg" : "bg-black/70 text-accent"
                        )}
                      >
                        #{f.display_no}
                      </span>
                      {isSel && (
                        <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-success flex items-center justify-center">
                          <svg
                            viewBox="0 0 24 24"
                            className="w-3 h-3 text-bg"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedFaces.length > 0 && (
                <div className="mt-3 pt-3 border-t border-text-muted/5">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
                    {t("pb_selected")} ({selectedFaces.length}):
                  </p>
                  <p className="text-xs text-success font-medium">
                    {selectedFaces
                      .map((f) => `#${f.display_no}`)
                      .join(", ")}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {open && (
        <RevealModal
          recordingId={recordingId}
          suspects={suspects}
          detectedFaces={detectedFaces}
          initialFaceIds={initialFaceIds}
          initialTimeWindow={initialTimeWindow}
          maskedUrl={videoUrl}
          recordingDurationSec={liveDuration ?? durationSec}
          onClose={close}
        />
      )}
    </>
  );
}

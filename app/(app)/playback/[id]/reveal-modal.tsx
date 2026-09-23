"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Upload,
  UserSearch,
  Users,
  Lock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FaceThumb } from "@/components/face-thumb";
import { revealScopeCopy, REVEAL_REASON_MIN, REVEAL_REASON_MAX } from "@/lib/reveal-scope";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useModalFocus } from "@/lib/use-modal-focus";

interface Suspect {
  id: string;
  name: string;
  image_path: string;
}

export interface DetectedFace {
  id: string;
  display_no: number;
  filename: string;
  detected_at: string;
  crop_sealed?: boolean;
}

type Step = "method" | "reauth" | "processing" | "done";

/** /api/reveal/start refusal codes → translation keys. */
const REVEAL_ERROR_KEYS: Record<string, TranslationKey> = {
  REAUTH_REQUIRED: "pb_reveal_err_reauth",
  RATE_LIMITED: "pb_reveal_err_rate",
  REVEAL_REASON_REQUIRED: "pb_reveal_err_reason",
  INVALID_PARAMS: "pb_reveal_start_failed",
  INVALID_WINDOW: "pb_reveal_err_window",
  WINDOW_EXCEEDS_DURATION: "pb_reveal_err_window",
  DURATION_UNKNOWN: "pb_reveal_err_duration",
  RECORDING_NOT_FOUND: "pb_reveal_err_not_found",
  TARGET_NOT_FOUND: "pb_reveal_err_not_found",
  NO_ORIGINAL: "pb_reveal_err_no_original",
  BAD_PHOTO: "pb_reveal_err_photo",
  ML_UNAVAILABLE: "pb_reveal_err_ml",
  REFERENCE_SEAL_FAILED: "pb_reveal_start_failed",
  START_FAILED: "pb_reveal_start_failed",
};
type Method = "upload" | "suspect" | "detected_face";

export function RevealModal({
  recordingId,
  suspects,
  detectedFaces,
  initialFaceIds,
  initialTimeWindow,
  maskedUrl,
  recordingDurationSec,
  onClose,
}: {
  recordingId: string;
  suspects: Suspect[];
  detectedFaces: DetectedFace[];
  /**
   * Хэрэв тохируулсан бол method picker-ийг алгасах:
   *   - 1 хүн → шууд reauth-руу
   *   - 1+ хүн → reauth-руу (multi-target reveal)
   */
  initialFaceIds?: string[];
  /** Original (blurred) recording URL — done step-д revealed video-той side-by-side харьцуулна. */
  maskedUrl?: string | null;
  /** Recording duration (s) — time-window slider-т ашиглана. NULL бол slider-ийг нуух. */
  recordingDurationSec?: number | null;
  /** If set, pre-enable the time window and seed start/end. Used by the
   *  FaceTimeline "Reveal range" quick-launch button. */
  initialTimeWindow?: { start: number; end: number } | null;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalFocus({ open: true, onClose, ref: dialogRef });
  const copy = revealScopeCopy[lang];
  const hasInitial = (initialFaceIds?.length ?? 0) > 0;

  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>(hasInitial ? "detected_face" : "upload");
  const [photo, setPhoto] = useState<File | null>(null);
  const [suspectId, setSuspectId] = useState<string | null>(null);

  // detected_face method-д олон ID-г хүлээн авна
  const [faceIds, setFaceIds] = useState<Set<string>>(
    new Set(initialFaceIds ?? [])
  );

  const [threshold, setThreshold] = useState(0.45);

  // Time-window scope (optional). Default: full recording (window disabled),
  // unless an initialTimeWindow was passed (FaceTimeline "Reveal range" quick-launch).
  // We coerce so that windowEnd > windowStart even on malformed inputs.
  const [windowEnabled, setWindowEnabled] = useState(!!initialTimeWindow);
  const [windowStart, setWindowStart] = useState(() => {
    if (!initialTimeWindow) return 0;
    return Math.max(0, Math.floor(initialTimeWindow.start));
  });
  const [windowEnd, setWindowEnd] = useState(() => {
    if (initialTimeWindow) {
      const s = Math.max(0, Math.floor(initialTimeWindow.start));
      return Math.max(s + 1, Math.ceil(initialTimeWindow.end));
    }
    return recordingDurationSec ? Math.max(1, Math.round(recordingDurationSec)) : 0;
  });

  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{
    id: string;
    status: string;
    progress: number;
    signed_url?: string | null;
    error_message?: string | null;
  } | null>(null);

  // Method-аас хамаарч "Үргэлжлүүлэх" товчийг enable
  const canContinue =
    (method === "upload" && photo) ||
    (method === "suspect" && suspectId) ||
    (method === "detected_face" && faceIds.size > 0);

  // initialFaceIds-аас сонгогдсон preview
  const initialFaces = useMemo(
    () => detectedFaces.filter((f) => (initialFaceIds ?? []).includes(f.id)),
    [detectedFaces, initialFaceIds]
  );

  function toggleFace(id: string) {
    setFaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Step "method" → "reauth"
  function continueToReauth() {
    setError(null);
    setStep("reauth");
  }

  // Step "reauth" — нууц үг submit
  async function submitReauth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          j.error === "server_config" ? t("totp_prompt_server_config") : (j.error ?? t("pb_reauth_failed")),
        );
      }
      setPassword("");
      if (job) {
        // Approval may take longer than the 15-minute reauth window. Resume
        // the existing job after verification; never create a duplicate.
        const result = await fetch(`/api/reveal/${job.id}`, { cache: "no-store" });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error ?? t("pb_play_failed_desc"));
        setJob((prev) => ({ ...prev!, ...data }));
        setStep(["completed", "failed", "rejected"].includes(data.status) ? "done" : "processing");
      } else {
        await startRevealJob();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
    } finally {
      setBusy(false);
    }
  }

  // Reveal job-ыг үүсгэж poll эхлүүлэх
  async function startRevealJob() {
    setStep("processing");
    setBusy(true);
    setError(null);

    const fd = new FormData();
    fd.append("recording_id", recordingId);
    fd.append("method", method);
    fd.append("reason", reason.trim());
    fd.append("threshold", String(threshold));

    if (method === "upload" && photo) fd.append("photo", photo);
    if (method === "suspect" && suspectId) fd.append("suspect_id", suspectId);
    if (method === "detected_face") {
      // Олон ID — face_ids[] параметр (FormData-д нэг key олон утгатай)
      Array.from(faceIds).forEach((id) => fd.append("face_ids", id));
    }
    if (windowEnabled && windowEnd > windowStart) {
      fd.append("start_sec", String(windowStart));
      fd.append("end_sec", String(windowEnd));
    }

    try {
      const res = await fetch("/api/reveal/start", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; job_id?: string; status?: string };
      if (!res.ok) {
        // Stable route code → the operator's language; never the raw server
        // text (it mixed Mongolian and English regardless of the UI language).
        const key = data.code ? REVEAL_ERROR_KEYS[data.code] : undefined;
        throw new Error(t(key ?? "pb_reveal_start_failed"));
      }
      if (!data.job_id) throw new Error(t("pb_reveal_start_failed"));
      setJob({ id: data.job_id, status: data.status ?? "pending_approval", progress: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai_error_generic"));
      setStep("method");
    } finally {
      setBusy(false);
    }
  }

  // Job status polling
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    const TERMINAL = new Set(["completed", "failed", "rejected"]);
    if (step !== "processing" || !job?.id || TERMINAL.has(job.status)) return;
    // Awaiting the second admin can take minutes/hours — poll slowly then;
    // once ML is actually rendering, tighten to 1.5 s for the progress bar.
    const intervalMs = job.status === "pending_approval" ? 6000 : 1500;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/reveal/${job.id}`, { cache: "no-store" });
        const data = await res.json();
        if (res.status === 401 && data.error === "REAUTH_REQUIRED") {
          setError(null);
          setStep("reauth");
          return;
        }
        if (!res.ok) {
          setError(data.error ?? t("pb_play_failed_desc"));
          if (res.status === 403 || res.status === 404) {
            setJob((prev) => ({ ...prev!, signed_url: null, error_message: data.error }));
            setStep("done");
          }
          return;
        }
        setError(null);
        if (data.status === "rejected" && !data.error_message) {
          data.error_message = `${data.rejected_email ? `${t("pb_rejected_by")} ${data.rejected_email}` : t("pb_rejected")}${data.rejected_reason ? `: ${data.rejected_reason}` : ""}`;
        }
        setJob((prev) => ({ ...prev!, ...data }));
        if (TERMINAL.has(data.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStep("done");
        }
      } catch {
        setError(t("pb_play_failed_desc"));
      }
    }, intervalMs);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.id, job?.status, step, t]);

  return (
    <div
      data-modal-backdrop
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-reveal-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-modal-title"
        tabIndex={-1}
        className="bg-bg-secondary border border-text-muted/10 rounded-2xl w-full max-w-2xl max-h-[90vh] max-h-[90dvh] overflow-y-auto overscroll-contain outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-text-muted/5 bg-bg-secondary/95 p-4 backdrop-blur sm:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h2 id="reveal-modal-title" className="min-w-0 font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4 text-accent" />
              {t("pb_modal_title")}
            </h2>
            <RevealAuthorityBadge />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0"
            aria-label={t("rt_dismiss")}
            title={t("rt_dismiss")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Step indicator */}
          <Stepper current={step} />

          {/* ─── STEP 1: Method ─── */}
          {step === "method" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 min-[480px]:grid-cols-3 gap-2">
                <MethodCard
                  active={method === "upload"}
                  onClick={() => setMethod("upload")}
                  icon={Upload}
                  title={t("pb_method_upload")}
                  desc={t("pb_method_upload_desc")}
                />
                <MethodCard
                  active={method === "suspect"}
                  onClick={() => setMethod("suspect")}
                  icon={UserSearch}
                  title={t("col_suspect")}
                  desc={t("pb_method_suspect_desc")}
                />
                <MethodCard
                  active={method === "detected_face"}
                  onClick={() => setMethod("detected_face")}
                  icon={Users}
                  title={t("pb_method_detected")}
                  desc={t("pb_method_detected_desc")}
                />
              </div>

              {method === "upload" && (
                <div>
                  <label className="label" htmlFor="reveal-photo">
                    {t("pb_upload_label")}
                  </label>
                  <input
                    id="reveal-photo"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                    className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
                  />
                </div>
              )}

              {method === "suspect" && (
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {suspects.length === 0 && (
                    <p className="col-span-2 text-xs text-text-muted py-6 text-center">
                      {t("pb_no_suspects")}
                    </p>
                  )}
                  {suspects.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSuspectId(s.id)}
                      className={cn(
                        "card text-left p-2 transition",
                        suspectId === s.id && "ring-2 ring-accent"
                      )}
                    >
                      <div className="text-sm font-medium">{s.name}</div>
                    </button>
                  ))}
                </div>
              )}

              {method === "detected_face" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-soft">
                      {t("pb_pick_many_hint")}{" "}
                      <span className="text-accent">({faceIds.size}/{detectedFaces.length})</span>
                    </span>
                    {faceIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setFaceIds(new Set())}
                        className="btn-ghost btn-sm"
                      >
                        {t("compare_clear")}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-72 overflow-y-auto">
                    {detectedFaces.length === 0 && (
                      <p className="col-span-full text-xs text-text-muted py-6 text-center">
                        {t("detected_faces_empty")}
                      </p>
                    )}
                    {detectedFaces.map((f) => {
                      const isSel = faceIds.has(f.id);
                      return (
                        <button
                          key={f.id}
                          onClick={() => toggleFace(f.id)}
                          className={cn(
                            "relative card p-1 aspect-square transition overflow-hidden",
                            isSel && "ring-2 ring-success"
                          )}
                          title={`#${f.display_no}`}
                        >
                          <FaceThumb
                            faceId={f.id}
                            alt={f.filename}
                            className="absolute inset-0 rounded"
                            sealed={f.crop_sealed}
                          />
                          <span
                            className={cn(
                              "absolute top-1 left-1 text-[10px] font-bold px-1 py-0.5 rounded leading-none",
                              isSel ? "bg-success text-bg" : "bg-black/70 text-accent"
                            )}
                          >
                            #{f.display_no}
                          </span>
                          {isSel && (
                            <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-success flex items-center justify-center">
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
                </div>
              )}

              <div>
                <label className="label" htmlFor="reveal-threshold">
                  {t("threshold")}: {threshold.toFixed(2)}
                </label>
                <input
                  id="reveal-threshold"
                  type="range"
                  min="0.30"
                  max="0.85"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full"
                />
                <p className="helper">
                  {t("pb_threshold_hint")}
                </p>
              </div>

              {recordingDurationSec && recordingDurationSec > 1 && (
                <div className="space-y-2">
                  <label className="label flex items-center justify-between">
                    <span>{t("reid_window")}</span>
                    <button
                      type="button"
                      onClick={() => setWindowEnabled((v) => !v)}
                      className={cn(
                        "btn-sm",
                        windowEnabled ? "btn-success" : "btn-ghost",
                      )}
                    >
                      {windowEnabled ? t("enabled") : t("disabled")}
                    </button>
                  </label>
                  {windowEnabled ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-text-muted mb-1">
                            {t("pb_window_start")} — {fmtSec(windowStart)}
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(0, Math.floor(recordingDurationSec) - 1)}
                            step={1}
                            value={windowStart}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setWindowStart(v);
                              if (windowEnd <= v) setWindowEnd(v + 1);
                            }}
                            className="w-full accent-accent"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-text-muted mb-1">
                            {t("pb_window_end")} — {fmtSec(windowEnd)}
                          </div>
                          <input
                            type="range"
                            min={windowStart + 1}
                            max={Math.ceil(recordingDurationSec)}
                            step={1}
                            value={windowEnd}
                            onChange={(e) => setWindowEnd(Number(e.target.value))}
                            className="w-full accent-accent"
                          />
                        </div>
                      </div>
                      <p className="helper">
                        {t("pb_window_note")}{" "}
                        {t("pb_window_selected")}{" "}
                        <span className="text-accent font-mono">
                          {fmtSec(windowStart)} → {fmtSec(windowEnd)}
                        </span>{" "}
                        ({windowEnd - windowStart}s / {Math.ceil(recordingDurationSec)}s)
                      </p>
                    </>
                  ) : (
                    <p className="helper">
                      {t("pb_window_off_note")}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="reveal-reason" className="label">{copy.reason}</label>
                <textarea id="reveal-reason" required minLength={REVEAL_REASON_MIN} maxLength={REVEAL_REASON_MAX}
                  value={reason} onChange={(event) => setReason(event.target.value)} className="input min-h-24" />
                <p className="helper">{copy.hint}</p>
                <p className="helper">{windowEnabled ? `${fmtSec(windowStart)} → ${fmtSec(windowEnd)}` : copy.whole}</p>
              </div>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
                <button onClick={onClose} className="btn-ghost flex-1">
                  {t("pb_cancel_btn")}
                </button>
                <button
                  onClick={continueToReauth}
                  disabled={!canContinue || reason.trim().length < REVEAL_REASON_MIN}
                  className="btn-primary flex-1"
                >
                  {t("pb_continue")}
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 2: Re-auth ─── */}
          {step === "reauth" && (
            <form onSubmit={submitReauth} className="space-y-3">
              {hasInitial && initialFaces.length > 0 && (
                <div className="card p-3 bg-accent/5 border-accent/20 space-y-2">
                  <div className="text-xs text-accent font-medium">
                    {t("pb_selected_from_video")}{" "}
                    <span className="font-bold">{initialFaces.length}</span>{" "}
                    {t("pb_faces_will_reveal")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {initialFaces.map((f) => (
                      <div
                        key={f.id}
                        className="relative w-12 h-12 rounded-md overflow-hidden bg-bg-tertiary"
                        title={`#${f.display_no} · ${f.filename}`}
                      >
                        <FaceThumb
                          faceId={f.id}
                          alt=""
                          className="absolute inset-0"
                          sealed={f.crop_sealed}
                        />
                        <span className="absolute top-0 left-0 z-10 text-[9px] font-bold leading-none px-1 py-0.5 bg-accent text-bg rounded-br">
                          #{f.display_no}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-warning/5 border border-warning/30 rounded-lg p-3 text-xs flex gap-2">
                <Lock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  {t("pb_reauth_note")}
                </div>
              </div>

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login_pass")}
                autoFocus
                className="input"
                disabled={busy}
              />

              {error && (
                <div className="text-danger text-xs bg-danger/10 border border-danger/30 rounded-lg p-2.5">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {!job && (
                  <button
                    type="button"
                    onClick={() => setStep("method")}
                    className="btn-ghost flex-1"
                    disabled={busy}
                  >
                    {t("back")}
                  </button>
                )}
                {(hasInitial || job) && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-ghost flex-1"
                    disabled={busy}
                  >
                    {t("pb_cancel_btn")}
                  </button>
                )}
                <button type="submit" disabled={busy || !password} className="btn-primary flex-1">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {t("confirm")}
                </button>
              </div>
            </form>
          )}

          {/* ─── STEP 3: Processing / Awaiting approval ─── */}
          {step === "processing" && error && (
            <p role="alert" className="text-sm text-danger">{error}</p>
          )}
          {step === "processing" && job?.status === "pending_approval" && (
            <div className="space-y-3 py-6 text-center">
              <ShieldCheck className="w-10 h-10 text-warning mx-auto" />
              <div>
                <div className="font-medium">{t("pb_awaiting_approval")}</div>
                <div className="text-xs text-text-soft mt-1 max-w-sm mx-auto leading-relaxed">
                  {t("pb_four_eyes_note")}
                </div>
              </div>
              <div className="text-[10px] text-text-muted font-mono">
                job {job.id.slice(0, 8)} · status: pending_approval
              </div>
            </div>
          )}
          {step === "processing" && job?.status !== "pending_approval" && (
            <div className="space-y-3 py-6 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto" />
              <div>
                <div className="font-medium">{t("pb_processing")}</div>
                <div className="text-xs text-text-muted mt-1">
                  {t("pb_processing_hint")}
                </div>
              </div>
              {job && (
                <div className="max-w-md mx-auto">
                  <div className="h-1.5 bg-text-muted/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-text-muted mt-1.5">
                    {job.status} · {job.progress}%
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 4: Done ─── */}
          {step === "done" && job && (
            <div className="space-y-3">
              {job.status === "completed" && job.signed_url ? (
                <>
                  <div className="bg-success/5 border border-success/30 rounded-lg p-3 flex gap-2 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                    <div>
                      <div className="font-medium text-success">{t("pb_reveal_success")}</div>
                      <div className="text-xs text-text-soft mt-0.5">
                        {t("pb_reveal_success_desc")}
                      </div>
                    </div>
                  </div>

                  {maskedUrl ? (
                    <SideBySidePlayer maskedUrl={maskedUrl} revealedUrl={job.signed_url} onError={() => setError(t("pb_play_failed_desc"))} />
                  ) : (
                    <video
                      src={job.signed_url}
                      controls
                      autoPlay
                      onError={() => setError(t("pb_play_failed_desc"))}
                      className="w-full rounded-lg bg-black"
                    />
                  )}

                  {error && (
                    <div role="alert" className="space-y-2 text-sm text-danger">
                      <p>{error}</p>
                      <button type="button" className="btn-ghost" onClick={() => { setError(null); setStep("reauth"); }}>
                        <Lock className="w-4 h-4" /> {t("reauth_gate_title")}
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <a
                      href={job.signed_url}
                      download={`reveal_${job.id.slice(0, 8)}.mp4`}
                      className="btn-ghost flex-1"
                    >
                      <Download className="w-4 h-4" />
                      {t("download")}
                    </a>
                    <button onClick={onClose} className="btn-primary flex-1">
                      {t("rt_dismiss")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-danger/5 border border-danger/30 rounded-lg p-4 flex gap-2">
                  <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
                  <div>
                    <div className="font-medium text-danger">{t("pb_reveal_failed")}</div>
                    <div className="text-xs text-text-soft mt-0.5">
                      {job.error_message ?? t("ui_error_title")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const { t } = useT();
  const steps: { key: Step; label: string }[] = [
    { key: "method", label: t("pb_step_pick") },
    { key: "reauth", label: t("pb_step_auth") },
    { key: "processing", label: t("pb_step_process") },
    { key: "done", label: t("pb_step_done") },
  ];
  const idx = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={cn(
            "flex-1 px-2 py-1.5 rounded-md text-center transition",
            i < idx && "bg-accent/15 text-accent",
            i === idx && "bg-accent/25 text-accent font-bold",
            i > idx && "bg-text-muted/5 text-text-muted"
          )}
        >
          {s.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Side-by-side comparison of the masked (original) and revealed videos.
 * Playback is synced: hitting play on one mirrors to the other, and seeking
 * one pulls the second to within 0.25s of the same offset.
 */
function SideBySidePlayer({
  maskedUrl,
  revealedUrl,
  onError,
}: {
  maskedUrl: string;
  revealedUrl: string;
  onError: () => void;
}) {
  const { t } = useT();
  const maskedRef = useRef<HTMLVideoElement | null>(null);
  const revealedRef = useRef<HTMLVideoElement | null>(null);
  const lockRef = useRef(false);

  useEffect(() => {
    const a = maskedRef.current;
    const b = revealedRef.current;
    if (!a || !b) return;

    const sync = (from: HTMLVideoElement, to: HTMLVideoElement) => {
      if (lockRef.current) return;
      lockRef.current = true;
      try {
        if (Math.abs(to.currentTime - from.currentTime) > 0.25) {
          to.currentTime = from.currentTime;
        }
        if (from.paused !== to.paused) {
          if (from.paused) to.pause();
          else void to.play().catch(() => undefined);
        }
      } finally {
        // Release lock on next tick so the mirrored events don't trigger us back.
        setTimeout(() => {
          lockRef.current = false;
        }, 50);
      }
    };

    const onAPlay = () => sync(a, b);
    const onAPause = () => sync(a, b);
    const onASeek = () => sync(a, b);
    const onBPlay = () => sync(b, a);
    const onBPause = () => sync(b, a);
    const onBSeek = () => sync(b, a);

    a.addEventListener("play", onAPlay);
    a.addEventListener("pause", onAPause);
    a.addEventListener("seeked", onASeek);
    b.addEventListener("play", onBPlay);
    b.addEventListener("pause", onBPause);
    b.addEventListener("seeked", onBSeek);

    return () => {
      a.removeEventListener("play", onAPlay);
      a.removeEventListener("pause", onAPause);
      a.removeEventListener("seeked", onASeek);
      b.removeEventListener("play", onBPlay);
      b.removeEventListener("pause", onBPause);
      b.removeEventListener("seeked", onBSeek);
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
      <div className="space-y-1">
        <div className="section-title">
          {t("pb_masked_label")}
        </div>
        <video
          ref={maskedRef}
          src={maskedUrl}
          controls
          playsInline
          muted
          className="w-full aspect-video rounded-lg bg-black"
        />
      </div>
      <div className="space-y-1">
        <div className="section-title text-success">
          {t("pb_revealed_label")}
        </div>
        <video
          ref={revealedRef}
          src={revealedUrl}
          onError={onError}
          controls
          autoPlay
          playsInline
          className="w-full aspect-video rounded-lg bg-black ring-2 ring-success/40"
        />
      </div>
    </div>
  );
}

function fmtSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MethodCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Upload;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "card text-left transition",
        active ? "ring-2 ring-accent bg-accent/5" : "hover:bg-text-muted/5"
      )}
    >
      <Icon className={cn("w-5 h-5 mb-2", active ? "text-accent" : "text-text-soft")} />
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{desc}</div>
    </button>
  );
}

/**
 * Shows the operator's hierarchical reveal authority (ADR 0009). Purely
 * informational — fetched from /api/reveal/my-level. Fully self-contained:
 * if the fetch fails it renders nothing, so it can never break the modal.
 *   level 0 → "Director (all)"   level N → "Level N" (scope-limited)
 */
function RevealAuthorityBadge() {
  const { t } = useT();
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/reveal/my-level")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.reveal_level === "number") setLevel(d.reveal_level);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (level === null) return null;
  const isDirector = level === 0;
  return (
    <span
      className={cn(
        "text-2xs font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1 shrink-0",
        isDirector
          ? "bg-accent/10 text-accent border-accent/20"
          : "bg-warning-soft text-warning border-warning/20",
      )}
      title={
        isDirector
          ? t("pb_authority_director_hint")
          : `${t("pb_authority_level")} L${level} — ${t("pb_authority_min_chain")} ${level}`
      }
    >
      <Lock className="w-3 h-3" />
      {isDirector ? "Director" : `${t("pb_level")} ${level}`}
    </span>
  );
}

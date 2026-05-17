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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  signed: string | null;
}

type Step = "method" | "reauth" | "processing" | "done";
type Method = "upload" | "suspect" | "detected_face";

export function RevealModal({
  recordingId,
  suspects,
  detectedFaces,
  initialFaceIds,
  maskedUrl,
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
  onClose: () => void;
}) {
  const hasInitial = (initialFaceIds?.length ?? 0) > 0;

  const [step, setStep] = useState<Step>(hasInitial ? "reauth" : "method");
  const [method, setMethod] = useState<Method>(hasInitial ? "detected_face" : "upload");
  const [photo, setPhoto] = useState<File | null>(null);
  const [suspectId, setSuspectId] = useState<string | null>(null);

  // detected_face method-д олон ID-г хүлээн авна
  const [faceIds, setFaceIds] = useState<Set<string>>(
    new Set(initialFaceIds ?? [])
  );

  const [threshold, setThreshold] = useState(0.45);
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
        throw new Error(j.error ?? "Нэвтрэлт амжилтгүй");
      }
      setPassword("");
      await startRevealJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
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
    fd.append("threshold", String(threshold));

    if (method === "upload" && photo) fd.append("photo", photo);
    if (method === "suspect" && suspectId) fd.append("suspect_id", suspectId);
    if (method === "detected_face") {
      // Олон ID — face_ids[] параметр (FormData-д нэг key олон утгатай)
      Array.from(faceIds).forEach((id) => fd.append("face_ids", id));
    }

    try {
      const res = await fetch("/api/reveal/start", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reveal эхлүүлж чадсангүй");
      setJob({ id: data.job_id, status: data.status, progress: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
      setStep("method");
    } finally {
      setBusy(false);
    }
  }

  // Job status polling
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!job?.id || job.status === "completed" || job.status === "failed") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/reveal/${job.id}`);
        const data = await res.json();
        setJob((prev) => ({ ...prev!, ...data }));
        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStep("done");
        }
      } catch {}
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.id, job?.status]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-text-muted/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-text-muted/5">
          <h2 className="font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-accent" />
            Reveal хийх — нууцлалын журамтай
          </h2>
          <button onClick={onClose} className="text-text-soft hover:text-text">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Step indicator */}
          <Stepper current={step} />

          {/* ─── STEP 1: Method ─── */}
          {step === "method" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <MethodCard
                  active={method === "upload"}
                  onClick={() => setMethod("upload")}
                  icon={Upload}
                  title="Зураг upload"
                  desc="Хайх хүний зургийг оруулна"
                />
                <MethodCard
                  active={method === "suspect"}
                  onClick={() => setMethod("suspect")}
                  icon={UserSearch}
                  title="Сэжигтэн"
                  desc="Бүртгэлтэй хүнээс сонгох"
                />
                <MethodCard
                  active={method === "detected_face"}
                  onClick={() => setMethod("detected_face")}
                  icon={Users}
                  title="Илрүүлсэн"
                  desc="Олон сонгож болно"
                />
              </div>

              {method === "upload" && (
                <div>
                  <label className="text-xs uppercase tracking-wide text-text-soft mb-1.5 block">
                    Хайх хүний зураг
                  </label>
                  <input
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
                      Сэжигтэн бүртгэгдээгүй. /suspects хуудаснаас нэмнэ үү.
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
                      Олон ID сонгож зэрэг reveal хийнэ үү{" "}
                      <span className="text-accent">({faceIds.size}/{detectedFaces.length})</span>
                    </span>
                    {faceIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setFaceIds(new Set())}
                        className="text-text-muted hover:text-text underline"
                      >
                        Цэвэрлэх
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-72 overflow-y-auto">
                    {detectedFaces.length === 0 && (
                      <p className="col-span-full text-xs text-text-muted py-6 text-center">
                        Энэ бичлэгийн хугацаанд нүүр илрээгүй.
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
                          {f.signed ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={f.signed}
                              alt={f.filename}
                              className="w-full h-full object-cover rounded"
                            />
                          ) : (
                            <div className="w-full h-full bg-bg-tertiary rounded" />
                          )}
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
                <label className="text-xs uppercase tracking-wide text-text-soft mb-1.5 block">
                  Тааралтын босго: {threshold.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0.30"
                  max="0.85"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Бага = илүү олон тааралт (false positive магадлал ↑) · Их = чанд тааралт
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={onClose} className="btn-ghost flex-1">
                  Болих
                </button>
                <button
                  onClick={continueToReauth}
                  disabled={!canContinue}
                  className="btn-primary flex-1"
                >
                  Үргэлжлүүлэх
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
                    Видеоноос сонгосон{" "}
                    <span className="font-bold">{initialFaces.length}</span> нүүр
                    дээр reveal хийгдэнэ
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {initialFaces.map((f) => (
                      <div
                        key={f.id}
                        className="relative w-12 h-12 rounded-md overflow-hidden bg-bg-tertiary"
                        title={`#${f.display_no} · ${f.filename}`}
                      >
                        {f.signed ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.signed}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : null}
                        <span className="absolute top-0 left-0 text-[9px] font-bold leading-none px-1 py-0.5 bg-accent text-bg rounded-br">
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
                  Reveal хийх нь нууцлалын журамтай үйлдэл. Үргэлжлүүлэхийн тулд
                  нууц үгээ дахин оруулна уу. Дараагийн 15 минутад дахин асуухгүй.
                </div>
              </div>

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Нууц үг"
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
                {!hasInitial && (
                  <button
                    type="button"
                    onClick={() => setStep("method")}
                    className="btn-ghost flex-1"
                    disabled={busy}
                  >
                    Буцах
                  </button>
                )}
                {hasInitial && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-ghost flex-1"
                    disabled={busy}
                  >
                    Болих
                  </button>
                )}
                <button type="submit" disabled={busy || !password} className="btn-primary flex-1">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Баталгаажуулах
                </button>
              </div>
            </form>
          )}

          {/* ─── STEP 3: Processing ─── */}
          {step === "processing" && (
            <div className="space-y-3 py-6 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto" />
              <div>
                <div className="font-medium">Reveal боловсруулж байна...</div>
                <div className="text-xs text-text-muted mt-1">
                  Frame бүрд нүүр detect → embedding → блюр харьцуулалт хийнэ
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
                      <div className="font-medium text-success">Reveal амжилттай!</div>
                      <div className="text-xs text-text-soft mt-0.5">
                        Зөвхөн сонгосон хүний нүүр илэрхий, бусад нь blur-тэй хэвээр
                      </div>
                    </div>
                  </div>

                  {maskedUrl ? (
                    <SideBySidePlayer maskedUrl={maskedUrl} revealedUrl={job.signed_url} />
                  ) : (
                    <video
                      src={job.signed_url}
                      controls
                      autoPlay
                      className="w-full rounded-lg bg-black"
                    />
                  )}

                  <div className="flex gap-2">
                    <a
                      href={job.signed_url}
                      download={`reveal_${job.id.slice(0, 8)}.mp4`}
                      className="btn-ghost flex-1"
                    >
                      <Download className="w-4 h-4" />
                      Татаж авах
                    </a>
                    <button onClick={onClose} className="btn-primary flex-1">
                      Хаах
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-danger/5 border border-danger/30 rounded-lg p-4 flex gap-2">
                  <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
                  <div>
                    <div className="font-medium text-danger">Reveal амжилтгүй</div>
                    <div className="text-xs text-text-soft mt-0.5">
                      {job.error_message ?? "Тодорхойгүй алдаа"}
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
  const steps: { key: Step; label: string }[] = [
    { key: "method", label: "1. Хүн сонгох" },
    { key: "reauth", label: "2. Auth" },
    { key: "processing", label: "3. Боловсруулах" },
    { key: "done", label: "4. Дуусаx" },
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
}: {
  maskedUrl: string;
  revealedUrl: string;
}) {
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
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
          Masked (original)
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
        <div className="text-[10px] uppercase tracking-wide text-success font-medium">
          Revealed
        </div>
        <video
          ref={revealedRef}
          src={revealedUrl}
          controls
          autoPlay
          playsInline
          className="w-full aspect-video rounded-lg bg-black ring-2 ring-success/40"
        />
      </div>
    </div>
  );
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

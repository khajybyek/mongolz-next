import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Lock,
  Calendar,
  Camera as CamIcon,
  Clock,
  ShieldCheck,
  History,
  CheckCircle2,
  XCircle,
  Hourglass,
  KeyRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { ACCESS_THROTTLE_MS, READ_ACTIONS, recordAccess } from "@/lib/audit";
import { PlaybackPlayer } from "./playback-player";
import { FaceThumb } from "@/components/face-thumb";
import { Empty } from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { workflowCopy, workflowStatus } from "@/lib/workflow-copy";
import {
  buildPrivacySchedule,
  formatOffsetRanges,
  formatVideoOffset,
  privacySpanRanges,
  revealBlockedByPrivacy,
  revealPrivacyVerdict,
  scheduleProtectedOffsets,
  spanOffsets,
  type ScheduleWindowRow,
} from "@/lib/privacy-schedule";
import { revealWithheldByPrivacy } from "@/lib/reveal-errors";
import { isFaceEncryptedRecording, recordingRevealable } from "@/lib/recording-mode";
import type { FaceInRecording } from "@/lib/database.types";

// Cache хийхгүй — faces background processing-аар нэмэгддэг тул хэзээ нээгдсэн
// үед хамгийн сүүлийн өгөгдлийг харуулах ёстой.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlaybackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ face?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const initialFaceId = typeof sp.face === "string" ? sp.face : null;
  const { user, profile } = await requireUser();
  const { t, lang } = await getT();
  const copy = workflowCopy(lang);
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";

  const { data: rec, error: recError } = await supabase
    .from("recordings")
    .select(
      "id, filename, storage_path, original_path, face_envelope_path, duration_sec, size_bytes, encrypted, has_original, blur_strategy, camera_id, camera_name, started_at, ended_at, capture_status, capture_error"
    )
    .eq("id", id)
    .maybeSingle();

  if (recError) return <><PageHeader title={copy.recording} /><Empty message={copy.unavailable} action={<a href="" className="btn-secondary">{copy.retry}</a>} /></>;
  if (!rec) notFound();
  if (rec.capture_status !== "ready") return <>
    <PageHeader title={rec.filename} subtitle={workflowStatus(rec.capture_status, lang)} />
    <Empty message={copy.captureNotReady} description={rec.capture_error ?? undefined} action={<div className="flex gap-2"><Link className="btn-secondary" href="/playback">{copy.recording}</Link><a className="btn-primary" href="/jobs">{copy.detail}</a><a href="" className="btn-secondary">{copy.refresh}</a></div>} />
  </>;

  // Choose the playback URL based on blur_strategy:
  //   • baked     — signed link to the plaintext blurred MP4 in the `recordings`
  //                 storage bucket (the legacy artifact).
  //   • on_demand — points at /api/recordings/[id]/view, which proxies the
  //                 ML service. The ML side decrypts the encrypted original
  //                 and derives the blurred view at request time (#3: one
  //                 encrypted source of truth — no plaintext blurred MP4 exists).
  //   • face_encrypted — the same route (ADR 0013): the stored video is
  //                 already masked and encrypted at rest; the ML side only
  //                 decrypts and streams it. storage_path is ciphertext, so a
  //                 signed Storage link would be unplayable (and unaudited).
  const faceEncrypted = isFaceEncryptedRecording(rec);
  const revealable = recordingRevealable(rec);
  let blurredUrl: string | null = null;
  if (rec.blur_strategy === "on_demand" || faceEncrypted) {
    blurredUrl = `/api/recordings/${rec.id}/view`;
  } else {
    const { data: signed } = await supabase.storage
      .from("recordings")
      .createSignedUrl(rec.storage_path, 60 * 30);
    blurredUrl = signed?.signedUrl ?? null;
    // A `baked` recording is fetched straight from Storage with this signed
    // link, so the audited /api/recordings/[id]/view route never sees it —
    // 28 of the 29 recordings in production are baked. Record the read here,
    // or "playback view is logged" would be false for almost every recording.
    if (blurredUrl) {
      await recordAccess({
        action: READ_ACTIONS.RECORDING_VIEWED,
        detail: `recording=${rec.id} · baked · signed url ttl=1800s`,
        userId: user.id,
        userEmail: user.email,
        throttleMs: ACCESS_THROTTLE_MS,
      });
    }
  }

  // Capture-time privacy spans (ADR 0012), read through the same RLS client
  // as the recording: the policy lets an operator see the spans of a
  // recording they can see. A read error only hides the notice — the reveal
  // job enforces the spans (and the schedule) on its own.
  const { data: spanRows } = await supabase
    .from("recording_privacy_spans")
    .select("start_offset_sec, end_offset_sec, source")
    .eq("recording_id", rec.id)
    .order("start_offset_sec");
  const privacySpans = privacySpanRanges(spanRows ?? []);

  // The camera's CURRENT schedule also withholds stretches from reveal — the
  // reveal job's backstop, and a private window added after capture
  // ("retroactive" tightening). Evaluated here only to SAY so (same rules,
  // same 60 s margin as the job); the job enforces it itself. Unreadable →
  // no notice rather than a guess.
  let scheduleRanges: ReturnType<typeof scheduleProtectedOffsets> = [];
  if (rec.camera_id) {
    const [{ data: cam }, { data: windows }] = await Promise.all([
      supabase.from("cameras").select("privacy_default").eq("id", rec.camera_id).maybeSingle(),
      supabase.from("masking_schedules").select("window_mode, starts_at, ends_at, weekdays").eq("camera_id", rec.camera_id),
    ]);
    if (cam && windows) {
      const schedule = buildPrivacySchedule(cam.privacy_default, windows as ScheduleWindowRow[]);
      scheduleRanges = scheduleProtectedOffsets(schedule, rec.started_at, rec.duration_sec);
    }
  }
  const scheduleRangeLabels = formatOffsetRanges(scheduleRanges);
  const revealPrivacy = {
    spans: spanOffsets(spanRows ?? []),
    schedule: scheduleRanges,
    durationSec: rec.duration_sec ?? null,
  };
  // The whole recording is protected (spans, or spans + current schedule):
  // every reveal request would be refused by the job — the modal already
  // refuses to send one. Said here so the info card and the Reveal CTA stop
  // promising a reveal (ADR 0012 §5/§7). Presentation only.
  const revealWithheld = revealBlockedByPrivacy(
    revealPrivacyVerdict(revealPrivacy.spans, revealPrivacy.schedule, revealPrivacy.durationSec, null),
  );
  // The first privacy card on the page — the Reveal CTA links to it, since
  // on a phone the cards render well below the player.
  const privacyNoticeId = privacySpans.length > 0
    ? "privacy-spans"
    : scheduleRangeLabels.length > 0
      ? "privacy-schedule"
      : null;

  // Face metadata — admin only. Viewer-д face илрүүлэлтийн өгөгдөл харагдахгүй
  // (RLS-ийн нэг хэсэг — privacy-preserving design).
  const { data: facesRaw } = isAdmin
    ? await supabase.rpc("faces_in_recording", { rec_id: id })
    : { data: null };
  // The RPC also carries crop_sealed / chain_index (ADR 0009) so the client
  // can badge sealed crops without probing the crop endpoint.
  const facesInRec = (facesRaw ?? []) as unknown as FaceInRecording[];

  // Бүх илэрсэн нүүрд detected_at-аар sorted дугаар (#1..#N) өгнө —
  // playback-ын overlay болон reveal modal хоёр ижил дугаартай байна.
  // Crop thumbnail-ыг client дотроос <FaceThumb faceId> унш — серверээс signed
  // URL бэлдэхгүй (ADR 0009 / Tier 2: бүх crop unified endpoint-оор явна).
  const numberedFaces = facesInRec.map((f, idx) => ({
    ...f,
    display_no: idx + 1,
  }));

  // Overlay-руу зориулсан хэлбэр (bbox-той л)
  const overlayFaces = numberedFaces
    .filter((f) => f.bbox && f.time_in_video_sec !== null)
    .map((f) => ({
      id: f.id,
      display_no: f.display_no,
      filename: f.filename,
      time_in_video_sec: f.time_in_video_sec as number,
      bbox: f.bbox,
    }));

  // Modal жагсаалтанд (3-р tab) болон Face timeline-д ашиглах. Сүүлийнхэд
  // time_in_video_sec нь scrubber-ын тэнхлэг тул заавал орох ёстой.
  const detectedFaces = numberedFaces.map((f) => ({
    id: f.id,
    display_no: f.display_no,
    filename: f.filename,
    detected_at: f.detected_at,
    time_in_video_sec: f.time_in_video_sec,
    crop_sealed: f.crop_sealed,
  }));

  // Suspects (admin л харах)
  const { data: suspects } = isAdmin
    ? await supabase.from("suspects").select("id, name, image_path").order("name")
    : { data: null };

  // Энэ recording-ийн өмнөх reveal job-уудын түүх (admin only).
  // 4-eyes audit / accountability — кто, хэзээ, ямар scope-ээр reveal хийсэн.
  type RevealHistoryRow = {
    id: string;
    status: string;
    method: string;
    threshold: number | null;
    target_start_sec: number | null;
    target_end_sec: number | null;
    requested_email: string | null;
    approved_email: string | null;
    rejected_email: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
  };
  const { data: revealHistoryRaw } = isAdmin
    ? await supabase
        .from("reveal_jobs")
        .select(
          "id, status, method, threshold, target_start_sec, target_end_sec, requested_email, approved_email, rejected_email, error_message, created_at, completed_at",
        )
        .eq("recording_id", id)
        .order("created_at", { ascending: false })
        .limit(15)
    : { data: null };
  const revealHistory: RevealHistoryRow[] = (revealHistoryRaw ?? []) as RevealHistoryRow[];

  return (
    <>
      <Link
        href="/playback"
        className="text-sm text-text-soft hover:text-text inline-flex items-center gap-1.5 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("playback_back")}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div>
          {blurredUrl ? (
            <PlaybackPlayer
              recordingId={rec.id}
              videoUrl={blurredUrl}
              faces={overlayFaces}
              suspects={suspects ?? []}
              detectedFaces={detectedFaces}
              isAdmin={isAdmin}
              durationSec={rec.duration_sec ?? null}
              initialFaceId={initialFaceId}
              revealPrivacy={revealPrivacy}
              revealWithheld={revealWithheld}
              privacyNoticeId={privacyNoticeId}
              faceEncrypted={faceEncrypted}
            />
          ) : (
            <div className="card aspect-video bg-black flex items-center justify-center text-text-muted text-sm">
              {t("playback_no_recording")}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card space-y-2">
            <h3 className="section-title mb-2">
              {t("rec_info")}
            </h3>
            <Row icon={Calendar} label={t("rec_started")}>{formatDate(rec.started_at)}</Row>
            <Row icon={Clock} label={t("rec_duration")}>
              {rec.duration_sec ? `${rec.duration_sec}s` : "—"}
            </Row>
            <Row icon={CamIcon} label={t("rec_camera")}>{rec.camera_name ?? "—"}</Row>
            <Row icon={Lock} label={t("rec_encrypted")}>
              {rec.encrypted ? t("rec_encrypted_yes") : t("rec_encrypted_no")}
            </Row>
            <Row icon={ShieldCheck} label={t("rec_original")}>
              {faceEncrypted ? (
                <span className="text-text-soft">{t("rec_original_face_encrypted")}</span>
              ) : rec.has_original ? (
                !isAdmin ? (
                  <span className="text-text-muted">{t("rec_original_kept_admin_only")}</span>
                ) : revealWithheld ? (
                  <span className="text-text-muted">{t("rec_original_kept_withheld")}</span>
                ) : (
                  <span className="text-success">{t("rec_original_kept")}</span>
                )
              ) : (
                <span className="text-text-muted">{t("rec_original_missing")}</span>
              )}
            </Row>
          </div>

          {faceEncrypted && (
            <div data-face-encrypted className="card border border-accent/30 bg-accent/5 space-y-2">
              <div className="flex items-start gap-2.5">
                <KeyRound className="w-4 h-4 text-accent mt-0.5 shrink-0" aria-hidden />
                <div className="space-y-1 min-w-0">
                  <h3 className="section-title text-accent">{t("pb_face_encrypted_title")}</h3>
                  <p className="text-xs text-text-soft leading-relaxed">{t("pb_face_encrypted_desc")}</p>
                  <p className="text-[10px] text-text-muted leading-relaxed pt-1 border-t border-text-muted/5 mt-2">
                    {t("pb_face_encrypted_limits")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {privacySpans.length > 0 && (
            <div id="privacy-spans" className="card border border-accent/30 bg-accent/5 space-y-2 scroll-mt-24">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-accent mt-0.5 shrink-0" aria-hidden />
                <div className="space-y-1 min-w-0">
                  <h3 className="section-title text-accent">{t("pb_privacy_spans_title")}</h3>
                  <p className="text-xs text-text-soft leading-relaxed">{t("pb_privacy_spans_desc")}</p>
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {privacySpans.map((span, i) => (
                      <li
                        key={`${span.start}-${i}`}
                        // .badge is nowrap; a long fail-closed label must wrap
                        // inside the card instead of running past its border.
                        className={`badge bg-accent/15 text-accent font-mono max-w-full flex-wrap whitespace-normal text-left${span.failClosed ? " rounded-lg" : ""}`}
                        title={span.failClosed ? t("pb_privacy_fail_closed") : undefined}
                      >
                        {span.start}
                        {span.end !== null ? `–${span.end}` : <span className="font-sans"> – {t("pb_privacy_until_end")}</span>}
                        {span.failClosed && <span className="font-sans"> · {t("pb_privacy_fail_closed")}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {scheduleRangeLabels.length > 0 && (
            <div id="privacy-schedule" className="card border border-accent/20 space-y-2 scroll-mt-24">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-accent mt-0.5 shrink-0" aria-hidden />
                <div className="space-y-1 min-w-0">
                  <h3 className="section-title text-accent">{t("pb_privacy_schedule_title")}</h3>
                  <p className="text-xs text-text-soft leading-relaxed">{t("pb_privacy_schedule_desc")}</p>
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {scheduleRangeLabels.map((range, i) => (
                      <li key={`${range.start}-${i}`} className="badge bg-accent/10 text-accent font-mono max-w-full flex-wrap whitespace-normal text-left">
                        {range.start}
                        {range.end !== null ? `–${range.end}` : <span className="font-sans"> – {t("pb_privacy_until_end")}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {isAdmin ? (
            <div className="card space-y-2">
              <h3 className="section-title mb-2">
                {t("detected_faces_count")} ({detectedFaces.length})
              </h3>
              {detectedFaces.length === 0 ? (
                <p className="text-xs text-text-muted py-4 text-center">
                  {t("detected_faces_empty")}
                  <br />
                  <span className="text-text-faint">
                    {t("detected_faces_hint")}
                  </span>
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 max-h-60 overflow-y-auto">
                  {detectedFaces.map((f) => (
                    <div
                      key={f.id}
                      className="relative"
                      title={`#${f.display_no} · ${f.filename}`}
                    >
                      <FaceThumb
                        faceId={f.id}
                        alt={f.filename}
                        className="aspect-square rounded"
                        sealed={f.crop_sealed}
                      />
                      <span className="absolute top-0.5 left-0.5 z-10 text-[10px] font-bold leading-none px-1 py-0.5 rounded bg-black/70 text-accent">
                        #{f.display_no}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card border border-warning/30 bg-warning/5">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <h3 className="section-title text-warning">
                    {t("admin_only_label")}
                  </h3>
                  <p className="text-xs text-text-soft leading-relaxed">
                    {t("face_data_admin_only")}
                  </p>
                  <p className="text-[10px] text-text-muted leading-relaxed pt-1 border-t border-text-muted/5 mt-2">
                    {t("privacy_design_note")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isAdmin && !revealable && (
            <div className="card text-xs text-text-muted leading-relaxed">
              {faceEncrypted ? t("reveal_not_possible_face_envelope") : t("reveal_not_possible")}
            </div>
          )}

          {isAdmin && revealHistory.length > 0 && (
            <div className="card space-y-2">
              <h3 className="section-title mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                {t("pb_reveal_history_title")} ({revealHistory.length})
              </h3>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {revealHistory.map((h) => {
                  // A privacy-policy refusal is final, not a failure to retry.
                  const withheld = h.status === "failed" && revealWithheldByPrivacy(h.error_message);
                  return (
                  <li
                    key={h.id}
                    className="text-[11px] leading-relaxed border-l-2 pl-2 py-1"
                    style={{
                      borderColor:
                        h.status === "completed"
                          ? "rgb(34 197 94 / 0.6)"
                          : withheld
                          ? "rgb(0 212 255 / 0.4)"
                          : h.status === "rejected" || h.status === "failed"
                          ? "rgb(244 63 94 / 0.6)"
                          : "rgb(0 212 255 / 0.4)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-text">
                      {h.status === "completed" ? (
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                      ) : withheld ? (
                        <Lock className="w-3 h-3 text-accent shrink-0" aria-label={t("reveal_withheld_privacy")} />
                      ) : h.status === "rejected" || h.status === "failed" ? (
                        <XCircle className="w-3 h-3 text-danger shrink-0" />
                      ) : (
                        <Hourglass className="w-3 h-3 text-accent shrink-0" />
                      )}
                      <span className="font-mono text-text-soft">
                        {h.id.slice(0, 8)}
                      </span>
                      <span className="text-text-muted">·</span>
                      <span className="font-medium">{h.method}</span>
                      {h.target_start_sec !== null && h.target_end_sec !== null && (
                        <>
                          <span className="text-text-muted">·</span>
                          <span className="text-accent font-mono">
                            ⏱ {formatVideoOffset(h.target_start_sec)}→{formatVideoOffset(h.target_end_sec)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-text-muted">
                      {h.requested_email}
                      {h.approved_email && h.approved_email !== h.requested_email && (
                        <span className="text-success"> · {t("pb_approved_by")} {h.approved_email}</span>
                      )}
                      {h.rejected_email && (
                        <span className="text-danger"> · {t("pb_rejected_by")} {h.rejected_email}</span>
                      )}
                    </div>
                    <div className="text-text-faint">
                      {formatDate(h.created_at)}
                      {h.threshold !== null && (
                        <span className="text-text-muted"> · {t("pb_threshold")} {h.threshold}</span>
                      )}
                      {withheld && (
                        <span className="text-accent"> · {t("reveal_withheld_privacy")}</span>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Lock;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
      {/* w-24: the longest label ("Шифрлэгдсэн", mn) fits whole — a label never breaks mid-word. */}
      <div className="text-text-muted w-24 shrink-0">{label}</div>
      <div className="text-text flex-1">{children}</div>
    </div>
  );
}

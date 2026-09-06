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
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { PlaybackPlayer } from "./playback-player";
import { FaceThumb } from "@/components/face-thumb";
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
  const { profile } = await requireUser();
  const { t } = await getT();
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";

  const { data: rec } = await supabase
    .from("recordings")
    .select(
      "id, filename, storage_path, original_path, duration_sec, size_bytes, encrypted, has_original, blur_strategy, camera_id, camera_name, started_at, ended_at"
    )
    .eq("id", id)
    .single();

  if (!rec) notFound();

  // Choose the playback URL based on blur_strategy:
  //   • baked     — signed link to the plaintext blurred MP4 in the `recordings`
  //                 storage bucket (the legacy artifact).
  //   • on_demand — points at /api/recordings/[id]/view, which proxies the
  //                 ML service. The ML side decrypts the encrypted original
  //                 and derives the blurred view at request time (#3: one
  //                 encrypted source of truth — no plaintext blurred MP4 exists).
  let blurredUrl: string | null = null;
  if (rec.blur_strategy === "on_demand") {
    blurredUrl = `/api/recordings/${rec.id}/view`;
  } else {
    const { data: signed } = await supabase.storage
      .from("recordings")
      .createSignedUrl(rec.storage_path, 60 * 30);
    blurredUrl = signed?.signedUrl ?? null;
  }

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
    created_at: string;
    completed_at: string | null;
  };
  const { data: revealHistoryRaw } = isAdmin
    ? await supabase
        .from("reveal_jobs")
        .select(
          "id, status, method, threshold, target_start_sec, target_end_sec, requested_email, approved_email, rejected_email, created_at, completed_at",
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
              {rec.has_original ? (
                <span className="text-success">{t("rec_original_kept")}</span>
              ) : (
                <span className="text-text-muted">{t("rec_original_missing")}</span>
              )}
            </Row>
          </div>

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

          {isAdmin && !rec.has_original && (
            <div className="card text-xs text-text-muted leading-relaxed">
              {t("reveal_not_possible")}
            </div>
          )}

          {isAdmin && revealHistory.length > 0 && (
            <div className="card space-y-2">
              <h3 className="section-title mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                {t("pb_reveal_history_title")} ({revealHistory.length})
              </h3>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {revealHistory.map((h) => (
                  <li
                    key={h.id}
                    className="text-[11px] leading-relaxed border-l-2 pl-2 py-1"
                    style={{
                      borderColor:
                        h.status === "completed"
                          ? "rgb(34 197 94 / 0.6)"
                          : h.status === "rejected" || h.status === "failed"
                          ? "rgb(244 63 94 / 0.6)"
                          : "rgb(0 212 255 / 0.4)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-text">
                      {h.status === "completed" ? (
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
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
                            ⏱ {fmtSec(h.target_start_sec)}→{fmtSec(h.target_end_sec)}
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
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function fmtSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
      <div className="text-text-muted w-20 shrink-0">{label}</div>
      <div className="text-text flex-1">{children}</div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, Calendar, Camera as CamIcon, Clock, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { PlaybackPlayer } from "./playback-player";

// Cache хийхгүй — faces background processing-аар нэмэгддэг тул хэзээ нээгдсэн
// үед хамгийн сүүлийн өгөгдлийг харуулах ёстой.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlaybackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireUser();
  const supabase = await createClient();

  const { data: rec } = await supabase
    .from("recordings")
    .select(
      "id, filename, storage_path, original_path, duration_sec, size_bytes, encrypted, has_original, camera_id, camera_name, started_at, ended_at"
    )
    .eq("id", id)
    .single();

  if (!rec) notFound();

  // Blurred бичлэгийн signed URL
  const { data: signed } = await supabase.storage
    .from("recordings")
    .createSignedUrl(rec.storage_path, 60 * 30);
  const blurredUrl = signed?.signedUrl ?? null;

  // Тухайн бичлэгт detect хийгдсэн нүүрнүүд + bbox + time_in_video_sec
  type FaceRow = {
    id: string;
    filename: string;
    image_path: string;
    detected_at: string;
    time_in_video_sec: number | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
  };
  const { data: facesRaw } = await supabase.rpc("faces_in_recording", { rec_id: id });
  const facesInRec = (facesRaw ?? []) as FaceRow[];

  // Face crop signed URL-уудыг batch
  const facesWithSigned = await Promise.all(
    facesInRec.map(async (f) => {
      const { data } = await supabase.storage
        .from("faces")
        .createSignedUrl(f.image_path, 60 * 30);
      return { ...f, signed: data?.signedUrl ?? null };
    })
  );

  // Бүх илэрсэн нүүрд detected_at-аар sorted дугаар (#1..#N) өгнө —
  // playback-ын overlay болон reveal modal хоёр ижил дугаартай байна.
  const numberedFaces = facesWithSigned.map((f, idx) => ({
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
      signed: f.signed,
      time_in_video_sec: f.time_in_video_sec as number,
      bbox: f.bbox,
    }));

  // Modal жагсаалтанд (3-р tab) — бүгдийг дугаартай нь
  const detectedFaces = numberedFaces.map((f) => ({
    id: f.id,
    display_no: f.display_no,
    filename: f.filename,
    detected_at: f.detected_at,
    signed: f.signed,
  }));

  // Suspects (admin л харах)
  const { data: suspects } = profile.role === "admin"
    ? await supabase.from("suspects").select("id, name, image_path").order("name")
    : { data: null };

  return (
    <>
      <Link
        href="/playback"
        className="text-sm text-neutral-400 hover:text-neutral-100 inline-flex items-center gap-1.5 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Playback
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
              isAdmin={profile.role === "admin"}
            />
          ) : (
            <div className="card aspect-video bg-black flex items-center justify-center text-neutral-500 text-sm">
              Бичлэг олдсонгүй
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">
              Бичлэгийн мэдээлэл
            </h3>
            <Row icon={Calendar} label="Эхэлсэн">{formatDate(rec.started_at)}</Row>
            <Row icon={Clock} label="Үргэлжлэх">
              {rec.duration_sec ? `${rec.duration_sec}s` : "—"}
            </Row>
            <Row icon={CamIcon} label="Камер">{rec.camera_name ?? "—"}</Row>
            <Row icon={Lock} label="Encrypted">
              {rec.encrypted ? "Тийм (Storage RLS)" : "Үгүй"}
            </Row>
            <Row icon={ShieldCheck} label="Original">
              {rec.has_original ? (
                <span className="text-success">Хадгалагдсан · Reveal боломжтой</span>
              ) : (
                <span className="text-neutral-500">Алга — reveal боломжгүй</span>
              )}
            </Row>
          </div>

          <div className="card space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">
              Илрүүлсэн нүүр ({detectedFaces.length})
            </h3>
            {detectedFaces.length === 0 ? (
              <p className="text-xs text-neutral-500 py-4 text-center">
                Энэ бичлэгт нүүр илрүүлэгдээгүй байна.
                <br />
                <span className="text-neutral-600">
                  (Шинэ recording-ууд автоматаар bbox-той хадгалагдана)
                </span>
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 max-h-60 overflow-y-auto">
                {detectedFaces.map((f) => (
                  <div
                    key={f.id}
                    className="relative aspect-square rounded overflow-hidden bg-bg-tertiary"
                    title={`#${f.display_no} · ${f.filename}`}
                  >
                    {f.signed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.signed}
                        alt={f.filename}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : null}
                    <span className="absolute top-0.5 left-0.5 text-[10px] font-bold leading-none px-1 py-0.5 rounded bg-black/70 text-accent">
                      #{f.display_no}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {profile.role === "admin" && !rec.has_original && (
            <div className="card text-xs text-neutral-500 leading-relaxed">
              Энэ бичлэгт original хадгалагдаагүй учир Reveal боломжгүй.
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
      <Icon className="w-3.5 h-3.5 text-neutral-500 mt-0.5 shrink-0" />
      <div className="text-neutral-500 w-20 shrink-0">{label}</div>
      <div className="text-neutral-200 flex-1">{children}</div>
    </div>
  );
}

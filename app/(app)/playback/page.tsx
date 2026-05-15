import { PlayCircle, FileVideo, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

// Шинэ recording, шинэ faces автоматаар харагдах ёстой
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlaybackPage() {
  await requireUser();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: recordings } = await supabase
    .from("recordings")
    .select("id, filename, storage_path, duration_sec, size_bytes, encrypted, camera_name, started_at, has_original")
    .order("started_at", { ascending: false })
    .limit(100);

  // Бичлэг бүрд хэдэн нүүр илрүүлсэнг тоолно
  const recIds = (recordings ?? []).map((r) => r.id);
  const { data: faceCountsRaw } = recIds.length
    ? await supabase
        .from("faces")
        .select("recording_id")
        .in("recording_id", recIds)
    : { data: [] };
  const faceCounts = new Map<string, number>();
  for (const row of faceCountsRaw ?? []) {
    if (row.recording_id) {
      faceCounts.set(row.recording_id, (faceCounts.get(row.recording_id) ?? 0) + 1);
    }
  }

  // Огноогоор бүлэглэх
  const grouped = new Map<string, typeof recordings>();
  for (const r of recordings ?? []) {
    const day = r.started_at.slice(0, 10);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(r);
  }

  return (
    <>
      <PageHeader title={t("nav_playback")} />

      {!recordings?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([day, items]) => (
            <div key={day}>
              <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
                {day} · {items?.length ?? 0} бичлэг
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items?.map((r) => {
                  const fc = faceCounts.get(r.id) ?? 0;
                  return (
                    <a
                      key={r.id}
                      href={`/playback/${r.id}`}
                      className="card flex items-center gap-3 hover:bg-white/[0.02] transition"
                    >
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <FileVideo className="w-5 h-5 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {r.filename}
                          {r.encrypted && <Lock className="w-3 h-3 text-warning" />}
                        </div>
                        <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                          <span>{formatDate(r.started_at)}</span>
                          <span>·</span>
                          <span>{r.camera_name ?? "—"}</span>
                          <span>·</span>
                          <span>{r.size_bytes ? `${Math.round(r.size_bytes / 1024 / 1024)}MB` : "—"}</span>
                          <span>·</span>
                          <span className={fc > 0 ? "text-accent" : "text-neutral-600"}>
                            {fc} нүүр
                          </span>
                          {!r.has_original && (
                            <>
                              <span>·</span>
                              <span className="text-neutral-600">reveal-гүй</span>
                            </>
                          )}
                        </div>
                      </div>
                      <PlayCircle className="w-4 h-4 text-neutral-400" />
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

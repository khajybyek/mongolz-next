import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { FaceThumb } from "@/components/face-thumb";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, filename, image_path, detected_at, camera_id, recording_id, reviewed, review_label, crop_sealed")
    .order("detected_at", { ascending: false })
    .limit(100);

  const unreviewed = (faces ?? []).filter((f) => !f.reviewed);
  const reviewed = (faces ?? []).filter((f) => f.reviewed);

  return (
    <>
      <PageHeader
        title={t("review_title")}
        subtitle={`${unreviewed.length} ${t("review_unreviewed")} · ${reviewed.length} ${t("review_reviewed")}`}
      />

      {!unreviewed.length ? (
        <Empty message={t("review_empty")} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {unreviewed.map((f) => (
            <div key={f.id} className="card p-0 overflow-hidden">
              <FaceThumb faceId={f.id} alt={f.filename} className="aspect-square" sealed={f.crop_sealed} />
              <div className="p-2 space-y-1.5">
                <div className="text-[10px] text-text-muted truncate">{formatDate(f.detected_at)}</div>
                <ReviewActions faceId={f.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

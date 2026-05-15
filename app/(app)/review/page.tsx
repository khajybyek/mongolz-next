import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { formatDate } from "@/lib/utils";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, filename, image_path, detected_at, camera_id, recording_id, reviewed, review_label")
    .order("detected_at", { ascending: false })
    .limit(100);

  const unreviewed = (faces ?? []).filter((f) => !f.reviewed);
  const reviewed = (faces ?? []).filter((f) => f.reviewed);

  const facesWithUrls = await Promise.all(
    unreviewed.map(async (f) => {
      const { data } = await supabase.storage.from("faces").createSignedUrl(f.image_path, 3600);
      return { ...f, signedUrl: data?.signedUrl ?? null };
    })
  );

  return (
    <>
      <PageHeader
        title="Human Review"
        subtitle={`${unreviewed.length} unreviewed · ${reviewed.length} reviewed`}
      />

      {!facesWithUrls.length ? (
        <Empty message="No faces to review" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {facesWithUrls.map((f) => (
            <div key={f.id} className="card p-0 overflow-hidden">
              <div className="aspect-square bg-bg-tertiary relative">
                {f.signedUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.signedUrl} alt={f.filename} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="p-2 space-y-1.5">
                <div className="text-[10px] text-neutral-500 truncate">{formatDate(f.detected_at)}</div>
                <ReviewActions faceId={f.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

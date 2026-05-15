import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export default async function FacesPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, filename, image_path, detected_at, camera_id")
    .order("detected_at", { ascending: false })
    .limit(120);

  return (
    <>
      <PageHeader title={t("nav_faces")} subtitle={`${faces?.length ?? 0} царай`} />

      {!faces?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {faces.map((f) => (
            <div key={f.id} className="card p-1.5">
              <div className="aspect-square bg-bg-tertiary rounded mb-1.5" />
              <div className="text-[10px] text-neutral-500 truncate">
                {formatDate(f.detected_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SEC = 600;
const PAGE_LIMIT = 120;

export default async function FacesPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, filename, image_path, detected_at, camera_id, cameras:cameras(name)")
    .order("detected_at", { ascending: false })
    .limit(PAGE_LIMIT);

  const rows = (faces ?? []) as Array<{
    id: string;
    filename: string;
    image_path: string;
    detected_at: string;
    camera_id: string | null;
    cameras: { name: string } | { name: string }[] | null;
  }>;

  const urlByPath = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from("faces")
      .createSignedUrls(rows.map((f) => f.image_path), SIGNED_URL_TTL_SEC);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }

  return (
    <>
      <PageHeader title={t("nav_faces")} subtitle={`${rows.length} царай`} />

      {!rows.length ? (
        <Empty message={t("empty")} />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {rows.map((f) => {
            const url = urlByPath.get(f.image_path);
            const cam = Array.isArray(f.cameras) ? f.cameras[0] : f.cameras;
            return (
              <div key={f.id} className="card p-1.5">
                <div className="aspect-square bg-bg-tertiary rounded mb-1.5 overflow-hidden">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={f.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageOff className="w-4 h-4 text-neutral-600" />
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 truncate">
                  {formatDate(f.detected_at)}
                </div>
                {cam?.name && (
                  <div className="text-[10px] text-neutral-600 truncate" title={cam.name}>
                    {cam.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

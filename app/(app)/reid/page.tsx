import { PageHeader } from "@/components/ui/page-header";
import { Footprints } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ReidView } from "./reid-view";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 600;
const THUMB_LIMIT = 36;

export default async function ReidPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: faces } = await supabase
    .from("faces")
    .select("id, image_path, detected_at, cameras:cameras(name)")
    .order("detected_at", { ascending: false })
    .limit(THUMB_LIMIT);

  const rows = (faces ?? []) as Array<{
    id: string;
    image_path: string;
    detected_at: string;
    cameras: { name: string } | { name: string }[] | null;
  }>;

  const urlByPath = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from("faces")
      .createSignedUrls(rows.map((r) => r.image_path), SIGNED_URL_TTL);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }

  const thumbs = rows.map((r) => {
    const cam = Array.isArray(r.cameras) ? r.cameras[0] : r.cameras;
    return {
      id: r.id,
      image_url: urlByPath.get(r.image_path) ?? null,
      detected_at: r.detected_at,
      camera_name: cam?.name ?? null,
    };
  });

  return (
    <>
      <PageHeader
        title={t("reid_title")}
        subtitle={t("reid_subtitle")}
        icon={<Footprints className="w-5 h-5" />}
      />
      <ReidView initialThumbs={thumbs} />
    </>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { Footprints } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ReidView } from "./reid-view";

export const dynamic = "force-dynamic";

const THUMB_LIMIT = 36;

export default async function ReidPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  // ADR 0009 / Tier 2: face crop-уудыг client дотроос <FaceThumb faceId>
  // unified endpoint-оор унш — server-аас signed URL bake хийхгүй (storage
  // layer encrypt-only болоход thumbnail тооцоо хийгдэхгүй).
  const { data: faces } = await supabase
    .from("faces")
    .select("id, detected_at, cameras:cameras(name)")
    .order("detected_at", { ascending: false })
    .limit(THUMB_LIMIT);

  const rows = (faces ?? []) as Array<{
    id: string;
    detected_at: string;
    cameras: { name: string } | { name: string }[] | null;
  }>;

  const thumbs = rows.map((r) => {
    const cam = Array.isArray(r.cameras) ? r.cameras[0] : r.cameras;
    return {
      id: r.id,
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

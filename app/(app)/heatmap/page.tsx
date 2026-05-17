import { PageHeader } from "@/components/ui/page-header";
import { Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { HeatmapView } from "./heatmap-view";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: cams } = await supabase
    .from("cameras")
    .select("id, name")
    .order("name", { ascending: true });

  const cameras = (cams ?? []) as Array<{ id: string; name: string }>;

  return (
    <>
      <PageHeader
        title={t("heatmap_title")}
        subtitle={t("heatmap_subtitle")}
        icon={<Flame className="w-5 h-5" />}
      />
      <HeatmapView cameras={cameras} />
    </>
  );
}

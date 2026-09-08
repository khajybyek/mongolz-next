import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { EdgeDetectView } from "./edge-detect-view";

export default async function EdgeDetectPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_edge_detect")}
        subtitle={t("edge_subtitle")}
      />
      <p className="mb-4 text-xs text-text-muted">{t("demo_english_only")}</p>
      <EdgeDetectView />
    </>
  );
}

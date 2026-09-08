import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ClusterView } from "./cluster-view";

export default async function ClustersPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_clusters")}
        subtitle={t("clusters_subtitle")}
      />
      <ClusterView />
    </>
  );
}

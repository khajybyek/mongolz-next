import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { ClusterView } from "./cluster-view";

export default async function ClustersPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Face Clustering"
        subtitle="DBSCAN clustering — group similar faces by identity"
      />
      <ClusterView />
    </>
  );
}

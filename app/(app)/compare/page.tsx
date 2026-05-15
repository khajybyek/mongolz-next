import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { CompareView } from "./compare-view";

export default async function ComparePage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Algorithm Compare"
        subtitle="Blur algorithm comparison — Cubist Mosaic vs Gaussian vs Pixelate"
      />
      <CompareView />
    </>
  );
}

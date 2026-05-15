import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { BenchmarksView } from "./benchmarks-view";

export default async function BenchmarksPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Performance Benchmarks"
        subtitle="Detection + embedding latency on Railway ML service"
      />
      <BenchmarksView />
    </>
  );
}

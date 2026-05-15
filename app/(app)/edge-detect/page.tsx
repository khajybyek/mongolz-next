import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { EdgeDetectView } from "./edge-detect-view";

export default async function EdgeDetectPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Edge Inference (WebGPU)"
        subtitle="Browser-side face detection — no server round-trip"
      />
      <EdgeDetectView />
    </>
  );
}

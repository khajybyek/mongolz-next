import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { ThresholdTuner } from "./threshold-tuner";

export default async function ThresholdsPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Threshold Tuning"
        subtitle="Adjust detection, alert, and dedup thresholds"
      />
      <ThresholdTuner />
    </>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ThresholdTuner } from "./threshold-tuner";

export default async function ThresholdsPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_thresholds")}
        subtitle={t("thr_subtitle")}
      />
      <ThresholdTuner />
    </>
  );
}

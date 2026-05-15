import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { EvalDashboard } from "./eval-dashboard";

export default async function EvalPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="ML Evaluation"
        subtitle="F1 / FPR / SSIM — Detection & Blur Quality Metrics"
      />
      <EvalDashboard />
    </>
  );
}

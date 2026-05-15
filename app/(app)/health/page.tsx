import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { HealthDashboard } from "./health-dashboard";

export default async function HealthPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader title="System Health" subtitle="Service status & connectivity" />
      <HealthDashboard />
    </>
  );
}

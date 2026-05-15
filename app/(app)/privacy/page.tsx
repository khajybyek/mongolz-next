import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { PrivacyDashboard } from "./privacy-dashboard";

export default async function PrivacyPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Differential Privacy"
        subtitle="Privacy-preserving face embeddings with (ε, δ)-guarantees"
      />
      <PrivacyDashboard />
    </>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { ZKRevealView } from "./zk-reveal-view";

export default async function ZKRevealPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Zero-Knowledge Reveal"
        subtitle="ZK proof protocol for privacy-preserving face reveal authorization"
      />
      <ZKRevealView />
    </>
  );
}

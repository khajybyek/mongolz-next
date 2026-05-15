import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { MultiCameraGrid } from "./multi-camera-grid";

export default async function GridPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: cameras } = await supabase
    .from("cameras")
    .select("id, name, cam_type, enabled")
    .eq("enabled", true)
    .order("name");

  return (
    <>
      <PageHeader title="Multi-Camera Grid" subtitle={`${cameras?.length ?? 0} active cameras`} />
      <MultiCameraGrid cameras={cameras ?? []} />
    </>
  );
}

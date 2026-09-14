import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { SearchForm } from "./search-form";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ incident?: string }> }) {
  await requireAdmin();
  const { t } = await getT();
  const params = (await searchParams) ?? {};
  const initialIncidentId = typeof params.incident === "string" && UUID_RE.test(params.incident) ? params.incident : "";
  const supabase = await createClient();
  const [cameraRes, incidentRes] = await Promise.all([
    supabase.from("cameras").select("id,name").order("name"),
    supabase.from("incidents").select("id,title,status").in("status", ["open", "investigating"]).order("updated_at", { ascending: false }).limit(100),
  ]);

  return (
    <>
      <PageHeader title={t("face_search")} subtitle={t("upload_face")} />
      <SearchForm
        cameras={cameraRes.data ?? []}
        incidents={incidentRes.data ?? []}
        initialIncidentId={initialIncidentId}
      />
    </>
  );
}

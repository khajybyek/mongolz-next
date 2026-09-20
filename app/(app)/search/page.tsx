import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { SearchForm } from "./search-form";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/workflow-query";

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ incident?: string }> }) {
  const { user } = await requireAdmin();
  const { t } = await getT();
  const params = (await searchParams) ?? {};
  const initialIncidentId = typeof params.incident === "string" && UUID_RE.test(params.incident) ? params.incident : "";
  const supabase = await createClient();
  const [cameraRes, incidentRes, suspectRes, presetRes] = await Promise.all([
    supabase.from("cameras").select("id,name").order("name"),
    supabase.from("incidents").select("id,title,status").order("updated_at", { ascending: false }).limit(200),
    supabase.from("suspects").select("id,name").order("name").limit(500),
    supabase.from("face_search_presets")
      .select("id,name,camera_id,from_at,to_at,recording_status,min_confidence,suspect_id,incident_id,match_threshold,result_limit")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title={t("face_search")} subtitle={t("upload_face")} />
      <SearchForm
        cameras={cameraRes.data ?? []}
        incidents={incidentRes.data ?? []}
        suspects={suspectRes.data ?? []}
        initialPresets={presetRes.data ?? []}
        initialIncidentId={initialIncidentId}
      />
    </>
  );
}

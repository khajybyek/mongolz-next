import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { RuleForm } from "./rule-form";
import { RulesTable } from "./rules-table";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [rulesRes, suspectsRes, camerasRes] = await Promise.all([
    supabase
      .from("alert_rules")
      .select(`id, name, enabled, min_similarity, dedup_window_sec,
               burst_count, burst_window_sec, quiet_from, quiet_to,
               suspect_id, camera_id, created_at,
               suspects:suspects(name), cameras:cameras(name)`)
      .order("created_at", { ascending: false }),
    supabase.from("suspects").select("id, name").order("name"),
    supabase.from("cameras").select("id, name").order("name"),
  ]);

  const rules = (rulesRes.data ?? []).map((r) => {
    const susp = Array.isArray(r.suspects) ? r.suspects[0] : r.suspects;
    const cam = Array.isArray(r.cameras) ? r.cameras[0] : r.cameras;
    return { ...r, suspect_name: susp?.name ?? null, camera_name: cam?.name ?? null };
  });

  return (
    <>
      <PageHeader
        title="Alert Rules"
        subtitle={`${rules.length} дүрэм · dedup + custom thresholds`}
      />

      <RuleForm
        suspects={suspectsRes.data ?? []}
        cameras={camerasRes.data ?? []}
      />

      {rules.length === 0 ? (
        <Empty message="Хараахан дүрэм байхгүй. Дээрх формоор үүсгэнэ үү." />
      ) : (
        <RulesTable rules={rules} />
      )}
    </>
  );
}

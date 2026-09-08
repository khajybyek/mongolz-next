import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { EvalDashboard } from "./eval-dashboard";

export default async function EvalPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_eval")}
        subtitle={t("eval_subtitle")}
      />
      <p className="mb-4 text-xs text-text-muted">{t("demo_english_only")}</p>
      <EvalDashboard />
    </>
  );
}

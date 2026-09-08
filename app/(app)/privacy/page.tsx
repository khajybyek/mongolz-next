import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { PrivacyDashboard } from "./privacy-dashboard";

export default async function PrivacyPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("dp_title")}
        subtitle={t("dp_subtitle")}
      />
      <p className="mb-4 text-xs text-text-muted">{t("demo_english_only")}</p>
      <PrivacyDashboard />
    </>
  );
}

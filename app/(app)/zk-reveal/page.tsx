import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ZKRevealView } from "./zk-reveal-view";

export default async function ZKRevealPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_zk_reveal")}
        subtitle={t("zk_subtitle")}
      />
      <p className="mb-4 text-xs text-text-muted">{t("demo_english_only")}</p>
      <ZKRevealView />
    </>
  );
}

import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { CompareView } from "./compare-view";

export default async function ComparePage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("compare_title")}
        subtitle={t("compare_subtitle")}
        icon={<ShieldCheck className="w-5 h-5" />}
      />
      <CompareView />
    </>
  );
}

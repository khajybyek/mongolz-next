import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { MlLabView } from "./view";

export const dynamic = "force-dynamic";

export default async function MlLabPage() {
  await requireAdmin();
  const { t } = await getT();
  return (
    <>
      <PageHeader
        title={t("ml_lab_title")}
        subtitle={t("ml_lab_subtitle")}
        icon={<Sparkles className="w-5 h-5" />}
      />
      <MlLabView />
    </>
  );
}

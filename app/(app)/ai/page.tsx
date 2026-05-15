import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { AIChat } from "./ai-chat";

export default async function AIPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader
        title={t("nav_ai")}
        subtitle="Claude AI-р DB-н статистик дээр шинжилгээ хийнэ"
      />
      <AIChat />
    </>
  );
}

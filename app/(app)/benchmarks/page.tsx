import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { BenchmarksView } from "./benchmarks-view";

export default async function BenchmarksPage() {
  await requireAdmin();
  const { t } = await getT();
  return (
    <>
      <PageHeader
        title={t("nav_benchmarks")}
        subtitle={t("bench_subtitle")}
      />
      <p className="mb-4 text-xs text-text-muted">{t("demo_english_only")}</p>
      <BenchmarksView />
    </>
  );
}

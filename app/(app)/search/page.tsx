import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { SearchForm } from "./search-form";

export default async function SearchPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader title={t("face_search")} subtitle={t("upload_face")} />
      <SearchForm />
    </>
  );
}

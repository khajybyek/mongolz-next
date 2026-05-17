import { PageHeader } from "@/components/ui/page-header";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { ZonesView } from "./zones-view";

export const dynamic = "force-dynamic";

export default async function PrivacyZonesPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: cams } = await supabase
    .from("cameras")
    .select("id, name")
    .order("name", { ascending: true });

  const cameras = (cams ?? []) as Array<{ id: string; name: string }>;

  return (
    <>
      <PageHeader
        title={t("zones_title")}
        subtitle={t("zones_subtitle")}
        icon={<Lock className="w-5 h-5" />}
      />
      <ZonesView cameras={cameras} />
    </>
  );
}

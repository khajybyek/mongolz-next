import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { WebhookKind } from "@/lib/database.types";
import { WebhookForm } from "./webhook-form";
import { WebhooksTable } from "./webhooks-table";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: hooks } = await supabase
    .from("webhooks")
    .select("id, name, kind, url, enabled, events, last_fired_at, last_status, fail_count, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title={t("webhooks_title")}
        subtitle={`${hooks?.length ?? 0} · Slack / Discord / generic`}
      />

      <WebhookForm />

      {!hooks?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <WebhooksTable
          hooks={hooks.map((h) => ({
            ...h,
            kind: h.kind as WebhookKind,
            created_at: formatDate(h.created_at),
            last_fired_at: h.last_fired_at ? formatDate(h.last_fired_at) : null,
          }))}
        />
      )}
    </>
  );
}

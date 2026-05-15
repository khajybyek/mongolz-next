import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { WebhookForm } from "./webhook-form";
import { WebhooksTable } from "./webhooks-table";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: hooks } = await supabase
    .from("webhooks")
    .select("id, name, kind, url, enabled, events, last_fired_at, last_status, fail_count, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle={`${hooks?.length ?? 0} integration · Slack / Discord / generic`}
      />

      <WebhookForm />

      {!hooks?.length ? (
        <Empty message="Хараахан webhook байхгүй" />
      ) : (
        <WebhooksTable
          hooks={hooks.map((h) => ({
            ...h,
            created_at: formatDate(h.created_at),
            last_fired_at: h.last_fired_at ? formatDate(h.last_fired_at) : null,
          }))}
        />
      )}
    </>
  );
}

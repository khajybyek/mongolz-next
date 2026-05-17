import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { UsersTable } from "./users-table";
import { CreateUserForm } from "./create-user-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await requireAdmin();
  const { t } = await getT();
  const svc = createServiceClient();

  const { data: profiles } = await svc
    .from("profiles")
    .select("id, email, full_name, role, totp_enabled, is_super_admin, created_at, updated_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title={t("users_title")}
        subtitle={`${profiles?.length ?? 0} ${t("users_subtitle")}`}
      />

      <CreateUserForm />

      {!profiles?.length ? (
        <Empty message={t("empty")} />
      ) : (
        <UsersTable
          users={profiles.map((p) => ({
            id: p.id,
            email: p.email,
            full_name: p.full_name,
            role: p.role,
            totp_enabled: p.totp_enabled,
            is_super_admin: p.is_super_admin ?? false,
            created_at: formatDate(p.created_at),
          }))}
          currentUserId={ctx.user.id}
        />
      )}
    </>
  );
}

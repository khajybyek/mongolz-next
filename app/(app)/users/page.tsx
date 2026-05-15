import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { UsersTable } from "./users-table";
import { CreateUserForm } from "./create-user-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await requireAdmin();
  const svc = createServiceClient();

  const { data: profiles } = await svc
    .from("profiles")
    .select("id, email, full_name, role, totp_enabled, created_at, updated_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Хэрэглэгчийн удирдлага"
        subtitle={`${profiles?.length ?? 0} нийт хэрэглэгч`}
      />

      <CreateUserForm />

      {!profiles?.length ? (
        <Empty message="Хэрэглэгч байхгүй байна" />
      ) : (
        <UsersTable
          users={profiles.map((p) => ({
            id: p.id,
            email: p.email,
            full_name: p.full_name,
            role: p.role,
            totp_enabled: p.totp_enabled,
            created_at: formatDate(p.created_at),
          }))}
          currentUserId={ctx.user.id}
        />
      )}
    </>
  );
}

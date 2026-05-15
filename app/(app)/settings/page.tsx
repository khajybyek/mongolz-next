import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TotpSettings } from "./totp-settings";

export default async function SettingsPage() {
  const { user, profile } = await requireUser();

  // Profile-аас шууд totp_enabled татна
  const svc = createServiceClient();
  const { data: prof } = await svc
    .from("profiles")
    .select("totp_enabled")
    .eq("id", user.id)
    .single();

  return (
    <>
      <PageHeader title="Тохиргоо" subtitle="Аюулгүй байдал ба хувийн тохиргоо" />
      <div className="max-w-xl space-y-6">
        <TotpSettings
          email={user.email}
          enabled={Boolean(prof?.totp_enabled)}
          role={profile.role}
        />
      </div>
    </>
  );
}

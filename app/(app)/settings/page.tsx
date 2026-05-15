import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TotpSettings } from "./totp-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ force_totp?: string }>;
}) {
  // Admin-only page. Viewer requests redirect via requireAdmin.
  const { user, profile } = await requireAdmin();
  const { force_totp } = await searchParams;

  // Profile-аас шууд totp_enabled татна
  const svc = createServiceClient();
  const { data: prof } = await svc
    .from("profiles")
    .select("totp_enabled")
    .eq("id", user.id)
    .single();

  const enabled = Boolean(prof?.totp_enabled);
  const mustSetup = force_totp === "1" || !enabled;

  return (
    <>
      <PageHeader title="Тохиргоо" subtitle="Аюулгүй байдал ба хувийн тохиргоо" />
      <div className="max-w-xl space-y-6">
        {mustSetup && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <div className="font-semibold mb-1">⚠ TOTP 2-Factor Authentication заавал тохируулна уу</div>
            <p className="text-warning/90 leading-relaxed">
              Admin role-той бол TOTP идэвхжүүлэх хүртэл бусад хуудаст хандах боломжгүй.
              Доорх QR-ыг scan хийгээд 6-digit код оруулна уу.
            </p>
          </div>
        )}
        <TotpSettings
          email={user.email}
          enabled={enabled}
          role={profile.role}
        />
      </div>
    </>
  );
}

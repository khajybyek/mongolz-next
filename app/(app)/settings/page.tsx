import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { TotpSettings } from "./totp-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ force_totp?: string }>;
}) {
  // Admin-only page. Viewer requests redirect via requireAdmin.
  const { user, profile } = await requireAdmin();
  const { t } = await getT();
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
      <PageHeader title={t("settings_title")} subtitle={t("settings_subtitle")} />
      <div className="max-w-xl space-y-6">
        {mustSetup && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <div className="font-semibold mb-1">{t("force_totp_title")}</div>
            <p className="text-warning/90 leading-relaxed">{t("force_totp_text")}</p>
          </div>
        )}
        <TotpSettings email={user.email} enabled={enabled} role={profile.role} />

        <div className="card space-y-3">
          <h3 className="text-sm font-semibold">{t("my_data_title")}</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">{t("my_data_text")}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a href="/api/gdpr/export" className="btn-secondary text-sm flex-1 text-center">
              {t("my_data_download")}
            </a>
            <a href="/settings/erase" className="btn-danger text-sm flex-1 text-center">
              {t("my_data_erase")}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

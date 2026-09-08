import { Download, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { EraseForm } from "../settings/erase/erase-form";

export const dynamic = "force-dynamic";

/**
 * Self-service GDPR surface for every signed-in role.
 *
 * /privacy is the admin-only differential-privacy demo; before this page the
 * navigation pointed non-admins at it, so a viewer was bounced to /dashboard
 * and could not exercise Article 15 (export) or Article 17 (erasure) at all.
 * Both API routes already scope to the calling user, so the only thing missing
 * was a page the caller is allowed to open.
 */
export default async function MyDataPage() {
  const { user, profile } = await requireUser();
  const { t } = await getT();

  return (
    <>
      <PageHeader title={t("my_data_title")} subtitle={t("mydata_subtitle")} />

      <div className="max-w-xl space-y-4 mt-4">
        <div className="card space-y-3">
          <h3 className="section-title">{t("mydata_export_title")}</h3>
          <p className="text-xs text-text-soft leading-relaxed">{t("mydata_export_text")}</p>
          <a href="/api/gdpr/export" className="btn-secondary w-full">
            <Download className="w-4 h-4" />
            {t("my_data_download")}
          </a>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-danger shrink-0" />
            <h3 className="section-title text-danger">{t("mydata_erase_title")}</h3>
          </div>
          <p className="text-xs text-text-soft leading-relaxed">{t("mydata_erase_text")}</p>
          <EraseForm
            email={user.email}
            role={profile.role}
            totpEnabled={Boolean(profile.totp_enabled)}
          />
        </div>
      </div>
    </>
  );
}

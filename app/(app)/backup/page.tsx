import { AlertTriangle, ArchiveRestore, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { BackupButton } from "./backup-button";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const { profile } = await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader title={t("backup_title")} subtitle={t("backup_subtitle")} />

      <div className="max-w-2xl space-y-4 mt-4">
        <BackupButton
          label={t("backup_download")}
          biometricLabel={t("backup_include_biometrics")}
          biometricHelp={t("backup_include_biometrics_help")}
          canIncludeBiometrics={profile.is_super_admin === true}
        />

        <div className="card border border-warning/30 bg-warning/[0.06]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <p className="text-xs text-warning/90 leading-relaxed">
              {t("backup_warning")}
            </p>
          </div>
        </div>

        <div className="card border border-accent/25 bg-accent/[0.05] space-y-2.5">
          <h3 className="section-title flex items-center gap-2 text-accent">
            <ArchiveRestore className="w-4 h-4 shrink-0" />
            {t("backup_recovery_title")}
          </h3>
          <p className="text-xs text-text-soft leading-relaxed">
            {t("backup_recovery_body")}
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1.5 text-xs text-text-soft leading-relaxed">
            <li>{t("backup_recovery_export")}</li>
            <li>{t("backup_recovery_separate")}</li>
            <li>{t("backup_recovery_verify")}</li>
          </ol>
        </div>

        {/* Operators must know the browser ZIP limits before a restore drill. */}
        <div className="card border border-danger/30 bg-danger-soft space-y-2">
          <h3 className="section-title flex items-center gap-2 text-danger">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            {t("backup_limits_title")}
          </h3>
          <ul className="list-disc list-outside ml-5 space-y-1.5 text-xs text-text-soft leading-relaxed">
            <li>{t("backup_limits_biometric")}</li>
            <li>{t("backup_limits_auth")}</li>
            <li>{t("backup_limits_secrets")}</li>
            <li>{t("backup_limits_storage")}</li>
          </ul>
        </div>

        <div className="card text-xs text-text-soft leading-relaxed space-y-2">
          <h3 className="section-title">{t("backup_zip_contents")}</h3>
          <ul className="list-disc list-outside ml-5 space-y-1">
            <li>
              <code className="text-accent">tables/*.json</code> — {t("backup_zip_tables")}
            </li>
            <li>
              <code className="text-accent">buckets/*.manifest.json</code> —{" "}
              {t("backup_zip_buckets")}
            </li>
            <li>
              <code className="text-accent">manifest.json</code> — {t("backup_zip_manifest")}
            </li>
            <li>
              <code className="text-accent">README.txt</code> — {t("backup_zip_readme")}
            </li>
          </ul>
          <p className="pt-2 border-t border-text-muted/5 text-[10px] text-text-muted">
            {t("backup_audited_as")}{" "}
            <code className="text-warning">BACKUP_DOWNLOAD</code> ·{" "}
            <code className="text-warning">BACKUP_DOWNLOAD_BIOMETRIC</code>
          </p>
        </div>
      </div>
    </>
  );
}

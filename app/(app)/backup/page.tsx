import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { BackupButton } from "./backup-button";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await requireAdmin();
  const { t } = await getT();

  return (
    <>
      <PageHeader title={t("backup_title")} subtitle={t("backup_subtitle")} />

      <div className="max-w-2xl space-y-4 mt-4">
        <BackupButton label={t("backup_download")} />

        <div className="card border border-warning/30 bg-warning/[0.06]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <p className="text-xs text-warning/90 leading-relaxed">
              {t("backup_warning")}
            </p>
          </div>
        </div>

        <div className="card text-xs text-text-soft leading-relaxed space-y-2">
          <h3 className="section-title">
            What&apos;s in the ZIP
          </h3>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <code className="text-accent">tables/*.json</code> — row dumps for{" "}
              <code>profiles · cameras · suspects · alerts · alert_rules ·
              audit_log · recordings · reveal_jobs · webhooks ·
              camera_permissions · masking_schedules · retention_policies</code>
            </li>
            <li>
              <code className="text-accent">buckets/*.manifest.json</code> —
              storage object lists (names + sizes only, no blob bytes)
            </li>
            <li>
              <code className="text-accent">README.txt</code> — row counts +
              restore instructions
            </li>
          </ul>
          <p className="pt-2 border-t border-text-muted/5 text-[10px] text-text-muted">
            Action audited as{" "}
            <code className="text-warning">BACKUP_DOWNLOAD</code>.
          </p>
        </div>
      </div>
    </>
  );
}

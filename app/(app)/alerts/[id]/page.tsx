import { notFound } from "next/navigation";
import { Bell, Camera, Clock, UserRound } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { FaceThumb } from "@/components/face-thumb";
import { formatDate, pct } from "@/lib/utils";
import { asAlertState, alertStateLabelKey, stateBadgeVariant } from "@/lib/alerts";
import { recordingFaceHref, UUID_RE } from "@/lib/workflow-query";
import { AlertMobileActions } from "./alert-mobile-actions";
import type { AlertLabel } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getT();
  const supabase = await createClient();
  const { data: alert, error } = await supabase.from("alerts").select(
    "id,suspect_id,suspect_name,similarity,camera_id,camera_name,face_id,state,label,note,created_at,last_seen_at,match_count,acknowledged_at,closed_at,face:faces(recording_id,filename,crop_sealed)",
  ).eq("id", id).maybeSingle();
  if (error || !alert) notFound();
  const face = Array.isArray(alert.face) ? alert.face[0] : alert.face;
  const playbackHref = alert.face_id ? recordingFaceHref(face?.recording_id ?? null, alert.face_id) : null;
  const state = asAlertState(alert.state);
  const label = (alert.label ?? "unknown") as AlertLabel;

  return (
    <div className="pb-52 lg:pb-4">
      <PageHeader
        title={alert.suspect_name}
        subtitle={`${alert.camera_name ?? "—"} · ${formatDate(alert.created_at)}`}
        icon={<Bell className="h-5 w-5" />}
        breadcrumbs={[{ label: t("alerts_title"), href: "/alerts" }, { label: alert.suspect_name }]}
      />
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="card overflow-hidden p-0">
          <div className="relative aspect-square bg-bg-tertiary">
            {alert.face_id ? <FaceThumb faceId={alert.face_id} alt={alert.suspect_name} sealed={face?.crop_sealed} className="absolute inset-0" /> : <div className="flex h-full items-center justify-center text-text-muted"><UserRound className="h-16 w-16" /></div>}
          </div>
        </section>
        <section className="card space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant={alert.similarity >= 0.7 ? "danger" : "warning"}>{pct(alert.similarity)}</Badge>
            <Badge variant={stateBadgeVariant(state)}>{t(alertStateLabelKey(state))}</Badge>
            <Badge variant={label === "true_positive" ? "success" : label === "false_positive" ? "danger" : "muted"}>{label === "true_positive" ? t("al_true_positive") : label === "false_positive" ? t("al_false_positive") : "—"}</Badge>
          </div>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-text-muted">{t("camera_name")}</dt><dd className="mt-1 flex items-center gap-2 font-medium"><Camera className="h-4 w-4 text-text-muted" />{alert.camera_name ?? "—"}</dd></div>
            <div><dt className="text-xs text-text-muted">{t("col_when")}</dt><dd className="mt-1 flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-text-muted" />{formatDate(alert.created_at)}</dd></div>
            <div><dt className="text-xs text-text-muted">{t("al_last_seen")}</dt><dd className="mt-1 font-medium">{alert.last_seen_at ? formatDate(alert.last_seen_at) : "—"}</dd></div>
            <div><dt className="text-xs text-text-muted">{t("col_total")}</dt><dd className="mt-1 font-medium">{alert.match_count ?? 1}</dd></div>
          </dl>
          <div>
            <p className="text-xs text-text-muted">{t("al_note")}</p>
            <p className="mt-1 min-h-16 whitespace-pre-wrap rounded-xl border border-border bg-bg-secondary/40 p-3 text-sm text-text-soft">{alert.note || "—"}</p>
          </div>
        </section>
      </div>
      <div className="mx-auto mt-5 max-w-5xl">
        <AlertMobileActions id={id} state={state} label={label} note={alert.note} playbackHref={playbackHref} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Bell, BriefcaseBusiness, Camera, Clock, Download, Film, LockKeyhole, Search, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { FaceThumb } from "@/components/face-thumb";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { formatDate, pct } from "@/lib/utils";
import { incidentCopy, incidentPriorityLabel, incidentStatusLabel } from "@/lib/incident-copy";
import { incidentPriorityVariant, incidentStatusVariant, isIncidentPriority, isIncidentStatus } from "@/lib/incidents";
import { recordingFaceHref, UUID_RE } from "@/lib/workflow-query";
import { workflowCopy } from "@/lib/workflow-copy";
import {
  AttachAlertForm,
  AttachRecordingForm,
  EvidenceExportButton,
  EvidenceHoldButton,
  IncidentUpdateForm,
  type AdminOption,
  type AlertOption,
  type RecordingOption,
} from "../incident-forms";
import type { Incident } from "@/lib/database.types";

type LinkedAlert = {
  added_at: string;
  alert: {
    id: string; suspect_id: string | null; suspect_name: string; camera_id: string | null;
    camera_name: string | null; similarity: number; created_at: string; state: string; face_id: string | null;
  } | null;
};
type LinkedFace = {
  added_at: string;
  face: {
    id: string; filename: string; crop_sealed: boolean; detected_at: string; recording_id: string | null;
    recordings: { filename: string } | null; cameras: { name: string } | null;
  } | null;
};
type LinkedRecording = {
  id: string;
  recording_id: string | null;
  recording_filename: string;
  camera_name: string | null;
  recording_started_at: string;
  clip_start_sec: number;
  clip_end_sec: number;
  note: string | null;
  legal_hold: boolean;
  added_at: string;
};

function eventLabel(type: string, copy: ReturnType<typeof incidentCopy>) {
  if (type === "created") return copy.eventCreated;
  if (type === "updated") return copy.eventUpdated;
  if (type === "note_added") return copy.eventNote;
  if (type === "alert_attached") return copy.eventAlert;
  if (type === "face_attached") return copy.eventFace;
  if (type === "recording_attached") return copy.eventRecording;
  if (type === "hold_changed") return copy.eventHold;
  if (type === "package_exported") return copy.eventPackage;
  return type;
}

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { lang } = await getT();
  const copy = incidentCopy(lang);
  const workflow = workflowCopy(lang);
  const supabase = await createClient();

  const [incidentRes, adminRes, linkedAlertRes, linkedFaceRes, linkedRecordingRes, exportRes, eventRes, recentAlertRes, recentRecordingRes] = await Promise.all([
    supabase.from("incidents").select("*").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("id,email,full_name").eq("role", "admin").order("email"),
    supabase.from("incident_alerts").select("added_at, alert:alerts(id,suspect_id,suspect_name,camera_id,camera_name,similarity,created_at,state,face_id)").eq("incident_id", id).order("added_at", { ascending: false }),
    supabase.from("incident_faces").select("added_at, face:faces(id,filename,crop_sealed,detected_at,recording_id,recordings:recordings(filename),cameras:cameras(name))").eq("incident_id", id).order("added_at", { ascending: false }),
    supabase.from("incident_recordings").select("id,recording_id,recording_filename,camera_name,recording_started_at,clip_start_sec,clip_end_sec,note,legal_hold,added_at").eq("incident_id", id).order("added_at", { ascending: false }),
    supabase.from("incident_evidence_exports").select("id,manifest_sha256,file_count,package_bytes,created_by_email,created_at").eq("incident_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("incident_events").select("id,event_type,detail,actor_email,created_at").eq("incident_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300),
    supabase.from("alerts").select("id,suspect_name,camera_name,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("recordings").select("id,filename,camera_name,duration_sec,started_at,capture_status").eq("capture_status", "ready").order("started_at", { ascending: false }).limit(100),
  ]);

  if (!incidentRes.data) notFound();
  if (!isIncidentStatus(incidentRes.data.status) || !isIncidentPriority(incidentRes.data.priority)) notFound();
  const incident = incidentRes.data as Incident;
  const admins = (adminRes.data ?? []) as AdminOption[];
  const linkedAlerts = (linkedAlertRes.data ?? []) as unknown as LinkedAlert[];
  const linkedFaces = (linkedFaceRes.data ?? []) as unknown as LinkedFace[];
  const linkedRecordings = (linkedRecordingRes.data ?? []) as unknown as LinkedRecording[];
  const linkedAlertIds = new Set(linkedAlerts.map((row) => row.alert?.id).filter(Boolean));
  const alertOptions: AlertOption[] = (recentAlertRes.data ?? [])
    .filter((alert) => !linkedAlertIds.has(alert.id))
    .map((alert) => ({ id: alert.id, label: `${alert.suspect_name} · ${alert.camera_name ?? "—"} · ${formatDate(alert.created_at)}` }));
  const recordingOptions: RecordingOption[] = (recentRecordingRes.data ?? []).map((recording) => ({
    id: recording.id,
    label: `${recording.camera_name ?? "—"} · ${formatDate(recording.started_at)} · ${recording.filename}`,
    durationSec: recording.duration_sec,
  }));
  const assignee = admins.find((admin) => admin.id === incident.assignee_id);

  return (
    <>
      <PageHeader
        title={incident.title}
        subtitle={incident.description ?? copy.subtitle}
        icon={<BriefcaseBusiness className="h-5 w-5" />}
        breadcrumbs={[{ label: copy.title, href: "/incidents" }, { label: incident.title }]}
        actions={
          <>
            <Badge variant={incidentPriorityVariant(incident.priority)}>{incidentPriorityLabel(incident.priority, lang)}</Badge>
            <Badge variant={incidentStatusVariant(incident.status)} dot>{incidentStatusLabel(incident.status, lang)}</Badge>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-secondary/50 px-4 py-3 text-xs text-text-soft">
        <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{copy.owner}: {assignee?.full_name || assignee?.email || copy.unassigned}</span>
        <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{copy.created}: {formatDate(incident.created_at)}</span>
        <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{copy.updated}: {formatDate(incident.updated_at)}</span>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-5">
          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title flex items-center gap-2"><Bell className="h-4 w-4 text-warning" />{copy.alerts} <Badge>{linkedAlerts.length}</Badge></h2>
            </div>
            <AttachAlertForm incidentId={id} alerts={alertOptions} />
            {linkedAlerts.length === 0 ? <Empty size="compact" icon={Bell} message={copy.noAlerts} /> : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {linkedAlerts.map(({ alert, added_at }) => alert && (
                  <div key={alert.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-text">{alert.suspect_name}</span><Badge variant={alert.similarity >= 0.7 ? "danger" : "warning"}>{pct(alert.similarity)}</Badge><Badge>{alert.state}</Badge></div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"><span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{alert.camera_name ?? "—"}</span><span>{formatDate(alert.created_at)}</span><span>{copy.attached}: {formatDate(added_at)}</span></p>
                    </div>
                    {alert.suspect_id && <Link href={`/suspects/${alert.suspect_id}` as never} className="btn-ghost btn-sm shrink-0">{copy.details}</Link>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="section-title flex items-center gap-2"><Film className="h-4 w-4 text-info" />{copy.recordingEvidence} <Badge>{linkedRecordings.length}</Badge></h2>
              {linkedRecordings.length > 0 && <EvidenceExportButton incidentId={id} />}
            </div>
            <AttachRecordingForm incidentId={id} recordings={recordingOptions} />
            {linkedRecordings.length === 0 ? <Empty size="compact" icon={Film} message={copy.noRecordingEvidence} /> : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {linkedRecordings.map((item) => (
                  <article key={item.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">{item.recording_filename}</p>
                        <p className="mt-1 text-xs text-text-muted">{item.camera_name ?? "—"} · {formatDate(item.recording_started_at)}</p>
                      </div>
                      <Badge variant={item.legal_hold ? "warning" : "muted"}>
                        {item.legal_hold && <LockKeyhole className="mr-1 h-3 w-3" />}{item.legal_hold ? copy.holdActive : copy.holdReleased}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs font-medium text-text-soft">{Number(item.clip_start_sec).toFixed(1)}s – {Number(item.clip_end_sec).toFixed(1)}s</p>
                    {item.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-muted">{item.note}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {item.recording_id && <Link href={`/playback/${item.recording_id}` as never} className="btn-secondary btn-sm">{workflow.openRecording}</Link>}
                      <EvidenceHoldButton incidentId={id} evidenceId={item.id} legalHold={item.legal_hold} />
                    </div>
                  </article>
                ))}
              </div>
            )}
            {(exportRes.data ?? []).length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-soft"><Download className="h-3.5 w-3.5" />{copy.eventPackage}</p>
                <ul className="space-y-1 text-2xs text-text-muted">
                  {(exportRes.data ?? []).map((item) => <li key={item.id} className="break-all">{formatDate(item.created_at)} · {item.file_count} files · SHA-256 {item.manifest_sha256.slice(0, 16)}…</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title flex items-center gap-2"><Search className="h-4 w-4 text-accent" />{copy.evidence} <Badge>{linkedFaces.length}</Badge></h2>
              <Link href={`/search?incident=${id}` as never} className="btn-secondary btn-sm"><Search className="h-3.5 w-3.5" />{copy.searchAndFilter}</Link>
            </div>
            {linkedFaces.length === 0 ? <Empty size="compact" icon={Search} message={copy.noEvidence} /> : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {linkedFaces.map(({ face, added_at }) => face && (
                  <div key={face.id} className="flex gap-3 rounded-xl border border-border p-3">
                    <FaceThumb faceId={face.id} alt={face.filename} sealed={face.crop_sealed} className="h-20 w-20 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 text-xs text-text-muted">
                      <p className="truncate font-medium text-text">{face.recordings?.filename ?? face.filename}</p>
                      <p className="mt-1 truncate">{face.cameras?.name ?? "—"}</p>
                      <p>{formatDate(face.detected_at)}</p>
                      {recordingFaceHref(face.recording_id, face.id) ? <Link href={recordingFaceHref(face.recording_id, face.id)! as never} className="mt-2 inline-flex text-accent hover:underline">{workflow.openRecording}</Link> : <p className="mt-2">{workflow.missingRecording}</p>}
                      <span className="sr-only">{copy.attached}: {formatDate(added_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card space-y-4">
            <h2 className="section-title flex items-center gap-2"><Activity className="h-4 w-4 text-info" />{copy.activity}</h2>
            {eventRes.error ? <p role="alert" className="text-sm text-danger">{copy.unavailable}</p> : (
              <ol className="space-y-0">
                {(eventRes.data ?? []).map((event) => (
                  <li key={event.id} className="relative border-l border-border pb-5 pl-5 last:pb-0">
                    <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-bg-primary bg-accent" />
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-text">{eventLabel(event.event_type, copy)}</p><time className="text-xs text-text-muted">{formatDate(event.created_at)}</time></div>
                    {event.detail && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-soft">{event.detail}</p>}
                    {event.actor_email && <p className="mt-1 text-2xs text-text-muted">{event.actor_email}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside><IncidentUpdateForm incident={incident} admins={admins} /></aside>
      </div>
    </>
  );
}

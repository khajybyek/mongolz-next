"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Search, Loader2, Video, Camera, Clock, Filter, Link2, Check } from "lucide-react";
import { FaceThumb } from "@/components/face-thumb";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { recordingFaceHref } from "@/lib/workflow-query";
import { workflowCopy } from "@/lib/workflow-copy";
import { incidentCopy } from "@/lib/incident-copy";
import { attachFaceToIncidentAction } from "@/app/(app)/incidents/actions";

interface Match {
  id: string;
  filename: string;
  image_path: string;
  crop_sealed?: boolean;
  detected_at: string;
  similarity: number;
  recording_filename: string | null;
  recording_id: string | null;
  camera_id: string | null;
  camera_name: string | null;
}

interface Option { id: string; name: string }
interface IncidentOption { id: string; title: string; status: string }

export function SearchForm({
  cameras,
  incidents,
  initialIncidentId = "",
}: {
  cameras: Option[];
  incidents: IncidentOption[];
  initialIncidentId?: string;
}) {
  const { t, lang } = useT();
  const copy = workflowCopy(lang);
  const incident = incidentCopy(lang);
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incidentId, setIncidentId] = useState(incidents.some((item) => item.id === initialIncidentId) ? initialIncidentId : "");
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [attachingFace, setAttachingFace] = useState<string | null>(null);
  const [, startAttachTransition] = useTransition();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setMatches(null);
    setAttached(new Set());
    const form = new FormData(event.currentTarget);
    form.set("file", file);

    try {
      const res = await fetch("/api/search", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error === "invalid_filters" ? incident.searchInvalid : `${t("search_failed")} (HTTP ${res.status})`);
        return;
      }
      setMatches(body?.matches ?? []);
    } catch {
      setError(t("search_failed"));
    } finally {
      setLoading(false);
    }
  }

  function attachFace(faceId: string) {
    if (!incidentId) return;
    setAttachingFace(faceId);
    startAttachTransition(async () => {
      const result = await attachFaceToIncidentAction(incidentId, faceId);
      setAttachingFace(null);
      if ("error" in result) {
        toast({ title: result.error === "invalid" ? incident.invalid : incident.unavailable, tone: "danger" });
        return;
      }
      setAttached((current) => new Set(current).add(faceId));
      toast({ title: incident.attachedOk, tone: "success", duration: 2000 });
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-accent" />
          <h2 className="section-title">{incident.searchFilters}</h2>
        </div>
        <div>
          <label className="label" htmlFor="search-file">{incident.uploadProbe}</label>
          <input
            id="search-file"
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            className="input file:mr-2 file:rounded file:border-0 file:bg-accent/15 file:px-2 file:py-1 file:text-accent"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="label" htmlFor="search-camera">{copy.camera}</label>
            <select id="search-camera" name="camera_id" defaultValue="" className="select"><option value="">{copy.allCameras}</option>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="search-from">{copy.from}</label>
            <input id="search-from" name="from" type="datetime-local" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="search-to">{copy.to}</label>
            <input id="search-to" name="to" type="datetime-local" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="search-threshold">{incident.threshold}</label>
            <input id="search-threshold" name="threshold" type="number" defaultValue="0.50" min="0.30" max="0.95" step="0.01" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="search-limit">{incident.resultLimit}</label>
            <input id="search-limit" name="limit" type="number" defaultValue="50" min="1" max="100" step="1" className="input" />
          </div>
        </div>
        <p className="text-xs text-text-muted">{incident.kst}</p>
        <button type="submit" disabled={!file || loading} className="btn-primary w-full sm:w-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {incident.searchAndFilter}
        </button>
      </form>

      {error && <div role="alert" className="card border-danger/30 bg-danger/5 text-sm text-danger">{error}</div>}
      {matches && matches.length === 0 && <Empty message={t("search_no_results")} icon={Search} />}

      {matches && matches.length > 0 && (
        <div className="space-y-4">
          <div className="card flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="search-incident">{incident.chooseIncident}</label>
              <select id="search-incident" className="select" value={incidentId} onChange={(event) => { setIncidentId(event.target.value); setAttached(new Set()); }}>
                <option value="">{incident.chooseIncident}</option>
                {incidents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </div>
            {incidentId ? <Link href={`/incidents/${incidentId}` as never} className="btn-secondary shrink-0">{incident.viewIncident}</Link> : <Link href="/incidents" className="btn-secondary shrink-0">{incident.newIncident}</Link>}
          </div>

          <div>
            <h2 className="section-title mb-2">{`${matches.length} ${t("search_matches_suffix")}`}</h2>
            <p className="mb-3 text-xs text-text-muted">{copy.candidate}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {matches.map((match) => {
                const similarity = Math.round(match.similarity * 100);
                const pctColor = similarity >= 70 ? "text-success" : similarity >= 50 ? "text-warning" : "text-text-soft";
                const playbackHref = recordingFaceHref(match.recording_id, match.id);
                const isAttached = attached.has(match.id);
                return (
                  <div key={match.id} className="card space-y-3 p-3">
                    <div className="relative aspect-square overflow-hidden rounded-lg bg-bg-tertiary">
                      <FaceThumb faceId={match.id} alt={match.filename} className="absolute inset-0" sealed={match.crop_sealed} />
                      <div className={`absolute right-1.5 top-1.5 z-10 rounded bg-black/70 px-2 py-1 font-mono text-xs ${pctColor}`}>{similarity}%</div>
                    </div>
                    <div className="space-y-1.5 text-xs text-text-soft">
                      <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{formatDate(match.detected_at)}</span></div>
                      {match.camera_name && <div className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{match.camera_name}</span></div>}
                      {match.recording_filename && <div className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={match.recording_filename}>{match.recording_filename}</span></div>}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {playbackHref ? <a className="btn-secondary btn-sm w-full" href={playbackHref}>{copy.openRecording}</a> : <p className="text-xs text-text-muted">{copy.missingRecording}</p>}
                      <button type="button" className="btn-outline btn-sm w-full" disabled={!incidentId || isAttached || attachingFace === match.id} onClick={() => attachFace(match.id)}>
                        {attachingFace === match.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isAttached ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                        {isAttached ? incident.attached : incident.attach}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Search, Loader2, Video, Camera, Clock, Filter, Link2, Check, ChevronDown } from "lucide-react";
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
interface SearchQuery {
  cameraId: string;
  from: string;
  to: string;
  threshold: string;
  limit: string;
}

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState<SearchQuery | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incidentId, setIncidentId] = useState(incidents.some((item) => item.id === initialIncidentId) ? initialIncidentId : "");
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [attachingFace, setAttachingFace] = useState<string | null>(null);
  const [, startAttachTransition] = useTransition();

  async function requestPage(query: SearchQuery, offset: number, append: boolean) {
    if (!file) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("camera_id", query.cameraId);
    form.set("from", query.from);
    form.set("to", query.to);
    form.set("threshold", query.threshold);
    form.set("limit", query.limit);
    form.set("offset", String(offset));
    try {
      const res = await fetch("/api/search", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error === "invalid_filters" ? incident.searchInvalid : `${t("search_failed")} (HTTP ${res.status})`);
        return;
      }
      const incoming = Array.isArray(body?.matches) ? body.matches as Match[] : [];
      setMatches((current) => {
        if (!append || !current) return incoming;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...incoming.filter((item) => !seen.has(item.id))];
      });
      setHasMore(Boolean(body?.hasMore));
      setNextOffset(typeof body?.nextOffset === "number" ? body.nextOffset : null);
    } catch {
      setError(t("search_failed"));
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData(event.currentTarget);
    const query: SearchQuery = {
      cameraId: String(form.get("camera_id") ?? ""),
      from: String(form.get("from") ?? ""),
      to: String(form.get("to") ?? ""),
      threshold: String(form.get("threshold") ?? "0.50"),
      limit: String(form.get("limit") ?? "50"),
    };
    setMatches(null);
    setAttached(new Set());
    setSearchQuery(query);
    setHasMore(false);
    setNextOffset(null);
    await requestPage(query, 0, false);
  }

  async function loadMore() {
    if (!searchQuery || nextOffset === null || loadingMore) return;
    await requestPage(searchQuery, nextOffset, true);
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
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setMatches(null);
              setSearchQuery(null);
              setHasMore(false);
              setNextOffset(null);
              setAttached(new Set());
            }}
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
            <h2 className="section-title mb-2">{`${incident.loadedResults}: ${matches.length}`}</h2>
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
            {hasMore && nextOffset !== null && (
              <div className="mt-5 flex justify-center">
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                  {incident.loadMore}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

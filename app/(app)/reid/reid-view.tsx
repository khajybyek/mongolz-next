"use client";

import { useEffect, useMemo, useState } from "react";
import { Cctv, Clock, Search, Sparkles } from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { FaceThumb } from "@/components/face-thumb";
import { useT } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";

type Thumb = {
  id: string;
  detected_at: string;
  camera_name: string | null;
};

type TrailItem = {
  face_id: string;
  camera_id: string | null;
  camera_name: string;
  detected_at: string;
  similarity: number;
  recording_id: string | null;
};

type TrailResponse = {
  threshold: number;
  windowHours: number;
  count: number;
  trail: TrailItem[];
};

export function ReidView({ initialThumbs }: { initialThumbs: Thumb[] }) {
  const { t } = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.55);
  const [windowHours, setWindowHours] = useState(24);
  const [trail, setTrail] = useState<TrailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setErr(null);
    const ctrl = new AbortController();
    const url = new URL("/api/reid/trail", window.location.origin);
    url.searchParams.set("face_id", selectedId);
    url.searchParams.set("threshold", threshold.toFixed(2));
    url.searchParams.set("window_hours", String(windowHours));
    fetch(url.toString(), { signal: ctrl.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j?.error || "trail fetch failed");
        setTrail(j as TrailResponse);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedId, threshold, windowHours]);

  const cameraGroups = useMemo(() => {
    if (!trail) return [] as { camera: string; items: TrailItem[] }[];
    const map = new Map<string, TrailItem[]>();
    for (const it of trail.trail) {
      const key = it.camera_name ?? "—";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([camera, items]) => ({ camera, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [trail]);

  const span = useMemo(() => {
    if (!trail || trail.trail.length === 0) return null;
    const first = new Date(trail.trail[0].detected_at).getTime();
    const last = new Date(trail.trail[trail.trail.length - 1].detected_at).getTime();
    return { first, last, dur: last - first };
  }, [trail]);

  const selectedThumb = useMemo(
    () => initialThumbs.find((th) => th.id === selectedId) ?? null,
    [initialThumbs, selectedId],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* Source picker */}
      <aside className="card p-3 space-y-3 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Search className="w-4 h-4 text-accent" />
          {t("reid_pick_source")}
        </div>

        {selectedThumb && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-2">
            <div className="text-[10px] text-accent uppercase tracking-wider font-semibold mb-1.5">
              {t("reid_source")}
            </div>
            <div className="flex gap-2">
              <FaceThumb
                faceId={selectedThumb.id}
                alt=""
                className="w-16 h-16 shrink-0 rounded overflow-hidden border border-accent/40"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate text-text" title={selectedThumb.camera_name ?? ""}>
                  {selectedThumb.camera_name ?? "—"}
                </div>
                <div className="text-[10px] text-text-muted truncate">
                  {formatDate(selectedThumb.detected_at)}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="mt-1 text-[10px] text-text-muted hover:text-danger-ring transition"
                >
                  ✕ {t("reid_clear")}
                </button>
              </div>
            </div>
          </div>
        )}

        {initialThumbs.length === 0 ? (
          <Empty message={t("empty")} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {initialThumbs.map((thumb) => {
              const active = selectedId === thumb.id;
              return (
                <button
                  key={thumb.id}
                  type="button"
                  onClick={() => setSelectedId(thumb.id)}
                  className={
                    "group relative aspect-square overflow-hidden rounded border transition " +
                    (active
                      ? "border-accent ring-2 ring-accent/30 shadow-glow"
                      : "border-border hover:border-accent/40")
                  }
                  title={thumb.camera_name ?? ""}
                >
                  <FaceThumb faceId={thumb.id} alt="" className="absolute inset-0" />
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Trail view */}
      <section className="space-y-4 min-w-0">
        <div className="card p-4 flex flex-wrap gap-4 items-center">
          <div className="text-sm">
            <label className="text-text-soft block text-xs mb-1">{t("reid_threshold")}</label>
            <input
              type="range"
              min={0.3}
              max={0.9}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-40 accent-accent"
              disabled={!selectedId}
            />
            <span className="ml-2 text-text font-mono">{threshold.toFixed(2)}</span>
          </div>
          <div className="text-sm">
            <label className="text-text-soft block text-xs mb-1">{t("reid_window")}</label>
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(parseInt(e.target.value, 10))}
              disabled={!selectedId}
              className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm"
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>3d</option>
              <option value={168}>7d</option>
            </select>
          </div>
          {span && (
            <div className="text-xs text-text-muted ml-auto">
              <span className="mr-3">{t("reid_first")}: {formatDate(new Date(span.first).toISOString())}</span>
              <span>{t("reid_last")}: {formatDate(new Date(span.last).toISOString())}</span>
            </div>
          )}
        </div>

        {!selectedId && (
          <div className="card p-10 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-accent/60" />
            <div className="text-text-soft text-sm">{t("reid_intro")}</div>
          </div>
        )}

        {loading && (
          <div className="card p-10 text-center">
            <Spinner />
          </div>
        )}

        {err && (
          <div className="card border-danger/30 bg-danger-soft p-3 text-sm text-danger-ring">
            {err}
          </div>
        )}

        {trail && !loading && !err && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={t("reid_total")} value={trail.count} />
              <Stat label={t("reid_cameras")} value={cameraGroups.length} />
              <Stat label={t("reid_window")} value={`${trail.windowHours}h`} />
              <Stat label={t("reid_threshold")} value={trail.threshold.toFixed(2)} />
            </div>

            {/* Timeline strip */}
            <div className="card p-3">
              <div className="text-xs text-text-soft mb-2 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {t("reid_timeline")}
              </div>
              <Timeline trail={trail.trail} />
            </div>

            {/* Per-camera buckets */}
            <div className="space-y-3">
              {cameraGroups.map((group) => (
                <div key={group.camera} className="card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text">
                      <Cctv className="w-4 h-4 text-accent" />
                      {group.camera}
                    </div>
                    <div className="text-xs text-text-muted">{group.items.length}</div>
                  </div>
                  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5">
                    {group.items.map((it) => (
                      <a
                        key={it.face_id}
                        href={it.recording_id ? `/playback/${it.recording_id}` : "#"}
                        className="block aspect-square overflow-hidden rounded border border-border hover:border-accent/40 relative group"
                        title={`${formatDate(it.detected_at)} · sim ${(it.similarity * 100).toFixed(0)}%`}
                      >
                        <FaceThumb faceId={it.face_id} alt="" className="absolute inset-0" />
                        <span className="absolute bottom-0 inset-x-0 z-10 bg-bg/80 text-[9px] text-text px-1 py-0.5 truncate">
                          {(it.similarity * 100).toFixed(0)}%
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-text-soft mb-1">{label}</div>
      <div className="text-xl font-semibold text-text">{value}</div>
    </div>
  );
}

function Timeline({ trail }: { trail: TrailItem[] }) {
  if (trail.length < 2) {
    return <div className="text-xs text-text-muted">{trail.length === 1 ? "1" : "0"}</div>;
  }
  const first = new Date(trail[0].detected_at).getTime();
  const last = new Date(trail[trail.length - 1].detected_at).getTime();
  const span = Math.max(last - first, 1);
  const cameras = Array.from(new Set(trail.map((t) => t.camera_name ?? "—")));
  const palette = ["#22d3ee", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#fb7185"];
  return (
    <div>
      <div className="relative h-12 bg-bg-tertiary rounded">
        {trail.map((it) => {
          const left = ((new Date(it.detected_at).getTime() - first) / span) * 100;
          const camIdx = cameras.indexOf(it.camera_name ?? "—");
          const color = palette[camIdx % palette.length];
          return (
            <div
              key={it.face_id}
              title={`${it.camera_name} · ${formatDate(it.detected_at)} · ${(it.similarity * 100).toFixed(0)}%`}
              style={{ left: `${left}%`, background: color, opacity: 0.4 + 0.6 * it.similarity }}
              className="absolute top-1.5 bottom-1.5 w-1 rounded-full -translate-x-1/2"
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {cameras.map((cam, i) => (
          <div key={cam} className="flex items-center gap-1 text-xs text-text-soft">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            {cam}
          </div>
        ))}
      </div>
    </div>
  );
}

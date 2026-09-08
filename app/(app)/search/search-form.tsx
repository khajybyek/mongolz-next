"use client";

import { useState } from "react";
import { Search, Loader2, Video, Camera, Clock } from "lucide-react";
import { FaceThumb } from "@/components/face-thumb";
import { Empty } from "@/components/ui/empty";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface Match {
  id: string;
  filename: string;
  image_path: string;
  crop_sealed?: boolean;
  detected_at: string;
  similarity: number;
  recording_filename: string | null;
  camera_name: string | null;
}

export function SearchForm() {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setMatches(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/search", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`${t("search_failed")} (HTTP ${res.status})`);
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("search_failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card flex items-center gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
          className="input file:bg-accent/15 file:text-accent file:border-0 file:rounded file:px-2 file:py-1 file:mr-2"
        />
        <button type="submit" disabled={!file || loading} className="btn-primary shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {t("search_btn")}
        </button>
      </form>

      {error && (
        <div className="card text-danger text-sm border-danger/30 bg-danger/5">{error}</div>
      )}

      {matches && matches.length === 0 && (
        <Empty message={t("search_no_results")} icon={Search} />
      )}

      {matches && matches.length > 0 && (
        <div>
          <h2 className="section-title mb-3">
            {`${matches.length} ${t("search_matches_suffix")}`}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {matches.map((m) => {
              const pct = Math.round(m.similarity * 100);
              const pctColor = pct >= 70 ? "text-success" : pct >= 50 ? "text-warning" : "text-text-soft";
              return (
                <div key={m.id} className="card p-2 space-y-2">
                  <div className="aspect-square bg-bg-tertiary rounded overflow-hidden relative">
                    <FaceThumb
                      faceId={m.id}
                      alt={m.filename}
                      className="absolute inset-0"
                      sealed={m.crop_sealed}
                    />
                    <div className={`absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded bg-black/60 text-xs font-mono ${pctColor}`}>
                      {pct}%
                    </div>
                  </div>
                  <div className="space-y-1 text-[11px] text-text-soft">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span className="truncate">{formatDate(m.detected_at)}</span>
                    </div>
                    {m.camera_name && (
                      <div className="flex items-center gap-1.5">
                        <Camera className="w-3 h-3 shrink-0" />
                        <span className="truncate">{m.camera_name}</span>
                      </div>
                    )}
                    {m.recording_filename && (
                      <div className="flex items-center gap-1.5">
                        <Video className="w-3 h-3 shrink-0" />
                        <span className="truncate" title={m.recording_filename}>
                          {m.recording_filename}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

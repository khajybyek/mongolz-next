"use client";

import { useState } from "react";
import { Search, Loader2, Video, Camera, Clock } from "lucide-react";
import { FaceThumb } from "@/components/face-thumb";
import { formatDate } from "@/lib/utils";

interface Match {
  id: string;
  filename: string;
  image_path: string;
  detected_at: string;
  similarity: number;
  recording_filename: string | null;
  camera_name: string | null;
}

export function SearchForm() {
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
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
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
          Хайх
        </button>
      </form>

      {error && (
        <div className="card text-danger text-sm border-danger/30 bg-danger/5">{error}</div>
      )}

      {matches && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-text-soft mb-3">
            {matches.length ? `${matches.length} тааралт олдлоо` : "Тааралт олдсонгүй"}
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

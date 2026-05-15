"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

interface Match {
  id: string;
  filename: string;
  image_path: string;
  detected_at: string;
  similarity: number;
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
          <h2 className="text-sm uppercase tracking-wide text-neutral-400 mb-3">
            {matches.length ? `${matches.length} тааралт олдлоо` : "Тааралт олдсонгүй"}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {matches.map((m) => (
              <div key={m.id} className="card p-2">
                <div className="aspect-square bg-bg-tertiary rounded mb-2" />
                <div className="text-xs font-medium truncate">{m.filename}</div>
                <div className="text-[10px] text-neutral-500">
                  {Math.round(m.similarity * 100)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

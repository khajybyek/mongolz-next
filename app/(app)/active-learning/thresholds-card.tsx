"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";

interface ThresholdSuggestion {
  suspect_id: string;
  suspect_name: string;
  suggested_threshold: number | null;
  tp_count: number;
  fp_count: number;
  total_labeled: number;
  error?: string;
}

export function ThresholdsCard() {
  const [data, setData] = useState<ThresholdSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts/suggested-thresholds");
      const j = await res.json();
      setData(j.suspects ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="card mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium">Санал болгож буй threshold-ууд</h3>
        <button onClick={load} disabled={loading} className="btn-ghost text-xs ml-auto">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Шинэчлэх"}
        </button>
      </div>

      {!data ? (
        <p className="text-xs text-neutral-500">Ачаалж байна...</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-neutral-500">Сэжигтэн байхгүй</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.map((s) => (
            <div key={s.suspect_id} className="bg-bg-tertiary rounded p-3 space-y-1">
              <div className="text-xs font-medium truncate">{s.suspect_name}</div>
              {s.total_labeled === 0 ? (
                <div className="text-[10px] text-neutral-500">Шошго байхгүй</div>
              ) : (
                <>
                  <div className="text-2xl font-bold font-mono text-accent">
                    {s.suggested_threshold != null ? Number(s.suggested_threshold).toFixed(2) : "—"}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {s.tp_count} TP · {s.fp_count} FP · {s.total_labeled} нийт
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-neutral-500 leading-relaxed">
        Шошголсон сэрэмжлүүлэг дээр үндэслэн F1-оптимал threshold-ыг тооцоолно.
        Хангалттай data (10+) хуримтлуулсны дараа алдааны түвшин буурна.
      </p>
    </div>
  );
}
